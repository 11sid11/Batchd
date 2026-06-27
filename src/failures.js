// Failure classifier for Batchd.
//
// Given an outcome object from a single undo click, return a kind:
//   - 'success'      : click succeeded, button is gone, no error
//   - 'already_gone' : button wasn't on the page (post deleted / not engaged anymore)
//                      — this is a SUCCESS for Batchd, not a failure. Do not retry.
//   - 'network'      : fetch/XHR threw (timeout, 5xx, offline)
//   - 'rate_limited' : X returned 429 or similar
//   - 'captcha'      : captcha UI detected
//   - 'unknown'      : click seemingly succeeded but button still there — X didn't honor it
//   - 'stale'        : target node was detached/replaced before the click could settle

export const FAILURE_KINDS = ['success', 'already_gone', 'network', 'rate_limited', 'captcha', 'unknown', 'stale'];

export function classify(outcome) {
  if (!outcome) return 'unknown';
  if (outcome.stale) return 'stale';
  if (outcome.buttonFound === false) return 'already_gone';
  if (outcome.captchaDetected) return 'captcha';
  if (outcome.error) return 'network';
  if (outcome.status === 429) return 'rate_limited';
  if (outcome.status >= 500 && outcome.status < 600) return 'network';
  if (outcome.responseOk && outcome.buttonStillThere === false) return 'success';
  if (outcome.responseOk && outcome.buttonStillThere === true) return 'unknown';
  return 'unknown';
}
