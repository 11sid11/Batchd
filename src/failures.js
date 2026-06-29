// Failure classifier for Batchd.
//
// Given an outcome object from a single click action, return a kind:
//   - 'success'        : the click sequence completed and the post is
//                        now gone.
//   - 'already_gone'   : the target was already detached before the
//                        click could fire. We never actually clicked.
//   - 'not_actionable' : the menu opened but did not contain the
//                        expected action item.
//   - 'network'        : fetch/XHR threw (timeout, 5xx, offline)
//   - 'rate_limited'   : X returned 429 or similar
//   - 'captcha'        : captcha UI detected
//   - 'unknown'        : click seemingly succeeded but the post is
//                        still there after the wait.
//   - 'stale'          : target node was detached/replaced before the
//                        click could settle

export const FAILURE_KINDS = ['success', 'already_gone', 'not_actionable', 'network', 'rate_limited', 'captcha', 'unknown', 'stale'];

export function classify(outcome) {
  if (!outcome) return 'unknown';
  if (outcome.success === true) return 'success';
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

