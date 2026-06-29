// Persistence layer for Batchd.
//
// Storage shape: a single key per store instance. In Node tests we inject an
// in-memory adapter; in the Tampermonkey runtime we inject an adapter that
// wraps GM_getValue/GM_setValue.

export const STATE_KEY = 'batchd_state';

// Pacing presets. Each category resolves its pacing from here so the run
// loop does not have to know the numbers. Keep this aligned with
// docs/adr/0003-replies-as-mode.md and CONTEXT.md.
export const PACING_PRESETS = {
  likes: {
    baseMs: 1200,
    jitter: 0.5,
    batchSize: 50,
    batchPauseMs: 60000,
    backoffBaseMs: 30000,
    backoffMaxMs: 300000,
  },
  replies: {
    baseMs: 3000,
    jitter: 0.5,
    batchSize: 20,
    batchPauseMs: 90000,
    backoffBaseMs: 60000,
    backoffMaxMs: 600000,
  },
};

export function defaultState() {
  return {
    cursor: { likes: null, replies: null },
    processed: [],          // array (not Set) so JSON round-trips cleanly
    config: {
      deleteLikes: true,
      deleteReplies: false, // off by default — replies are destructive and public
      dryRun: false,
      pacing: {
        likes: { ...PACING_PRESETS.likes },
        replies: { ...PACING_PRESETS.replies },
      },
    },
    stats: {
      success: 0,
      failure: 0,
      skipped: 0,
      consecutiveFailures: 0,
      startedAt: 0,
      lastActionAt: 0,
    },
    failures: {},           // postId -> classification, for diagnostics
  };
}

// Resolve a category's pacing numbers, falling back to the preset if the
// persisted config is missing keys (e.g. after upgrading from a pre-replies
// shape that only had `pacing.baseMs` etc. at the top level).
export function pacingFor(category, cfg) {
  const preset = PACING_PRESETS[category];
  if (!preset) throw new Error(`Unknown pacing category: ${category}`);
  const overrides = cfg?.pacing?.[category] ?? {};
  return { ...preset, ...overrides };
}

// Migrate a state object loaded from storage. Handles the v0.1.0 shape
// (flat `config.pacing = { baseMs, jitter, ... }` for likes only) by
// re-parenting the keys under `config.pacing.likes`. New keys are filled
// in from the current defaults. Idempotent.
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  const next = defaultState();

  // Cursor — keep unknown categories, add new ones.
  if (raw.cursor && typeof raw.cursor === 'object') {
    next.cursor = { ...next.cursor, ...raw.cursor };
  }

  // Processed — array, just keep.
  if (Array.isArray(raw.processed)) next.processed = raw.processed;

  // Config.
  if (raw.config && typeof raw.config === 'object') {
    const c = raw.config;
    if (typeof c.deleteLikes === 'boolean') next.config.deleteLikes = c.deleteLikes;
    if (typeof c.deleteReplies === 'boolean') next.config.deleteReplies = c.deleteReplies;
    if (typeof c.dryRun === 'boolean') next.config.dryRun = c.dryRun;

    // Old shape: config.pacing = { baseMs, jitter, ... } for likes only.
    // New shape: config.pacing = { likes: {...}, replies: {...} }.
    if (c.pacing && typeof c.pacing === 'object') {
      // If new shape already present, take it as-is.
      if (c.pacing.likes || c.pacing.replies) {
        next.config.pacing = {
          likes: { ...PACING_PRESETS.likes, ...(c.pacing.likes || {}) },
          replies: { ...PACING_PRESETS.replies, ...(c.pacing.replies || {}) },
        };
      } else {
        // Old shape — re-parent under `likes`.
        next.config.pacing = {
          likes: { ...PACING_PRESETS.likes, ...c.pacing },
          replies: { ...PACING_PRESETS.replies },
        };
      }
    }
  }

  // Stats and failures — best-effort, defaults to fresh.
  if (raw.stats && typeof raw.stats === 'object') {
    next.stats = { ...next.stats, ...raw.stats };
  }
  if (raw.failures && typeof raw.failures === 'object') {
    next.failures = { ...raw.failures };
  }

  return next;
}

export function createStore(storage, options = {}) {
  const saveEvery = options.saveEvery ?? 1;   // persist every N mutations
  const log = options.log ?? (() => {});

  // Load once at construction. All mutations work against this in-memory
  // copy. We persist every `saveEvery` mutations so a long run doesn't
  // JSON.stringify the entire state on every single click.
  function readFromStorage() {
    const raw = storage.get(STATE_KEY);
    if (raw == null) return defaultState();
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return migrate(parsed);
    } catch {
      return defaultState();
    }
  }

  let cache = readFromStorage();
  let opsSinceFlush = 0;

  function maybeFlush() {
    opsSinceFlush++;
    if (opsSinceFlush >= saveEvery) {
      flush();
    }
  }

  function flush() {
    storage.set(STATE_KEY, JSON.stringify(cache));
    opsSinceFlush = 0;
    log('persist: flushed state to storage');
  }

  return {
    loadState() {
      // Returns a copy so external callers can't mutate the cache by reference
      return JSON.parse(JSON.stringify(cache));
    },

    saveState(state) {
      cache = JSON.parse(JSON.stringify(state));
      flush();
    },

    reset() {
      cache = defaultState();
      flush();
    },

    flush,   // exposed for the run loop to force a save at end-of-session

    processedHas(postId) {
      return cache.processed.includes(postId);
    },

    processedAdd(postId) {
      if (!cache.processed.includes(postId)) {
        cache.processed.push(postId);
        maybeFlush();
      }
    },

    processedSize() {
      return cache.processed.length;
    },

    loadCursor(category) {
      return cache.cursor[category] ?? null;
    },

    saveCursor(category, postId) {
      cache.cursor[category] = postId;
      maybeFlush();
    },

    bumpStat(name, n = 1) {
      cache.stats[name] = (cache.stats[name] ?? 0) + n;
      maybeFlush();
    },

    recordFailure(postId, classification) {
      cache.failures[postId] = classification;
      maybeFlush();
    },

    updateConfig(partial) {
      cache.config = { ...cache.config, ...partial };
      maybeFlush();
    },

    setStat(name, value) {
      cache.stats[name] = value;
      maybeFlush();
    },

    markRunStarted() {
      if (!cache.stats.startedAt) {
        cache.stats.startedAt = Date.now();
        maybeFlush();
      }
    },

    touchLastAction() {
      cache.stats.lastActionAt = Date.now();
      maybeFlush();
    },
  };
}
