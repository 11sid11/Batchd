import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCategory } from '../src/run.js';
import { createStore, defaultState } from '../src/persist.js';

function memoryStorage() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => m.set(k, v),
  };
}

function storeWithConfig(config = {}) {
  const store = createStore(memoryStorage(), { saveEvery: 1 });
  const state = defaultState();
  state.config = {
    ...state.config,
    ...config,
    pacing: {
      ...state.config.pacing,
      baseMs: 0,
      jitter: 0,
      batchSize: 50,
      batchPauseMs: 0,
      backoffBaseMs: 1,
      backoffMaxMs: 1,
      ...(config.pacing || {}),
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
  return { postId, undoButton: {}, needsMenu: false };
}

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
        clickUndo: async (t) => {
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
        clickUndo: async (t) => {
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
    assert.equal(state.stats.failure, 6);
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
        clickUndo: async (t) => {
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
        clickUndo: async () => {
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
        clickUndo: async () => {
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
        clickUndo: async () => {
          first = false;
          return { outcome: { stale: true } };
        },
      },
    });

    const state = store.loadState();
    assert.equal(result.status, 'done');
    assert.equal(state.stats.failure, 0);
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
        clickUndo: async (t) => {
          visible = visible.filter((candidate) => candidate.postId !== t.postId);
          return { outcome: { buttonFound: true, responseOk: true, buttonStillThere: false } };
        },
      },
    });

    assert.equal(result.processed, 3);
    assert.deepEqual(sleeps, [0, 0, 99, 0]);
  });
});
