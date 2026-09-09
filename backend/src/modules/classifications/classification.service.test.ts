import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * classifyHotspot is the gate. Everything else on this branch exists to make
 * sure a missing value reaches it as a null instead of as a plausible number,
 * and these tests are what prove the gate then does its job.
 *
 * Mongo and the ML service are both mocked. The pipeline must be assertable
 * without a database or an inference process — the backend cannot reach Atlas
 * from CI and a test that silently skips is worse than no test.
 */

// Hoisted so the vi.mock factories, which vitest lifts above the imports, can
// reach these without a temporal-dead-zone trap on a static import.
const { enrichHotspot, classificationUpsert, alertUpsert, axiosPost, hotspotFind } = vi.hoisted(
  () => ({
    enrichHotspot: vi.fn(),
    classificationUpsert: vi.fn(async (_filter: any, doc: any) => doc),
    alertUpsert: vi.fn(async () => ({})),
    axiosPost: vi.fn(),
    hotspotFind: vi.fn(),
  })
);

/** Hotspot.find(...).select(...).lean() and .sort(...).limit(...).lean(). */
const findChain = (rows: any[]) => ({
  select: () => ({ lean: async () => rows }),
  sort: () => ({ limit: () => ({ lean: async () => rows }) }),
});
vi.mock('../osm/enrichment.service', () => ({
  enrichHotspot: (...args: any[]) => enrichHotspot(...args),
  haversineMeters: () => 0,
}));

vi.mock('../hotspots/hotspot.model', () => ({
  Hotspot: { find: (...args: any[]) => hotspotFind(...(args as [])) },
}));

vi.mock('./classification.model', async () => {
  const actual = await vi.importActual<any>('./classification.model');
  return {
    ...actual,
    Classification: { findOneAndUpdate: (...a: any[]) => classificationUpsert(a[0], a[1]) },
  };
});

vi.mock('../alerts/alert.model', () => ({
  Alert: { findOneAndUpdate: (...a: any[]) => alertUpsert(...(a as [])) },
}));

vi.mock('axios', () => ({
  default: { post: (...a: any[]) => axiosPost(...(a as [])) },
}));

import { classifyHotspot } from './classification.service';

/** A well-formed FIRMS detection. Nothing about the thermal side is missing. */
const hotspot = (over: Record<string, unknown> = {}) =>
  ({
    _id: 'hs-1',
    location: { type: 'Point', coordinates: [77.21, 28.61] },
    detectedAt: new Date('2026-09-01T18:30:00Z'),
    frp: 120,
    brightness: 365,
    brightnessTi5: 300,
    dayNight: 'N',
    instrument: 'VIIRS',
    satellite: 'NOAA-20',
    confidence: 'h',
    ...over,
  }) as any;

const enrichment = (over: Record<string, unknown> = {}) => ({
  nearestIndustrialFacility: null,
  nearestRefinery: null,
  nearestPowerPlant: null,
  nearestOilGas: null,
  industrialFeaturesWithin5km: 0,
  nearestMine: null,
  miningFeaturesWithin5km: 0,
  forestContextNearby: false,
  agricultureContextNearby: false,
  nearbyFeatureCount: 0,
  enrichmentStatus: 'no_osm_coverage',
  enrichmentSource: 'osm_india_v1',
  facilityType: 'none',
  facilityDistanceMeters: null,
  inferredLandCover: 'other',
  ...over,
});

const facility = (over: Record<string, unknown> = {}) => ({
  name: 'Ghazipur Landfill',
  type: 'waste_disposal',
  category: 'other',
  subcategory: 'waste_disposal',
  distance_m: 200,
  osmId: 42,
  sourceId: 'osm:way/42',
  longitude: 77.33,
  latitude: 28.62,
  ...over,
});

/** Enrichment in which every required spatial feature resolves. */
const complete = () =>
  enrichment({
    nearestIndustrialFacility: facility({ subcategory: 'refinery', name: 'Mathura Refinery' }),
    facilityType: 'refinery',
    facilityDistanceMeters: 200,
    inferredLandCover: 'built_up',
    enrichmentStatus: 'enriched',
  });

beforeEach(() => {
  vi.clearAllMocks();
  hotspotFind.mockImplementation(() => findChain([]) as any);
  axiosPost.mockResolvedValue({
    data: {
      success: true,
      data: {
        predicted_class: 'industrial_fire',
        confidence: 0.88,
        class_probabilities: { industrial_fire: 0.88 },
        model_version: 'XGB-TEST',
      },
    },
  });
});

describe('classifyHotspot — the completeness gate', () => {
  it('records unclassified_insufficient_features when OSM coverage is absent', async () => {
    enrichHotspot.mockResolvedValue(enrichment());

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.pipelineStatus).toBe('unclassified_insufficient_features');
    expect(doc.predictedClass).toBeNull();
    expect(doc.confidence).toBeNull();
    expect(doc.classProbabilities).toBeNull();
    expect(doc.featureCompleteness.unresolved).toContain('facility_distance_m');
  });

  it('does not spend an inference call on a row it cannot classify', async () => {
    enrichHotspot.mockResolvedValue(enrichment());
    await classifyHotspot(hotspot());
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('raises no alert for an unclassified row, however anomalous it looks', async () => {
    // 200 m from mapped infrastructure with a 120 MW first-ever detection: this
    // clears every threshold in the alert rule. It must still not fire, because
    // there is no classified signature to assert in the alert text.
    enrichHotspot.mockResolvedValue(
      enrichment({
        nearestIndustrialFacility: facility(),
        facilityType: 'waste_disposal',
        facilityDistanceMeters: 200,
        inferredLandCover: 'built_up',
        enrichmentStatus: 'enriched',
      })
    );

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.pipelineStatus).toBe('unclassified_insufficient_features');
    expect(alertUpsert).not.toHaveBeenCalled();
  });

  it('gates a facility type the trained vocabulary has no code for', async () => {
    enrichHotspot.mockResolvedValue(
      enrichment({
        nearestIndustrialFacility: facility(),
        facilityType: 'waste_disposal',
        facilityDistanceMeters: 200,
        inferredLandCover: 'built_up',
        enrichmentStatus: 'enriched',
      })
    );

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.featureCompleteness.unresolved).toContain('facility_type_encoded');
    expect(doc.featureCompleteness.unresolved).not.toContain('facility_distance_m');
  });

  it('gates on an unreported FRP even where OSM coverage is complete', async () => {
    enrichHotspot.mockResolvedValue(
      enrichment({
        nearestIndustrialFacility: facility({ subcategory: 'refinery' }),
        facilityType: 'refinery',
        facilityDistanceMeters: 200,
        inferredLandCover: 'built_up',
        enrichmentStatus: 'enriched',
      })
    );

    const doc: any = await classifyHotspot(hotspot({ frp: null }));

    expect(doc.pipelineStatus).toBe('unclassified_insufficient_features');
    expect(doc.featureCompleteness.unresolved).toContain('frp');
    // No FRP means the anomaly heuristic has no input; it is not scored.
    expect(doc.anomalyScore).toBeNull();
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('classifies normally once every required feature resolves', async () => {
    enrichHotspot.mockResolvedValue(
      enrichment({
        nearestIndustrialFacility: facility({ subcategory: 'refinery', name: 'Mathura Refinery' }),
        facilityType: 'refinery',
        facilityDistanceMeters: 200,
        inferredLandCover: 'built_up',
        enrichmentStatus: 'enriched',
      })
    );

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.pipelineStatus).toBe('classified');
    expect(doc.predictedClass).toBe('industrial_fire');
    expect(doc.featureCompleteness.unresolved).toEqual([]);
    expect(axiosPost).toHaveBeenCalledTimes(1);

    const sent = axiosPost.mock.calls[0][1].features;
    expect(sent.facility_type_encoded).toBe(1);
    expect(sent.facility_distance_m).toBe(200);
    // Optional history is absent here and travels as an explicit null.
    expect(sent.historical_mean_frp).toBeNull();
    expect(sent.days_since_last_detection).toBeNull();
  });

  it('records unclassified_model_unavailable when the inference service does not answer', async () => {
    enrichHotspot.mockResolvedValue(complete());
    axiosPost.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8000'));

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.pipelineStatus).toBe('unclassified_model_unavailable');
    // The features resolved; it is the service that was missing, not an input.
    expect(doc.featureCompleteness.unresolved).toEqual([]);
    expect(doc.modelVersion).toMatch(/-OFFLINE$/);
  });

  it('invents no class, confidence or probability vector when the model is unreachable', async () => {
    enrichHotspot.mockResolvedValue(complete());
    axiosPost.mockRejectedValue(new Error('socket hang up'));

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.predictedClass).toBeNull();
    expect(doc.confidence).toBeNull();
    expect(doc.classProbabilities).toBeNull();
  });

  it('treats an unusable model payload as no answer rather than as a verdict', async () => {
    enrichHotspot.mockResolvedValue(complete());
    axiosPost.mockResolvedValue({ data: { success: false, error: 'model not loaded' } });

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.pipelineStatus).toBe('unclassified_model_unavailable');
    expect(doc.predictedClass).toBeNull();
  });

  it('raises no alert on a detection the model never scored', async () => {
    // 200 m from a refinery with a 120 MW detection: this clears the alert rule
    // on every axis except the one that matters — there is no prediction.
    enrichHotspot.mockResolvedValue(complete());
    axiosPost.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8000'));

    const doc: any = await classifyHotspot(hotspot());

    expect(doc.anomalyScore).toBeGreaterThanOrEqual(0.65);
    expect(doc.facilityDistanceMeters).toBeLessThanOrEqual(1500);
    expect(alertUpsert).not.toHaveBeenCalled();
  });

  it('never puts a fabricated FRP in the evidence text', async () => {
    enrichHotspot.mockResolvedValue(enrichment());

    const doc: any = await classifyHotspot(hotspot({ frp: null, brightness: null }));

    const joined = doc.explanation.join(' ');
    expect(joined).toContain('not reported');
    expect(joined).not.toContain('10.0 MW');
    expect(joined).not.toContain('310.0 K');
  });
});
