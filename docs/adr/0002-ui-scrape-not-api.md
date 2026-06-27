# UI scrape, not X API

We drive Batchd by reading post IDs from the rendered Likes tab on x.com and
clicking active unlike controls in the DOM, rather than calling X's REST API
with an OAuth bearer token. Trade-off accepted: the script is fragile to X UI
changes in exchange for not requiring the user to provision a developer account,
register an app, complete OAuth, or live under X's API limits. Tampermonkey runs
in the user's already-logged-in browser context, so the existing session cookie
is reused without ceremony.
