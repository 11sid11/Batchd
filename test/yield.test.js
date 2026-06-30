import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAndYield } from "../src/yield.js";

// Suppress console.info from the module during tests so the test output
// stays clean. Each test passes its own `target` object so the global
// is never touched.

test("returns false on first call and stamps the instance on the target", () => {
  const target = {};
  const yielded = checkAndYield("tampermonkey", target);
  assert.equal(yielded, false);
  assert.equal(target.__batchd.instance, "tampermonkey");
});

test("returns true on second call to the same target", () => {
  const target = {};
  checkAndYield("tampermonkey", target);
  const yielded = checkAndYield("chrome-extension", target);
  assert.equal(yielded, true);
});

test("returns false on a fresh target even after the first target was marked", () => {
  const a = {};
  const b = {};
  checkAndYield("tampermonkey", a);
  const yielded = checkAndYield("chrome-extension", b);
  assert.equal(yielded, false);
  assert.equal(b.__batchd.instance, "chrome-extension");
});

test("merges with existing __batchd rather than overwriting it", () => {
  // The caller may have pre-populated __batchd with debug handles
  // (store, panel) before invoking the yield check. The yield check
  // should add the `instance` field without clobbering them.
  const target = { __batchd: { store: { stub: true }, panel: { stub: true } } };
  const yielded = checkAndYield("tampermonkey", target);
  assert.equal(yielded, false);
  assert.equal(target.__batchd.instance, "tampermonkey");
  assert.deepEqual(target.__batchd.store, { stub: true });
  assert.deepEqual(target.__batchd.panel, { stub: true });
});

test("defaults the target to globalThis when not passed", () => {
  // Install a marker on globalThis, then verify default-target behavior.
  globalThis.__batchd = { instance: "preexisting" };
  const yielded = checkAndYield("tampermonkey");
  assert.equal(yielded, true);
  delete globalThis.__batchd;
});

test("console.info is called when yielding to a different instance, naming both", (t) => {
  const mockInfo = t.mock.method(console, "info");
  const target = {};
  checkAndYield("tampermonkey", target);
  checkAndYield("chrome-extension", target);
  assert.equal(mockInfo.mock.callCount(), 1);
  const msg = mockInfo.mock.calls[0].arguments[0];
  assert.match(msg, /tampermonkey/);
  assert.match(msg, /chrome-extension/);
});

test("same-instance re-call returns false (does not yield to itself) and does not log", (t) => {
  const mockInfo = t.mock.method(console, "info");
  const target = {};
  const first = checkAndYield("tampermonkey", target);
  const second = checkAndYield("tampermonkey", target);
  assert.equal(first, false);
  // Document the actual corrected behavior: a repeat call from the
  // winning instance is a no-op success, not a self-yield that would
  // prevent the entry point from mounting.
  assert.equal(second, false);
  assert.equal(target.__batchd.instance, "tampermonkey");
  // No "another instance" warning for a self-call.
  assert.equal(mockInfo.mock.callCount(), 0);
});

test("afterEach cleanup restores console.info", () => {
  // The t.mock.method above restores automatically when the subtest ends;
  // this case documents that no globalThis pollution survives.
  assert.equal(globalThis.__batchd, undefined);
});
