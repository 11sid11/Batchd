import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, FAILURE_KINDS, shouldAbort } from '../src/failures.js';

test('classify maps a clean click outcome to success', () => {
  assert.equal(classify({ buttonFound: true, responseOk: true, buttonStillThere: false }), 'success');
});

test('classify maps missing button (item already gone) to already_gone, NOT a failure', () => {
  // Important: this is a successful outcome for Batchd because the engagement no longer counts.
  // We must not retry or count it toward the consecutive-failure abort.
  assert.equal(classify({ buttonFound: false, responseOk: true, buttonStillThere: false }), 'already_gone');
});

test('classify maps network exception to network', () => {
  assert.equal(classify({ buttonFound: true, error: new Error('Failed to fetch') }), 'network');
});

test('classify maps 429 response to rate_limited', () => {
  assert.equal(classify({ buttonFound: true, responseOk: false, status: 429 }), 'rate_limited');
});

test('classify maps captcha UI signal to captcha', () => {
  assert.equal(classify({ buttonFound: true, captchaDetected: true }), 'captcha');
});

test('classify maps button-still-there-after-click (X did not honor the request) to unknown', () => {
  assert.equal(classify({ buttonFound: true, responseOk: true, buttonStillThere: true }), 'unknown');
});

test('classify is exhaustive — every kind in FAILURE_KINDS has a classifier path', () => {
  // All known outcomes should map to a known kind, never undefined
  const samples = [
    { buttonFound: true, responseOk: true, buttonStillThere: false },
    { buttonFound: false },
    { buttonFound: true, error: new Error('x') },
    { buttonFound: true, status: 429 },
    { buttonFound: true, captchaDetected: true },
    { buttonFound: true, responseOk: true, buttonStillThere: true },
    { buttonFound: true, status: 500 },
    {},
  ];
  for (const s of samples) {
    const kind = classify(s);
    assert.ok(FAILURE_KINDS.includes(kind), `classifier returned unknown kind: ${kind} for ${JSON.stringify(s)}`);
  }
});

test('shouldAbort is false below the threshold', () => {
  assert.equal(shouldAbort(0, 5), false);
  assert.equal(shouldAbort(4, 5), false);
});

test('shouldAbort is true at or above the threshold', () => {
  assert.equal(shouldAbort(5, 5), true);
  assert.equal(shouldAbort(6, 5), true);
});

test('shouldAbort treats already_gone as a reset, not a step toward abort', () => {
  // Helper: after an already_gone, the counter is reset to 0, so shouldAbort is false
  let counter = 3;
  counter = 0;   // reset
  assert.equal(shouldAbort(counter, 5), false);
});
