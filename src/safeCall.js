// Tiny swallow helper shared by both storage adapters.
//
// The storage adapters wrap a callback- or sync-based backend API
// that may throw (quota, invalidated context, disabled global).
// Rather than duplicate the try/catch shape in two adapters — and
// risk one of them drifting from the other's recovery behavior —
// both call `safeCall(fn)` and let the shared helper centralize the
// swallow. The catch is intentionally silent: callers either handle
// their own logging (`loadChromeStorage` warns on chrome.runtime.lastError)
// or the loss is genuinely fire-and-forget (`gmStorage().set` swallows
// quota errors because persist.js's in-memory cache is already the
// source of truth within a session).
//
// Returns whatever `fn` returns, or `undefined` if `fn` threw.

export function safeCall(fn) {
  try {
    return fn();
  } catch {
    // Silent: see file comment. Callers that need diagnostics
    // (chrome.runtime.lastError, etc.) handle them in their own path.
  }
}