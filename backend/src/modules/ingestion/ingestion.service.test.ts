import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A sensor run fetches a window, stores what is new in it, and classifies what
 * it stored. These tests pin the boundary between those three steps: a failure
 * in a later one must not erase the record of an earlier one having succeeded,
 * because IngestionLog is the provenance trail and the catch-up logic reads it
 * to decide how far back to re-poll.
 */

const { fetchFirmsArea, hotspotCreate, classifyHotspot, ingestionLogCreate } = vi.hoisted(() => ({
  fetchFirmsArea: vi.fn(),
  hotspotCreate: vi.fn(),
  classifyHotspot: vi.fn(),
  ingestionLogCreate: vi.fn(async (_doc: Record<string, unknown>) => ({})),
}));

vi.mock('./firms.client', async () => {
  const actual = await vi.importActual<any>('./firms.client');
  return { ...actual, fetchFirmsArea: (...a: any[]) => fetchFirmsArea(...(a as [])) };
});

vi.mock('../hotspots/hotspot.model', () => ({
  Hotspot: {
    create: (...a: any[]) => hotspotCreate(...(a as [])),
    findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }),
  },
}));

vi.mock('../classifications/classification.service', () => ({
  classifyHotspot: (...a: any[]) => classifyHotspot(...(a as [])),
}));

vi.mock('./ingestion.model', () => ({
  IngestionLog: {
    create: (doc: any) => ingestionLogCreate(doc),
    findOne: () => ({ sort: () => ({ lean: async () => null }) }),
    countDocuments: async () => 0,
  },
}));

import { ingestFirmsArea, liveIngestionState } from './ingestion.service';

const bbox = { west: 76.8, south: 28.0, east: 77.6, north: 29.0 };

/** A raw FIRMS CSV row as csv-parse hands it over, one per unique detection. */
const row = (over: Record<string, unknown> = {}) => ({
  latitude: '28.61',
  longitude: '77.21',
  bright_ti4: '340.5',
  scan: '0.4',
  track: '0.4',
  acq_date: '2026-09-01',
  acq_time: '2015',
  satellite: 'N',
  instrument: 'VIIRS',
  confidence: 'n',
  version: '2.0NRT',
  bright_ti5: '295.1',
  frp: '12.4',
  daynight: 'N',
  ...over,
});

const logRows = () => ingestionLogCreate.mock.calls.map((c) => c[0] as Record<string, any>);

beforeEach(() => {
  vi.clearAllMocks();
  hotspotCreate.mockImplementation(async (doc: any) => ({ ...doc, _id: `hs-${Math.random()}` }));
  classifyHotspot.mockResolvedValue({});
  // Module-level mutable state: reset it so one test cannot read as another's
  // provenance.
  Object.assign(liveIngestionState, {
    firmsConnected: false,
    lastPollAttemptAt: null,
    lastSuccessfulPoll: null,
    lastNewObservationAt: null,
    lastProcessedObservationAt: null,
    newObservationsLastPoll: 0,
    pollStatusMessage: 'Awaiting initial NASA FIRMS satellite poll cycle',
  });
});

describe('ingestMultiSensors — a sensor run reports what actually happened', () => {
  it('keeps the stored counts when a classification throws', async () => {
    fetchFirmsArea.mockResolvedValue([row(), row({ latitude: '28.72' })]);
    classifyHotspot
      .mockRejectedValueOnce(new Error('enrichment query timed out'))
      .mockResolvedValue({});

    const result = await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(result.totalFetched).toBe(2);
    expect(result.totalStored).toBe(2);

    const [log] = logRows();
    expect(log.recordsReceived).toBe(2);
    expect(log.recordsStored).toBe(2);
    expect(log.status).toBe('PARTIAL');
    expect(log.errorMessage).toContain('failed to classify');
  });

  it('still classifies the rest of the batch after one failure', async () => {
    fetchFirmsArea.mockResolvedValue([
      row(),
      row({ latitude: '28.72' }),
      row({ latitude: '28.83' }),
    ]);
    classifyHotspot.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});

    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(classifyHotspot).toHaveBeenCalledTimes(3);
  });

  it('logs a clean run as SUCCESS with no error message', async () => {
    fetchFirmsArea.mockResolvedValue([row()]);

    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    const [log] = logRows();
    expect(log.status).toBe('SUCCESS');
    expect(log.errorMessage).toBeUndefined();
    expect(log.recordsStored).toBe(1);
  });

  it('does not store detections outside India that the FIRMS rectangle returns', async () => {
    fetchFirmsArea.mockResolvedValue([
      row(), // Delhi
      row({ latitude: '6.93', longitude: '79.86' }), // Colombo, Sri Lanka
      row({ latitude: '31.52', longitude: '74.36' }), // Lahore, Pakistan
    ]);

    const result = await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(hotspotCreate).toHaveBeenCalledTimes(1);
    expect(classifyHotspot).toHaveBeenCalledTimes(1);
    expect(result.totalFetched).toBe(3);
    expect(result.totalOutsideIndia).toBe(2);
    expect(result.totalStored).toBe(1);
    const [log] = logRows();
    expect(log.recordsReceived).toBe(3);
    expect(log.recordsStored).toBe(1);
    expect(log.recordsRejected).toBe(2);
    expect(log.status).toBe('SUCCESS');
  });

  it('marks a run PARTIAL when a record cannot be stored for a non-duplicate reason', async () => {
    fetchFirmsArea.mockResolvedValue([row(), row({ latitude: '28.72' })]);
    hotspotCreate
      .mockRejectedValueOnce(new Error('connection pool exhausted'))
      .mockImplementation(async (doc: any) => ({ ...doc, _id: 'hs-2' }));

    const result = await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(result.totalStored).toBe(1);
    const [log] = logRows();
    expect(log.status).toBe('PARTIAL');
    expect(log.errorMessage).toContain('failed to store');
  });

  it('does not treat an existing observation as a degradation', async () => {
    fetchFirmsArea.mockResolvedValue([row(), row({ latitude: '28.72' })]);
    const duplicate: any = new Error('E11000 duplicate key error');
    duplicate.code = 11000;
    hotspotCreate.mockRejectedValueOnce(duplicate).mockImplementation(async (doc: any) => ({
      ...doc,
      _id: 'hs-2',
    }));

    const result = await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(result.totalDuplicates).toBe(1);
    expect(logRows()[0].status).toBe('SUCCESS');
  });
});

describe('live provenance — a failed cycle is not a successful poll', () => {
  it('leaves lastSuccessfulPoll untouched when every sensor query fails', async () => {
    fetchFirmsArea.mockResolvedValue([row()]);
    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });
    const successAt = liveIngestionState.lastSuccessfulPoll;
    expect(successAt).not.toBeNull();

    fetchFirmsArea.mockRejectedValue(new Error('503 Service Unavailable'));
    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT', 'MODIS_NRT'] });

    // The freshness clock still points at the last poll that actually landed.
    expect(liveIngestionState.lastSuccessfulPoll).toBe(successAt);
    expect(liveIngestionState.firmsConnected).toBe(false);
  });

  it('says the sensors did not answer rather than that there was nothing new', async () => {
    fetchFirmsArea.mockRejectedValue(new Error('ETIMEDOUT'));

    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(liveIngestionState.pollStatusMessage).not.toContain('No new FIRMS observations');
    expect(liveIngestionState.pollStatusMessage).toContain('No sensor answered');
    expect(liveIngestionState.newObservationsLastPoll).toBe(0);
  });

  it('records the attempt even when it fails, so the outage is visible', async () => {
    fetchFirmsArea.mockRejectedValue(new Error('ETIMEDOUT'));

    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(liveIngestionState.lastPollAttemptAt).not.toBeNull();
    expect(liveIngestionState.lastSuccessfulPoll).toBeNull();
  });

  it('records a poll that answered with an empty window as a success', async () => {
    fetchFirmsArea.mockResolvedValue([]);

    await ingestFirmsArea(bbox, { sensors: ['VIIRS_SNPP_NRT'] });

    expect(liveIngestionState.firmsConnected).toBe(true);
    expect(liveIngestionState.lastSuccessfulPoll).not.toBeNull();
    expect(liveIngestionState.pollStatusMessage).toBe('No new FIRMS observations since last poll');
  });
});
