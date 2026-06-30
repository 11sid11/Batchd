// Batchd — Chrome extension entry point.
//
// Mirrors the bootstrap block of `src/batchd.user.js` (the Tampermonkey
// userscript entry point) but uses `chromeStorage` and
// `loadChromeStorage` from `src/storage.chrome.js` instead of
// `gmStorage`. The shared logic in `currentUsername`, `activeCategories`,
// and `runSequential` is identical to the userscript — both entry points
// are wired against the same `Batchd` namespace produced by the build
// script. See ADR 0004 in `docs/adr/` for the architecture.

  // ---- Destructure dependencies from the Batchd namespace ---------------
  // Same pattern as the Tampermonkey entry: the build script writes each
  // module's exports as `Batchd.X = ...`, and we destructure them here.
  const { createStore, mountPanel, runCategory, loadChromeStorage, chromeStorage, checkAndYield } = Batchd;

  // ---- Bootstrap ---------------------------------------------------------
  // The Chrome extension runs the bootstrap as an async IIFE because the
  // initial state must be loaded from `chrome.storage.local` (callback-
  // based, async) before `createStore` reads it. The Tampermonkey
  // bootstrap is synchronous because `GM_getValue` is sync; the only
  // difference is the await point below.
  (async function bootstrap() {

    // ---- Yield check ----------------------------------------------------
    // If a second Batchd instance (the Tampermonkey userscript on a user
    // who installed both) is already running on this window, log a
    // one-time notice and bail. This is the cheap detect-and-yield
    // pattern from CONTEXT.md (term: "Yield check").
    if (checkAndYield('chrome-extension')) return;

    // ---- Preload state from chrome.storage.local ------------------------
    // `persist.js` calls `storage.get(STATE_KEY)` synchronously, so the
    // initial state must already be in the in-memory cache by the time
    // `createStore` runs. `loadChromeStorage` resolves with whatever
    // `chrome.storage.local` currently holds; on a fresh install that's
    // an empty object and `persist.js` falls back to defaults.
    const initial = await loadChromeStorage();
    const storage = chromeStorage(initial);

    // ---- Username discovery --------------------------------------------
    function currentUsername() {
      const m = location.pathname.match(/^\/([^/]+)/);
      return m ? m[1] : 'me';
    }

    // ---- Active categories ---------------------------------------------
    function activeCategories() {
      const cfg = panelStore.loadState().config;
      const want = [];
      if (cfg.deleteReplies) want.push('replies');
      if (cfg.deleteLikes) want.push('likes');
      return want;
    }

    // ---- Run loop -------------------------------------------------------
    // Identical to the Tampermonkey userscript's run loop. The category
    // order is deterministic: replies first, then likes — replies is
    // destructive and public, so we run it before likes so the user
    // sees the higher-stakes progress first.
    async function runSequential({ signal, onProgress }) {
      const categories = activeCategories();
      if (categories.length === 0) {
        panel.appendLog('nothing to do — both Likes and Replies toggles are off');
        return { status: 'noop' };
      }

      for (const category of categories) {
        if (signal?.aborted) return { status: 'aborted' };
        const result = await runCategory(category, {
          store: panelStore,
          username: currentUsername(),
          signal,
          onProgress,
          log: panel.appendLog,
        });
        if (result.status === 'navigated') return result;
        if (result.status === 'blocked' || result.status === 'aborted') return result;
      }
      return { status: 'done' };
    }

    // ---- Wire it up -----------------------------------------------------
    const panelStore = createStore(storage, { saveEvery: 5 });
    const panel = mountPanel({
      store: panelStore,
      runSequential,
      log: () => {},
    });

    // Expose for debugging from the console. The content script runs in
    // Chrome's MV3 isolated world, so `window` here is the page's window
    // (not the isolated world's window) — the same target the
    // Tampermonkey userscript attaches to. That is exactly what makes
    // the detect-and-yield check work across installs.
    window.__batchd = { instance: 'chrome-extension', store: panelStore, panel };
  })();
