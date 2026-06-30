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
  const existing = target.__batchd?.instance;
  if (existing) {
    if (existing === instance) {
      // Same-instance re-call: this entry point already won the race and
      // stamped us. Yielding to ourselves would cause the caller to bail
      // and leave `window` stamped but unmounted — a latent bug. Treat a
      // repeat call from the winning instance as a no-op success.
      return false;
    }
    console.info(
      `[batchd] instance "${instance}" found an active "${existing}" — yielding. ` +
        `Uninstall the duplicate install if you want this one to take over.`,
    );
    return true;
  }
  target.__batchd = { ...target.__batchd, instance };
  return false;
}
