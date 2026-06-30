// Tampermonkey storage adapter for Batchd.
//
// Exposes the same two-method shape (`{ get, set }`) that
// `src/persist.js` expects from any storage adapter. The Tampermonkey
// sandbox provides `GM_getValue` / `GM_setValue` as global functions;
// this module wraps them with try/catch so quota errors or missing
// globals degrade gracefully (a fresh install with no script storage
// yet would otherwise throw on first read).
//
// The Chrome extension has its own parallel adapter at
// `src/storage.chrome.js` that talks to `chrome.storage.local`. The
// contract is identical so `src/persist.js` is platform-agnostic.
// See ADR 0004 in `docs/adr/` for the architecture.

export function gmStorage() {
  return {
    get: (k) => {
      try {
        return globalThis.GM_getValue(k);
      } catch {
        return undefined;
      }
    },
    set: (k, v) => {
      try {
        globalThis.GM_setValue(k, v);
      } catch {
        // quota or disabled — silently drop, in-memory state in
        // persist.js is the source of truth within a session
      }
    },
  };
}
