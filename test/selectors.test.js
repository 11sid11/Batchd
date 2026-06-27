import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickUndo } from '../src/selectors.js';

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
      needsMenu: false,
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
