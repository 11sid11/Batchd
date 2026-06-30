import { test } from "node:test";
import assert from "node:assert/strict";
import { loadChromeStorage, chromeStorage } from "../src/storage.chrome.js";

// Mock chrome.storage.local with a plain in-memory map. The real
// Chrome API is callback-based, so the mock matches that shape.
function makeChrome() {
  const store = {};
  const calls = { get: [], set: [] };
  return {
    calls,
    install() {
      globalThis.chrome = {
        storage: {
          local: {
            get: (keys, cb) => {
              calls.get.push(keys);
              if (keys === null || keys === undefined) {
                cb({ ...store });
              } else if (typeof keys === "string") {
                cb({ [keys]: store[keys] });
              } else if (Array.isArray(keys)) {
                const result = {};
                for (const k of keys) result[k] = store[k];
                cb(result);
              } else {
                cb({ ...store, ...keys });
              }
            },
            set: (items, cb) => {
              calls.set.push(items);
              Object.assign(store, items);
              if (cb) cb();
            },
          },
        },
      };
    },
    get store() {
      return store;
    },
  };
}

test("loadChromeStorage resolves with the full storage contents", async () => {
  const m = makeChrome();
  m.install();
  m.store.batchd_state = JSON.stringify({ cursor: { likes: "x" } });
  const result = await loadChromeStorage();
  assert.deepEqual(result, { batchd_state: JSON.stringify({ cursor: { likes: "x" } }) });
  delete globalThis.chrome;
});

test("loadChromeStorage resolves with {} when chrome is not defined", async () => {
  // No globalThis.chrome installed
  const result = await loadChromeStorage();
  assert.deepEqual(result, {});
});

test("chromeStorage returns the preloaded value for a known key", () => {
  const storage = chromeStorage({ foo: "bar" });
  assert.equal(storage.get("foo"), "bar");
});

test("chromeStorage returns undefined for an unknown key", () => {
  const storage = chromeStorage({ foo: "bar" });
  assert.equal(storage.get("missing"), undefined);
});

test("chromeStorage with no initial returns undefined for every key", () => {
  const storage = chromeStorage();
  assert.equal(storage.get("anything"), undefined);
});

test("set updates the in-memory cache so subsequent gets see the new value", () => {
  const storage = chromeStorage();
  storage.set("foo", "bar");
  assert.equal(storage.get("foo"), "bar");
});

test("set writes through to chrome.storage.local (fire-and-forget)", () => {
  const m = makeChrome();
  m.install();
  const storage = chromeStorage();
  storage.set("foo", "bar");
  assert.equal(m.calls.set.length, 1);
  assert.deepEqual(m.calls.set[0], { foo: "bar" });
  assert.equal(m.store.foo, "bar");
  delete globalThis.chrome;
});

test("set does not throw when chrome.storage.local is unavailable", () => {
  // No globalThis.chrome installed
  const storage = chromeStorage();
  assert.doesNotThrow(() => storage.set("foo", "bar"));
  assert.equal(storage.get("foo"), "bar");
});
