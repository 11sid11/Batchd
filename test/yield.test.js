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
