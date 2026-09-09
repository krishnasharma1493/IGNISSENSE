import { Hotspot } from '../hotspots/hotspot.model';
import { fetchFirmsArea, normalizeFirmsRecord, FirmsSensor, FirmsRawRecord } from './firms.client';
import { classifyHotspot } from '../classifications/classification.service';
import { IngestionLog } from './ingestion.model';
import { config } from '../../config';

export interface IngestionResult {
  totalFetched: number;
  totalValid: number;
  totalStored: number;
  totalDuplicates: number;
  delhiNcrCount: number;
  sensorsQueried: string[];
  retrievedAt: Date;
}

export const ALL_LIVE_SENSORS: FirmsSensor[] = [
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'MODIS_NRT',
];

/**
 * Ingest live real-time FIRMS data for Delhi NCR bounding box across all active sensors.
 */
export async function ingestFirmsDelhiNcr(
  options: {
    sensors?: FirmsSensor[];
    dayRange?: number;
    date?: string;
  } = {}
): Promise<IngestionResult> {
  const { sensors = ALL_LIVE_SENSORS, dayRange = 5, date } = options;

  return ingestMultiSensors(config.delhiNcr.bbox, sensors, dayRange, 'delhi_ncr', date);
}

/**
 * Ingest live real-time FIRMS data across all of India (parent geography).
 */
export async function ingestFirmsIndia(
  options: {
    sensors?: FirmsSensor[];
    dayRange?: number;
    date?: string;
  } = {}
): Promise<IngestionResult> {
  const { sensors = ALL_LIVE_SENSORS, dayRange = 2, date } = options;

  const indiaBbox = { west: 68.0, south: 6.5, east: 97.5, north: 37.5 };

  return ingestMultiSensors(indiaBbox, sensors, dayRange, 'india', date);
}

/**
 * Ingest live real-time FIRMS data for a custom bounding box.
 */
export async function ingestFirmsArea(
  bbox: { west: number; south: number; east: number; north: number },
  options: {
    sensors?: FirmsSensor[];
    dayRange?: number;
    date?: string;
  } = {}
): Promise<IngestionResult> {
  const { sensors = ALL_LIVE_SENSORS, dayRange = 2, date } = options;
  return ingestMultiSensors(bbox, sensors, dayRange, 'custom_area', date);
}


export interface IngestionProvenanceState {
  firmsConnected: boolean;
  /** When a poll last ran, whether or not any sensor answered. */
  lastPollAttemptAt: Date | null;
  /** When a poll last returned data from at least one sensor. */
  lastSuccessfulPoll: Date | null;
  lastNewObservationAt: Date | null;
  lastProcessedObservationAt: Date | null;
  newObservationsLastPoll: number;
  pollStatusMessage: string;
  sensorsQueried: string[];
}

export const liveIngestionState: IngestionProvenanceState = {
  firmsConnected: false,
  lastPollAttemptAt: null,
  lastSuccessfulPoll: null,
  lastNewObservationAt: null,
  lastProcessedObservationAt: null,
  newObservationsLastPoll: 0,
  pollStatusMessage: 'Awaiting initial NASA FIRMS satellite poll cycle',
  sensorsQueried: ALL_LIVE_SENSORS,
};

/**
 * Multi-sensor fetch, store, classify, and provenance logging
 */
async function ingestMultiSensors(
  bbox: { west: number; south: number; east: number; north: number },
  sensors: FirmsSensor[],
  dayRange: number,
  regionName: string,
  date?: string
): Promise<IngestionResult & { message: string }> {
  const startTime = Date.now();
  const result: IngestionResult = {
    totalFetched: 0,
    totalValid: 0,
    totalStored: 0,
    totalDuplicates: 0,
    delhiNcrCount: 0,
    sensorsQueried: sensors,
    retrievedAt: new Date(),
  };

  let anySensorSucceeded = false;

  for (const sensor of sensors) {
    const sensorStartTime = Date.now();
    try {
      console.log(`[FIRMS Ingestion] Pulling authentic satellite data for ${sensor} (dayRange: ${dayRange})...`);
      const rawRecords = await fetchFirmsArea({
        bbox,
        sensor,
        dayRange,
        date,
      });

      anySensorSucceeded = true;
      result.totalFetched += rawRecords.length;

      const storedStats = await processAndStoreRecords(rawRecords);
      result.totalValid += storedStats.valid;
      result.totalStored += storedStats.stored;
      result.totalDuplicates += storedStats.duplicates;
      result.delhiNcrCount += storedStats.delhiNcr;

      // A run that fetched its window but could not store or classify part of
      // it is PARTIAL, not SUCCESS. The distinction is the difference between
      // "this window is fully covered" and "some of it needs another pass".
      const degradations: string[] = [];
      if (storedStats.insertFailures > 0) {
        degradations.push(`${storedStats.insertFailures} record(s) failed to store`);
      }
      if (storedStats.classificationFailures > 0) {
        degradations.push(`${storedStats.classificationFailures} record(s) failed to classify`);
      }

      // Log individual sensor run to IngestionLog
      await IngestionLog.create({
        source: 'NASA_FIRMS',
        product: sensor,
        region: regionName,
        bbox,
        dayRange,
        date,
        recordsReceived: rawRecords.length,
        recordsAccepted: storedStats.valid,
        recordsStored: storedStats.stored,
        recordsRejected: rawRecords.length - storedStats.valid,
        duplicates: storedStats.duplicates,
        delhiNcrCount: storedStats.delhiNcr,
        retrievedAt: new Date(),
        durationMs: Date.now() - sensorStartTime,
        status: degradations.length > 0 ? 'PARTIAL' : 'SUCCESS',
        errorMessage: degradations.length > 0 ? degradations.join('; ') : undefined,
      });
    } catch (err: any) {
      console.error(`[FIRMS Ingestion] Failed sensor ${sensor}:`, err.message);
      await IngestionLog.create({
        source: 'NASA_FIRMS',
        product: sensor,
        region: regionName,
        bbox,
        dayRange,
        date,
        recordsReceived: 0,
        recordsAccepted: 0,
        recordsStored: 0,
        recordsRejected: 0,
        duplicates: 0,
        delhiNcrCount: 0,
        retrievedAt: new Date(),
        durationMs: Date.now() - sensorStartTime,
        status: 'FAILED',
        errorMessage: err.message,
      });
    }
  }

  // Update live system provenance.
  //
  // A cycle in which every sensor query failed is not a successful poll. It
  // previously stamped lastSuccessfulPoll with the current time and reported
  // "No new FIRMS observations since last poll" — a total outage reading as a
  // quiet, healthy pipeline, with a freshness clock in the header that kept
  // advancing while nothing was being fetched.
  const now = new Date();
  liveIngestionState.lastPollAttemptAt = now;
  liveIngestionState.firmsConnected = anySensorSucceeded;
  liveIngestionState.sensorsQueried = sensors;

  if (!anySensorSucceeded) {
    liveIngestionState.newObservationsLastPoll = 0;
    liveIngestionState.pollStatusMessage =
      `No sensor answered this cycle (${sensors.join(', ')}). ` +
      'Displayed detections are from the last successful poll.';
  } else {
    liveIngestionState.lastSuccessfulPoll = now;
    liveIngestionState.lastProcessedObservationAt = now;
    liveIngestionState.newObservationsLastPoll = result.totalStored;

    if (result.totalStored > 0) {
      liveIngestionState.lastNewObservationAt = now;
      liveIngestionState.pollStatusMessage = `${result.totalStored} new FIRMS observations ingested and classified`;
    } else {
      liveIngestionState.pollStatusMessage = 'No new FIRMS observations since last poll';
    }
  }

  console.log(
    `[FIRMS Ingestion Complete] ${liveIngestionState.pollStatusMessage}. ` +
      `Fetched: ${result.totalFetched}, Valid: ${result.totalValid}, ` +
      `New Stored: ${result.totalStored}, Duplicates Skipped: ${result.totalDuplicates}, Delhi NCR: ${result.delhiNcrCount} (${Date.now() - startTime}ms)`
  );

  return {
    ...result,
    message: liveIngestionState.pollStatusMessage,
  };
}

/**
 * Process, store, and classify raw FIRMS records using deterministic unique constraints
 */
async function processAndStoreRecords(rawRecords: Array<FirmsRawRecord>): Promise<{
  valid: number;
  stored: number;
  duplicates: number;
  delhiNcr: number;
  insertFailures: number;
  classificationFailures: number;
}> {
  const counts = {
    valid: 0,
    stored: 0,
    duplicates: 0,
    delhiNcr: 0,
    insertFailures: 0,
    classificationFailures: 0,
  };
  const validDocs: any[] = [];
  const seenKeys = new Set<string>();

  for (const raw of rawRecords) {
    const normalized = normalizeFirmsRecord(raw);
    if (!normalized) continue;

    // Deduplicate in batch using deterministic key: [lon, lat, timestamp, satellite, instrument]
    const key = `${normalized.location.coordinates[0].toFixed(5)}_${normalized.location.coordinates[1].toFixed(5)}_${normalized.detectedAt.getTime()}_${normalized.satellite}_${normalized.instrument}`;
    if (seenKeys.has(key)) {
      counts.duplicates++;
      continue;
    }
    seenKeys.add(key);

    counts.valid++;
    if (normalized.region === 'delhi_ncr') {
      counts.delhiNcr++;
    }
    validDocs.push(normalized);
  }

  // Insert documents and enforce database uniqueness constraint
  const newlyCreatedHotspots: any[] = [];
  for (const doc of validDocs) {
    try {
      const created = await Hotspot.create(doc);
      counts.stored++;
      newlyCreatedHotspots.push(created);
    } catch (err: any) {
      // MongoDB E11000 duplicate key error code -> expected for existing observation
      if (err.code === 11000 || err.message?.includes('duplicate key')) {
        counts.duplicates++;
      } else {
        // Not a duplicate: the record was fetched and accepted but never
        // stored. Counted so the run is not logged as wholly successful.
        counts.insertFailures++;
        console.warn('[FIRMS Ingestion] Document insertion failed:', err.message);
      }
    }
  }

  // Real ML Inference only on genuinely new observations.
  //
  // Each hotspot is classified in isolation. Under a bare Promise.all one
  // rejection abandoned the rest of the chunk and every chunk after it, then
  // propagated into the per-sensor catch — which wrote an IngestionLog row
  // reading FAILED with recordsReceived 0 and recordsStored 0, for a run that
  // had in fact fetched and stored its records. A row that cannot be classified
  // is counted and left for the next pass to pick up.
  if (newlyCreatedHotspots.length > 0) {
    console.log(`[ML Pipeline] Executing feature extraction & ML classification on ${newlyCreatedHotspots.length} new observations...`);
    const chunkSize = 15;
    for (let i = 0; i < newlyCreatedHotspots.length; i += chunkSize) {
      const chunk = newlyCreatedHotspots.slice(i, i + chunkSize);
      const settled = await Promise.allSettled(chunk.map((h) => classifyHotspot(h)));
      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          counts.classificationFailures++;
          console.warn(
            '[ML Pipeline] Classification failed for one observation:',
            outcome.reason?.message ?? outcome.reason
          );
        }
      }
    }
  }

  return counts;
}

/**
 * Get latest ingestion status for data freshness provenance
 */
export async function getLatestIngestionStatus() {
  const latestLog = await IngestionLog.findOne({ status: { $in: ['SUCCESS', 'PARTIAL'] } })
    .sort({ retrievedAt: -1 })
    .lean();

  const lastRun = await IngestionLog.findOne()
    .sort({ retrievedAt: -1 })
    .select('status retrievedAt')
    .lean();

  const totalLogs = await IngestionLog.countDocuments();
  const latestHotspot = await Hotspot.findOne().sort({ detectedAt: -1 }).select('detectedAt').lean();

  return {
    ...liveIngestionState,
    latestLog,
    lastRunStatus: lastRun?.status ?? null,
    lastRunAt: lastRun?.retrievedAt ?? null,
    totalLogs,
    latestDetectedAt: latestHotspot?.detectedAt || null,
  };
}

