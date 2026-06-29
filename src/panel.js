// Control panel — floating bottom-right overlay.
//
// Renders a single root element (#batchd-panel) and exposes an `actions`
// object via mountPanel() so the entry-point can wire button clicks.

const LOG_MAX = 50;
const CONFIRM_LIKES = 'DELETE';
const CONFIRM_REPLIES = 'DELETE MY REPLIES';

export function mountPanel({ store, runSequential, onReset, log = () => {} }) {
  const root = document.createElement('div');
  root.id = 'batchd-panel';
  root.innerHTML = template();
  document.body.appendChild(root);

  injectStyles();

  const state = {
    abortController: null,
    status: 'idle',   // idle | running | paused | done | error
  };

  // Wire up toggles -> store
  for (const key of ['deleteLikes', 'deleteReplies', 'dryRun']) {
    const el = root.querySelector(`[data-toggle="${key}"]`);
    const cfg = store.loadState().config[key];
    if (el) el.checked = cfg;
    el?.addEventListener('change', () => {
      store.updateConfig({ [key]: el.checked });
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
  refreshGoEnabled();

  // Stop / Reset
  root.querySelector('[data-action="stop"]').addEventListener('click', () => {
    if (state.abortController) {
      state.abortController.abort();
      setStatus('aborting');
    }
  });

  root.querySelector('[data-action="reset"]').addEventListener('click', () => {
    if (!confirm('Reset all Batchd state? This clears processed IDs and stats.')) return;
    store.reset();
    onReset?.();
    renderStats(store.loadState().stats);
    appendLog('state reset');
  });

  // Go
  goBtn.addEventListener('click', async () => {
    state.abortController = new AbortController();
    setStatus('running');
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
      renderStats(store.loadState().stats);
    }
  }

  function renderStats(stats) {
    root.querySelector('[data-stat="success"]').textContent = stats.success ?? 0;
    root.querySelector('[data-stat="failure"]').textContent = stats.failure ?? 0;
    root.querySelector('[data-stat="skipped"]').textContent = stats.skipped ?? 0;
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
  renderStats(store.loadState().stats);
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
    <div class="toggles">
      <label class="toggle"><input type="checkbox" data-toggle="deleteLikes"> Likes</label>
      <label class="toggle"><input type="checkbox" data-toggle="deleteReplies"> Replies</label>
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
      <div class="stat"><div class="label">success</div><div class="value" data-stat="success">0</div></div>
      <div class="stat"><div class="label">failure</div><div class="value" data-stat="failure">0</div></div>
      <div class="stat"><div class="label">skipped</div><div class="value" data-stat="skipped">0</div></div>
    </div>
    <div class="note">Likes and replies cleanup is best effort. X may hide or stall a few posts; refresh/rerun or remove leftovers manually.</div>
    <div class="log" data-log></div>
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
#batchd-panel .toggles { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
#batchd-panel label.toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; }
#batchd-panel .confirm { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
#batchd-panel input[type="text"] { background: #192734; border: 1px solid #38444d; color: #e7e9ea; border-radius: 4px; padding: 4px 6px; font: inherit; }
#batchd-panel .buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
#batchd-panel button { background: #1d9bf0; color: #fff; border: 0; border-radius: 999px; padding: 6px 12px; font: inherit; cursor: pointer; }
#batchd-panel button:disabled { background: #253341; color: #6e7681; cursor: not-allowed; }
#batchd-panel button.secondary { background: #253341; }
#batchd-panel .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; font-size: 12px; margin-bottom: 8px; }
#batchd-panel .stat { background: #192734; border-radius: 6px; padding: 4px 6px; text-align: center; }
#batchd-panel .stat .label { color: #8b98a5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
#batchd-panel .stat .value { font-weight: 700; font-size: 14px; }
#batchd-panel .note { color: #8b98a5; font-size: 11px; line-height: 1.3; margin: 0 0 8px; }
#batchd-panel .log { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; background: #192734; border-radius: 6px; padding: 4px 6px; max-height: 120px; overflow-y: auto; color: #8b98a5; }
`.trim();
