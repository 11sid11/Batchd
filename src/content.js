// Batchd — Chrome extension content-script entry point.
//
// Wraps `bootstrapBatchd` (src/entry.js) in an async IIFE so we can
// `await loadChromeStorage()` before constructing the adapter.
// `persist.js` calls `storage.get(STATE_KEY)` synchronously, so the
// initial chrome.storage.local contents must already be in the
// in-memory cache by the time `createStore` runs.
//
// The Tampermonkey userscript has a parallel entry point at
// src/batchd.user.js that calls the same bootstrap at top level
// because `gmStorage()` is synchronous. See ADR 0004 in docs/adr/.
//
// `loadChromeStorage` and `chromeStorage` are imported rather than
// referenced as bare identifiers because the build script wraps each
// module in its own inner IIFE (see `scripts/build.js`), which keeps
// local bindings out of every other module's scope. The rewrite step
// turns this `import { ... } from './storage.chrome.js'` line into
// `const { loadChromeStorage, chromeStorage } = Batchd;` inside the
// content script's wrapper, so the bare references below resolve
// against the `Batchd` namespace where `storage.chrome.js` has
// already stashed the functions.

import { loadChromeStorage, chromeStorage } from './storage.chrome.js';
import { bootstrapBatchd } from './entry.js';

(async function bootstrap() {
  const initial = await loadChromeStorage();
  bootstrapBatchd({
    instanceName: 'chrome-extension',
    storage: chromeStorage(initial),
  });
})();