import { IngestionLog } from './ingestion.model';
import { ingestFirmsIndia } from './ingestion.service';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FIRMS_MAX_DAY_RANGE = 10;

/**
 * A restart mid-cycle silently skips a poll. On boot we look at how long it has
 * been since the last successful ingestion and, if that exceeds one poll
 * interval, request a day range wide enough to cover the gap.
 *
 * Returns null when no catch-up is warranted.
 */
export function computeCatchupDayRange(lastSuccessAt: Date | null, now: Date): number | null {
  if (lastSuccessAt === null) return FIRMS_MAX_DAY_RANGE;
  const gapMs = now.getTime() - lastSuccessAt.getTime();
  if (gapMs <= POLL_INTERVAL_MS) return null;
  // +1 day of margin: a gap of exactly N whole days must still fully cover the
  // day the last successful poll started on, not just the N days since then.
  const days = Math.ceil(gapMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(FIRMS_MAX_DAY_RANGE, Math.max(1, days));
}

export async function runCatchupIfNeeded(): Promise<void> {
  // PARTIAL counts as coverage: the window was fetched, even if a record in it
  // failed to store or classify. Treating it as a gap would re-poll days of
  // FIRMS quota to recover detections that are already stored.
  const last = await IngestionLog.findOne({ status: { $in: ['SUCCESS', 'PARTIAL'] } })
    .sort({ retrievedAt: -1 })
    .select('retrievedAt')
    .lean();

  const dayRange = computeCatchupDayRange(last?.retrievedAt ?? null, new Date());
  if (dayRange === null) {
    console.log('[Catchup] Last poll is recent; no gap to recover.');
    return;
  }

  console.log(`[Catchup] Recovering a gap in coverage with dayRange=${dayRange}.`);
  await ingestFirmsIndia({ dayRange });
}
