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
// The chrome backend is feature-detected ONCE at construction so the
// hot `set` path skips the `typeof chrome !== "undefined" &&
// chrome.storage?.local?.set` check on every call. Without this
// cache, every persisted state change paid a property-lookup tax
// proportional to the number of state keys the user mutates.
//
// The Tampermonkey userscript has its own parallel adapter at
// `src/storage.gm.js` that wraps `GM_getValue` / `GM_setValue`. The
// contract is identical so `src/persist.js` is platform-agnostic.
// See ADR 0004 in `docs/adr/` for the architecture.

import { safeCall } from "./safeCall.js";

export function loadChromeStorage() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local?.get) {
      resolve({});
      return;
    }
    const invoked = safeCall(() => {
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
    });
    if (invoked === undefined) {
      // safeCall caught a synchronous throw (e.g., extension context
      // invalidated). Fall back to an empty cache — same shape the
      // persist layer would see on a fresh install with no prior state.
      resolve({});
    }
  });
}

export function chromeStorage(initial) {
  const cache = { ...(initial || {}) };
  // Cache the feature-detection result so the hot `set` path doesn't
  // re-check on every write. A freshly-installed extension always
  // sees chrome here, but in a test or stripped-down runtime the
  // check still has to defend against undefined.
  const canWrite =
    typeof chrome !== "undefined" &&
    typeof chrome.storage?.local?.set === "function";
  return {
    get: (k) => cache[k],
    set: (k, v) => {
      cache[k] = v;
      if (!canWrite) return;
      safeCall(() => {
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
      });
    },
  };
}