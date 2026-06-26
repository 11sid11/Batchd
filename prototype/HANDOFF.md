# Prototype → main flow handoff

## What this prototype answered

The biggest unknown going into /implement was: **what DOM does Batchd actually
target on x.com?** Without selector stability, the entire userscript is
guesswork. This prototype produced one canonical reference:

- `prototype/findings/SELECTORS.md` — every selector Batchd needs, with
  gotchas (undo buttons are contextual; repost is a dropdown, not a direct
  action; profile tabs are anchor links).

## What this prototype did NOT answer (deferred to /implement)

These require a logged-in X session, which the prototype environment
doesn't have:

1. Confirm the "Undo Repost" menu item selector (`[data-testid="unretweet"]`?)
2. Visual state transition timing on the unlike button (does `unlike` flip
   to `like` immediately on click, or after network round-trip?)
3. X's rate-limit and captcha UI signals — are they client-rendered or only
   network-response?
4. Exact captcha trigger threshold

These four items are the first thing /implement should verify with a
real browser session. They're listed as the "Open questions for the
implementer" section in `SELECTORS.md`.

## Decisions the prototype does NOT change

All 12 decisions from the /grill-with-docs session stand:

- Tampermonkey userscript (ADR-0001)
- UI scrape (ADR-0002)
- Sequential Reposts → Quote Reposts → Likes
- 1200ms ±50% jitter, 60s rest every 50, backoff 30s→5min
- Skip-and-continue, 5-consecutive-failure abort
- Typed "DELETE" confirmation + dry-run mode
- Persist state every Nth action, no close-tab handlers
- Hybrid watchdog at 20 empty scrolls for end-of-list detection
- Floating bottom-right control panel

## Recommended build order for /implement

Based on the dependency graph implied by `SELECTORS.md` and the resolved
decisions:

1. **Selector module** (`selectors.js`) — wrap the selectors in named
   functions (`findAllLikedPosts()`, `findUnlikeButton(postId)`, etc.).
   Verifies against the open questions above. **Test with a logged-in
   session before moving on.**
2. **Pacing engine** (`pacing.js`) — the delay + jitter + batch pause +
   failure backoff logic. Pure functions; easy to unit-test without a
   browser.
3. **Persistence layer** (`persist.js`) — `GM_setValue`/`GM_getValue` wrapper
   for the cursor, processed set, config, and stats. Handles serialization
   (processed set may exceed 10k IDs).
4. **Failure classifier** (`failures.js`) — given a click outcome, classify
   it as `success`, `already_gone`, `rate_limited`, `network`, `unknown`.
5. **Run loop** (`run.js`) — orchestrates one category: scroll → find
   targets → pace → click → classify → persist → loop until watchdog trips.
6. **Control panel UI** (`panel.js` + `panel.css`) — floating bottom-right
   overlay with config toggles, dry-run toggle, typed confirmation input,
   progress display, pause/resume/stop buttons.
7. **Wire-up** (`batchd.user.js`) — `@grant` declarations, `@match`
   patterns (x.com profile + reposts + likes tabs), `===` head injection.

## Suggested /implement command

When you're ready to start:

> `/implement Batchd, working from prototype/HANDOFF.md and the 12 decisions
> in CONTEXT.md. Start with the selector module.`

## Files written by this prototype session

```
Batchd/
├── CONTEXT.md                          (written in /grill-with-docs)
├── docs/
│   └── adr/
│       ├── 0001-tampermonkey-userscript.md
│       └── 0002-ui-scrape-not-api.md
└── prototype/
    ├── HANDOFF.md                      (this file)
    └── findings/
        └── SELECTORS.md                (canonical selectors + gotchas)
```
