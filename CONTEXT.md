# Batchd — Context Glossary

A Tampermonkey userscript that bulk-deletes a user's own X.com engagement
(reposts, quote reposts, likes). Personal-use tool, not a product.

## Scope

**Engagement only.** Batchd operates on actions a user has performed against
other people's posts (reposts, quote reposts, likes). It does **not** delete
the user's own authored posts, replies, media, DMs, or account.

## Canonical terms

| Term | Definition |
|------|------------|
| **Engagement** | A record on x.com that the current user took an action on a post: Repost, Quote Repost, or Like. Exists in the user's profile under the *Reposts* and *Likes* tabs. |
| **Repost** (formerly Retweet) | A pure share of another user's post with no added text. Undo path: click the Repost button on the original post and confirm *Undo repost*. |
| **Quote Repost** (formerly Quote Tweet) | A repost with the user's own added text on top. **Constraint**: at the UI level, Quote Reposts share the same `/reposts` tab and the same `Undo repost` flow as plain Reposts. There is no per-post UI mechanism to undo one kind without the other. The `deleteQuoteReposts` toggle is therefore informational — if either `deleteReposts` or `deleteQuoteReposts` is on, the entire `/reposts` tab is processed uniformly. |
| **Reposts tab** | The `/me/reposts` URL (formerly `/me/retweets`, redirects). Contains all reposts the user has made, plain and quote, intermixed reverse-chronologically. |
| **Like** | The heart icon on a post. Undo path: click the heart again. Includes self-likes (likes on the user's own posts). |
| **Bulk-delete** | Sequentially performing the undo action for each engagement, with pacing and persistence. |
| **Session** | One continuous run of the script from start to a terminal state (done, aborted, or paused). |
| **Processed item** | A post ID for which the undo action has succeeded at least once in the current or any prior session. |
| **Cursor** | The position in a Reposts or Likes timeline where the script is currently reading from. |
| **Watchdog** | The mechanism that detects end-of-list by counting consecutive scroll attempts that return no new items. |
| **Dry run** | A mode where the script walks the timeline and tallies without performing any undo actions. |
| **Failure** | Any non-success outcome for a single undo action: network error, rate-limit, captcha, stale DOM target, or item-already-gone. |
| **Consecutive-failure threshold** | The legacy Reposts threshold that triggers a hard abort when repeated failures suggest a sustained outage. Likes do not use this threshold; they skip/document non-captcha failures and keep refilling the timeline. |
| **Pacing parameters** | The set of tunables controlling how fast undo actions are performed: base delay, jitter, batch pause, failure backoff. |

## Configuration surface

The user can toggle each engagement type on or off at run start:

- `deleteReposts` (boolean, default `true`)
- `deleteQuoteReposts` (boolean, default `true`)
- `deleteLikes` (boolean, default `true`)

The user can additionally toggle:

- `dryRun` (boolean, default `false`) — walk and tally only, no clicks
- `pacing` (object) — defaults: 1200ms base delay ±50% jitter, 60s rest every 50 actions, exponential backoff 30s → 5min on failure

## Resolved decisions

### Architectural (full ADRs in `docs/adr/`)

| # | Decision | File |
|---|----------|------|
| 0001 | Tampermonkey userscript, not Chrome extension or plain script | `docs/adr/0001-tampermonkey-userscript.md` |
| 0002 | UI scrape, not X API | `docs/adr/0002-ui-scrape-not-api.md` |

### Operational (captured here, no ADR)

- **Sequential Reposts → Quote Reposts → Likes** — single linear cursor per category, no cross-tab state
- **Likes skip-and-document non-captcha failures; captcha/user stop are hard stops** — one bad item doesn't kill the run, and failed likes are left retryable in a future session
- **Likes use an ongoing refill loop** — detect one visible target, unlike it, re-query, scroll for more when no eligible visible targets remain, and finish only after the idle watchdog proves no more work is surfacing
- **Likes cleanup is best-effort against X's rendered timeline** — X may leave a small number of liked posts hidden, stalled, tombstoned, or rendered without a detectable unlike control; those can require a refresh/rerun or manual cleanup
- **Reposts retain skip-and-continue with hard-abort at 5 consecutive failures** — one bad item doesn't kill the run, sustained outage does
- **Hybrid watchdog at 20 empty scrolls** for end-of-list detection — graceful "X is hiding older items" signal for power users
- **Typed "DELETE" confirmation + dry-run mode toggle** — friction-by-design at the point of no return
- **Persist state on every Nth action, no explicit close-tab handlers** — crash-safe without `beforeunload` ceremony
- **Floating bottom-right control panel** — overlays without blocking the tab content you're watching

## Out of scope (intentionally)

- Deleting the user's own posts, replies, or media
- Operating on other users' accounts
- Operating on the user's bookmarks (different engagement type, different UX)
- Automated scheduling or triggers
- Cross-browser support beyond Tampermonkey-compatible engines (Violentmonkey, Greasemonkey 4.x)
- Multi-account handling
