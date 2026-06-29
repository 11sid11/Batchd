// Failure classifier for Batchd.
//
// Given an outcome object from a single click action, return a kind:
//   - 'success'        : click succeeded, target control is gone, no error
//   - 'already_gone'   : target control wasn't on the page (post deleted /
//                        not engaged anymore) — this is a SUCCESS for
//                        Batchd, not a failure. Do not retry.
//   - 'not_actionable' : the menu opened but did not contain the expected
//                        action item (e.g. the more button we clicked
//                        was the parent post's, not ours). Skip without
//                        retry — the post is structurally not delete-able
//                        by this run. Do not retry.
//   - 'network'        : fetch/XHR threw (timeout, 5xx, offline)
//   - 'rate_limited'   : X returned 429 or similar
//   - 'captcha'        : captcha UI detected
//   - 'unknown'        : click seemingly succeeded but button still there —
//                        X didn't honor it
//   - 'stale'          : target node was detached/replaced before the click
//                        could settle

export const FAILURE_KINDS = ['success', 'already_gone', 'not_actionable', 'network', 'rate_limited', 'captcha', 'unknown', 'stale'];

export function classify(outcome) {
  if (!outcome) return 'unknown';
  if (outcome.stale) return 'stale';
  if (outcome.buttonFound === false) return 'already_gone';
  if (outcome.notDeleteable) return 'not_actionable';
  if (outcome.captchaDetected) return 'captcha';
  if (outcome.error) return 'network';
  if (outcome.status === 429) return 'rate_limited';
  if (outcome.status >= 500 && outcome.status < 600) return 'network';
  if (outcome.responseOk && outcome.buttonStillThere === false) return 'success';
  if (outcome.responseOk && outcome.buttonStillThere === true) return 'unknown';
  return 'unknown';
}
