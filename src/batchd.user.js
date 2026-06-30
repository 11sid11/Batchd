// Batchd — Tampermonkey entry point.
//
// Wires the modules together:
//   - gmStorage adapter for the persistence layer (src/storage.gm.js)
//   - mountPanel for the floating UI
//   - runCategory from run.js, called for Likes and/or Replies cleanup
//
// This file is the entry point. The build script (scripts/build.js) copies
// the other src/*.js files into this one as a single distributable.
//
// The Chrome extension has a parallel entry point at extension/content.js
// that uses the chromeStorage adapter (src/storage.chrome.js) instead of
// gmStorage. See ADR 0004 in docs/adr/.

// ==UserScript==
// @name         Batchd
// @namespace    batchd
// @version      0.2.0
// @description  Bulk-delete your X.com likes and replies.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

  // ---- Destructure dependencies from the Batchd namespace ---------------
  // The build script (scripts/build.js) writes each module's exports as
  // `Batchd.X = ...`, so we destructure them here. Without this, bare
  // calls like `createStore(...)` would throw ReferenceError at runtime.
  const { createStore, mountPanel, runCategory, gmStorage, checkAndYield } = Batchd;

  // ---- Yield check ---------------------------------------------------------
  // If a second Batchd instance (the Chrome extension on a user who
  // installed both) is already running on this window, log a one-time
  // notice and bail before touching anything. This is the cheap
  // detect-and-yield pattern from CONTEXT.md (term: "Yield check").
  if (checkAndYield('tampermonkey')) return;

  // ---- Username discovery ----------------------------------------------------
  // We pull the username out of the URL so the run loop can navigate to the
  // correct tab.
  function currentUsername() {
    const m = location.pathname.match(/^\/([^/]+)/);
    return m ? m[1] : 'me';
  }

  // ---- Active categories ----------------------------------------------------
  // The user can tick Likes and/or Replies in the panel. We respect the
  // current page: if we're already on a tab that matches one of the
  // active categories, that category runs first (no navigation). The
  // order is deterministic: replies first, then likes — replies is
  // destructive and public, so we run it before likes so the user sees
  // the higher-stakes progress first.
  function activeCategories() {
    const cfg = panelStore.loadState().config;
    const want = [];
    if (cfg.deleteReplies) want.push('replies');
    if (cfg.deleteLikes) want.push('likes');
    return want;
  }

  // ---- Run loop --------------------------------------------------------------
  // Walks the active categories one at a time. A "navigated" status
  // (returned by runCategory when we had to switch tabs) bubbles up so
  // the panel can stop the session — the user reloads and clicks Go
  // again to resume from the saved cursor.
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
      if (result.status === 'navigated') {
        // We just changed tabs; the page will reload, so stop here.
        // The user clicks Go again on the new tab to continue.
        return result;
      }
      if (result.status === 'blocked' || result.status === 'aborted') {
        return result;
      }
    }
    return { status: 'done' };
  }

  // ---- Bootstrap ------------------------------------------------------------
  const panelStore = createStore(gmStorage(), { saveEvery: 5 });
  const panel = mountPanel({
    store: panelStore,
    runSequential,
    log: () => {},
  });

  // Expose for debugging from the console
  // (Tampermonkey isolates the script; this attaches to window for inspection)
  window.__batchd = { instance: 'tampermonkey', store: panelStore, panel };
