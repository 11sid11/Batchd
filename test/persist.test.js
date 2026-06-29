import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultState } from '../src/persist.js';

function memoryStorage() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => m.set(k, v),
  };
}

test('loadState returns defaultState when storage is empty', () => {
  const store = createStore(memoryStorage());
  const state = store.loadState();
  assert.deepEqual(state, defaultState());
});

test('loadState returns whatever was last saved', () => {
  const store = createStore(memoryStorage());
  const next = defaultState();
  next.stats.success = 42;
  store.saveState(next);
  const reloaded = store.loadState();
  assert.equal(reloaded.stats.success, 42);
});

test('processedHas returns false for unknown post ids', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.processedHas('999'), false);
});

test('processedAdd adds a post id and processedHas returns true afterwards', () => {
  const store = createStore(memoryStorage());
  store.processedAdd('111');
  assert.equal(store.processedHas('111'), true);
  assert.equal(store.processedHas('222'), false);
});

test('processedSize grows with each unique add', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.processedSize(), 0);
  store.processedAdd('1');
  store.processedAdd('2');
  store.processedAdd('3');
  assert.equal(store.processedSize(), 3);
  store.processedAdd('2');   // duplicate — should not grow
  assert.equal(store.processedSize(), 3);
});

test('processed set survives a save/load round trip', () => {
  const storage = memoryStorage();
  const s1 = createStore(storage);
  s1.processedAdd('abc');
  s1.processedAdd('def');
  // s1 auto-saves on each add; new store backed by the same storage should see them
  const s2 = createStore(storage);
  assert.equal(s2.processedHas('abc'), true);
  assert.equal(s2.processedHas('def'), true);
  assert.equal(s2.processedSize(), 2);
});

test('cursor is null by default for each category', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.loadCursor('likes'), null);
});

test('saveCursor persists per category and loadCursor returns the right value', () => {
  const store = createStore(memoryStorage());
  store.saveCursor('likes', '222');
  assert.equal(store.loadCursor('likes'), '222');
});

test('saveCursor overwrites prior cursor for the same category', () => {
  const store = createStore(memoryStorage());
  store.saveCursor('likes', '111');
  store.saveCursor('likes', '222');
  assert.equal(store.loadCursor('likes'), '222');
});

test('bumpStat increments a stat counter by 1 by default', () => {
  const store = createStore(memoryStorage());
  store.bumpStat('success');
  store.bumpStat('success');
  store.bumpStat('failure');
  const state = store.loadState();
  assert.equal(state.stats.success, 2);
  assert.equal(state.stats.failure, 1);
});

test('bumpStat accepts a custom increment', () => {
  const store = createStore(memoryStorage());
  store.bumpStat('success', 5);
  assert.equal(store.loadState().stats.success, 5);
});

test('recordFailure persists classification by postId', () => {
  const store = createStore(memoryStorage());
  store.recordFailure('111', 'rate_limited');
  store.recordFailure('222', 'network');
  const state = store.loadState();
  assert.equal(state.failures['111'], 'rate_limited');
  assert.equal(state.failures['222'], 'network');
});

test('updateConfig merges partial config without dropping existing keys', () => {
  const store = createStore(memoryStorage());
  store.updateConfig({ deleteLikes: false });
  const state = store.loadState();
  assert.equal(state.config.deleteLikes, false);
  assert.ok(state.config.pacing);                    // preserved
});

test('reset clears all state back to defaults', () => {
  const storage = memoryStorage();
  const s1 = createStore(storage);
  s1.processedAdd('111');
  s1.bumpStat('success', 10);
  s1.recordFailure('222', 'captcha');
  s1.reset();
  const s2 = createStore(storage);
  assert.equal(s2.processedSize(), 0);
  assert.equal(s2.loadState().stats.success, 0);
  assert.deepEqual(s2.loadState().failures, {});
});

test('saveEvery batches writes: storage is not touched until Nth mutation', () => {
  const storage = memoryStorage();
  let writes = 0;
  const countingStorage = {
    get: (k) => storage.get(k),
    set: (k, v) => { writes++; storage.set(k, v); },
  };
  const store = createStore(countingStorage, { saveEvery: 5 });
  // 4 mutations: nothing written yet
  store.processedAdd('1');
  store.processedAdd('2');
  store.processedAdd('3');
  store.processedAdd('4');
  assert.equal(writes, 0);
  // 5th mutation: one write
  store.processedAdd('5');
  assert.equal(writes, 1);
  // 6th-9th: still 1 write
  store.processedAdd('6');
  store.processedAdd('7');
  store.processedAdd('8');
  store.processedAdd('9');
  assert.equal(writes, 1);
  // 10th: 2 writes
  store.processedAdd('10');
  assert.equal(writes, 2);
});

test('flush() forces an immediate write', () => {
  const storage = memoryStorage();
  let writes = 0;
  const countingStorage = {
    get: (k) => storage.get(k),
    set: (k, v) => { writes++; storage.set(k, v); },
  };
  const store = createStore(countingStorage, { saveEvery: 100 });
  store.processedAdd('1');
  assert.equal(writes, 0);
  store.flush();
  assert.equal(writes, 1);
  // the data is actually persisted
  const fresh = createStore(storage);
  assert.equal(fresh.processedHas('1'), true);
});

test('setStat writes an arbitrary stat value', () => {
  const store = createStore(memoryStorage());
  store.setStat('foo', 42);
  assert.equal(store.loadState().stats.foo, 42);
});

test('markRunStarted sets startedAt only the first time it is called', async () => {
  const store = createStore(memoryStorage());
  assert.equal(store.loadState().stats.startedAt, 0);
  store.markRunStarted();
  const first = store.loadState().stats.startedAt;
  assert.ok(first > 0);
  // Simulate elapsed time
  await new Promise((r) => setTimeout(r, 5));
  store.markRunStarted();
  const second = store.loadState().stats.startedAt;
  assert.equal(second, first);   // unchanged
});

test('touchLastAction updates lastActionAt to ~now', () => {
  const store = createStore(memoryStorage());
  store.touchLastAction();
  const t = store.loadState().stats.lastActionAt;
  assert.ok(t > 0);
  assert.ok(Date.now() - t < 1000);
});

import { PACING_PRESETS, pacingFor } from '../src/persist.js';

test('cursor is null by default for replies too', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.loadCursor('replies'), null);
});

test('saveCursor for replies does not clobber the likes cursor', () => {
  const store = createStore(memoryStorage());
  store.saveCursor('likes', '111');
  store.saveCursor('replies', '222');
  assert.equal(store.loadCursor('likes'), '111');
  assert.equal(store.loadCursor('replies'), '222');
});

test('pacingFor resolves a known category to its preset', () => {
  const cfg = defaultState().config;
  assert.equal(pacingFor('likes', cfg).baseMs, PACING_PRESETS.likes.baseMs);
  assert.equal(pacingFor('replies', cfg).baseMs, PACING_PRESETS.replies.baseMs);
});

test('pacingFor lets user overrides win over the preset', () => {
  const cfg = {
    pacing: {
      likes: { baseMs: 999 },
      replies: { baseMs: 1234 },
    },
  };
  assert.equal(pacingFor('likes', cfg).baseMs, 999);
  assert.equal(pacingFor('replies', cfg).baseMs, 1234);
});

test('pacingFor throws for an unknown category', () => {
  assert.throws(() => pacingFor('bookmarks', defaultState().config), /Unknown pacing category/);
});

test('migrates the v0.1.0 flat-pacing shape under pacing.likes', () => {
  const storage = memoryStorage();
  // Old v0.1.0 state: flat pacing, only deleteLikes flag, cursor only has likes.
  const oldState = {
    cursor: { likes: 'oldcursor' },
    processed: ['1', '2'],
    config: {
      deleteLikes: true,
      dryRun: false,
      pacing: { baseMs: 1200, jitter: 0.5, batchSize: 50, batchPauseMs: 60000, backoffBaseMs: 30000, backoffMaxMs: 300000 },
    },
    stats: { success: 5, failure: 1, skipped: 0, consecutiveFailures: 0, startedAt: 0, lastActionAt: 0 },
    failures: { '2': 'rate_limited' },
  };
  storage.set('batchd_state', JSON.stringify(oldState));

  const store = createStore(storage);
  const state = store.loadState();

  // Old cursor preserved.
  assert.equal(state.cursor.likes, 'oldcursor');
  // New cursor key added with default null.
  assert.equal(state.cursor.replies, null);
  // Old pacing re-parented under likes; replies preset added.
  assert.equal(state.config.pacing.likes.baseMs, 1200);
  assert.equal(state.config.pacing.likes.jitter, 0.5);
  assert.equal(state.config.pacing.replies.baseMs, PACING_PRESETS.replies.baseMs);
  // deleteReplies defaulted to false on migration.
  assert.equal(state.config.deleteReplies, false);
  // Processed set preserved.
  assert.deepEqual(state.processed, ['1', '2']);
  // Stats and failures preserved.
  assert.equal(state.stats.success, 5);
  assert.equal(state.failures['2'], 'rate_limited');
});
