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

test('clickUndo treats a missing refreshed article as already gone', async () => {
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
    });

    assert.deepEqual(result.outcome, { buttonFound: false });
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

import { findEngagedPosts, clickAction, clickDelete, tabUrl } from '../src/selectors.js';

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
