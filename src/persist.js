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

const STAT_KEYS = ['success', 'failure', 'skipped', 'consecutiveFailures'];

function emptyStatBucket() {
  return { success: 0, failure: 0, skipped: 0, consecutiveFailures: 0 };
}

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
    // Per-category run counters so the panel can show likes stats when
    // the user is running likes and replies stats when running replies.
    // startedAt and lastActionAt are global (most-recent-run timeline).
    stats: {
      likes: emptyStatBucket(),
      replies: emptyStatBucket(),
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
// (flat `config.pacing = { baseMs, jitter, ... }` for likes only) and
// the v0.2.0 flat `stats = { success, failure, skipped, ... }` shape.
// Both are re-parented under their category. New keys are filled in from
// the current defaults. Idempotent.
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

  // Stats — v0.1.0 was flat (success/failure/skipped at top level).
  // v0.2.0+ is per-category. Re-parent flat counters into stats.likes
  // since the pre-releases only had likes runs.
  if (raw.stats && typeof raw.stats === 'object') {
    const s = raw.stats;
    const hasFlat =
      typeof s.success === 'number' ||
      typeof s.failure === 'number' ||
      typeof s.skipped === 'number' ||
      typeof s.consecutiveFailures === 'number';
    if (hasFlat) {
      next.stats.likes = {
        success: s.success ?? 0,
        failure: s.failure ?? 0,
        skipped: s.skipped ?? 0,
        consecutiveFailures: s.consecutiveFailures ?? 0,
      };
      if (typeof s.startedAt === 'number') next.stats.startedAt = s.startedAt;
      if (typeof s.lastActionAt === 'number') next.stats.lastActionAt = s.lastActionAt;
    } else if (s.likes || s.replies) {
      if (s.likes) next.stats.likes = { ...next.stats.likes, ...s.likes };
      if (s.replies) next.stats.replies = { ...next.stats.replies, ...s.replies };
      if (typeof s.startedAt === 'number') next.stats.startedAt = s.startedAt;
      if (typeof s.lastActionAt === 'number') next.stats.lastActionAt = s.lastActionAt;
    }
  }

  // Failures — best-effort, defaults to fresh.
  if (raw.failures && typeof raw.failures === 'object') {
    next.failures = { ...raw.failures };
  }

  return next;
}

function ensureStatBucket(cache, category) {
  if (!cache.stats[category] || typeof cache.stats[category] !== 'object') {
    cache.stats[category] = emptyStatBucket();
  }
  return cache.stats[category];
}

export function createStore(storage, options = {}) {
  const saveEvery = options.saveEvery ?? 1;
  const log = options.log ?? (() => {});

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
    if (opsSinceFlush >= saveEvery) flush();
  }

  function flush() {
    storage.set(STATE_KEY, JSON.stringify(cache));
    opsSinceFlush = 0;
    log('persist: flushed state to storage');
  }

  return {
    loadState() {
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

    flush,

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

    // Increment a per-category counter (e.g. 'success', 'failure',
    // 'skipped', 'consecutiveFailures'). Global stats (startedAt,
    // lastActionAt) are managed by their own methods.
    bumpStat(category, name, n = 1) {
      if (!STAT_KEYS.includes(name)) {
        throw new Error(`bumpStat: unknown per-category stat name: ${name}`);
      }
      const bucket = ensureStatBucket(cache, category);
      bucket[name] = (bucket[name] ?? 0) + n;
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

    // Set an arbitrary per-category stat. Used by tests; not called
    // from the run loop (which only bumps standard counters).
    setStat(category, name, value) {
      const bucket = ensureStatBucket(cache, category);
      bucket[name] = value;
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
