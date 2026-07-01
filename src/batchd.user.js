// Batchd — Tampermonkey entry point.
//
// Hands the `gmStorage` adapter to `bootstrapBatchd` (in src/entry.js),
// which handles the yield check, panel wiring, run loop, and
// `window.__batchd` stamp. The Chrome extension has a parallel entry
// point at src/content.js that wraps the same bootstrap in an async
// IIFE to await `loadChromeStorage()`. See ADR 0004 in docs/adr/.

// ==UserScript==
// @name         Batchd
// @namespace    batchd
// @version      0.3.0
// @description  Bulk-delete your X.com likes and replies.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

// `bootstrapBatchd` and `gmStorage` are imported rather than
// referenced as bare identifiers because the build script wraps
// every module in its own inner IIFE (see `scripts/build.js`), which
// keeps local bindings out of every other module's scope. The
// rewrite step turns each `import { ... } from './...'` line into
// `const { ... } = Batchd;` inside this entry point's wrapper, so
// the bare references below resolve against the `Batchd` namespace
// where the source modules have already stashed the functions.
// Mirror of the same fix in src/content.js for the chrome entry.
import { bootstrapBatchd } from './entry.js';
import { gmStorage } from './storage.gm.js';

  // ---- Top-level call -------------------------------------------------------
  // The build wraps this file in an outer IIFE (see scripts/build.js), so
  // top-level statements run once when the userscript starts. GM_getValue
  // is synchronous, so the storage adapter can be constructed here
  // without an await.
  bootstrapBatchd({ instanceName: 'tampermonkey', storage: gmStorage() });