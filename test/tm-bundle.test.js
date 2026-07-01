// Regression test for the v0.3.0 Tampermonkey bundle scoping bug.
//
// v0.3.0's Tampermonkey userscript was also completely non-functional
// in browser — same scoping pattern as the chrome bug, but masked
// because (a) TM auto-update prompts but doesn't force, and (b) the
// pre-v0.3.0 bundle (v0.2.2) was a single concat with no per-module
// IIFEs, so users who hadn't accepted the v0.3.0 update continued
// running v0.2.2 fine.
//
// Two cumulative root causes — this test catches BOTH:
//
//   1. `src/batchd.user.js` referenced `bootstrapBatchd` and
//      `gmStorage` as bare identifiers. The build script wraps every
//      module in its own inner IIFE, so cross-module bare references
//      are unresolved at eval time.
//
//   2. `TM_ORDER` puts `entry.js` before the shared modules, so when
//      `entry.js`'s IIFE runs its top-of-file `import { hasCompetingInstance
//      } from './yield.js'` is rewritten into
//      `const { hasCompetingInstance } = Batchd;` — evaluated when
//      `entry.js`'s IIFE runs, before `yield.js` has stamped
//      `Batchd.hasCompetingInstance`. The local const captures
//      `undefined` and `bootstrapBatchd` later calls it as a function.
//
// If a future refactor reintroduces either bug (by removing the
// `import` lines from `src/batchd.user.js`, or by reordering `TM_ORDER`
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

test('tm bundle: bootstrap reaches window.__batchd without ReferenceError', async () => {
  // TM injects GM_* onto the page's window. The bundle's outer IIFE
  // does `const globalThis = window;`, so the storage adapter's
  // `globalThis.GM_getValue(k)` reads from `window`, not from the
  // bare global.
  const gmStore = {};
  const window = {
    GM_getValue: (k) => gmStore[k],
    GM_setValue: (k, v) => { gmStore[k] = v; },
  };

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

  const bundle = await readFile('dist/batchd.user.js', 'utf8');

  const ctx = {
    window,
    document,
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
  ctx.globalThis = ctx;

  vm.createContext(ctx);

  // Loading the bundle must not throw a ReferenceError on the
  // synchronous portion. TM is fully synchronous (gmStorage is sync,
  // no chrome-style async storage load), so by the time
  // runInContext returns the bootstrap has either completed or thrown.
  assert.doesNotThrow(
    () => vm.runInContext(bundle, ctx, { filename: 'dist/batchd.user.js' }),
    'tm bundle should not throw on initial eval',
  );

  // The smoking-gun assertion. If either root cause recurs, the
  // bootstrap throws before reaching `window.__batchd = ...`, so the
  // property is undefined and this assertion fails with the original
  // ReferenceError visible in the test output's prior frame.
  assert.ok(
    ctx.window.__batchd,
    'tm bundle should stamp __batchd on window after bootstrap completes',
  );
  assert.equal(ctx.window.__batchd.instance, 'tampermonkey');
});
