# Prototype -> main flow handoff

## Current scope

Batchd is Likes-only. The old share-removal flow was removed because it did
not work reliably enough in the live UI. Future implementation work should not
reintroduce that flow without a new design pass and live verification.

## What this prototype answered

The key DOM target for the current script is the active like control on the
rendered X.com Likes tab. The canonical reference is:

- `prototype/findings/SELECTORS.md`

## Deferred live questions

These still require a logged-in X session when selectors drift:

1. Does the active heart expose `[data-testid="unlike"]`, `aria-label="Liked"`,
   or only the filled-heart SVG path?
2. Does the unlike control flip immediately after click or only after the
   network round-trip?
3. Does X surface rate-limit/captcha state in the DOM, or only through failed
   requests?

## Recommended build order

1. Selector module: keep the active-heart detection broad and deduped.
2. Run loop: process one visible like, re-query, scroll/refill, and stop only
   after the idle watchdog exhausts.
3. Pacing/failure handling: use steady pacing, skip non-captcha failures for
   the current session, and leave them retryable later.
4. Panel: keep the UI compact and explicit that cleanup is best-effort.
