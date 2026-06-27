// Selectors — the only module that touches the X.com DOM.

const TAB_PATHS = {
  likes: '/likes',
};

// Stable SVG-path signatures for engagement icons. X rotates the
// `data-testid` attributes between front-end releases but the actual SVG
// icon paths are more durable (they only change on a redesign). We use
// these as fallback selectors when the testid no longer matches.
const ICON_PATH = {
  // Filled heart (LIKE present → UNDO click) — the one the user confirmed
  // for the likes tab. Path starts "M20.884 13.19...".
  likedHeart: 'M20.884 13.19',
};

// Cap on scroll attempts with no new items before the watchdog declares
// "end of list." From CONTEXT.md decision #12.
const EMPTY_SCROLL_WATCHDOG = 20;

// Pause between scroll attempts (ms). Lets X's lazy loader fetch + render.
const SCROLL_PAUSE_MS = 800;

// How long to wait for a button click to flip its test ID before declaring
// "stuck" (X didn't honor the click). Pacing-related so lives here.
const CLICK_FLIP_TIMEOUT_MS = 5000;

export function tabUrl(username, category) {
  const path = TAB_PATHS[category];
  if (!path) throw new Error(`Unknown category: ${category}`);
  return `https://x.com/${username}${path}`;
}

export function findEngagedPosts(category) {
  if (category !== 'likes') throw new Error(`Unknown category: ${category}`);

  const results = [];
  const seen = new Set();

  const candidates = collectUnlikeButtons();
  for (const btn of candidates) {
    const { postId, container } = findPostFromButton(btn);
    if (!postId || seen.has(postId)) continue;
    seen.add(postId);
    results.push({ article: container, postId, undoButton: btn });
  }
  return results;
}

// Collect every "unlike" candidate button on the page, deduplicated.
// Three signals, in priority order.
function collectUnlikeButtons() {
  const buttons = new Set();

  // 1. aria-label="Liked" — most stable, set on the actual like button.
  document.querySelectorAll('[aria-label="Liked"]').forEach((el) => {
    const btn = el.closest('button') || el;
    if (btn && btn.tagName === 'BUTTON') buttons.add(btn);
  });

  // 2. Heart SVG path — covers X variants that use a different attribute
  //    set but still draw the filled heart icon. Walk up to a <button>.
  document.querySelectorAll(`svg path[d^="${ICON_PATH.likedHeart}"]`).forEach((path) => {
    const btn = path.closest('button');
    if (btn) buttons.add(btn);
  });

  // 3. data-testid="unlike" — fallback for builds that still emit it.
  document.querySelectorAll('[data-testid="unlike"]').forEach((el) => {
    if (el.tagName === 'BUTTON') buttons.add(el);
    else {
      const btn = el.closest('button');
      if (btn) buttons.add(btn);
    }
  });

  return Array.from(buttons);
}

function findUnlikeButton(container) {
  const labelMatch = container.querySelector('[aria-label="Liked"]');
  if (labelMatch) return labelMatch.closest?.('button') || labelMatch;

  const heartMatch = container.querySelector(`svg path[d^="${ICON_PATH.likedHeart}"]`);
  if (heartMatch) return heartMatch.closest?.('button') || heartMatch;

  const testIdMatch = container.querySelector('[data-testid="unlike"]');
  if (testIdMatch) return testIdMatch.closest?.('button') || testIdMatch;

  return null;
}

// Walk up from a button until we find an ancestor that contains a
// /status/<id> link. That ancestor is the post container; the captured
// id is the post id we'll persist as "processed". Walk is bounded by
// depth and by document.body so we don't blow the stack on a malformed
// tree.
function findPostFromButton(btn) {
  let el = btn.parentElement;
  for (let depth = 0; el && el !== document.body && depth < 25; depth++) {
    const statusLink = el.querySelector(':scope a[href*="/status/"]')
      || el.querySelector('a[href*="/status/"]');
    if (statusLink) {
      const m = statusLink.getAttribute('href').match(/\/status\/(\d+)/);
      if (m) {
        const article = el.closest('article[data-testid="tweet"]') || el;
        return { postId: m[1], container: article };
      }
    }
    el = el.parentElement;
  }
  return { postId: null, container: null };
}

export function extractPostId(articleEl) {
  const link = articleEl.querySelector('a[href*="/status/"]');
  if (!link) return null;
  const m = link.getAttribute('href').match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

export function isCaptchaPresent() {
  // X renders a captcha iframe when it suspects bot activity. There is no
  // stable selector — the iframe title or src contains "captcha". We look
  // for the visible challenge modal as a stronger signal.
  if (document.querySelector('[data-testid="captcha"]')) return true;
  if (document.querySelector('iframe[src*="captcha"]')) return true;
  return false;
}

export async function scrollForMore({ signal } = {}) {
  if (signal?.aborted) return { reason: 'aborted', articles: 0 };
  if (isCaptchaPresent()) return { reason: 'captcha', articles: 0 };

  const before = document.querySelectorAll('article[data-testid="tweet"]').length;
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(SCROLL_PAUSE_MS);
  const after = document.querySelectorAll('article[data-testid="tweet"]').length;

  return {
    reason: 'scrolled',
    articles: after,
    changed: after !== before,
  };
}

export async function clickUndo(target, { signal } = {}) {
  if (target.undoButton?.isConnected === false) {
    return { outcome: { stale: true } };
  }

  target.undoButton.click();

  // Wait for the button to flip (or disappear, or for us to time out).
  const flipped = await waitForFlip(target, signal);
  return { outcome: flipped };
}

async function waitForFlip(target, signal) {
  // Success criterion: the unlike control (by testid OR by heart SVG) is
  // gone from the article — i.e. the like was removed. Either signal is
  // enough because they refer to the same icon (the unlike action removes
  // the fill from the heart, which also flips the testid back to "like").
  const start = Date.now();
  const isUnlikeControl = (article) => findUnlikeButton(article) !== null;

  while (Date.now() - start < CLICK_FLIP_TIMEOUT_MS) {
    if (signal?.aborted) break;
    // Re-query the same article. The original node may have been replaced.
    const fresh = document.querySelector(`article[data-testid="tweet"] a[href*="/status/${target.postId}"]`)
      ?.closest('article[data-testid="tweet"]');
    if (!fresh) return { buttonFound: false };
    if (!isUnlikeControl(fresh)) {
      return { buttonFound: true, responseOk: true, buttonStillThere: false };
    }
    await sleep(100);
  }

  // Timeout: button still there. X did not honor the click.
  return { buttonFound: true, responseOk: true, buttonStillThere: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const TIMING = {
  EMPTY_SCROLL_WATCHDOG,
  SCROLL_PAUSE_MS,
  CLICK_FLIP_TIMEOUT_MS,
};
