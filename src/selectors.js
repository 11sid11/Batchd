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
  const undo = UNDO_BUTTON[category];
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const results = [];

  for (const article of articles) {
    const id = extractPostId(article);
    if (!id) continue;

    if (category === 'likes') {
      const btn = article.querySelector('[data-testid="unlike"]');
      if (btn) results.push({ article, postId: id, undoButton: btn, needsMenu: false });
    } else {
      // Reposts + Quote Reposts both live under the same tab.
      // The "Repost" button (data-testid="retweet") opens a menu; the menu's
      // "Undo repost" item is data-testid="unretweet". Both native reposts
      // and quote reposts can be undone from this menu.
      const btn = article.querySelector('[data-testid="retweet"]');
      if (btn) results.push({ article, postId: id, undoButton: btn, needsMenu: true });
    }
  }

  return results;
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
  const start = Date.now();
  const startingTestId = target.undoButton.getAttribute('data-testid');

  while (Date.now() - start < CLICK_FLIP_TIMEOUT_MS) {
    if (signal?.aborted) break;
    // Re-query the same article. The original node may have been replaced.
    const fresh = document.querySelector(`article[data-testid="tweet"] a[href*="/status/${target.postId}"]`)
      ?.closest('article[data-testid="tweet"]');
    if (!fresh) return { buttonFound: false };
    const btn = fresh.querySelector(`[data-testid="${startingTestId}"]`);
    if (!btn) return { buttonFound: true, responseOk: true, buttonStillThere: false };
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
