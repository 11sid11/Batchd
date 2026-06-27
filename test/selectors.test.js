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
