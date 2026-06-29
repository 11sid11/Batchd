# Replies as a category peer of likes, sharing the same userscript

We are adding a "Replies" mode to Batchd on top of the existing Likes
mode. The user can tick one or both checkboxes in the panel; the
run-loop core is shared; the click action and pacing preset are
per-category. Trade-off accepted: a slightly heavier userscript and
two category branches in `selectors.js` / `run.js`, in exchange for not
shipping a second userscript (and the install / state / failure-
tracking duplication that would come with it).

## Why this shape

### Not a sibling userscript

A second `batchd-replies.user.js` would mean:
- two Tampermonkey installs, two storage keys, two state stores;
- the failure-handling heuristics would fork and drift;
- the panel would have to be duplicated or wired through cross-script
  messaging;
- a user who wants both modes would manage two scripts and two
  "stop" buttons.

The architecture is already category-pluggable: `tabUrl(category)`,
`findEngagedPosts(category)`, `runCategory(category)`, and
`cursor[category]` all take a category. The only Likes-only
assumptions left are inside the action implementation (`clickUndo`
vs. `clickDelete`) and the pacing numbers.

### Not an "all engagement" mode

A previous version of Batchd tried to handle reposts, quote reposts,
and likes in one shared loop. It was removed in commit `0c1d148`
("Remove non-like cleanup paths") because the live UI did not
expose reliable unretweet / un-quote-repost controls. We are
intentionally **not** reintroducing reposts or quote reposts in
this branch — see "What this ADR does not cover" below.

Replies are different from reposts in one decisive way: each reply
is a post the user authored, so X's "Delete" flow is the same
modal every other post on the user's profile uses. There is one
DOM target, one menu, one confirm button. That is what makes a
replies loop tractable as a category peer of likes.

## What the replies loop looks like

### Source view

`https://x.com/<username>/with_replies` — X's "Replies" tab on the
user's profile. The script's `tabUrl('me', 'replies')` resolves to
this URL. If X changes this URL pattern, the patch point is one
line in `selectors.js` (`TAB_PATHS.replies`); no other module
needs to change.

### Action sequence (per visible reply)

1. Click the more-menu trigger (⋯) on the post — three fallback
   selectors in priority order:
   - `[data-testid="caret"]`
   - `aria-label="More"` (X renders this on the menu button)
   - `[aria-label*="ore"][role="button"]` (last-resort shape match
     for the SVG with the "more" icon)
2. Wait up to 3s for a menu item with text "Delete" to appear.
3. Click the "Delete" menu item.
4. Wait up to 3s for a confirmation modal — fallback selectors:
   - `[data-testid="tweetDeleteConfirm"]`
   - dialog containing a button whose text is exactly "Delete"
5. Click the modal's Delete confirm button.
6. Wait for the post to disappear from the timeline (or for the
   timeline to shift the target post out of view), bounded by
   `CLICK_FLIP_TIMEOUT_MS` (5s, shared with likes).

### Pacing

Likes run at 1200ms base. Replies run at **3000ms base**, ±50%
jitter, with a 90s pause every 20 actions and exponential backoff
60s → 10min on failure. The pacing preset is named (`pacing.likes`
vs. `pacing.replies`) so the run loop resolves the right bundle per
category.

Slower because:
- delete is destructive and not idempotent (unlike is);
- X's anti-abuse signals treat delete harsher than unlike (higher
  rate-limit risk, higher captcha risk);
- public, social cost — a misclick leaves a visible gap in someone
  else's notifications.

### Confirmation

Likes gate the Go button on typed "DELETE". Replies gate it on
typed "**DELETE MY REPLIES**". When both toggles are on, the gate
is "DELETE MY REPLIES" (the stronger one wins). Dry-run bypasses
the gate for either category.

## Configuration additions

```
config.deleteLikes:   true   (unchanged)
config.deleteReplies: false  (new — off by default; replies are
                             destructive and public, so we do not
                             turn it on for the user)
config.dryRun:        false  (unchanged)
config.pacing.likes:  { ... } (unchanged)
config.pacing.replies: { ... } (new)
config.cursor.likes:  ...
config.cursor.replies: ...  (new key, separate from likes cursor)
```

`deleteReplies` defaults to `false` rather than `true`. Rationale:
a fresh install of Batchd should not silently start deleting
content the user authored. The user must opt in.

## State

- `cursor.replies` is keyed separately from `cursor.likes`. The
  two categories never share a cursor because they live on
  different X pages and have disjoint post-ID sets.
- `processed[]` is shared across categories. A post ID is a post
  ID — no overlap is possible between the likes tab and the
  replies tab in normal use. Sharing the set keeps `processedHas`
  O(1) and means a future category extension doesn't need to
  reason about per-category processed sets.

## What this ADR does not cover

- **Reintroducing reposts or quote reposts.** Out of scope for
  this branch. The prior removal (commit `0c1d148`) was
  deliberate; restoring those flows needs a new design pass and
  live verification, not a config flag.
- **Deleting non-reply posts (the user's regular "Tweets" tab).**
  Out of scope. The Replies tab already covers the most
  high-value deletion case; a broader "delete my own tweets"
  loop is a different problem (different pacing, different
  confirmation, possibly different ADR).
- **Bulk-deleting media only.** Delete deletes the post; there is
  no separate "remove media" affordance in X's UI that we can
  drive.
- **Cross-tab parallelization.** One category runs at a time. The
  pacing numbers are tuned for a single live tab; running
  likes and replies concurrently would compound backoff without
  cutting wall time meaningfully.
