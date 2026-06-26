import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay, shouldBatchPause, batchPauseDuration, backoffMs } from '../src/pacing.js';

test('nextDelay with zero jitter returns the base delay', () => {
  assert.equal(nextDelay(1000, 0), 1000);
  assert.equal(nextDelay(1200, 0), 1200);
});

test('nextDelay with jitter stays within [base*(1-j), base*(1+j)]', () => {
  // Deterministic RNG: returns 0 first, then 1, then 0.5
  const atZero = nextDelay(1000, 0.5, () => 0);
  const atOne = nextDelay(1000, 0.5, () => 1);
  const atHalf = nextDelay(1000, 0.5, () => 0.5);

  assert.equal(atZero, 500);   // lower bound
  assert.equal(atOne, 1500);   // upper bound
  assert.equal(atHalf, 1000);  // midpoint
});

test('nextDelay jitter result is always within bounds across many samples', () => {
  for (let i = 0; i < 200; i++) {
    const d = nextDelay(1200, 0.5);
    assert.ok(d >= 600, `delay ${d} below lower bound 600`);
    assert.ok(d <= 1800, `delay ${d} above upper bound 1800`);
  }
});

test('nextDelay result is an integer (rounded)', () => {
  for (let i = 0; i < 50; i++) {
    const d = nextDelay(1000, 0.3);
    assert.equal(Number.isInteger(d), true);
  }
});

test('shouldBatchPause is true exactly every batchSize actions', () => {
  const batch = 50;
  assert.equal(shouldBatchPause(0, batch), false);   // 1st action, not yet
  assert.equal(shouldBatchPause(48, batch), false);  // 49th action, not yet
  assert.equal(shouldBatchPause(49, batch), true);   // 50th action -> pause
  assert.equal(shouldBatchPause(50, batch), false);  // 51st action, new batch
  assert.equal(shouldBatchPause(98, batch), false);  // 99th action
  assert.equal(shouldBatchPause(99, batch), true);   // 100th action -> pause
});

test('shouldBatchPause respects custom batch size', () => {
  assert.equal(shouldBatchPause(9, 10), true);
  assert.equal(shouldBatchPause(10, 10), false);
});

test('batchPauseDuration returns the configured pause in ms', () => {
  assert.equal(batchPauseDuration(60000), 60000);
  assert.equal(batchPauseDuration(0), 0);   // 0 = pause disabled
});

test('backoffMs doubles each consecutive failure, capped at maxBackoffMs', () => {
  // 1st failure: 30s, 2nd: 60s, 3rd: 120s, 4th: 240s, 5th: 480s (capped at 300s)
  assert.equal(backoffMs(1, 30000, 300000), 30000);
  assert.equal(backoffMs(2, 30000, 300000), 60000);
  assert.equal(backoffMs(3, 30000, 300000), 120000);
  assert.equal(backoffMs(4, 30000, 300000), 240000);
  assert.equal(backoffMs(5, 30000, 300000), 300000);   // capped
  assert.equal(backoffMs(6, 30000, 300000), 300000);   // still capped
  assert.equal(backoffMs(100, 30000, 300000), 300000); // far past cap
});

test('backoffMs returns 0 for zero or negative failure count', () => {
  assert.equal(backoffMs(0, 30000, 300000), 0);
  assert.equal(backoffMs(-1, 30000, 300000), 0);
});
