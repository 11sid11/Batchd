// Run loop — the orchestrator that drives one category (reposts / likes).
//
// Pure control flow. All DOM access is delegated to selectors.js; all
// decisions about pacing, persistence, and failure handling are delegated
// to their respective modules.

import {
  findEngagedPosts,
  clickUndo,
  scrollUntilExhausted,
  scrollForMore,
  isCaptchaPresent,
  tabUrl,
} from './selectors.js';
import { nextDelay, shouldBatchPause, backoffMs } from './pacing.js';
import { classify, shouldAbort } from './failures.js';

const DEFAULT_IDLE_SCROLL_WATCHDOG = 20;

export async function runCategory(category, { store, username, signal, onProgress, log = () => {}, deps = {} }) {
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

  const runtime = {
    findEngagedPosts,
    clickUndo,
    scrollUntilExhausted,
    scrollForMore,
    isCaptchaPresent,
    sleep,
    idleLimit: DEFAULT_IDLE_SCROLL_WATCHDOG,
    ...deps,
  };

  if (category === 'likes') {
    return runLikesCategory({ category, store, signal, onProgress, log, cfg, runtime });
  }

  return runSnapshotCategory({ category, store, signal, onProgress, log, cfg, runtime });
}

async function runSnapshotCategory({ category, store, signal, onProgress, log, cfg, runtime }) {
  let processedThisRun = 0;
  let consecutiveFailures = 0;
  const maxConsecutive = 5;

  // First scroll: until exhausted / captcha / aborted. This loads as many
  // articles into the DOM as X's lazy-loader is willing to surface before
  // it gives up.
  const scrollResult = await runtime.scrollUntilExhausted({
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

    const allTargets = runtime.findEngagedPosts(category);
    const targets = allTargets.filter((t) => !store.processedHas(t.postId));
    log(`run: round ${detectionRound} — ${allTargets.length} in DOM, ${targets.length} unprocessed`);

    if (targets.length === 0) break;

    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) return { status: 'aborted' };
      const target = targets[i];

      // Pace: sleep baseMs ± jitter before the action
      const delay = nextDelay(cfg.pacing.baseMs, cfg.pacing.jitter);
      await runtime.sleep(delay);

      let clickResult;
      if (cfg.dryRun) {
        clickResult = { outcome: { buttonFound: true, responseOk: true, buttonStillThere: true } };
        log(`run: [dry] would click ${category} on ${target.postId}`);
      } else {
        try {
          clickResult = await runtime.clickUndo(target, { signal });
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
        await runtime.sleep(backoff);
      }

      // Batch pause — every N actions, take a longer rest so X's rate-limit
      // window resets. Use the running `processedThisRun` (across rounds)
      // so the cadence is consistent.
      if (shouldBatchPause(processedThisRun, cfg.pacing.batchSize)) {
        log(`run: batch pause — ${cfg.pacing.batchPauseMs}ms rest`);
        await runtime.sleep(cfg.pacing.batchPauseMs);
      }

      store.touchLastAction();
    }
  }

  store.flush();
  return { status: 'done', processed: processedThisRun };
}

async function runLikesCategory({ category, store, signal, onProgress, log, cfg, runtime }) {
  let processedThisRun = 0;
  let failureBackoffStep = 0;
  let idleStreak = 0;
  const failedThisRun = new Set();
  const idleLimit = runtime.idleLimit;

  while (idleStreak < idleLimit) {
    if (signal?.aborted) return { status: 'aborted' };
    if (runtime.isCaptchaPresent()) {
      log('run: blocked: captcha');
      store.flush();
      return { status: 'blocked', reason: 'captcha' };
    }

    const allTargets = runtime.findEngagedPosts(category);
    const targets = allTargets.filter((t) =>
      !store.processedHas(t.postId) && !failedThisRun.has(t.postId)
    );

    onProgress?.({
      phase: 'detecting',
      visible: allTargets.length,
      eligible: targets.length,
      skippedThisRun: failedThisRun.size,
      idleStreak,
    });

    if (targets.length === 0) {
      const scrollResult = await runtime.scrollForMore({ signal });
      if (scrollResult.reason === 'aborted') return { status: 'aborted' };
      if (scrollResult.reason === 'captcha') {
        log('run: blocked: captcha');
        store.flush();
        return { status: 'blocked', reason: 'captcha' };
      }

      const afterTargets = runtime.findEngagedPosts(category);
      const afterEligible = afterTargets.filter((t) =>
        !store.processedHas(t.postId) && !failedThisRun.has(t.postId)
      );
      onProgress?.({
        phase: 'scrolling',
        articles: scrollResult.articles,
        visible: afterTargets.length,
        eligible: afterEligible.length,
        skippedThisRun: failedThisRun.size,
        idleStreak,
      });

      if (afterEligible.length > 0) {
        idleStreak = 0;
        log(`run: refill found ${afterEligible.length} eligible likes`);
      } else {
        idleStreak++;
        log(`run: idle ${idleStreak}/${idleLimit} — visible=${afterTargets.length}, skippedThisRun=${failedThisRun.size}`);
      }
      continue;
    }

    const target = targets[0];
    const delay = nextDelay(cfg.pacing.baseMs, cfg.pacing.jitter);
    await runtime.sleep(delay);

    if (cfg.dryRun) {
      failedThisRun.add(target.postId);
      log(`run: [dry] would click ${category} on ${target.postId}`);
      onProgress?.({
        phase: 'acting',
        index: processedThisRun,
        postId: target.postId,
        kind: 'dry_run',
        visible: allTargets.length,
        eligible: targets.length,
        skippedThisRun: failedThisRun.size,
        idleStreak,
      });
      idleStreak = 0;
      continue;
    }

    let clickResult;
    try {
      clickResult = await runtime.clickUndo(target, { signal });
    } catch (err) {
      clickResult = target.undoButton?.isConnected === false
        ? { outcome: { stale: true } }
        : { outcome: { buttonFound: true, error: err } };
    }

    const kind = classify(clickResult.outcome);
    onProgress?.({
      phase: 'acting',
      index: processedThisRun,
      postId: target.postId,
      kind,
      visible: allTargets.length,
      eligible: targets.length,
      skippedThisRun: failedThisRun.size,
      idleStreak,
    });

    if (kind === 'stale') {
      log(`run: stale target ${target.postId}: re-querying`);
      idleStreak = 0;
      continue;
    }

    if (kind === 'captcha') {
      log('run: blocked: captcha');
      store.flush();
      return { status: 'blocked', reason: 'captcha' };
    }

    if (kind === 'success' || kind === 'already_gone') {
      store.processedAdd(target.postId);
      store.bumpStat(kind === 'success' ? 'success' : 'skipped');
      store.saveCursor(category, target.postId);
      processedThisRun++;
      failureBackoffStep = 0;
      idleStreak = 0;

      if (shouldBatchPause(processedThisRun, cfg.pacing.batchSize)) {
        log(`run: batch pause — ${cfg.pacing.batchPauseMs}ms rest`);
        await runtime.sleep(cfg.pacing.batchPauseMs);
      }
    } else {
      store.bumpStat('failure');
      store.recordFailure(target.postId, kind);
      failedThisRun.add(target.postId);
      failureBackoffStep++;
      idleStreak = 0;

      const backoff = backoffMs(failureBackoffStep, cfg.pacing.backoffBaseMs, cfg.pacing.backoffMaxMs);
      log(`run: skipped failed post ${target.postId} (${kind}) — backing off ${backoff}ms`);
      await runtime.sleep(backoff);
    }

    store.touchLastAction();
  }

  log(`run: done: idle watchdog exhausted (${idleLimit} idle scrolls)`);
  store.flush();
  return {
    status: 'done',
    reason: 'idle_watchdog_exhausted',
    processed: processedThisRun,
    skippedThisRun: failedThisRun.size,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
