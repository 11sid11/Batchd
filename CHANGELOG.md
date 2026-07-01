# Changelog

All notable changes to Batchd are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-07-01

### Fixed
- **Chrome extension v0.3.0 was completely non-functional in browser.**
  The v0.3.0 chrome bundle crashed at `loadChromeStorage is not defined`
  on first load, so the panel never mounted.
  - Root cause #1: `src/content.js` (the chrome entry point) called
    `loadChromeStorage()`, `chromeStorage()`, and `bootstrapBatchd()`
    as bare identifiers. The build script wraps every module in its
    own inner IIFE (so per-module locals don't leak across modules),
    which means bare cross-module references are unresolved at eval
    time. Fixed by adding explicit `import` statements for the three
    symbols; the build script's ESM-rewriter turns them into
    `const { ... } = Batchd;` inside the content script's wrapper,
    where the names resolve at call time.
  - Root cause #2: even after #1, `bootstrapBatchd` threw
    `hasCompetingInstance is not a function` because `entry.js`'s
    top-of-file `import { hasCompetingInstance } from './yield.js'`
    was rewritten into an eager `const { hasCompetingInstance } = Batchd;`
    evaluated when `entry.js`'s IIFE ran — before `yield.js` had
    stamped `Batchd.hasCompetingInstance`. Fixed by reordering
    `CHROME_ORDER` in `scripts/build.js` to concatenate the shared
    modules **before** `entry.js` instead of after it. The chrome
    bundle's structural assertion (it must contain the strings
    `loadChromeStorage` and `chromeStorage`) now catches a future
    re-introduction at build time.
- **Tampermonkey userscript v0.3.0 had the same scoping bug** and
  would also have been non-functional — the v0.3.0 bundle's last
  inner IIFE called `bootstrapBatchd({...})` and `gmStorage()` as
  bare identifiers that were unresolved at eval time, throwing
  `ReferenceError: bootstrapBatchd is not defined`. This was masked
  in the field because TM's auto-update prompts but does not force,
  so most users on a previous-version install (e.g. v0.2.2) kept
  working until they accepted the v0.3.0 update, at which point the
  panel would stop mounting.
  - Root cause #1: same as chrome — `src/batchd.user.js` called
    `bootstrapBatchd` and `gmStorage` as bare identifiers. Fixed by
    adding explicit `import` statements at the top of
    `src/batchd.user.js`.
  - Root cause #2: same as chrome — `TM_ORDER` in `scripts/build.js`
    concatenated `entry.js` before the shared modules, causing
    `entry.js`'s eager destructure of `Batchd.hasCompetingInstance`
    to capture `undefined`. Fixed by reordering `TM_ORDER` to
    concatenate the shared modules **before** `entry.js`.

### Notes
- Both fixes are mirror images: the chrome and TM entry points are
  now structurally identical (each imports the same three symbols;
  both build orders now concatenate shared modules before entry.js).
- A regression test (`test/tm-bundle.test.js`) is added for the TM
  path, mirroring the existing `test/chrome-bundle.test.js`. Both
  tests load the BUILT bundle in a vm context and assert that
  `window.__batchd` is stamped after bootstrap completes without
  any ReferenceError.

[0.3.1]: https://github.com/11sid11/Batchd/releases/tag/v0.3.1

## [0.3.0] - 2026-06-30

### Added
- **Chrome Web Store extension (MV3)** - one-click install for users who
  prefer not to set up Tampermonkey. Same behavior as the userscript;
  same floating panel, same selectors, same pacing. The extension is
  built from the same `src/` as the userscript via a thin `storage
  adapter` seam (`src/storage.gm.js` for Tampermonkey,
  `src/storage.chrome.js` for Chrome). One code path, two install
  paths. See `docs/adr/0004-chrome-extension-with-unified-source.md`
  for the full rationale.
- **`npm run build:userscript`** and **`npm run build:extension`** -
  granular build targets. `npm run build` (no argument) builds both.
- **Detect-and-yield coexistence guard** - if a user has both the
  Tampermonkey userscript and the Chrome extension installed, the
  first to mount sets `window.__batchd = { instance, store, panel }`;
  the second sees the marker and bails with a one-time console
  message. Implemented in `src/yield.js`.
- **22 new tests** (118 total). `src/storage.gm.js` (6),
  `src/storage.chrome.js` (8), `src/yield.js` (5), and a
  regression-guard for the `==UserScript==`-strip regex in the
  build script (2). All green.

### Changed
- **`scripts/build.js` now emits two artifacts** - `dist/batchd.user.js`
  (Tampermonkey) and `dist/extension/` (Chrome MV3 folder with
  `content.js`, `manifest.json`, and `icons/`). Both share the eight
  shared logic modules (`entry.js`, `yield.js`, `pacing.js`, `persist.js`,
  `failures`, `selectors`, `run`, `panel`); only the storage adapter
  and the entry point differ.
- **`src/batchd.user.js` no longer contains the inline `gmStorage`
  factory** - it now `import`s the function from `src/storage.gm.js`.
  Same behavior, one line of glue code.
- **Build regex bug fix** - the strip regex that removes the
  `==UserScript==` block from the Tampermonkey entry source was
  missing the `m` flag, so the block was leaking into the bundle ~3KB
  deep with a stale `@version 0.2.0`. Fixed; regression-tested.

### Installation

- **Tampermonkey (unchanged):** the userscript bundle is
  `dist/batchd.user.js`. Existing installs auto-update via the
  existing `@updateURL`.
- **Chrome extension (new):** `dist/extension/` is the loadable
  extension folder. To publish: zip it, open the [Chrome Web Store
  Developer Dashboard](https://chrome.google.com/webstore/devconsole/),
  upload, fill in the listing, submit. First review is 1-2 weeks.

[0.3.0]: https://github.com/11sid11/Batchd/releases/tag/v0.3.0

## [0.2.2] - 2026-06-30

### Added
- **"Maintained by" footer in the panel** - a low-contrast attribution
  line at the bottom of the floating control panel linking to the
  maintainer's X.com profile (@sid_flac). Sits below the log so it
  does not crowd the action area, and is styled subtly (10px, muted
  gray, with a thin top-border separator) so it does not distract
  from the main controls.

[0.2.2]: https://github.com/11sid11/Batchd/releases/tag/v0.2.2
