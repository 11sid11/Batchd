// Selectors — the only module that touches the X.com DOM.

const TAB_PATHS = {
  likes: '/likes',
  // X's "Replies" tab on the user's own profile. If X changes this URL
  // pattern, this is the only line that needs to move.
  replies: '/with_replies',
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

// How long to wait for an intermediate UI (more-menu, confirm modal) to
// appear after a click. Shorter than CLICK_FLIP_TIMEOUT_MS because the
// menu/modal is rendered client-side; the longer timeout is reserved for
// network round-trips.
const MENU_APPEAR_TIMEOUT_MS = 2000;
const MODAL_APPEAR_TIMEOUT_MS = 5000;

export function tabUrl(username, category) {
  const path = TAB_PATHS[category];
  if (!path) throw new Error(`Unknown category: ${category}`);
  return `https://x.com/${username}${path}`;
}

// Dispatch by category. Each category owns its own detection logic; the
// run loop calls this with whichever category it's currently processing.
export function findEngagedPosts(category) {
  if (category === 'likes') return findLikedPosts();
  if (category === 'replies') return findReplies();
  throw new Error(`Unknown category: ${category}`);
}

// Dispatch by category for the click action. The run loop only ever calls
// this with the category it just ran `findEngagedPosts` for.
export async function clickAction(category, target, opts) {
  if (category === 'likes') return clickUndo(target, opts);
  if (category === 'replies') return clickDelete(target, opts);
  throw new Error(`Unknown category: ${category}`);
}

// ---- LIKES -----------------------------------------------------------------

function findLikedPosts() {
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

// ---- REPLIES ---------------------------------------------------------------

// Find the user's own posts on the replies timeline that we can drive a
// Delete on. We do NOT filter to "only my own posts" via DOM — the source
// view is already filtered by X to the user's own replies, so any
// `article[data-testid="tweet"]` rendered there is a target. If X
// includes suggested/related inserts in the future, callers will need to
// filter via a "by you" marker; for now, presence-of-article is enough.
function findReplies() {
  const results = [];
  const seen = new Set();

  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    if (!article.isConnected) continue;
    const postId = extractPostId(article);
    if (!postId || seen.has(postId)) continue;

    const moreButton = findMoreButton(article);
    if (!moreButton) continue;   // not actionable

    seen.add(postId);
    results.push({ article, postId, moreButton });
  }
  return results;
}

// Locate the "more" / "caret" menu trigger on a post. Three signals, in
// priority order — mirrors collectUnlikeButtons() so a future drift in
// X's DOM only requires updating one place.
function findMoreButton(article) {
  // 1. data-testid="caret" — X's current canonical testid for the more menu.
  const caret = article.querySelector('[data-testid="caret"]');
  if (caret) {
    if (caret.tagName === 'BUTTON') return caret;
    const btn = caret.closest('button');
    if (btn) return btn;
  }

  // 2. aria-label="More" — stable across X releases that localize via labels.
  const labelMatch = article.querySelector('[aria-label="More"]');
  if (labelMatch) {
    if (labelMatch.tagName === 'BUTTON') return labelMatch;
    const btn = labelMatch.closest('button');
    if (btn) return btn;
  }

  // 3. data-testid fallback (X has used both `caret` and `More` historically).
  const moreId = article.querySelector('[data-testid="more"]');
  if (moreId) {
    if (moreId.tagName === 'BUTTON') return moreId;
    const btn = moreId.closest('button');
    if (btn) return btn;
  }

  return null;
}

// Drive the full delete sequence for one reply:
//   1. Open the more-menu
//   2. Click the "Delete" item
//   3. Confirm the delete-post modal
//   4. Wait for the post to disappear from the timeline
// Each step has its own timeout; if any step fails, we return an outcome
// the classifier can map to a failure kind. Steps are exposed as
// individual helpers so tests can pin behavior at each boundary.
export async function clickDelete(target, opts = {}) {
  const { signal, deps = {} } = opts;
  const openMenu   = deps.openMenu       ?? openMoreMenuImpl;
  const findItem   = deps.findMenuItem   ?? findMenuItemImpl;
  const findConf   = deps.findConfirmBtn ?? findConfirmButtonImpl;
  const waitGone   = deps.waitForGone    ?? waitForPostGoneImpl;
  const sleepFn    = deps.sleep          ?? sleep;

  if (target.moreButton?.isConnected === false || target.article?.isConnected === false) {
    return { outcome: { stale: true } };
  }

  // 1. Open the more menu.
  const menuOpen = await openMenu(target, { signal, sleep: sleepFn });
  if (!menuOpen.ok) return { outcome: menuOpen.outcome };

  // 2. Find and click the "Delete" item in the menu.
  const itemHit = findItem({ text: 'Delete' });
  if (!itemHit) return { outcome: { error: new Error('Delete menu item not found') } };
  itemHit.click();

  // 3. Wait for and click the confirm button in the delete-post modal.
  const confBtn = await waitFor(fn => findConf(fn), MODAL_APPEAR_TIMEOUT_MS, { signal, sleep: sleepFn });
  if (!confBtn) return { outcome: { error: new Error('Delete confirm modal not found') } };
  confBtn.click();

  // 4. Wait for the post to disappear.
  const gone = await waitGone(target.postId, { signal, sleep: sleepFn });
  return { outcome: gone };
}

async function openMoreMenuImpl(target, { signal, sleep: sleepFn }) {
  target.moreButton.click();
  // Wait for a menu to appear. We treat any role=menu on the page as the
  // success signal — X renders the menu in a portal at body level, not
  // inside the article.
  const appeared = await waitFor(
    () => document.querySelector('[role="menu"]'),
    MENU_APPEAR_TIMEOUT_MS,
    { signal, sleep: sleepFn }
  );
  if (!appeared) return { ok: false, outcome: { error: new Error('More menu did not appear') } };
  return { ok: true };
}

function findMenuItemImpl({ text }) {
  // X renders dropdown items as role=menuitem. Match exactly on text
  // because the menu contains "Follow", "Mute", "Block", "Delete", etc.
  const items = document.querySelectorAll('[role="menuitem"]');
  for (const item of items) {
    if ((item.textContent || '').trim() === text) return item;
  }
  // Fallback: prefix match, in case X wraps the text in a span.
  for (const item of items) {
    if ((item.textContent || '').trim().startsWith(text)) return item;
  }
  return null;
}

function findConfirmButtonImpl() {
  // The delete-post confirm modal sits inside #layers. X has changed the
  // structure enough times that we cannot rely on a single testid. The
  // order of operations:
  //   1. Find the dialog. Try the canonical testid, then the modal
  //      layer (#layers > div[2]), then any visible role=dialog.
  //   2. Find the destructive "Delete" button inside it by label.
  //   3. Fall back: identify the Cancel button, return the other one.
  //   4. Last resort: per the live X build observed on 2026-06-30,
  //      the buttons container is
  //      `#layers/div[2]/.../div[2]/div[2]/div[2]/button[1]`,
  //      and the Delete button is button[1] (the first in the container).
  //      So with 2 buttons, default to buttons[0].
  let dialog = document.querySelector('[data-testid="tweetDeleteConfirm"]');

  if (!dialog) {
    const layers = document.getElementById('layers');
    const modalLayer = layers && layers.children[1];
    if (modalLayer) {
      dialog = modalLayer.querySelector('[role="dialog"]') || modalLayer;
    }
  }

  if (!dialog) {
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      if (d.offsetParent !== null) { dialog = d; break; }
    }
  }

  if (!dialog) return null;

  const buttons = Array.from(dialog.querySelectorAll('button'));
  if (buttons.length === 0) return null;

  // Diagnostic: log what we found so the user can see why matching
  // succeeded or failed. Stripped in production builds later if noisy.
  if (typeof console !== 'undefined' && console.log) {
    console.log('[batchd] confirm dialog buttons:', buttons.map((b) => ({
      aria: b.getAttribute('aria-label') || '',
      text: (b.textContent || '').trim().slice(0, 30),
    })));
  }
  // 2. Match by accessible name (case-insensitive). X may render the
  //    label as "Delete", "Delete post", or "Delete reply" depending
  //    on the post type and locale.
  const isDeleteLabel = (s) => {
    const t = s.trim().toLowerCase();
    return t === 'delete' || t === 'delete post' || t === 'delete reply';
  };

  for (const btn of buttons) {
    if (isDeleteLabel(btn.getAttribute('aria-label') || '')) return btn;
  }
  for (const btn of buttons) {
    if (isDeleteLabel(btn.textContent || '')) return btn;
  }

  // 3. Two-button heuristic: if one is Cancel, the other is Delete.
  if (buttons.length === 2) {
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim().toLowerCase();
      if (label === 'cancel' || label.startsWith('cancel')) {
        return btn === buttons[0] ? buttons[1] : buttons[0];
      }
    }
    // 4. No clear Cancel label — fall through to positional. With 2
    //    buttons in the current X build, button[1] (XPath 1-based) is
    //    Delete, which is buttons[0] in 0-based.
    return buttons[0];
  }

  // Last resort: first button.
  return buttons[0];
}

async function waitForPostGoneImpl(postId, { signal, sleep: sleepFn }) {
  const start = Date.now();
  while (Date.now() - start < CLICK_FLIP_TIMEOUT_MS) {
    if (signal?.aborted) break;
    const stillThere = document.querySelector(`article[data-testid="tweet"] a[href*="/status/${postId}"]`);
    if (!stillThere) return { buttonFound: false };
    await sleepFn(100);
  }
  return { buttonFound: true, responseOk: true, buttonStillThere: true };
}

// Poll a predicate until it returns truthy, with a timeout. Shared by
// the menu and modal waits. Returns the truthy value or null on timeout.
async function waitFor(predicate, timeoutMs, { signal, sleep: sleepFn } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return null;
    const v = predicate();
    if (v) return v;
    await sleepFn(50);
  }
  return null;
}

// ---- SHARED ----------------------------------------------------------------

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const TIMING = {
  EMPTY_SCROLL_WATCHDOG,
  SCROLL_PAUSE_MS,
  CLICK_FLIP_TIMEOUT_MS,
  MENU_APPEAR_TIMEOUT_MS,
  MODAL_APPEAR_TIMEOUT_MS,
};



