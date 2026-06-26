// Pacing engine for Batchd. Pure functions, no DOM access.
//
// Configured via the resolved defaults from /grill-with-docs:
//   - 1200ms base delay ±50% jitter
//   - 60s rest every 50 actions
//   - Exponential backoff 30s → 5min on failure

export function nextDelay(baseMs, jitterFraction, rng = Math.random) {
  if (jitterFraction === 0) return baseMs;
  const low = baseMs * (1 - jitterFraction);
  const high = baseMs * (1 + jitterFraction);
  return Math.round(low + rng() * (high - low));
}

export function shouldBatchPause(actionIndex, batchSize) {
  if (batchSize <= 0) return false;
  return (actionIndex + 1) % batchSize === 0;
}

export function batchPauseDuration(configuredMs) {
  return configuredMs;
}

export function backoffMs(consecutiveFailures, baseMs, maxMs) {
  if (consecutiveFailures <= 0) return 0;
  const raw = baseMs * 2 ** (consecutiveFailures - 1);
  return Math.min(raw, maxMs);
}
