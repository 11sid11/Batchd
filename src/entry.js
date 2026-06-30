// Batchd — shared bootstrap for both install targets.
//
// Both the Tampermonkey userscript (src/batchd.user.js) and the Chrome
// extension content script (src/content.js) hand a storage adapter to
// `bootstrapBatchd()` and otherwise look identical from here down:
// detect-and-yield, panel wiring, the run loop, and stamping
// `window.__batchd` for debug access. Factor it out so a future bug
// fix lands in one place, not two.
//
// The chrome entry point awaits `loadChromeStorage()` before calling
// this helper because `persist.js` reads `storage.get(STATE_KEY)`
// synchronously and the chrome storage backend is callback-based.
// `gmStorage()` is already synchronous, so the Tampermonkey entry can
// call this helper at top level.

import { hasCompetingInstance } from './yield.js';

export function bootstrapBatchd({ instanceName, storage }) {
  const { createStore, mountPanel, runCategory } = Batchd;

  // ---- Yield check ---------------------------------------------------------
  // If a second Batchd instance is already running on this window, log
  // a one-time notice and bail before touching anything. See the
  // "Yield check" term in CONTEXT.md and ADR 0004 for the full rationale.
  if (hasCompetingInstance(instanceName)) return;

  // ---- Username discovery --------------------------------------------------
  // Pull the username out of the URL so the run loop can navigate to
  // the correct tab.
  function currentUsername() {
    const m = location.pathname.match(/^\/([^/]+)/);
    return m ? m[1] : 'me';
  }

  // ---- Active categories ---------------------------------------------------
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

  // ---- Run loop ------------------------------------------------------------
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

  // ---- Bootstrap -----------------------------------------------------------
  const panelStore = createStore(storage, { saveEvery: 5 });
  const panel = mountPanel({
    store: panelStore,
    runSequential,
    log: () => {},
  });

  // Expose for debugging from the console. The chrome content script
  // attaches to the page's window (not the isolated world's), which is
  // the same target the Tampermonkey userscript attaches to — exactly
  // what makes the cross-instance yield check work.
  window.__batchd = { instance: instanceName, store: panelStore, panel };
}