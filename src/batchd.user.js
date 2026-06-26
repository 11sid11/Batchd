// Batchd — Tampermonkey entry point.
//
// Wires the modules together:
//   - createStore backed by GM_getValue / GM_setValue
//   - mountPanel for the floating UI
//   - runCategory from run.js, called sequentially across the configured
//     categories
//
// This file is the entry point. The build script (scripts/build.js) copies
// the other src/*.js files into this one as a single distributable.

// ==UserScript==
// @name         Batchd
// @namespace    batchd
// @version      0.1.0
// @description  Bulk-delete your X.com reposts and likes.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

  // ---- Storage adapter for the persistence layer ----------------------------
  function gmStorage() {
    return {
      get: (k) => {
        try { return GM_getValue(k); } catch { return undefined; }
      },
      set: (k, v) => {
        try { GM_setValue(k, v); } catch { /* quota or disabled */ }
      },
    };
  }

  // ---- Username discovery ----------------------------------------------------
  // We pull the username out of the URL so the run loop can navigate to the
  // correct tabs. /me/reposts also works (X resolves it server-side), so we
  // don't actually need this for navigation — but it's useful for logging.
  function currentUsername() {
    const m = location.pathname.match(/^\/([^/]+)/);
    return m ? m[1] : 'me';
  }

  // ---- Sequential run -------------------------------------------------------
  // Per CONTEXT.md decision #3: Reposts → Quote Reposts → Likes, single linear
  // cursor. In practice, Reposts and Quote Reposts share the same tab and the
  // same undo path (see CONTEXT.md glossary entry), so we collapse them into
  // a single /reposts pass. The two config toggles are honoured as "if either
  // is on, process /reposts".
  const ORDERED_CATEGORIES = ['reposts', 'quoteReposts', 'likes'];

  async function runSequential({ signal, onProgress }) {
    const cfg = panelStore.loadState().config;
    const enabled = ORDERED_CATEGORIES.filter((c) => {
      if (c === 'reposts') return cfg.deleteReposts;
      if (c === 'quoteReposts') return cfg.deleteQuoteReposts;
      if (c === 'likes') return cfg.deleteLikes;
      return false;
    });

    if (enabled.length === 0) {
      panel.appendLog('nothing to do — all toggles are off');
      return { status: 'noop' };
    }

    for (const category of enabled) {
      if (signal?.aborted) return { status: 'aborted' };
      const tab = category === 'likes' ? 'likes' : 'reposts';   // collapse quoteReposts -> reposts
      const result = await runCategory(tab, {
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
      if (result.status !== 'done') return result;
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
  window.__batchd = { store: panelStore, panel };
