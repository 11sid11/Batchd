// Tampermonkey storage adapter for Batchd.
//
// Exposes the same two-method shape (`{ get, set }`) that
// `src/persist.js` expects from any storage adapter. The Tampermonkey
// sandbox provides `GM_getValue` / `GM_setValue` as global functions;
// this module wraps them with try/catch so quota errors or missing
// globals degrade gracefully (a fresh install with no script storage
// yet would otherwise throw on first read).
//
// Both adapters share the `safeCall` swallow helper so the recovery
// behavior stays consistent across platforms — a quota error in
// Tampermonkey should look the same as one in the chrome extension.
// The contract is identical so `src/persist.js` is platform-agnostic.
//
// The Chrome extension has its own parallel adapter at
// `src/storage.chrome.js` that talks to `chrome.storage.local`. See
// ADR 0004 in `docs/adr/` for the architecture.

import { safeCall } from "./safeCall.js";

export function gmStorage() {
  return {
    get: (k) => {
      const result = safeCall(() => globalThis.GM_getValue(k));
      // safeCall returns undefined on throw; the persist layer relies on
      // undefined (not null) to distinguish "absent" from "set to null".
      return result;
    },
    set: (k, v) => {
      safeCall(() => globalThis.GM_setValue(k, v));
      // safeCall swallows — in-memory state in persist.js is the source
      // of truth within a session; a quota failure here is best-effort.
    },
  };
}