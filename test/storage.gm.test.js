import { test } from "node:test";
import assert from "node:assert/strict";
import { gmStorage } from "../src/storage.gm.js";

// Each test installs a global GM_getValue / GM_setValue and tears it down
// afterwards. The adapter should be a pure consumer of those globals and
// never cache between calls (the persist layer caches its own state).
//
// Cleanup uses `t.afterEach` so a thrown assertion still restores the
// globals — earlier versions of this file leaked `globalThis.GM_*` on
// failure and broke test ordering.

test("get returns the value GM_getValue returns", (t) => {
  globalThis.GM_getValue = (k) => `value-for-${k}`;
  t.afterEach(() => {
    delete globalThis.GM_getValue;
  });
  const storage = gmStorage();
  assert.equal(storage.get("foo"), "value-for-foo");
  assert.equal(storage.get("bar"), "value-for-bar");
});

test("get returns undefined when GM_getValue throws", (t) => {
  globalThis.GM_getValue = () => {
    throw new Error("quota");
  };
  t.afterEach(() => {
    delete globalThis.GM_getValue;
  });
  const storage = gmStorage();
  assert.equal(storage.get("foo"), undefined);
});

test("get returns undefined when GM_getValue is not defined", () => {
  // No globalThis.GM_getValue installed — gmStorage().get must return
  // undefined without throwing.
  const storage = gmStorage();
  assert.equal(storage.get("foo"), undefined);
});

test("get returns undefined (not null, not a default) when GM_getValue reports missing key", (t) => {
  // GM_getValue returns undefined for an unknown key — the contract the
  // persist layer relies on to distinguish "absent" from "set to null".
  globalThis.GM_getValue = (k) => {
    if (k === "known") return "set-value";
    return undefined;
  };
  t.afterEach(() => {
    delete globalThis.GM_getValue;
  });
  const storage = gmStorage();
  assert.equal(storage.get("missing"), undefined);
  assert.notEqual(storage.get("missing"), null);
  assert.equal(storage.get("known"), "set-value");
});

test("set calls GM_setValue with the key and value", (t) => {
  let captured = null;
  globalThis.GM_setValue = (k, v) => {
    captured = { k, v };
  };
  t.afterEach(() => {
    delete globalThis.GM_setValue;
  });
  const storage = gmStorage();
  storage.set("foo", "bar");
  assert.deepEqual(captured, { k: "foo", v: "bar" });
});

test("set swallows errors from GM_setValue", (t) => {
  globalThis.GM_setValue = () => {
    throw new Error("quota");
  };
  t.afterEach(() => {
    delete globalThis.GM_setValue;
  });
  const storage = gmStorage();
  assert.doesNotThrow(() => storage.set("foo", "bar"));
});

test("set is a no-op when GM_setValue is not defined", () => {
  // No globalThis.GM_setValue installed — gmStorage().set must not throw.
  const storage = gmStorage();
  assert.doesNotThrow(() => storage.set("foo", "bar"));
});
