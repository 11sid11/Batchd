# UI scrape, not X API

We drive Batchd by reading post IDs from the rendered X.com
timeline (the Likes tab for the unlike flow, the Replies tab for the
delete flow) and clicking the corresponding controls in the DOM,
rather than calling X's REST API with an OAuth bearer token.
Trade-off accepted: the script is fragile to X UI changes in exchange
for not requiring the user to provision a developer account,
register an app, complete OAuth, or live under X's API limits.
Tampermonkey runs in the user's already-logged-in browser context,
so the existing session cookie is reused without ceremony.

This decision applies to **both** cleanup categories:
- **Likes** (`/<username>/likes`): we read each visible post ID
  and click the active heart to trigger the unlike.
- **Replies** (`/<username>/with_replies`): we read each visible
  post ID, open its more-menu, and drive the Delete + confirm
  modal sequence.

If X ever changes the rendered DOM in a way that breaks our
selectors, the patch point is one or two functions in
`src/selectors.js` (the `TAB_PATHS` map, `findMoreButtonInNode`,
`findConfirmButtonImpl`). The run loop and persistence layers do
not need to change.
