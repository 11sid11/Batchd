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

(async function bootstrap() {
  const initial = await loadChromeStorage();
  bootstrapBatchd({
    instanceName: 'chrome-extension',
    storage: chromeStorage(initial),
  });
})();