import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCategory } from '../src/run.js';
import { createStore, defaultState, PACING_PRESETS } from '../src/persist.js';

function memoryStorage() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => m.set(k, v),
  };
}

// Build a store whose config has fast defaults for the given category.
// Old test code passed `pacing: { baseMs: 0, ... }` which landed on
// `config.pacing` at the top level. After the per-category pacing
// refactor, those overrides must land on `config.pacing[category]`.
function storeWithConfig(config = {}, category = 'likes') {
  const store = createStore(memoryStorage(), { saveEvery: 1 });
  const state = defaultState();
  state.config = {
    ...state.config,
    ...config,
    pacing: {
      ...state.config.pacing,
      [category]: {
        ...state.config.pacing[category],
        baseMs: 0,
        jitter: 0,
        batchSize: 50,
        batchPauseMs: 0,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        ...(config.pacing || {}),
      },
    },
  };
  store.saveState(state);
  return store;
}

function withLocation(path, fn) {
  const originalLocation = globalThis.location;
  globalThis.location = {
    href: `https://x.com/me${path}`,
    assign(url) {
      this.href = url;
    },
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.location = originalLocation;
    });
}

function target(postId) {
  return { postId, undoButton: {} };
}

function replyTarget(postId) {
  return { postId, moreButton: {}, article: {} };
}

test('runCategory throws for an unknown category', async () => {
  await withLocation('/likes', async () => {
    await assert.rejects(
      () => runCategory('bookmarks', { store: storeWithConfig(), username: 'me', deps: { sleep: async () => {}, isCaptchaPresent: () => false, findEngagedPosts: () => [], scrollForMore: async () => ({ reason: 'scrolled', articles: 0 }) } }),
      /Unsupported category: bookmarks/
    );
  });
});

test('likes keep scrolling and process targets that appear after an empty pass', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig();
    const calls = [];
    let visible = [];
    const result = await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 2,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => visible,
        scrollForMore: async () => {
          calls.push('scroll');
          visible = [target('101')];
          return { reason: 'scrolled', articles: visible.length };
        },
        click: async (t) => {
          calls.push(`click:${t.postId}`);
          visible = [];
          return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    assert.equal(result.status, 'done');
    assert.equal(result.processed, 1);
    assert.deepEqual(calls.slice(0, 2), ['scroll', 'click:101']);
    assert.equal(store.processedHas('101'), true);
  });
});

test('likes skip and document non-captcha failures instead of aborting after five', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig();
    const posts = ['1', '2', '3', '4', '5', '6', '7'];
    const failed = new Set();
    const result = await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => posts.filter((id) => !failed.has(id)).map(target),
        scrollForMore: async () => ({ reason: 'scrolled', articles: 0 }),
        click: async (t) => {
          if (t.postId !== '7') {
            failed.add(t.postId);
            return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: true } };
          }
          failed.add(t.postId);
          return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    const state = store.loadState();
    assert.equal(result.status, 'done');
    assert.equal(result.processed, 1);
    assert.equal(store.processedHas('7'), true);
    assert.equal(store.processedHas('1'), false);
    assert.equal(state.stats.likes.failure, 6);
    assert.equal(state.failures['1'], 'unknown');
    assert.equal(state.failures['6'], 'unknown');
  });
});

test('likes do not retry a failed post again in the same session', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig();
    const clickCounts = {};
    await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => [target('201'), target('202')],
        scrollForMore: async () => ({ reason: 'scrolled', articles: 2 }),
        click: async (t) => {
          clickCounts[t.postId] = (clickCounts[t.postId] || 0) + 1;
          return t.postId === '201'
            ? { outcome: { buttonFound: true, responseOk: true, buttonStillThere: true } }
            : { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    assert.equal(clickCounts['201'], 1);
    assert.equal(clickCounts['202'], 1);
  });
});

test('likes stop only after the idle watchdog is exhausted', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig();
    let scrolls = 0;
    const result = await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 3,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => [],
        scrollForMore: async () => {
          scrolls++;
          return { reason: 'scrolled', articles: 0 };
        },
        click: async () => {
          throw new Error('should not click');
        },
      },
    });

    assert.equal(result.status, 'done');
    assert.equal(result.reason, 'idle_watchdog_exhausted');
    assert.equal(scrolls, 3);
  });
});

test('likes reset idle streak after a successful unlike', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig();
    let scrolls = 0;
    let visible = [];
    const result = await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 2,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => visible,
        scrollForMore: async () => {
          scrolls++;
          if (scrolls === 2) visible = [target('301')];
          return { reason: 'scrolled', articles: visible.length };
        },
        click: async () => {
          visible = [];
          return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    assert.equal(result.status, 'done');
    assert.equal(result.processed, 1);
    assert.equal(scrolls, 4);
  });
});

test('likes treat stale targets as a re-query event, not a failure', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig();
    let first = true;
    const result = await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => first ? [target('401')] : [],
        scrollForMore: async () => ({ reason: 'scrolled', articles: 0 }),
        click: async () => {
          first = false;
          return { outcome: { stale: true } };
        },
      },
    });

    const state = store.loadState();
    assert.equal(result.status, 'done');
    assert.equal(state.stats.likes.failure, 0);
    assert.deepEqual(state.failures, {});
  });
});

test('likes pause after exactly the configured number of successful actions', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig({ pacing: { batchSize: 2, batchPauseMs: 99 } });
    let visible = [target('501'), target('502'), target('503')];
    const sleeps = [];
    const result = await runCategory('likes', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async (ms) => sleeps.push(ms),
        isCaptchaPresent: () => false,
        findEngagedPosts: () => visible,
        scrollForMore: async () => ({ reason: 'scrolled', articles: visible.length }),
        click: async (t) => {
          visible = visible.filter((candidate) => candidate.postId !== t.postId);
          return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    assert.equal(result.processed, 3);
    assert.deepEqual(sleeps, [0, 0, 99, 0]);
  });
});

// ---- REPLIES ---------------------------------------------------------------

test('replies navigates to the /with_replies tab when on the wrong page', async () => {
  await withLocation('/likes', async () => {
    const store = storeWithConfig({}, 'replies');
    const result = await runCategory('replies', {
      store,
      username: 'me',
      deps: {
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => [],
        scrollForMore: async () => ({ reason: 'scrolled', articles: 0 }),
        click: async () => ({ outcome: { buttonFound: false } }),
      },
    });
    assert.equal(result.status, 'navigated');
    assert.equal(result.reason, 'wrong_tab');
    assert.equal(globalThis.location.href, 'https://x.com/me/with_replies');
  });
});

test('replies uses the replies pacing preset for base delay', async () => {
  await withLocation('/with_replies', async () => {
    // Use the *real* replies preset (don't zero it out) and verify the
    // pre-action delay observed is the preset's baseMs (3000ms), not the
    // likes preset's (1200ms).
    const store = createStore(memoryStorage(), { saveEvery: 1 });
    store.saveState(defaultState());

    const sleeps = [];
    let visible = [replyTarget('r-1'), replyTarget('r-2')];
    const result = await runCategory('replies', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async (ms) => sleeps.push(ms),
        isCaptchaPresent: () => false,
        findEngagedPosts: () => visible,
        scrollForMore: async () => ({ reason: 'scrolled', articles: visible.length }),
        click: async (t) => {
          visible = visible.filter((candidate) => candidate.postId !== t.postId);
          return { outcome: { success: true } };
        },
      },
    });

    assert.equal(result.processed, 2);
    // baseMs = 3000 ± 50% jitter (0.5)
    for (const s of sleeps.slice(0, 2)) {
      assert.ok(s >= 1500 && s <= 4500, `expected replies base delay in [1500, 4500], got ${s}`);
    }
    // And not the likes numbers (1200 ± 50% = [600, 1800]).
    for (const s of sleeps.slice(0, 2)) {
      assert.ok(s > 1800, `expected replies base delay > 1800ms, got ${s}`);
    }
  });
});

test('replies processes targets and saves the replies cursor separately from likes', async () => {
  await withLocation('/with_replies', async () => {
    const store = storeWithConfig();
    const calls = [];
    let visible = [];
    const result = await runCategory('replies', {
      store,
      username: 'me',
      deps: {
        idleLimit: 2,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => visible,
        scrollForMore: async () => {
          calls.push('scroll');
          visible = [replyTarget('r-101')];
          return { reason: 'scrolled', articles: visible.length };
        },
        click: async (t) => {
          calls.push(`click:${t.postId}`);
          visible = [];
          return { outcome: { success: true } };
        },
      },
    });

    assert.equal(result.status, 'done');
    assert.equal(result.processed, 1);
    assert.deepEqual(calls.slice(0, 2), ['scroll', 'click:r-101']);
    assert.equal(store.processedHas('r-101'), true);
    // Replies cursor is updated; likes cursor is untouched.
    assert.equal(store.loadCursor('replies'), 'r-101');
    assert.equal(store.loadCursor('likes'), null);
  });
});

test('replies skip and document non-captcha failures instead of aborting after five', async () => {
  await withLocation('/with_replies', async () => {
    const store = storeWithConfig({}, 'replies');
    const posts = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
    const failed = new Set();
    const result = await runCategory('replies', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => posts.filter((id) => !failed.has(id)).map(replyTarget),
        scrollForMore: async () => ({ reason: 'scrolled', articles: 0 }),
        click: async (t) => {
          if (t.postId !== 'r7') {
            failed.add(t.postId);
            return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: true } };
          }
          failed.add(t.postId);
          return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    const state = store.loadState();
    assert.equal(result.status, 'done');
    assert.equal(result.processed, 1);
    assert.equal(store.processedHas('r7'), true);
    assert.equal(state.stats.replies.failure, 6);
  });
});

test('replies pause after exactly the configured number of successful actions', async () => {
  await withLocation('/with_replies', async () => {
    const store = storeWithConfig({ pacing: { batchSize: 2, batchPauseMs: 99 } }, 'replies');
    let visible = [replyTarget('r-201'), replyTarget('r-202'), replyTarget('r-203')];
    const sleeps = [];
    const result = await runCategory('replies', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async (ms) => sleeps.push(ms),
        isCaptchaPresent: () => false,
        findEngagedPosts: () => visible,
        scrollForMore: async () => ({ reason: 'scrolled', articles: visible.length }),
        click: async (t) => {
          visible = visible.filter((candidate) => candidate.postId !== t.postId);
          return { outcome: { success: true } };
        },
      },
    });

    assert.equal(result.processed, 3);
    // Two delays at baseMs (0 in this test, since the helper zeros it
    // out for the replies preset), then a 99ms batch pause, then 0 again.
    assert.deepEqual(sleeps, [0, 0, 99, 0]);
  });
});

test('replies treated as separate from likes: same post id processed in one does not block the other', async () => {
  // processed[] is shared. A post id that was processed as a like should
  // be filtered out as a reply too — we never want to click a post
  // twice even if the cursor surfaces it again.
  await withLocation('/with_replies', async () => {
    const store = storeWithConfig();
    store.processedAdd('999');
    const result = await runCategory('replies', {
      store,
      username: 'me',
      deps: {
        idleLimit: 1,
        sleep: async () => {},
        isCaptchaPresent: () => false,
        findEngagedPosts: () => [replyTarget('999')],
        scrollForMore: async () => ({ reason: 'scrolled', articles: 0 }),
        click: async () => { throw new Error('should not click already-processed id'); },
      },
    });
    assert.equal(result.status, 'done');
    assert.equal(result.processed, 0);
  });
});

test('replies default pacing preset is 3000ms base / batchSize 20 / batchPauseMs 90000', () => {
  assert.equal(PACING_PRESETS.replies.baseMs, 3000);
  assert.equal(PACING_PRESETS.replies.jitter, 0.5);
  assert.equal(PACING_PRESETS.replies.batchSize, 20);
  assert.equal(PACING_PRESETS.replies.batchPauseMs, 90000);
  assert.equal(PACING_PRESETS.replies.backoffBaseMs, 60000);
  assert.equal(PACING_PRESETS.replies.backoffMaxMs, 600000);
});


