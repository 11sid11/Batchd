// Persistence layer for Batchd.
//
// Storage shape: a single key per store instance. In Node tests we inject an
// in-memory adapter; in the Tampermonkey runtime we inject an adapter that
// wraps GM_getValue/GM_setValue.

export const STATE_KEY = 'batchd_state';

export function defaultState() {
  return {
    cursor: { reposts: null, quoteReposts: null, likes: null },
    processed: [],          // array (not Set) so JSON round-trips cleanly
    config: {
      deleteReposts: true,
      deleteQuoteReposts: true,
      deleteLikes: true,
      dryRun: false,
      pacing: {
        baseMs: 1200,
        jitter: 0.5,
        batchSize: 50,
        batchPauseMs: 60000,
        backoffBaseMs: 30000,
        backoffMaxMs: 300000,
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
      return JSON.parse(raw);
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
