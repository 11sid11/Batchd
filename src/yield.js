// Detect-and-yield guard for Batchd.
//
// When a user has both the Tampermonkey userscript and the Chrome
// extension installed, both entry points would otherwise mount a
// floating panel, build a `createStore`, and start a run loop. Two
// run loops racing over the same timeline would un-like / delete the
// same posts, double-count stats, and render two panels on top of
// each other. See ADR 0004 and the **Yield check** term in
// `CONTEXT.md` for the full rationale.
//
// `checkAndYield(instance, target)` returns `false` if no other
// Batchd is running on `target` (which is `window` in both the TM
// userscript and the Chrome content script), and stamps the
// `__batchd.instance` field on `target` so a later entry point can
// see it. Returns `true` if another instance is already running; the
// caller should bail. Both entry points call this first thing, so
// exactly one wins regardless of which loads first.

export function checkAndYield(instance, target = globalThis) {
  if (target.__batchd?.instance) {
    const existing = target.__batchd.instance;
    console.info(
      `[batchd] another instance is already running (${existing}) — yielding. ` +
        `Uninstall the duplicate install if you want this one to take over.`,
    );
    return true;
  }
  target.__batchd = { ...target.__batchd, instance };
  return false;
}
