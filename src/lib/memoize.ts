/**
 * Per-isolate memoization for pure data helpers.
 *
 * Our dashboard data functions walk large, immutable JSON snapshots that are
 * baked in at build time, so a given call always returns the same result for
 * the lifetime of the Worker isolate. Recomputing them on every request — and
 * worse, several times within a single render — is what pushes the Cloudflare
 * Worker over its CPU budget (Error 1102), especially when a reader switches
 * between dashboard tabs and the warm isolate re-runs the same full snapshot
 * walks each time.
 *
 * Wrapping a helper with `memoize` makes the first call in an isolate pay the
 * cost and every later call — including repeated tab switches — O(1).
 *
 * Args are keyed via `JSON.stringify`, so only memoize functions whose args
 * are JSON-serialisable primitives (true for every data helper here). The
 * cache lives for the isolate's lifetime; because a new deploy spins up fresh
 * isolates, refreshed snapshots are always picked up.
 */
export function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const key = args.length === 0 ? "" : JSON.stringify(args);
    const hit = cache.get(key);
    if (hit !== undefined || cache.has(key)) return hit as R;
    const value = fn(...args);
    cache.set(key, value);
    return value;
  };
}
