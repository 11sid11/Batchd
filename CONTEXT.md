# Batchd — Context Glossary

Batchd is a Tampermonkey userscript that bulk-removes the user'"'"'s own X.com
likes and replies. It is a personal-use tool, not a product.

## Scope

**Likes and replies.** Batchd operates on engagement the current user has
made on X.com. It does **not** remove other engagement types, reposts, quote
reposts, DMs, bookmarks, or account data.

### Likes

Lives on the `/<username>/likes` tab. Action: click the active heart to
unlike. Idempotent, no modal, low social cost.

### Replies

Lives on the user'"'"'s profile **Replies** tab — `https://x.com/<username>/with_replies`.
The script walks that rendered timeline and opens each post'"'"'s "more" menu
to reach the **Delete** action, then confirms X'"'"'s delete-post modal.
Reply deletion is destructive and public: it removes a post the user
authored and is visible to everyone who saw it. Pacing is intentionally
slower than likes.

### Mode

The currently active cleanup category — either `likes` or `replies`.
Likes and Replies are **mutually exclusive** in the panel: ticking one
auto-unticks the other. The panel shows the active mode in a small
"STATS [mode]" pill above the three counter boxes.

## Canonical terms

| Term | Definition |
|------|------------|
| **Like** | The heart icon on a post. Undo path: click the active heart again. Includes self-likes. |
| **Likes tab** | The `/<username>/likes` URL. Contains posts the user has liked, reverse-chronologically when X renders them. |
| **Reply** | A post the user authored as a reply to another post. On X, replies the user wrote show up on their profile under the Replies tab. |
| **Replies tab** | The `/<username>/with_replies` URL (X'"'"'s "Replies" filter on the user'"'"'s own profile). |
| **Bulk-remove** | Sequentially performing the unlike-or-delete action for each visible target, with pacing and persistence. |
| **Mode** | The currently active cleanup category (`likes` or `replies`). The two are mutually exclusive. |
| **Mutual exclusivity** | Likes and Replies cannot be ticked at the same time. Toggling one clears the other (in both the DOM and the store). |
| **Goto link** | The small `→ /likes` / `→ /with_replies` button next to each toggle. Navigates to the relevant tab using the current path'"'"'s username. |
| **Session** | One continuous run of the script from start to a terminal state: done, aborted, blocked, or navigated. |
| **Processed item** | A post ID for which the category'"'"'s action has succeeded at least once in the current or any prior session. |
| **Cursor** | The last successfully processed post ID for a given category. It is diagnostic/persistence state, not a seek mechanism. |
| **Watchdog** | The mechanism that declares the visible timeline stalled after repeated scroll attempts with no eligible targets. |
| **Dry run** | A mode where the script walks the visible timeline and logs intended actions without clicking. |
| **Failure** | Any non-success outcome for a single action. The full set of failure kinds is `success`, `already_gone`, `not_actionable`, `network`, `rate_limited`, `captcha`, `unknown`, `stale` — see `src/failures.js` for the canonical list and `classify()`. |
| **Stat** | A per-category run counter. Each category has `success`, `failure`, `skipped`, and `consecutiveFailures`. The panel shows the active category'"'"'s stats under a "STATS [mode]" pill. |
| **Mode chip** | The small Twitter-blue pill in the panel that names the active category above the stat boxes. |
| **Stopwatch** | The MM:SS elapsed-time display in the panel. Starts when Go is clicked, freezes when Stop is clicked or the run completes naturally. Format `HH:MM:SS` past the hour. |
| **Pacing parameters** | The tunables controlling action speed: base delay, jitter, batch pause, and failure backoff. Each category has its own pacing preset. |
| **Pacing preset** | A named bundle of pacing parameters. Batchd ships two: `likes` (default — 1200ms base) and `replies` (3000ms base, tighter batch, longer backoff). |
| **Confirmation** | The typed gate string the user must enter before the Go button enables. Both Likes and Replies currently use "DELETE". |
| **More-button scoping** | On the replies tab, X renders each thread as one `article[data-testid="tweet"]` containing both the parent post and the user'"'"'s reply. The script walks up from the reply'"'"'s status link to find the `⋯` button in the reply subtree, not the parent post'"'"'s. |
| **Delete sequence** | The three-click chain for replies: open more-menu → click "Delete" item → click confirm in the delete-post modal. |
| **Migration** | A one-time state-shape upgrade that runs when the script reads persisted storage. v0.1.0 → v0.2.0 migrates the flat `pacing` object under `pacing.likes` and the flat `stats` object under `stats.likes`. Idempotent. |

## Configuration surface

The user can toggle:

- `deleteLikes` (boolean, default `true`)
- `deleteReplies` (boolean, default `false`) — off by default because replies are destructive and public; also because Likes and Replies are mutually exclusive
- `dryRun` (boolean, default `false`) — walk and tally only, no clicks
- `pacing` (object) — two presets:
  - `pacing.likes`: 1200ms base delay ±50% jitter, 60s rest every 50 actions, exponential backoff 30s → 5min on failure
  - `pacing.replies`: 3000ms base delay ±50% jitter, 90s rest every 20 actions, exponential backoff 60s → 10min on failure

## Resolved decisions

### Architectural

| # | Decision | File |
|---|----------|------|
| 0001 | Tampermonkey userscript (one shared userscript for both Likes and Replies), not Chrome extension or plain script | `docs/adr/0001-tampermonkey-userscript.md` |
| 0002 | UI scrape, not X API (applies to both Likes tab and Replies tab) | `docs/adr/0002-ui-scrape-not-api.md` |
| 0003 | Replies are a category peer of likes, sharing the same userscript with a per-category pacing preset | `docs/adr/0003-replies-as-mode.md` |

### Operational

- **Likes use an ongoing refill loop** — detect one visible target, unlike it, re-query, scroll for more when no eligible visible targets remain, and finish only after the idle watchdog proves no more work is surfacing.
- **Replies use the same refill loop** — the run-loop core is shared between categories; only the click action and pacing preset differ.
- **Non-captcha failures are skipped and documented** — one bad item does not kill the run, and failed items are left retryable in a future session. Applies to both likes and replies.
- **Captcha/user stop are hard stops** — captcha needs human intervention; user stop aborts promptly.
- **Likes cleanup is best-effort against X'"'"'s rendered timeline** — X may leave a small number of liked posts hidden, stalled, tombstoned, or rendered without a detectable unlike control; those can require a refresh/rerun or manual cleanup.
- **Replies cleanup is best-effort, same caveat** — X may leave a small number of replies hidden, stalled, or rendered without a detectable more-menu or Delete item; those can require a refresh/rerun or manual cleanup.
- **Typed "DELETE" confirmation + dry-run mode toggle** — friction-by-design at the point of no return. Both Likes and Replies use the same "DELETE" gate (the destructive-public nature of replies is mitigated by the slower pacing preset, the off-by-default `deleteReplies` flag, and the mutual-exclusivity rule rather than a longer typed string).
- **Persist state on every Nth action, no explicit close-tab handlers** — crash-safe without `beforeunload` ceremony.
- **Floating bottom-right control panel** — overlays without blocking the tab content you'"'"'re watching.
- **Mutual exclusivity between Likes and Replies** — only one mode is active at a time, so the user is always explicit about which cleanup is running.

## Out of scope

- Removing reposts or quote reposts (the prior pre-likes-only flow was removed in commit `0c1d148` because it did not work reliably enough in the live UI; reintroducing it requires a new design pass and live verification, not in this branch)
- Deleting the user'"'"'s own non-reply posts (tweets that are not replies to anyone)
- Operating on other users'"'"' accounts
- Operating on bookmarks
- Operating on DMs
- Automated scheduling or triggers
- Multi-account handling
- Bulk delete of media attached to the user'"'"'s own posts (Delete deletes the post; media deletion is a separate X flow)
