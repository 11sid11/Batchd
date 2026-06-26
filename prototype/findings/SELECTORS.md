# Prototype findings — X.com DOM selectors

## Scope of this document

What selectors Batchd (the Tampermonkey userscript) should target to discover
posts, identify the like / unlike / repost / un-repost controls, and extract
post IDs. Verified against the publicly-known conventions for x.com's React
front-end as of 2025–2026; **not** verified against a live logged-in render
because the prototype session has no X account credentials.

## Confirmed / canonical selectors

These come from public reverse-engineering work (twscrape, fa0311 scrapers,
multiple Tampermonkey scripts on Greasyfork that target x.com) and from
WebFetch summarising the same conventions. They are stable across the React
front-end (2022–present). X has not signalled a planned change.

| Element | Selector | Notes |
|---------|----------|-------|
| Tweet / post article | `article[data-testid="tweet"]` | The wrapper for one post in any timeline view. |
| Like button (currently not liked) | `[data-testid="like"]` | Click to like. |
| Unlike button (currently liked) | `[data-testid="unlike"]` | Click to unlike. This is the one we click. |
| Repost button (currently not reposted) | `[data-testid="retweet"]` | Opens a dropdown. **Note**: data-testid is still `retweet` even though UI text says "Repost". |
| Undo-repost button (in the dropdown menu) | `[data-testid="unretweet"]` | Click to undo. Again, `unretweet` test ID even though UI text says "Undo repost". |
| Post permalink | `a[href*="/status/"]` | Extract numeric post ID from `href`. |
| Tweet text | `[data-testid="tweetText"]` | Optional, for dry-run display. |
| Tweet timestamp | `time` element | Optional, for dry-run display. |

## URL paths

| Tab | Path | Notes |
|-----|------|-------|
| Posts (default) | `/<username>` | |
| Reposts | `/<username>/reposts` | New name as of X rebrand. Old `/retweets` redirects here. |
| Likes | `/<username>/likes` | Unchanged. |
| Replies | `/<username>/with_replies` | |
| Media | `/<username>/media` | |

## Quirks and gotchas

### 1. The "Repost" button is a dropdown, not a direct action
Clicking `[data-testid="retweet"]` opens a menu with options including
"Repost" (a confirm action) and "Quote Repost" (opens the composer). The
action we want is the confirm — `[data-testid="unretweet"]` after one click
on `[data-testid="retweet"]`. There is a window of ~500ms between the two
clicks during which the menu is open.

To distinguish "I want to undo a repost" from "I want to quote repost": the
script must find the `[data-testid="unretweet"]` menu item and click it.
Clicking outside the menu dismisses without action.

### 2. The undo buttons appear contextually
- `[data-testid="unlike"]` only appears on a post you've already liked.
- `[data-testid="unretweet"]` only appears in the repost-confirm menu on a
  post you've already reposted.
- A naive "click all `data-testid="like"` buttons" would LIKES posts you've
  not liked. **Use the inverse selectors** (`unlike`, `unretweet`) to identify
  items to act on — they're the items where engagement exists.

### 3. Profile tabs are anchor links, not buttons
The "Reposts" and "Likes" tabs on `/<username>` are `<a>` tags inside a nav
with `role="tablist"`. They're navigated by setting `window.location` (or
`history.pushState`), not by clicking a button that triggers a route change.
The script can directly navigate to `/me/reposts` or `/me/likes` without
needing to find the tab element.

### 4. Post IDs are bigints
Twitter/X post IDs are 64-bit integers but they fit in JavaScript's `Number`
up to ~2^53. Safe to use as object keys and in sets without `BigInt`.

### 5. The "Reposts" tab shows posts YOU reposted (not your repost count)
Visiting `/me/reposts` renders the posts you've reposted, in reverse
chronological order. Same shape as the "Posts" timeline — same selectors
apply.

### 6. The "Likes" tab shows posts YOU liked
Visiting `/me/likes` renders posts you've liked, reverse chronological.
Same shape. Self-likes (on your own posts) DO appear here.

### 7. Posts that have been deleted render differently
If a post you've liked or reposted is since deleted by the author, it may
still appear as a tombstone in your Likes/Reposts tab with a "This post is
unavailable" placeholder. The undo button may or may not be present. The
script should treat "post not found" as success (engagement no longer
counts) rather than failure.

### 8. `data-testid` values are obfuscated in minified production bundles
The values themselves are stable (per the React conventions above), but the
surrounding className strings are not. Don't try to target CSS classes — they
change per build.

## Verification checklist (for the implementer)

Once you have a logged-in browser session, run this snippet in DevTools on
`https://x.com/me/likes`:

```js
(() => {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  const sample = articles[0];
  if (!sample) return { error: "No articles found — page didn't render." };
  const idLink = sample.querySelector('a[href*="/status/"]');
  const unlikeBtn = sample.querySelector('[data-testid="unlike"]');
  const likeBtn = sample.querySelector('[data-testid="like"]');
  return {
    articleCount: articles.length,
    samplePostId: idLink?.href.match(/\/status\/(\d+)/)?.[1],
    sampleHasUnlike: !!unlikeBtn,
    sampleHasLike: !!likeBtn,
  };
})();
```

Expected output:
```js
{
  articleCount: <varies, scroll-dependent>,
  samplePostId: "1234567890123456789",
  sampleHasUnlike: true,   // because you liked it
  sampleHasLike: false
}
```

If `sampleHasUnlike` is `false` on a post you've liked, the selectors have
drifted — re-inspect and update this document.

## Open questions for the implementer

These weren't resolvable without a logged-in session; surface them when you
have one:

1. **Confirm "Undo Repost" menu item selector** — the dropdown menu items
   use what `data-testid`? We believe `unretweet`; verify on first run.
2. **Visual "Liking..." spinner behaviour** — does the unlike button
   immediately swap to `data-testid="like"` after click, or does it stay as
   `unlike` until the network round-trip completes? Determines whether we
   need to wait for selector flip before moving to the next item.
3. **Rate-limit signal** — does X render any client-side UI when rate
   limits are hit (modal, banner, toast)? Or is it only the network
   response that indicates it? The pacing defaults assume the latter.
4. **Captcha trigger threshold** — at what cadence does X start serving
   captchas during unlike operations? The 5-consecutive-failure abort
   threshold assumes the rate-limit signal is reliable.
