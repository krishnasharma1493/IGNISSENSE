/**
 * Interval scheduling for the live ingestion loop.
 *
 * A FIRMS cycle is not guaranteed to finish inside its interval. An India-wide
 * catch-up pull can take upwards of ten minutes — four sensor fetches, then
 * feature extraction and inference for every newly stored detection — while the
 * interval fires every five. A bare setInterval therefore stacks runs on top of
 * one another, each re-fetching the same window against a quota of 5000
 * transactions per ten minutes and competing for the same Atlas connection
 * pool. The unique index keeps the stored data correct, so the cost is quota
 * and load rather than corruption; the overlap simply buys nothing, because the
 * run already in flight covers the window the new one would ask for.
 */

/**
 * Wrap an async task so that it never runs concurrently with itself. A call
 * made while the previous one is still in flight is dropped, and `onSkip` is
 * invoked instead.
 */
export function serializeRuns(
  task: () => Promise<void>,
  onSkip: () => void = () => {}
): () => Promise<void> {
  let inFlight = false;

  return async () => {
    if (inFlight) {
      onSkip();
      return;
    }

    inFlight = true;
    try {
      await task();
    } finally {
      // Released in `finally` so a thrown task does not wedge the loop shut for
      // the lifetime of the process.
      inFlight = false;
    }
  };
}
