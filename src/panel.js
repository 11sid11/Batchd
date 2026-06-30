// Control panel — floating bottom-right overlay.
//
// Renders a single root element (#batchd-panel) and exposes an `actions`
// object via mountPanel() so the entry-point can wire button clicks.

const LOG_MAX = 50;
const CONFIRM_LIKES = 'DELETE';
const CONFIRM_REPLIES = 'DELETE';

export function mountPanel({ store, runSequential, onReset, log = () => {} }) {
  const root = document.createElement('div');
  root.id = 'batchd-panel';
  root.innerHTML = template();
  document.body.appendChild(root);

  injectStyles();

  const state = {
    abortController: null,
    status: 'idle',   // idle | running | paused | done | error
    runStartedAt: 0,
    timerInterval: null,
  };

  // ---- Stopwatch: starts on Go, stops on Stop or natural completion. ----
  function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.runStartedAt = Date.now();
    state.timerInterval = setInterval(updateElapsed, 1000);
    updateElapsed();
  }
  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    updateElapsed();
  }
  function updateElapsed() {
    const el = root.querySelector('[data-elapsed]');
    if (!el) return;
    if (!state.runStartedAt) { el.textContent = '00:00'; return; }
    el.textContent = formatElapsed(Date.now() - state.runStartedAt);
  }
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? pad(h) + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  // Wire up toggles -> store
  for (const key of ['deleteLikes', 'deleteReplies', 'dryRun']) {
    const el = root.querySelector(`[data-toggle="${key}"]`);
    const cfg = store.loadState().config[key];
    if (el) el.checked = cfg;
    el?.addEventListener('change', () => {
      store.updateConfig({ [key]: el.checked });
      // Mutual exclusivity: Likes and Replies work on
      // different URLs, so they cannot be active together.
      if (el.checked && (key === 'deleteLikes' || key === 'deleteReplies')) {
        const otherKey = key === 'deleteLikes' ? 'deleteReplies' : 'deleteLikes';
        const otherEl = root.querySelector('[data-toggle=' + otherKey + ']');
        if (otherEl && otherEl.checked) {
          otherEl.checked = false;
          store.updateConfig({ [otherKey]: false });
        }
      }
      renderStats();
      refreshGoEnabled();
    });
  }

  // Confirmation: Go button stays disabled until the user types the
  // required confirmation string. The required string depends on which
  // mode is active: "DELETE MY REPLIES" if replies is on (with or
  // without likes), otherwise "DELETE". The stronger string wins.
  // Dry run bypasses the gate for either mode.
  const confirmInput = root.querySelector('[data-confirm]');
  const goBtn = root.querySelector('[data-action="go"]');
  const dryRunEl = root.querySelector('[data-toggle="dryRun"]');

  function requiredConfirmText() {
    const cfg = store.loadState().config;
    if (cfg.deleteReplies) return CONFIRM_REPLIES;
    return CONFIRM_LIKES;
  }

  function refreshGoEnabled() {
    if (state.status === 'running') {
      goBtn.disabled = true;
      return;
    }
    if (dryRunEl.checked) {
      goBtn.disabled = false;
      return;
    }
    confirmInput.placeholder = requiredConfirmText();
    goBtn.disabled = confirmInput.value !== requiredConfirmText();
  }

  confirmInput.addEventListener('input', refreshGoEnabled);

  // Goto buttons: click to navigate to the relevant tab.
  // Mirrors the URLs in TAB_PATHS in selectors.js.
  function gotoTab(category) {
    const m = location.pathname.match(/^\/([^/]+)/);
    const username = m ? m[1] : 'me';
    const path = category === 'replies' ? '/with_replies' : '/' + category;
    location.assign('https://x.com/' + username + path);
  }
  for (const cat of ['likes', 'replies']) {
    const btn = root.querySelector('[data-goto=' + cat + ']');
    btn?.addEventListener('click', () => gotoTab(cat));
  }
  refreshGoEnabled();

  // Stop / Reset
  root.querySelector('[data-action="stop"]').addEventListener('click', () => {
    if (state.abortController) {
      state.abortController.abort();
      setStatus('aborting');
      stopTimer();
    }
  });

  root.querySelector('[data-action="reset"]').addEventListener('click', () => {
    if (!confirm('Reset all Batchd state? This clears processed IDs and stats.')) return;
    store.reset();
    onReset?.();
    renderStats();
    appendLog('state reset');
  });

  // Go
  goBtn.addEventListener('click', async () => {
    state.abortController = new AbortController();
    setStatus('running');
    startTimer();
    goBtn.disabled = true;
    try {
      const result = await runSequential({ signal: state.abortController.signal, onProgress: onRunProgress });
      if (result?.reason) appendLog(`${result.status}: ${result.reason}`);
      setStatus(result?.status ?? 'done');
    } catch (err) {
      appendLog(`error: ${err.message}`);
      setStatus('error');
    } finally {
      state.abortController = null;
      stopTimer();
      refreshGoEnabled();
    }
  });

  function setStatus(s) {
    state.status = s;
    root.querySelector('[data-status]').textContent = s;
  }

  function onRunProgress(p) {
    if (p.phase === 'scrolling') {
      const detail = p.eligible == null
        ? `${p.articles} posts, ${p.emptyStreak} empty`
        : `${p.visible} visible, ${p.eligible} eligible, ${p.skippedThisRun} skipped, idle ${p.idleStreak}`;
      root.querySelector('[data-status]').textContent =
        `scrolling (${detail})`;
    } else if (p.phase === 'detecting') {
      root.querySelector('[data-status]').textContent =
        `detecting (${p.visible} visible, ${p.eligible} eligible, ${p.skippedThisRun} skipped, idle ${p.idleStreak})`;
    } else if (p.phase === 'acting') {
      appendLog(`#${p.index + 1} ${p.postId} → ${p.kind}`);
      renderStats();
    }
  }

  // Determine which category the stats boxes should reflect.
  // Looks at the toggles: the active mode is what we are about
  // to run. Falls back to the last category that has any
  // recorded stats, then to 'likes' as a default.
  function activeStatCategory() {
    const cfg = store.loadState().config;
    if (cfg.deleteLikes) return 'likes';
    if (cfg.deleteReplies) return 'replies';
    const stats = store.loadState().stats;
    if (stats && stats.replies && (stats.replies.success + stats.replies.failure + stats.replies.skipped) > 0) return 'replies';
    return 'likes';
  }
  function renderStats() {
    const cat = activeStatCategory();
    const bucket = store.loadState().stats[cat] || { success: 0, failure: 0, skipped: 0 };
    root.querySelector('[data-stats-mode]').textContent = cat;
    root.querySelector('[data-stat="success"]').textContent = bucket.success ?? 0;
    root.querySelector('[data-stat="failure"]').textContent = bucket.failure ?? 0;
    root.querySelector('[data-stat="skipped"]').textContent = bucket.skipped ?? 0;
  }

  function appendLog(line) {
    const el = root.querySelector('[data-log]');
    const ts = new Date().toLocaleTimeString();
    el.textContent = `[${ts}] ${line}\n` + el.textContent;
    const lines = el.textContent.split('\n');
    if (lines.length > LOG_MAX) el.textContent = lines.slice(0, LOG_MAX).join('\n');
    log(line);
  }

  // Initial render
  renderStats();
  refreshGoEnabled();

  return {
    setStatus,
    appendLog,
    renderStats,
  };
}

function template() {
  return `
    <h1>Batchd <button class="secondary" data-action="reset" title="Reset all state" style="padding:2px 8px;font-size:11px;">reset</button></h1>
    <div class="status" data-status>idle</div>
    <div class="elapsed" data-elapsed>00:00</div>
    <div class="toggles">
      <div class="toggle-line">
        <label class="toggle"><input type="checkbox" data-toggle="deleteLikes"> Likes</label>
        <button class="goto" data-goto="likes" title="Open your /likes tab">/likes</button>
      </div>
      <div class="toggle-line">
        <label class="toggle"><input type="checkbox" data-toggle="deleteReplies"> Replies</label>
        <button class="goto" data-goto="replies" title="Open your /with_replies tab">/with_replies</button>
      </div>
      <label class="toggle"><input type="checkbox" data-toggle="dryRun"> Dry run (preview only)</label>
    </div>
    <div class="confirm">
      <label>Type <code id="confirm-required">DELETE</code> to confirm (skipped in dry run):</label>
      <input type="text" data-confirm autocomplete="off" spellcheck="false">
    </div>
    <div class="buttons">
      <button data-action="go">Go</button>
      <button class="secondary" data-action="stop">Stop</button>
    </div>
    <div class="stats">
      <div class="stats-header">stats <span class="stats-mode" data-stats-mode>likes</span></div>
      <div class="stat"><div class="label">success</div><div class="value" data-stat="success">0</div></div>
      <div class="stat"><div class="label">failure</div><div class="value" data-stat="failure">0</div></div>
      <div class="stat"><div class="label">skipped</div><div class="value" data-stat="skipped">0</div></div>
    </div>
    <div class="note">Likes and replies cleanup is best effort. X may hide or stall a few posts; refresh/rerun or remove leftovers manually.</div>
    <div class="log" data-log></div>
    <div class="footer">Maintained by: <a href="https://x.com/sid_flac" target="_blank" rel="noopener noreferrer">@sid_flac</a></div>
  `;
}

function injectStyles() {
  if (document.getElementById('batchd-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'batchd-panel-styles';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

// Inline copy of panel.css — kept in sync manually. (Could be @require'd but
// single-file userscripts are easier to share.)
const PANEL_CSS = `
#batchd-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 320px;
  max-height: 80vh;
  overflow-y: auto;
  background: #15202b;
  color: #e7e9ea;
  border: 1px solid #38444d;
  border-radius: 12px;
  padding: 12px 14px;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  z-index: 9999;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
#batchd-panel h1 { font-size: 14px; font-weight: 700; margin: 0 0 8px; display: flex; justify-content: space-between; align-items: center; }
#batchd-panel .status { font-size: 12px; color: #8b98a5; margin-bottom: 8px; }
#batchd-panel .elapsed { font-size: 11px; color: #6e7681; font-family: ui-monospace, "SF Mono", Menlo, monospace; margin-bottom: 10px; letter-spacing: 0.04em; }
#batchd-panel .toggles { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
#batchd-panel label.toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; }
#batchd-panel .toggle-line { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
#batchd-panel .goto { background: transparent; border: 0; color: #1d9bf0; font-size: 11px; padding: 0 4px; cursor: pointer; font-family: inherit; }
#batchd-panel .goto:hover { text-decoration: underline; }
#batchd-panel .confirm { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
#batchd-panel input[type="text"] { background: #192734; border: 1px solid #38444d; color: #e7e9ea; border-radius: 4px; padding: 4px 6px; font: inherit; }
#batchd-panel .buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
#batchd-panel button { background: #1d9bf0; color: #fff; border: 0; border-radius: 999px; padding: 6px 12px; font: inherit; cursor: pointer; }
#batchd-panel button:disabled { background: #253341; color: #6e7681; cursor: not-allowed; }
#batchd-panel button.secondary { background: #253341; }
#batchd-panel .stats-header { font-size: 10px; color: #6e7681; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; grid-column: 1 / -1; }
#batchd-panel .stats-mode { display: inline-block; background: #253341; color: #1d9bf0; font-size: 10px; padding: 1px 6px; border-radius: 999px; margin-left: 4px; text-transform: lowercase; letter-spacing: 0; font-weight: 600; }
#batchd-panel .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; font-size: 12px; margin-bottom: 8px; }
#batchd-panel .stat { background: #192734; border-radius: 6px; padding: 4px 6px; text-align: center; }
#batchd-panel .stat .label { color: #8b98a5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
#batchd-panel .stat .value { font-weight: 700; font-size: 14px; }
#batchd-panel .note { color: #8b98a5; font-size: 11px; line-height: 1.3; margin: 0 0 8px; }
#batchd-panel .log { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; background: #192734; border-radius: 6px; padding: 4px 6px; max-height: 120px; overflow-y: auto; color: #8b98a5; }
#batchd-panel .footer { font-size: 10px; color: #6e7681; text-align: center; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid #253341; }
#batchd-panel .footer a { color: #8b98a5; text-decoration: none; }
#batchd-panel .footer a:hover { color: #1d9bf0; text-decoration: underline; }
`.trim();











