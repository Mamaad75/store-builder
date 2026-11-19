/**
 * Single-flight, time-bounded cache for an expensive probe (same behaviour as the web app's src/lib/cached-probe.ts): concurrent
 * callers share ONE in-flight probe and a finished result is reused for `ttlMs`, so request volume never drives probe volume.
 */
export function createCachedProbe<T>(probe: () => Promise<T>, opts: { ttlMs: number; now?: () => number }): () => Promise<T> {
  const now = opts.now ?? Date.now;
  let cached: { at: number; value: T } | null = null;
  let inFlight: Promise<T> | null = null;
  return () => {
    if (cached && now() - cached.at < opts.ttlMs) return Promise.resolve(cached.value);
    if (!inFlight) {
      inFlight = probe()
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}
