// Chrome-extension storage adapter for Batchd.
//
// Exposes the same two-method shape (`{ get, set }`) that
// `src/persist.js` expects from any storage adapter. The Chrome
// extension runtime provides `chrome.storage.local` as a callback-
// based async API; this module splits the work into:
//
//   1. `loadChromeStorage()` — async, reads the full contents of
//      `chrome.storage.local` once. The content script awaits this
//      before constructing the adapter so `persist.js` sees a fully
//      populated cache on its first `storage.get(...)` call.
//
//   2. `chromeStorage(initial)` — sync, takes the preloaded contents
//      and returns the `{ get, set }` adapter. `set` updates the
//      in-memory cache synchronously (so `persist.js` reads see the
//      write immediately) and writes through to `chrome.storage.local`
//      fire-and-forget. The cache is the source of truth within a
//      session; the storage backend is the source of truth across
//      sessions.
//
// The Tampermonkey userscript has its own parallel adapter at
// `src/storage.gm.js` that wraps `GM_getValue` / `GM_setValue`. The
// contract is identical so `src/persist.js` is platform-agnostic.
// See ADR 0004 in `docs/adr/` for the architecture.

export function loadChromeStorage() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local?.get) {
      resolve({});
      return;
    }
    try {
      chrome.storage.local.get(null, (items) => {
        // Surface backend errors instead of silently swallowing them —
        // without this, a quota blow-up or invalidated context leaves
        // the user staring at a fresh-install cache with no breadcrumb.
        // Per ADR 0004, we degrade gracefully to {} so persist.js still
        // gets a valid shape, but the warn gives the maintainer a clue.
        if (chrome.runtime?.lastError) {
          console.warn(
            "Batchd: chrome.storage.local.get failed:",
            chrome.runtime.lastError.message
          );
          resolve({});
          return;
        }
        resolve(items || {});
      });
    } catch {
      // Extension context invalidated or storage API threw synchronously.
      // Fall back to an empty cache — same shape the persist layer would
      // see on a fresh install with no prior state.
      resolve({});
    }
  });
}

export function chromeStorage(initial) {
  const cache = { ...(initial || {}) };
  return {
    get: (k) => cache[k],
    set: (k, v) => {
      cache[k] = v;
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
          // Provide a callback so we can observe chrome.runtime.lastError.
          // Writes return synchronously (in-memory cache already updated)
          // so the adapter stays best-effort; we never throw because the
          // running session's cache write already succeeded — losing only
          // the cross-session persistence is preferable to a noisy failure.
          // See ADR 0004 for why persist.js treats the adapter as fire-and-forget.
          chrome.storage.local.set({ [k]: v }, () => {
            if (chrome.runtime?.lastError) {
              console.error(
                "Batchd: chrome.storage.local.set failed:",
                chrome.runtime.lastError.message
              );
            }
          });
        }
      } catch {
        // Extension context invalidated (e.g. mid-update). The in-memory
        // cache still holds the write, so the running session is
        // consistent; only the cross-session persistence is lost.
      }
    },
  };
}
