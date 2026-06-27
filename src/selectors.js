// Selectors — the only module that touches the X.com DOM.
//
// Selectors come from prototype/findings/SELECTORS.md. They are stable across
// X's React front-end (2022–present) but X can change them at any time.
// Verification snippet for a logged-in session is in that doc.
//
// This module is browser-only. Tests for it would require JSDOM + a fixture
// page; given the cost we instead verify the selectors manually on first run.

// Profile-tab URLs for the categories Batchd handles.
// Reposts tab is /me/reposts (formerly /me/retweets, redirects).
const TAB_PATHS = {
  reposts: '/reposts',
  quoteReposts: '/reposts',   // X mixes native reposts and quote reposts in the same tab
  likes: '/likes',
};

// The undo-button test ID for each category.
// Reposts: must open the repost-confirm menu first, then click unretweet.
const UNDO_BUTTON = {
  reposts: { primary: 'retweet', menuItem: 'unretweet' },
  quoteReposts: { primary: 'retweet', menuItem: 'unretweet' },
  likes: 'unlike',
};

// Stable SVG-path signatures for each engagement icon. X rotates the
// `data-testid` attributes between front-end releases but the actual SVG
// icon paths are more durable (they only change on a redesign). We use
// these as fallback selectors when the testid no longer matches.
const ICON_PATH = {
  // Filled heart (LIKE present → UNDO click) — the one the user confirmed
  // for the likes tab. Path starts "M20.884 13.19...".
  likedHeart: 'M20.884 13.19',
  // Repost glyph (two arrows in a square) — used as the undo anchor on
  // reposts. We still prefer the testid there because the dropdown flow
  // relies on `[data-testid="retweet"]` opening the menu.
  repostGlyph: 'M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88z',
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
  const results = [];
  const seen = new Set();

  if (category === 'likes') {
    // Strategy: scan for unlike controls anywhere on the page and walk
    // each one up to the enclosing post. This avoids relying on a
    // particular wrapper convention (`<article data-testid="tweet">` vs
    // `<div id="id__<random>">` vs whatever X ships next).
    //
    // We try three signals, in order of stability:
    //   1. `aria-label="Liked"` on a button — X always sets this on the
    //      active like button; very stable across releases.
    //   2. The heart SVG path — the actual icon geometry; survives testid
    //      renames.
    //   3. `[data-testid="unlike"]` — the documented canonical selector;
    //      may have been renamed by the current build.
    // Each signal that hits returns the wrapping button; we then walk up
    // to the post container to capture the post ID.
    const candidates = collectUnlikeButtons();
    for (const btn of candidates) {
      const { postId, container } = findPostFromButton(btn);
      if (!postId || seen.has(postId)) continue;
      seen.add(postId);
      results.push({ article: container, postId, undoButton: btn, needsMenu: false });
    }
    return results;
  }

  // Reposts + Quote Reposts: keep using the article-scoped testid selector.
  // The two-click flow (open menu, click unretweet) is stable on the
  // data-testid attribute, and `data-testid="retweet"` reliably opens the
  // dropdown that contains `data-testid="unretweet"`.
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  for (const article of articles) {
    const id = extractPostId(article);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const btn = article.querySelector('[data-testid="retweet"]');
    if (btn) results.push({ article, postId: id, undoButton: btn, needsMenu: true });
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

export async function scrollUntilExhausted({ onProgress, signal } = {}) {
  // Scroll the page in fixed steps, giving X time to lazy-load each batch.
  // Returns when:
  //   - EMPTY_SCROLL_WATCHDOG consecutive scrolls produced no new articles, OR
  //   - signal.aborted is true.
  let lastCount = -1;
  let emptyStreak = 0;
  let totalScrolled = 0;

  while (emptyStreak < EMPTY_SCROLL_WATCHDOG) {
    if (signal?.aborted) return { reason: 'aborted', totalScrolled };
    if (isCaptchaPresent()) return { reason: 'captcha', totalScrolled };

    window.scrollTo(0, document.body.scrollHeight);
    await sleep(SCROLL_PAUSE_MS);

    const current = document.querySelectorAll('article[data-testid="tweet"]').length;
    if (current > lastCount) {
      lastCount = current;
      emptyStreak = 0;
    } else {
      emptyStreak++;
    }
    totalScrolled++;
    onProgress?.({ articles: current, emptyStreak, totalScrolled });
  }

  return { reason: 'exhausted', totalScrolled, finalCount: lastCount };
}

export async function clickUndo(target, { signal } = {}) {
  // target: { undoButton, needsMenu, postId }
  if (target.needsMenu) {
    target.undoButton.click();
    await sleep(300);   // wait for menu to open
    if (signal?.aborted) return { outcome: { buttonFound: false } };
    const menuItem = document.querySelector('[data-testid="unretweet"]');
    if (!menuItem) return { outcome: { buttonFound: false } };   // already gone
    menuItem.click();
  } else {
    target.undoButton.click();
  }

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
