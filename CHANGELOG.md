# Changelog

All notable changes to Batchd are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-06-30

### Added
- **"Maintained by" footer in the panel** - a low-contrast attribution
  line at the bottom of the floating control panel linking to the
  maintainer's X.com profile (@sid_flac). Sits below the log so it
  does not crowd the action area, and is styled subtly (10px, muted
  gray, with a thin top-border separator) so it does not distract
  from the main controls.

## [0.2.1] - 2026-06-30

### Added
- **Tampermonkey auto-update** - the userscript header now includes
  `@updateURL` and `@downloadURL`, both pointing at the GitHub release
  `latest` download URL. Existing installs auto-update when a new
  release is cut; new installs can fetch the script from any release.
  Strategy B: rely on the release asset rather than committing the
  built `dist/batchd.user.js` to the repo (see README "Quick start").
- **Banner polish fields** - `@author 11sid11`, `@license MIT`,
  `@homepage`, `@supportURL`, and `@icon` (pointing at `assets/logo.svg`
  on the master branch). Tampermonkey dashboards now show Batchd with
  a proper icon and a link to the issue tracker.
- **`test/build.test.js`** - 7 cases covering the new banner fields,
  the preserved original fields, and the defensive minimal-pkg case.

### Changed
- **Banner construction extracted** - `scripts/build.js` now exports a
  pure `renderBanner(pkg)` function. The auto-build call is guarded so
  importing the module from a test does not trigger a build.
- **`@version` reads from `package.json`** - bumping the script version
  is now a one-file edit (`package.json`) followed by `npm run build`.
  The banner in `scripts/build.js` no longer needs a separate bump.

### Fixed
- **Stale tests from the v0.1.0 -> v0.2.0 refactor** - several tests
  referenced the pre-v0.2.0 flat `stats` shape and the old
  `buttonFound/responseOk/buttonStillThere` `clickUndo` outcome. The
  production code was updated in v0.2.0 to use per-category stats and
  to collapse successful outcomes to `{ success: true }`, but the tests
  were left behind. Updated to the new shapes; suite is 89/89 green.

[0.2.2]: https://github.com/11sid11/Batchd/releases/tag/v0.2.2

[0.2.1]: https://github.com/11sid11/Batchd/releases/tag/v0.2.1

## [0.2.0] - 2026-06-30

### Added
- **Replies mode** — bulk-delete your own X.com replies from the
  `/with_replies` tab. Driven via the more-menu → Delete → confirm
  modal sequence. Off by default (`deleteReplies: false`) because
  reply deletion is destructive and public.
- **Per-category pacing presets** — `pacing.likes` (1200ms base,
  50/60s, backoff 30s→5min) and `pacing.replies` (3000ms base,
  20/90s, backoff 60s→10min). Resolved at runtime by
  `pacingFor(category, cfg)`.
- **Per-category stats** — `stats.likes.{success, failure, skipped,
  consecutiveFailures}` and `stats.replies.{...}`. Panel shows the
  active category'"'"'s stats with a "STATS [mode]" pill above the
  boxes.
- **Mutual exclusivity** between Likes and Replies toggles. Toggling
  one auto-unticks the other in both the DOM and the store.
- **Goto links** — small `→ /likes` and `→ /with_replies` buttons
  next to each toggle that navigate to the relevant tab.
- **Stopwatch** — MM:SS elapsed-time display in the panel. Starts on
  Go, freezes on Stop or natural completion. `HH:MM:SS` past the hour.
- **More-button scoping** — on the replies tab, where X renders each
  thread as one `article` containing both the parent post and the
  user'"'"'s reply, the script walks up from the reply'"'"'s status
  link to find the `⋯` button in the reply subtree, not the parent'"'"'s.
- **Defense in `clickDelete`** — when the more menu opens but has no
  "Delete" item (the wrong post was clicked), the script closes the
  menu with an Escape keydown and returns a new `not_actionable`
  outcome. Avoids leaving an open menu blocking the page.
- **`{ success: true }` outcome from click actions** — distinguishes
  "we deleted it" from "the post was already gone" so successful
  deletes count under `success`, not `skipped`.
- **State-shape migration** — v0.1.0 flat `pacing` and `stats`
  objects are re-parented under their category on read. Idempotent.
- **`MIT` license** and `README.md` — first open-source release.

### Changed
- **Run loop refactor** — `runLikesCategory` is replaced by a single
  `runCategoryCore` shared between likes and replies. The only
  per-category inputs are the click function and the pacing numbers.
- **`runSequential` fans out** to whichever categories are active,
  replies first then likes.
- **Run-loop dependency** renamed from `clickUndo` to `click`. The
  click action is resolved per category by `clickAction(category,
  target, opts)` in `selectors.js`.
- **Confirmation text** — both Likes and Replies now use the same
  gate: typed "DELETE". The destructive-public nature of replies is
  mitigated by the off-by-default toggle, mutual exclusivity, and
  slower pacing rather than a longer typed string.
- **Failure kinds expanded** — added `not_actionable` (menu opened but
  no "Delete" item). Treats it like `already_gone` in the run loop
  (added to processed, not retried, not counted as a failure).

### Fixed
- **Confirm-button selector for current X modal structure** — the
  previous `[data-testid="tweetDeleteConfirm"]` testid is no longer
  emitted by the live X build. New finder tries the testid, then the
  modal layer (`#layers > div:nth-child(2)`), then any visible
  `[role="dialog"]`; matches the Delete button by accessible name
  (case-insensitive "Delete" / "Delete post" / "Delete reply") and
  falls back to position if labels are missing.
- **More-button scoping on thread rendering** — the previous
  `findMoreButton()` returned the first `⋯` in the article, which on
  the replies tab was usually the parent post'"'"'s. Now scoped to
  the smallest ancestor of the reply'"'"'s status link.
- **Success/success-and-already-gone classification** — previously
  `buttonFound: false` from `waitForPostGone` was always classified
  as `already_gone` and bumped to `skipped`. Now the click action
  emits an explicit `{ success: true }` when the click sequence
  completed and the post is gone.

## [0.1.0] - 2026-06-28

### Added
- **Likes-only bulk-unlike** — initial release. Tampermonkey
  userscript that walks the `/likes` tab, clicks the active heart on
  each visible post, with refill loop, idle watchdog, batch pause,
  and exponential backoff.
- **Persistence** — `GM_getValue` / `GM_setValue`-backed store. Cursor
  per category, processed set, config (toggles + pacing), stats,
  failures map.
- **Floating bottom-right control panel** with toggle, dry-run mode,
  typed `DELETE` confirmation, Go / Stop / Reset buttons, stats, log.
- **Tests** — `node --test` suite covering pacing, persistence,
  failures, the run loop, and selector behavior.

### Removed
- **Reposts, quote reposts** — prior support for these was removed in
  commit `0c1d148` ("Remove non-like cleanup paths") because the live
  X UI did not expose reliable unretweet / un-quote-repost controls.
  See `CONTEXT.md` and `docs/adr/0003-replies-as-mode.md` for the
  reasoning.

[0.2.0]: https://github.com/11sid11/Batchd/releases/tag/v0.2.0
[0.2.1]: https://github.com/11sid11/Batchd/releases/tag/v0.2.1
[0.1.0]: https://github.com/11sid11/Batchd/releases/tag/v0.1.0
