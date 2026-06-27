// Run loop — the orchestrator that drives one category (reposts / likes).
//
// Pure control flow. All DOM access is delegated to selectors.js; all
// decisions about pacing, persistence, and failure handling are delegated
// to their respective modules.

import { findEngagedPosts, clickUndo, scrollUntilExhausted, tabUrl } from './selectors.js';
import { nextDelay, shouldBatchPause, batchPauseDuration, backoffMs } from './pacing.js';
import { classify, shouldAbort } from './failures.js';

export async function runCategory(category, { store, username, signal, onProgress, log = () => {} }) {
  log(`run: starting category ${category}`);

  // Ensure we're on the right tab. If we aren't, navigate and stop; the
  // user will reload and resume from the saved cursor.
  const expected = tabUrl(username, category);
  if (!location.href.startsWith(expected.split('?')[0])) {
    log(`run: not on ${expected}; navigating`);
    location.assign(expected);
    return { status: 'navigated', reason: 'wrong_tab' };
  }

  const cfg = store.loadState().config;
  if (cfg.dryRun) log('run: DRY RUN — no clicks will be performed');
  store.markRunStarted();

  let processedThisRun = 0;
  let consecutiveFailures = 0;
  const maxConsecutive = 5;

  // First scroll: until exhausted / captcha / aborted. This loads as many
  // articles into the DOM as X's lazy-loader is willing to surface before
  // it gives up.
  const scrollResult = await scrollUntilExhausted({
    onProgress: (p) => onProgress?.({ phase: 'scrolling', ...p }),
    signal,
  });
  log(`run: scroll finished — reason=${scrollResult.reason}, scrolled=${scrollResult.totalScrolled}, final=${scrollResult.finalCount ?? '?'}`);

  if (scrollResult.reason === 'captcha') {
    return { status: 'blocked', reason: 'captcha' };
  }
  if (scrollResult.reason === 'aborted') {
    return { status: 'aborted' };
  }

  // Process iteratively. After each pass, the DOM has changed — articles we
  // unliked have been removed, articles below them have shifted up, and X
  // may have lazy-loaded more posts into the now-empty space. Re-query
  // `findEngagedPosts` each iteration so newly-surfaced posts get processed
  // too. Stop when an iteration finds no new unprocessed posts.
  const MAX_DETECTION_ITERATIONS = 20;
  for (let detectionRound = 0; detectionRound < MAX_DETECTION_ITERATIONS; detectionRound++) {
    if (signal?.aborted) return { status: 'aborted' };

    const allTargets = findEngagedPosts(category);
    const targets = allTargets.filter((t) => !store.processedHas(t.postId));
    log(`run: round ${detectionRound} — ${allTargets.length} in DOM, ${targets.length} unprocessed`);

    if (targets.length === 0) break;

    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) return { status: 'aborted' };
      const target = targets[i];

      // Pace: sleep baseMs ± jitter before the action
      const delay = nextDelay(cfg.pacing.baseMs, cfg.pacing.jitter);
      await sleep(delay);

      let clickResult;
      if (cfg.dryRun) {
        clickResult = { outcome: { buttonFound: true, responseOk: true, buttonStillThere: true } };
        log(`run: [dry] would click ${category} on ${target.postId}`);
      } else {
        try {
          clickResult = await clickUndo(target, { signal });
        } catch (err) {
          clickResult = { outcome: { buttonFound: true, error: err } };
        }
      }

      const kind = classify(clickResult.outcome);
      onProgress?.({ phase: 'acting', index: i, postId: target.postId, kind });

      if (kind === 'success' || kind === 'already_gone') {
        store.processedAdd(target.postId);
        store.bumpStat(kind === 'success' ? 'success' : 'skipped');
        store.saveCursor(category, target.postId);
        consecutiveFailures = 0;
        processedThisRun++;
      } else {
        store.bumpStat('failure');
        store.recordFailure(target.postId, kind);
        consecutiveFailures++;
        if (shouldAbort(consecutiveFailures, maxConsecutive)) {
          log(`run: abort — ${consecutiveFailures} consecutive failures`);
          return { status: 'aborted', reason: 'consecutive_failures', consecutiveFailures };
        }
        const backoff = backoffMs(consecutiveFailures, cfg.pacing.backoffBaseMs, cfg.pacing.backoffMaxMs);
        log(`run: ${kind} on ${target.postId} — backing off ${backoff}ms`);
        await sleep(backoff);
      }

      // Batch pause — every N actions, take a longer rest so X's rate-limit
      // window resets. Use the running `processedThisRun` (across rounds)
      // so the cadence is consistent.
      if (shouldBatchPause(processedThisRun, cfg.pacing.batchSize)) {
        log(`run: batch pause — ${cfg.pacing.batchPauseMs}ms rest`);
        await sleep(cfg.pacing.batchPauseMs);
      }

      store.touchLastAction();
    }
  }

  store.flush();
  return { status: 'done', processed: processedThisRun };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
