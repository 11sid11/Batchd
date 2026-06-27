# Batchd — Context Glossary

Batchd is a Tampermonkey userscript that bulk-removes the user's own X.com
likes. It is a personal-use tool, not a product.

## Scope

**Likes only.** Batchd operates on likes the current user has made on X.com.
It does **not** remove other engagement types, authored posts, replies, media,
DMs, bookmarks, or account data.

## Canonical terms

| Term | Definition |
|------|------------|
| **Like** | The heart icon on a post. Undo path: click the active heart again. Includes self-likes. |
| **Likes tab** | The `/me/likes` URL. Contains posts the user has liked, reverse-chronologically when X renders them. |
| **Bulk-remove** | Sequentially performing the unlike action for each visible liked post, with pacing and persistence. |
| **Session** | One continuous run of the script from start to a terminal state: done, aborted, blocked, or navigated. |
| **Processed item** | A post ID for which the unlike action has succeeded at least once in the current or any prior session. |
| **Cursor** | The last successfully processed post ID for the Likes timeline. It is diagnostic/persistence state, not a seek mechanism. |
| **Watchdog** | The mechanism that declares the visible timeline stalled after repeated scroll attempts with no eligible likes. |
| **Dry run** | A mode where the script walks the visible Likes timeline and logs intended actions without clicking. |
| **Failure** | Any non-success outcome for a single unlike action: network error, rate-limit, captcha, stale DOM target, or item-already-gone. |
| **Pacing parameters** | The tunables controlling action speed: base delay, jitter, batch pause, and failure backoff. |

## Configuration surface

The user can toggle:

- `deleteLikes` (boolean, default `true`)
- `dryRun` (boolean, default `false`) — walk and tally only, no clicks
- `pacing` (object) — defaults: 1200ms base delay +/-50% jitter, 60s rest every 50 actions, exponential backoff 30s -> 5min on failure

## Resolved decisions

### Architectural

| # | Decision | File |
|---|----------|------|
| 0001 | Tampermonkey userscript, not Chrome extension or plain script | `docs/adr/0001-tampermonkey-userscript.md` |
| 0002 | UI scrape, not X API | `docs/adr/0002-ui-scrape-not-api.md` |

### Operational

- **Likes use an ongoing refill loop** — detect one visible target, unlike it, re-query, scroll for more when no eligible visible targets remain, and finish only after the idle watchdog proves no more work is surfacing.
- **Non-captcha failures are skipped and documented** — one bad item does not kill the run, and failed likes are left retryable in a future session.
- **Captcha/user stop are hard stops** — captcha needs human intervention; user stop aborts promptly.
- **Likes cleanup is best-effort against X's rendered timeline** — X may leave a small number of liked posts hidden, stalled, tombstoned, or rendered without a detectable unlike control; those can require a refresh/rerun or manual cleanup.
- **Typed "DELETE" confirmation + dry-run mode toggle** — friction-by-design at the point of no return.
- **Persist state on every Nth action, no explicit close-tab handlers** — crash-safe without `beforeunload` ceremony.
- **Floating bottom-right control panel** — overlays without blocking the tab content you're watching.

## Out of scope

- Removing non-like engagement types
- Deleting the user's own posts, replies, or media
- Operating on other users' accounts
- Operating on bookmarks
- Automated scheduling or triggers
- Multi-account handling
