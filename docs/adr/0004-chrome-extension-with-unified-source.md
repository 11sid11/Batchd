# ADR 0004: Chrome extension alongside the Tampermonkey userscript (unified source)

We keep the Tampermonkey userscript (ADR 0001) as a first-class install path
and add a parallel Chrome extension (MV3) for users who prefer a one-click
Web Store install over installing Tampermonkey plus a userscript. The two
artifacts share `src/` via a thin `storage adapter` seam --
`storage.gm.js` for Tampermonkey and `storage.chrome.js` for the extension --
and `scripts/build.js` emits both `dist/batchd.user.js` and `dist/extension/`
from the same `package.json` version.

Considered and rejected:

- **(A) Replace the userscript with the extension** -- loses the Firefox,
  Safari, Edge, and Opera reach that ADR 0001 deliberately preserved.
  Rejected because the Tampermonkey build still works on those browsers
  and the personal-use posture (see ADR 0001) values that reach.
- **(B) Two parallel codebases** -- the extension ships its own copy of
  the logic, decoupled from `src/`. Rejected because every future selector
  / pacing / run-loop patch would then need to land in two places,
  doubling the maintenance burden for the file most likely to need
  patching (`selectors.js`, ~21KB).

Trade-off accepted: a small refactor (factor the existing `gmStorage()`
factory out of `src/batchd.user.js` into a reusable `src/storage.gm.js`,
add a parallel `src/storage.chrome.js`, and add a new `src/entry.js`
plus a thin chrome entry `src/content.js`) plus one new build target,
in exchange for one shared codebase. The chrome install keeps an
`extension/` folder for `manifest.json` and `icons/` only -- no chrome
source lives outside `src/`. None of the eight shared logic modules
(`entry.js`, `yield.js`, `pacing.js`, `persist.js`, `failures.js`,
`selectors.js`, `run.js`, `panel.js`) change semantically; only
`batchd.user.js` loses the inline `gmStorage()` factory and gains an
import for `storage.gm.js`.

The Chrome Web Store publish step is manual for v0.3.0 (zip and drag
`dist/extension/` into the Developer Dashboard) because the first
publish cycle also needs the listing copy, screenshots, and privacy
disclosures set up by hand. CI auto-upload via the Chrome Web Store API
is deferred until after the first publish lands and we have real review
feedback to design the automation around.
