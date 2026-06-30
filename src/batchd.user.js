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

  // ---- Top-level call -------------------------------------------------------
  // The build wraps this file in an outer IIFE (see scripts/build.js), so
  // top-level statements run once when the userscript starts. GM_getValue
  // is synchronous, so the storage adapter can be constructed here
  // without an await.
  bootstrapBatchd({ instanceName: 'tampermonkey', storage: gmStorage() });