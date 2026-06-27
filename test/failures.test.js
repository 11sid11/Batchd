import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, FAILURE_KINDS } from '../src/failures.js';

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

test('classify maps stale DOM targets to stale', () => {
  assert.equal(classify({ stale: true }), 'stale');
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
    { stale: true },
    { buttonFound: true, status: 500 },
    {},
  ];
  for (const s of samples) {
    const kind = classify(s);
    assert.ok(FAILURE_KINDS.includes(kind), `classifier returned unknown kind: ${kind} for ${JSON.stringify(s)}`);
  }
});
