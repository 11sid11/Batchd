// Regression test for the v0.3.0 chrome bundle scoping bug.
//
// v0.3.0's chrome extension was completely non-functional in browser:
// the bundle crashed with `loadChromeStorage is not defined` on first
// load, so the panel never mounted. The Tampermonkey userscript was
// unaffected.
//
// Two cumulative root causes — this test catches BOTH:
//
//   1. `src/content.js` referenced `loadChromeStorage`, `chromeStorage`,
//      and `bootstrapBatchd` as bare identifiers. The build script
//      wraps every module in its own inner IIFE, so cross-module bare
//      references are unresolved at eval time.
//
//   2. Even after #1, `bootstrapBatchd` would throw
//      `hasCompetingInstance is not a function` because `entry.js`'s
//      top-of-file `import` was rewritten into an eager
//      `const { hasCompetingInstance } = Batchd;` evaluated when
//      `entry.js`'s IIFE ran — before `yield.js` had stamped
//      `Batchd.hasCompetingInstance`.
//
// If a future refactor reintroduces either bug (by removing the
// `import` lines from `src/content.js`, or by reordering `CHROME_ORDER`
// in `scripts/build.js` so `entry.js` is concatenated before the
// shared modules), this test fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Minimal DOM stub: every property is a no-op element. The bundle
// only needs real objects with the right shape — the assertions below
// are about whether bootstrap COMPLETES, not about what the panel
// renders.
function mkEl() {
  const el = {
    innerHTML: '',
    id: '',
    textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    focus() {},
    blur() {},
    click() {},
    get firstChild() { return this.children[0] || null; },
  };
  return new Proxy(el, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string') return () => undefined;
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

test('chrome bundle: bootstrap reaches window.__batchd without ReferenceError', async () => {
  // chrome.storage.local shim — callback-based to match the real API.
  // Reads return the in-memory copy; writes update it.
  const storage = {};
  const chrome = {
    storage: {
      local: {
        get(_keys, cb) { cb?.({ ...storage }); },
        set(obj, cb) { Object.assign(storage, obj); cb?.(); },
      },
    },
    runtime: { lastError: null },
  };

  const window = {};
  const document = {
    body: mkEl(),
    head: mkEl(),
    documentElement: mkEl(),
    createElement: () => mkEl(),
    createElementNS: () => mkEl(),
    getElementById: () => mkEl(),
    querySelector: () => mkEl(),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  const bundle = await readFile('dist/extension/content.js', 'utf8');

  const ctx = {
    window,
    document,
    chrome,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Object,
    Array,
    JSON,
    Math,
    Map,
    Set,
    Date,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    URL,
    URLSearchParams,
  };
  // The bundle's outer IIFE does `const globalThis = window;` so the
  // shared `__batchd` stamp lands on the window object we passed in.
  // Setting `globalThis` on the context makes Node-side helpers (none
  // used here, but defensive) work the same way.
  ctx.globalThis = ctx;

  vm.createContext(ctx);

  // Loading the bundle must not throw a ReferenceError on the
  // synchronous portion (all IIFEs run to completion before this
  // returns; the only async part is `loadChromeStorage`'s await on
  // `chrome.storage.local.get`, which is the chrome callback API
  // and runs as a microtask after the synchronous eval returns).
  assert.doesNotThrow(
    () => vm.runInContext(bundle, ctx, { filename: 'dist/extension/content.js' }),
    'chrome bundle should not throw on initial eval',
  );

  // Wait for the async bootstrap (content.js awaits loadChromeStorage
  // before calling bootstrapBatchd). The chrome callback API resolves
  // on a microtask, so a few ticks is plenty.
  for (let i = 0; i < 100 && !ctx.window.__batchd; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }

  // The smoking-gun assertion. If either root cause recurs, the
  // bootstrap throws before reaching `window.__batchd = ...`, so the
  // property is undefined and this assertion fails with the original
  // ReferenceError visible in the test output's prior frame.
  assert.ok(
    ctx.window.__batchd,
    'chrome bundle should stamp __batchd on window after bootstrap completes',
  );
  assert.equal(ctx.window.__batchd.instance, 'chrome-extension');
});
