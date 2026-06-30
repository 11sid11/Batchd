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

test("loadChromeStorage resolves to {} when chrome.runtime.lastError is set", async (t) => {
  const mockWarn = t.mock.method(console, "warn");
  const m = makeChrome();
  m.install();
  // Wrap chrome.storage.local.get so the callback is invoked with
  // chrome.runtime.lastError set — mirrors how Chrome surfaces backend
  // failures (quota exceeded, invalidated context, etc.).
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.runtime = { lastError: { message: "quota exceeded" } };
  globalThis.chrome.storage.local.get = (keys, cb) => {
    // lastError must be set BEFORE invoking the callback, matching real Chrome.
    cb({});
  };
  const result = await loadChromeStorage();
  assert.deepEqual(result, {});
  assert.equal(mockWarn.mock.callCount(), 1);
  assert.match(mockWarn.mock.calls[0].arguments[0], /Batchd: chrome\.storage\.local\.get failed/);
  // Restore
  globalThis.chrome.storage.local.get = originalGet;
  delete globalThis.chrome.runtime;
  delete globalThis.chrome;
});

test("chromeStorage.set logs an error when chrome.runtime.lastError is set", (t) => {
  const mockError = t.mock.method(console, "error");
  const m = makeChrome();
  m.install();
  globalThis.chrome.runtime = { lastError: { message: "context invalidated" } };
  const originalSet = globalThis.chrome.storage.local.set;
  globalThis.chrome.storage.local.set = (items, cb) => {
    // Surface lastError only after calling back, so the adapter's
    // callback sees the error set exactly as Chrome would expose it.
    originalSet(items, () => {
      cb && cb();
    });
  };
  const storage = chromeStorage();
  storage.set("foo", "bar");
  // The set callback runs async; flush microtasks so the assertion
  // sees the logged error.
  return new Promise((resolve) => {
    setImmediate(() => {
      assert.equal(mockError.mock.callCount(), 1);
      assert.match(
        mockError.mock.calls[0].arguments[0],
        /Batchd: chrome\.storage\.local\.set failed/
      );
      // In-memory cache write already happened; degrade gracefully.
      assert.equal(storage.get("foo"), "bar");
      delete globalThis.chrome.runtime;
      delete globalThis.chrome;
      resolve();
    });
  });
});
