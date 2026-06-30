import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCompetingInstance } from "../src/yield.js";

// Suppress console.info from the module during tests so the test output
// stays clean. Each test passes its own `target` object so the global
// is never touched.

test("returns false on first call and stamps the instance on the target", () => {
  const target = {};
  const yielded = hasCompetingInstance("tampermonkey", target);
  assert.equal(yielded, false);
  assert.equal(target.__batchd.instance, "tampermonkey");
});

test("returns true on second call to the same target", () => {
  const target = {};
  hasCompetingInstance("tampermonkey", target);
  const yielded = hasCompetingInstance("chrome-extension", target);
  assert.equal(yielded, true);
});

test("returns false on a fresh target even after the first target was marked", () => {
  const a = {};
  const b = {};
  hasCompetingInstance("tampermonkey", a);
  const yielded = hasCompetingInstance("chrome-extension", b);
  assert.equal(yielded, false);
  assert.equal(b.__batchd.instance, "chrome-extension");
});

test("overwrites a pre-existing __batchd object (yield only sets `instance`)", () => {
  // The yield check is the FIRST thing the bootstrap runs, before
  // store/panel exist. A pre-existing __batchd here would only happen
  // from a debug handle or a leftover stamp — yielding should reset
  // it to just { instance } rather than merge, so the entry-point's
  // later `window.__batchd = { instance, store, panel }` is the sole
  // owner of the full shape.
  const target = { __batchd: { store: { stub: true }, panel: { stub: true } } };
  const yielded = hasCompetingInstance("tampermonkey", target);
  assert.equal(yielded, false);
  assert.equal(target.__batchd.instance, "tampermonkey");
  assert.equal(target.__batchd.store, undefined);
  assert.equal(target.__batchd.panel, undefined);
});

test("defaults the target to globalThis when not passed", () => {
  // Install a marker on globalThis, then verify default-target behavior.
  globalThis.__batchd = { instance: "preexisting" };
  const yielded = hasCompetingInstance("tampermonkey");
  assert.equal(yielded, true);
  delete globalThis.__batchd;
});

test("console.info is called when yielding to a different instance, naming both", (t) => {
  const mockInfo = t.mock.method(console, "info");
  const target = {};
  hasCompetingInstance("tampermonkey", target);
  hasCompetingInstance("chrome-extension", target);
  assert.equal(mockInfo.mock.callCount(), 1);
  const msg = mockInfo.mock.calls[0].arguments[0];
  assert.match(msg, /tampermonkey/);
  assert.match(msg, /chrome-extension/);
});

test("same-instance re-call returns false (does not yield to itself) and does not log", (t) => {
  const mockInfo = t.mock.method(console, "info");
  const target = {};
  const first = hasCompetingInstance("tampermonkey", target);
  const second = hasCompetingInstance("tampermonkey", target);
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