# Prototype -> main flow handoff (historical snapshot)

> **Note:** This file is a 2026-06-27 snapshot. Batchd has since
> grown a Replies mode (commit `87e0f72`, "Add replies cleanup as a
> category peer of likes"). The current scope is Likes + Replies.
> For the present state see `CONTEXT.md` and `docs/adr/0003-replies-as-mode.md`.

## Current scope (as of 2026-06-27)

Batchd was Likes-only. The old share-removal flow had been removed
because it did not work reliably enough in the live UI. Future
implementation work should not reintroduce that flow without a new
design pass and live verification.

## What this prototype answered

The key DOM target for the current script is the active like control on the
rendered X.com Likes tab. The canonical reference is:

- `prototype/findings/SELECTORS.md` (file removed in 0c1d148)

## Deferred live questions (still relevant for likes)

These require a logged-in X session when selectors drift:

1. Does the active heart expose `[data-testid="unlike"]`, `aria-label="Liked"`,
   or only the filled-heart SVG path?
2. Does the unlike control flip immediately after click or only after the
   network round-trip?
3. Does X surface rate-limit/captcha state in the DOM, or only through failed
   requests?

## Recommended build order (since executed)

1. Selector module: keep the active-heart detection broad and deduped.
2. Run loop: process one visible like, re-query, scroll/refill, and stop only
   after the idle watchdog exhausts.
3. Pacing/failure handling: use steady pacing, skip non-captcha failures for
   the current session, and leave them retryable later.
4. Panel: keep the UI compact and explicit that cleanup is best-effort.

All four items were completed in the post-prototype work. The
prototype/findings/SELECTORS.md file was removed in commit `0c1d148`
because the canonical selector reference now lives next to the code
(in `src/selectors.js` and the ADRs).
