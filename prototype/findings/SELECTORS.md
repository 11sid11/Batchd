# Prototype findings — X.com Likes selectors

## Scope

Batchd targets only the user's rendered X.com Likes tab. It discovers visible
liked posts, extracts their post IDs, and clicks the active unlike control.

## Canonical selectors

| Element | Selector | Notes |
|---------|----------|-------|
| Post article | `article[data-testid="tweet"]` | Useful wrapper when X renders a standard post article. |
| Unlike button | `[data-testid="unlike"]` | Primary active-like selector when present. |
| Active like label | `[aria-label="Liked"]` | Stable fallback for the active like button. |
| Filled heart path | `svg path[d^="M20.884 13.19"]` | Geometry fallback for active liked state. |
| Post permalink | `a[href*="/status/"]` | Extract numeric post ID from `href`. |

## URL path

| Tab | Path |
|-----|------|
| Likes | `/<username>/likes` |

## Quirks and gotchas

- The unlike control is contextual; inactive heart buttons must not be clicked.
- X can re-render the timeline after every click, so targets must be re-queried
  rather than processed from a stale snapshot.
- Some liked posts can be hidden, stalled, tombstoned, or rendered without a
  detectable active-heart signal. Those leftovers may require refresh/rerun or
  manual cleanup.
- Post IDs should be stored as strings.

## Verification snippet

Run this on `https://x.com/me/likes` in a logged-in browser session:

```js
(() => {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  const sample = articles[0];
  if (!sample) return { error: "No articles found — page didn't render." };
  const idLink = sample.querySelector('a[href*="/status/"]');
  const unlikeBtn = sample.querySelector('[data-testid="unlike"]');
  const likedLabel = sample.querySelector('[aria-label="Liked"]');
  const filledHeart = sample.querySelector('svg path[d^="M20.884 13.19"]');
  return {
    articleCount: articles.length,
    samplePostId: idLink?.href.match(/\/status\/(\d+)/)?.[1],
    sampleHasUnlike: !!unlikeBtn,
    sampleHasLikedLabel: !!likedLabel,
    sampleHasFilledHeart: !!filledHeart,
  };
})();
```
