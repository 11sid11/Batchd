import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickUndo, findEngagedPosts, tabUrl } from '../src/selectors.js';

test('tabUrl only supports likes', () => {
  assert.equal(tabUrl('me', 'likes'), 'https://x.com/me/likes');
  assert.throws(() => tabUrl('me', 'unsupported'), /Unknown category: unsupported/);
});

test('clickUndo treats removed unlike signal as a successful flip', async () => {
  const originalDocument = globalThis.document;
  try {
    let liked = true;
    const article = {
      querySelector(selector) {
        if (!liked) return null;
        if (selector === '[data-testid="unlike"]') return undoButton;
        if (selector === '[aria-label="Liked"]') return undoButton;
        if (selector.startsWith('svg path')) return { closest: () => undoButton };
        return null;
      },
    };
    const anchor = {
      closest(selector) {
        return selector === 'article[data-testid="tweet"]' ? article : null;
      },
    };
    const undoButton = {
      click() {
        liked = false;
      },
    };

    globalThis.document = {
      querySelector(selector) {
        return selector.includes('/status/123') ? anchor : null;
      },
    };

    const result = await clickUndo({
      undoButton,
      postId: '123',
    });

    assert.deepEqual(result.outcome, {
      buttonFound: true,
      responseOk: true,
      buttonStillThere: false,
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

test('clickUndo returns success when the post disappears after the click', async () => {
  const originalDocument = globalThis.document;
  try {
    const undoButton = { click() {} };
    globalThis.document = {
      querySelector() {
        return null;
      },
    };

    const result = await clickUndo({
      undoButton,
      postId: '456',
      article: { isConnected: true },
    });

    // Post was gone after the click — we successfully unliked and X
    // removed the post from the visible timeline (or it was deleted
    // by something else mid-flight). Either way: success.
    assert.deepEqual(result.outcome, { success: true });
  } finally {
    globalThis.document = originalDocument;
  }
});

test('findEngagedPosts dedupes unlike signals for the same liked post', () => {
  const originalDocument = globalThis.document;
  try {
    const link = {
      getAttribute(name) {
        return name === 'href' ? '/someone/status/789' : null;
      },
    };
    const article = {};
    const container = {
      querySelector(selector) {
        return selector.includes('/status/') ? link : null;
      },
      closest(selector) {
        return selector === 'article[data-testid="tweet"]' ? article : null;
      },
      parentElement: null,
    };
    const button = {
      tagName: 'BUTTON',
      parentElement: container,
      closest(selector) {
        return selector === 'button' ? button : null;
      },
    };
    container.parentElement = { querySelector: () => null, parentElement: null };

    globalThis.document = {
      body: {},
      querySelectorAll(selector) {
        if (selector === '[aria-label="Liked"]') return [button];
        if (selector.startsWith('svg path')) return [{ closest: () => button }];
        if (selector === '[data-testid="unlike"]') return [button];
        return [];
      },
    };

    const results = findEngagedPosts('likes');

    assert.equal(results.length, 1);
    assert.equal(results[0].postId, '789');
    assert.equal(results[0].undoButton, button);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('tabUrl resolves replies to the profile Replies tab', () => {
  assert.equal(tabUrl('alice', 'replies'), 'https://x.com/alice/with_replies');
});

test('findEngagedPosts dispatches replies to findReplies', () => {
  const originalDocument = globalThis.document;
  try {
    const moreButton = { tagName: 'BUTTON', isConnected: true };
    const link = { getAttribute: (n) => (n === 'href' ? '/me/status/777' : null) };
    const article = {
      isConnected: true,
      querySelector(selector) {
        if (selector === '[data-testid="tweet"]') return null;
        if (selector === '[data-testid="caret"]') return moreButton;
        if (selector === 'a[href*="/status/"]') return link;
        return null;
      },
    };
    globalThis.document = {
      querySelectorAll(selector) {
        if (selector === 'article[data-testid="tweet"]') return [article];
        return [];
      },
    };

    const results = findEngagedPosts('replies');
    assert.equal(results.length, 1);
    assert.equal(results[0].postId, '777');
    assert.equal(results[0].moreButton, moreButton);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('findReplies skips articles that have no detectable more menu', () => {
  const originalDocument = globalThis.document;
  try {
    const link = { getAttribute: (n) => (n === 'href' ? '/me/status/888' : null) };
    const article = {
      isConnected: true,
      querySelector() { return null; },   // no more menu, no link
    };
    globalThis.document = {
      querySelectorAll(selector) {
        if (selector === 'article[data-testid="tweet"]') return [article];
        return [];
      },
    };

    assert.deepEqual(findEngagedPosts('replies'), []);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('findReplies dedupes articles by post id', () => {
  const originalDocument = globalThis.document;
  try {
    const moreButton = { tagName: 'BUTTON', isConnected: true };
    const link = { getAttribute: (n) => (n === 'href' ? '/me/status/999' : null) };
    const article1 = {
      isConnected: true,
      querySelector(sel) {
        if (sel === '[data-testid="caret"]') return moreButton;
        if (sel === 'a[href*="/status/"]') return link;
        return null;
      },
    };
    const article2 = { ...article1 };   // same post id
    globalThis.document = {
      querySelectorAll(selector) {
        if (selector === 'article[data-testid="tweet"]') return [article1, article2];
        return [];
      },
    };

    const results = findEngagedPosts('replies');
    assert.equal(results.length, 1);
    assert.equal(results[0].postId, '999');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('clickDelete returns stale when the target article is detached', async () => {
  const target = {
    postId: '111',
    moreButton: { isConnected: false },
    article: { isConnected: false },
  };
  const result = await clickDelete(target, { deps: { sleep: async () => {} } });
  assert.deepEqual(result.outcome, { stale: true });
});

test('clickDelete runs the full sequence and waits for the post to disappear', async () => {
  let menuOpenClickCount = 0;
  let itemClickCount = 0;
  let confirmClickCount = 0;
  let waitForGoneCalls = 0;

  const moreButton = {
    isConnected: true,
    click() { menuOpenClickCount++; },
  };
  const article = { isConnected: true };
  const target = { postId: '222', moreButton, article };

  const item = { click() { itemClickCount++; } };
  const confirmBtn = { click() { confirmClickCount++; } };

  const deps = {
    sleep: async () => {},
    openMenu: async () => ({ ok: true }),
    findMenuItem: () => item,
    findConfirmBtn: () => confirmBtn,
    waitForGone: async () => {
      waitForGoneCalls++;
      return { buttonFound: false };   // success: post is gone
    },
  };

  const result = await clickDelete(target, { deps });
  assert.equal(menuOpenClickCount, 1);
  assert.equal(itemClickCount, 1);
  assert.equal(confirmClickCount, 1);
  assert.equal(waitForGoneCalls, 1);
  assert.deepEqual(result.outcome, { buttonFound: false });
});

test('clickDelete returns an error when the more menu does not appear', async () => {
  const target = {
    postId: '333',
    moreButton: { isConnected: true, click() {} },
    article: { isConnected: true },
  };
  const result = await clickDelete(target, {
    deps: {
      sleep: async () => {},
      openMenu: async () => ({ ok: false, outcome: { error: new Error('More menu did not appear') } }),
    },
  });
  assert.ok(result.outcome.error);
  assert.match(result.outcome.error.message, /More menu did not appear/);
});

test('clickDelete returns an error when the Delete menu item is missing', async () => {
  const target = {
    postId: '444',
    moreButton: { isConnected: true, click() {} },
    article: { isConnected: true },
  };
  const result = await clickDelete(target, {
    deps: {
      sleep: async () => {},
      openMenu: async () => ({ ok: true }),
      findMenuItem: () => null,
    },
  });
  assert.ok(result.outcome.error);
  assert.match(result.outcome.error.message, /Delete menu item not found/);
});

test('clickDelete returns an error when the confirm modal never appears', async () => {
  const target = {
    postId: '555',
    moreButton: { isConnected: true, click() {} },
    article: { isConnected: true },
  };
  const result = await clickDelete(target, {
    deps: {
      sleep: async () => {},
      openMenu: async () => ({ ok: true }),
      findMenuItem: () => ({ click() {} }),
      findConfirmBtn: () => null,   // modal never appears
    },
  });
  assert.ok(result.outcome.error);
  assert.match(result.outcome.error.message, /Delete confirm modal not found/);
});

test('clickDelete maps a stuck post to a buttonStillThere=true outcome', async () => {
  const target = {
    postId: '666',
    moreButton: { isConnected: true, click() {} },
    article: { isConnected: true },
  };
  const result = await clickDelete(target, {
    deps: {
      sleep: async () => {},
      openMenu: async () => ({ ok: true }),
      findMenuItem: () => ({ click() {} }),
      findConfirmBtn: () => ({ click() {} }),
      waitForGone: async () => ({ buttonFound: true, responseOk: true, buttonStillThere: true }),
    },
  });
  assert.deepEqual(result.outcome, { buttonFound: true, responseOk: true, buttonStillThere: true });
});

test('clickAction dispatches replies to clickDelete', async () => {
  let called = false;
  const target = { postId: 'r-1', moreButton: {}, article: {} };
  // Inject clickDelete into the dispatcher via the clickAction path:
  // since clickAction is the dispatcher, we verify it by stubbing the
  // module's findEngagedPosts/clickUndo by observing the result that
  // clickAction reaches clickDelete for 'replies'.
  const result = await clickAction('replies', target, {
    deps: {
      sleep: async () => {},
      openMenu: async () => ({ ok: true }),
      findMenuItem: () => ({ click() { called = true; } }),
      findConfirmBtn: () => null,   // forces an error path we can assert
    },
  });
  assert.ok(result.outcome.error);
  assert.match(result.outcome.error.message, /Delete confirm modal not found/);
  assert.equal(called, true);
});

test('findReplies scopes the more button to the target post id, not the parent', () => {
  const originalDocument = globalThis.document;
  try {
    // Simulate X's thread rendering: one article containing the parent
    // post AND the user's reply. The parent's more button is the first
    // [data-testid=caret] in the article; the reply's is nested deeper,
    // in a subtree that contains the link to the reply's status.
    const parentMore = { tagName: 'BUTTON', isConnected: true };
    const replyMore = { tagName: 'BUTTON', isConnected: true };

    const parentLink = { getAttribute: (n) => (n === 'href' ? '/someone/status/111' : null) };
    const replyLink = { getAttribute: (n) => (n === 'href' ? '/me/status/222' : null) };

    // The reply subtree is a div containing replyLink + replyMore.
    const replySubtree = {
      querySelector(sel) {
        if (sel === '[data-testid="caret"]') return replyMore;
  if (sel.includes('/status/')) return replyLink;
        return null;
      },
    };
    // The article-wide query finds the parent's caret first; the
    // scoped walk from replyLink should find replyMore instead.
    const article = {
      isConnected: true,
      querySelector(sel) {
        if (sel === '[data-testid="caret"]') return parentMore;
  if (sel.includes('/status/')) return replyLink;
        return null;
      },
      // querySelectorAll is used by the older 3-signal search when
      // scoped lookups fail; we won't hit it on this test, but keep
      // an empty list as a safety net.
      querySelectorAll: () => [],
    };

    // Override .children-equivalent via a manual walk in findMoreButton.
    // The implementation walks parentElement; we model that by
    // giving the reply link a parentElement chain that reaches the
    // replySubtree first, then the article.
    Object.defineProperty(replyLink, 'parentElement', {
      value: {
        ...replySubtree,
        parentElement: {
          querySelector(sel) {
            if (sel === '[data-testid="caret"]') return null;  // not in this layer
            return null;
          },
          parentElement: {
            ...article,
            parentElement: { parentElement: null },
          },
        },
      },
    });
    globalThis.document = {
      querySelectorAll: (s) => (s === 'article[data-testid="tweet"]' ? [article] : []),
    };

    const results = findEngagedPosts('replies');
    assert.equal(results.length, 1);
    assert.equal(results[0].postId, '222');
    assert.equal(results[0].moreButton, replyMore, "should pick the reply more button, not the parent");
  } finally { globalThis.document = originalDocument; }
});

test('findReplies falls back to the article-wide search when no status link is found', () => {
  const originalDocument = globalThis.document;
  try {
    const moreButton = { tagName: 'BUTTON', isConnected: true };
    const link = { getAttribute: (n) => (n === 'href' ? '/me/status/333' : null) };
    const article = {
      isConnected: true,
      querySelector(sel) {
        if (sel === '[data-testid="caret"]') return moreButton;
        if (sel.includes('/status/')) return link;
        return null;
      },
    };
    globalThis.document = {
      querySelectorAll: (s) => (s === 'article[data-testid="tweet"]' ? [article] : []),
    };
    const results = findEngagedPosts('replies');
    assert.equal(results.length, 1);
    assert.equal(results[0].moreButton, moreButton);
  } finally { globalThis.document = originalDocument; }
});


// Helper: import internals via a small wrapper that mirrors clickDelete's
// dispatch. We test the case-insensitive match by calling the real
// findMenuItemImpl through a synthetic clickDelete that bypasses openMenu.
test('clickDelete closes the menu when Delete is not in it (parent post case)', async () => {
  let escapeDispatched = false;
  const originalDispatch = globalThis.document?.dispatchEvent;
  const originalDocument = globalThis.document;
  try {
    globalThis.document = {
      ...(originalDocument || {}),
      dispatchEvent: (e) => { if (e && e.key === 'Escape') escapeDispatched = true; return true; },
    };
    const target = {
      postId: '999',
      moreButton: { isConnected: true, click() {} },
      article: { isConnected: true },
    };
    // openMenu succeeds, but findMenuItem returns null because the menu
    // contains Follow/Mute/Block (the parent post's menu) — not Delete.
    const result = await clickDelete(target, {
      deps: {
        sleep: async () => {},
        openMenu: async () => ({ ok: true }),
        findMenuItem: () => null,
      },
    });
    assert.equal(escapeDispatched, true, 'should dispatch Escape to close the wrong menu');
    assert.deepEqual(result.outcome, { notDeleteable: true });
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('clickDelete does not close the menu when Delete IS in it', async () => {
  let escapeDispatched = false;
  const originalDocument = globalThis.document;
  try {
    globalThis.document = {
      ...(originalDocument || {}),
      dispatchEvent: () => { escapeDispatched = true; return true; },
    };
    const target = {
      postId: 'r-1',
      moreButton: { isConnected: true, click() {} },
      article: { isConnected: true },
    };
    // Successful full sequence — should NOT trigger Escape.
    await clickDelete(target, {
      deps: {
        sleep: async () => {},
        openMenu: async (t) => { t.moreButton.click(); return { ok: true }; },
        findMenuItem: () => ({ click() {} }),
        findConfirmBtn: () => null,   // modal times out, but we get the "modal not found" path
      },
    });
    assert.equal(escapeDispatched, false, 'should not close the menu when Delete is present');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('clickDelete matches "Delete" menu item case-insensitively through the real finder', async () => {
  // Build a real DOM with the menu and a lowercase "delete" item so
  // we exercise findMenuItemImpl directly (no mock).
  const originalDocument = globalThis.document;
  try {
    const menuItem = { click() {} };
    globalThis.document = {
      querySelectorAll(sel) {
        if (sel === '[role="menuitem"]') return [menuItem];
        return [];
      },
      querySelector(sel) {
        if (sel === '[role="menu"]') return {};   // menu appeared
        if (sel.startsWith('article[data-testid="tweet"]')) return null;
        return null;
      },
    };
    // Override the textContent getter to return lowercase 'delete'.
    Object.defineProperty(menuItem, 'textContent', { value: 'delete' });

    const target = {
      postId: 'r-1',
      moreButton: { isConnected: true, click() {} },
      article: { isConnected: true },
    };
    const result = await clickDelete(target, {
      deps: {
        sleep: async () => {},
        // openMenu does the actual click, returns ok
        openMenu: async (t) => { t.moreButton.click(); return { ok: true }; },
        // findMenuItem NOT provided — falls through to findMenuItemImpl
        findConfirmBtn: () => null,   // modal times out — that path tests downstream
      },
    });
    // We expect the 'modal not found' error since we didn't mock confirm.
    // The point is: we got PAST the menu-item check (no 'notDeleteable'),
    // proving the case-insensitive match worked.
    assert.ok(result.outcome.error, 'expected downstream error');
    assert.match(result.outcome.error.message, /Delete confirm modal not found/);
  } finally { globalThis.document = originalDocument; }
});







test('clickUndo returns stale when the target is detached before the click', async () => {
  const result = await clickUndo({
    undoButton: { isConnected: false, click() {} },
    postId: '789',
    article: { isConnected: true },
  });
  assert.deepEqual(result.outcome, { stale: true });
});

test('clickDelete returns success when the post disappears after the confirm click', async () => {
  const target = {
    postId: 'r-2',
    moreButton: { isConnected: true, click() {} },
    article: { isConnected: true },
  };
  const result = await clickDelete(target, {
    deps: {
      sleep: async () => {},
      openMenu: async (t) => { t.moreButton.click(); return { ok: true }; },
      findMenuItem: () => ({ click() {} }),
      findConfirmBtn: () => ({ click() {} }),
      waitForGone: async () => ({ buttonFound: false }),
    },
  });
  assert.deepEqual(result.outcome, { success: true });
});
