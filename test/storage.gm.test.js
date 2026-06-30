import { test } from "node:test";
import assert from "node:assert/strict";
import { gmStorage } from "../src/storage.gm.js";

// Each test installs a global GM_getValue / GM_setValue and tears it down
// afterwards. The adapter should be a pure consumer of those globals and
// never cache between calls (the persist layer caches its own state).

test("get returns the value GM_getValue returns", () => {
  globalThis.GM_getValue = (k) => `value-for-${k}`;
  const storage = gmStorage();
  assert.equal(storage.get("foo"), "value-for-foo");
  assert.equal(storage.get("bar"), "value-for-bar");
  delete globalThis.GM_getValue;
});

test("get returns undefined when GM_getValue throws", () => {
  globalThis.GM_getValue = () => {
    throw new Error("quota");
  };
  const storage = gmStorage();
  assert.equal(storage.get("foo"), undefined);
  delete globalThis.GM_getValue;
});

test("get returns undefined when GM_getValue is not defined", () => {
  // No globalThis.GM_getValue installed
  const storage = gmStorage();
  assert.equal(storage.get("foo"), undefined);
});

test("set calls GM_setValue with the key and value", () => {
  let captured = null;
  globalThis.GM_setValue = (k, v) => {
    captured = { k, v };
  };
  const storage = gmStorage();
  storage.set("foo", "bar");
  assert.deepEqual(captured, { k: "foo", v: "bar" });
  delete globalThis.GM_setValue;
});

test("set swallows errors from GM_setValue", () => {
  globalThis.GM_setValue = () => {
    throw new Error("quota");
  };
  const storage = gmStorage();
  assert.doesNotThrow(() => storage.set("foo", "bar"));
  delete globalThis.GM_setValue;
});

test("set is a no-op when GM_setValue is not defined", () => {
  // No globalThis.GM_setValue installed
  const storage = gmStorage();
  assert.doesNotThrow(() => storage.set("foo", "bar"));
});
