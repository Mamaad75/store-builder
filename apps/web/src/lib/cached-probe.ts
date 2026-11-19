/**
 * Single-flight, time-bounded cache for an expensive probe (phase 13 review fix for the public `/api/ready`).
 *  - concurrent callers share ONE in-flight probe instead of starting one each;
 *  - a finished result (success or failure) is reused for `ttlMs`, so request volume no longer drives probe volume:
 *    at most one probe per `ttlMs` per process, however many requests arrive.
 * Pure (no I/O of its own) so it is unit-tested with a fake clock.
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
