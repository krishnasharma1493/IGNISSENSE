import { IHotspot, Hotspot } from '../hotspots/hotspot.model';
import { enrichHotspot, EnrichmentResult } from '../osm/enrichment.service';
import { haversineMeters } from '../osm/enrichment.service';
import { IFacility } from '../facilities/facility.model';
import { FACILITY_TYPE_MAP, LANDCOVER_MAP, REQUIRED_FEATURES } from './featureContract';

export { FACILITY_TYPE_MAP, LANDCOVER_MAP } from './featureContract';

export interface ExtractedFeatures {
  // Thermal features from real sensor telemetry.
  // All four are nullable: FIRMS does not always supply FRP or both brightness
  // bands, and a detection that was never measured must not be handed a
  // plausible number. `tempDelta` is null whenever either band is null.
  frp: number | null;
  brightness: number | null;
  brightnessTi5: number | null;
  tempDelta: number | null; // brightness - brightnessTi5 (thermal contrast)
  dayNight: 'D' | 'N';
  instrument: string;
  satellite: string;
  confidence: string;

  // Spatial features from India-wide OSM context
  nearestFacility: IFacility | null;
  facilityDistanceMeters: number | null;
  facilityType: string;
  isInsideIndustrialPerimeter: boolean; // < 400m
  isNearIndustrialPerimeter: boolean; // < 1500m
  nearbyClusterCount3km: number;
  landCover: 'built_up' | 'forest' | 'cropland' | 'bare' | 'water' | 'other';

  // Temporal & Historical features from real FIRMS history
  historicalOverpassesWithin1_5km: number;
  // Null when there is no prior detection at this coordinate. A first-ever
  // detection has no baseline; echoing back its own FRP as the "historical
  // mean" would make it indistinguishable from a site that has burned at
  // exactly this intensity before.
  historicalMeanFrp: number | null;
  historicalStdDevFrp: number | null;
  frpZScore: number | null;
  daysSinceLastDetection: number | null;
  priorObservations: Array<{
    detectedAt: Date;
    frp: number;
    brightness: number;
    satellite: string;
    distanceMeters: number;
  }>;

  // Enrichment provenance
  enrichmentSource?: string;
  enrichmentStatus?: string;
}

/**
 * Extract comprehensive, verifiable features for a real FIRMS hotspot.
 *
 * Spatial context is now provided by the India-wide OSM enrichment service
 * (enrichment.service.ts) which queries the osm_features collection.
 * Falls back to legacy Delhi NCR facilities collection if India-wide data
 * is not yet loaded.
 *
 * The canonical 14-feature schema is preserved — the ML model input
 * does not change, only the data source improves.
 */
export async function extractFeaturesForHotspot(
  hotspot: IHotspot
): Promise<ExtractedFeatures> {
  const [lon, lat] = hotspot.location.coordinates;
  // Read straight through. `??` rather than `||` so a genuine measured 0 is
  // kept, and no default is supplied for an absent measurement.
  const frp = hotspot.frp ?? null;
  const brightness = hotspot.brightness ?? null;
  const brightnessTi5 = hotspot.brightnessTi5 ?? null;
  const tempDelta =
    brightness !== null && brightnessTi5 !== null
      ? Math.max(0, brightness - brightnessTi5)
      : null;

  // 1. Spatial context: India-wide OSM enrichment
  const enrichment: EnrichmentResult = await enrichHotspot(lon, lat, 25000);

  const facilityType = enrichment.facilityType;
  const distanceMeters = enrichment.facilityDistanceMeters;
  const isInsideIndustrialPerimeter = distanceMeters !== null && distanceMeters <= 400;
  const isNearIndustrialPerimeter = distanceMeters !== null && distanceMeters <= 1500;
  // `water` is a measured category with its own code (4) in all three lockstep
  // maps; relabelling it 'other' discarded a real observation.
  const landCover = enrichment.inferredLandCover;

  // Build a compatibility shim for nearestFacility (used by explanation generation)
  let nearestFacility: IFacility | null = null;
  if (enrichment.nearestIndustrialFacility) {
    const nf = enrichment.nearestIndustrialFacility;
    nearestFacility = {
      name: nf.name,
      facilityType: nf.subcategory,
      sourceId: nf.sourceId,
      osmId: nf.osmId,
      _id: null,
      location: {
        type: 'Point',
        coordinates: [nf.longitude, nf.latitude],
      },
    } as any;
  }

  // 2. Spatial cluster density: other FIRMS hotspots within 3km in the last 72 hours
  const threeDaysAgo = new Date(new Date(hotspot.detectedAt).getTime() - 72 * 60 * 60 * 1000);
  const radius3kmRad = 3.0 / 6371.0;
  const radius1_5kmRad = 1.5 / 6371.0;

  const clusterHotspots = await Hotspot.find({
    _id: { $ne: hotspot._id },
    detectedAt: { $gte: threeDaysAgo, $lte: hotspot.detectedAt },
    location: {
      $geoWithin: {
        $centerSphere: [[lon, lat], radius3kmRad],
      },
    },
  })
    .select('frp detectedAt location')
    .lean();

  const nearbyClusterCount3km = clusterHotspots.length;

  // 3. Historical temporal analysis: past FIRMS observations within 1.5 km over all stored history
  const historicalHotspots = await Hotspot.find({
    _id: { $ne: hotspot._id },
    detectedAt: { $lt: hotspot.detectedAt },
    location: {
      $geoWithin: {
        $centerSphere: [[lon, lat], radius1_5kmRad],
      },
    },
  })
    .sort({ detectedAt: -1 })
    .limit(50)
    .lean();


  const priorObservations = historicalHotspots.map((h) => ({
    detectedAt: h.detectedAt,
    frp: h.frp || 0,
    brightness: h.brightness || 0,
    satellite: h.satellite,
    distanceMeters: haversineMeters(
      lon,
      lat,
      h.location.coordinates[0],
      h.location.coordinates[1]
    ),
  }));

  const historicalCount = priorObservations.length;
  // No history is not a baseline of zero, nor a baseline equal to this
  // detection. It is the absence of one, and it is passed on as such. These are
  // OPTIONAL features, so a null here does not gate the row to unclassified.
  let historicalMeanFrp: number | null = null;
  let historicalStdDevFrp: number | null = null;
  let frpZScore: number | null = null;
  let daysSinceLastDetection: number | null = null;

  if (historicalCount > 0) {
    const frpValues = priorObservations.map((p) => p.frp);
    const sum = frpValues.reduce((a, b) => a + b, 0);
    const meanFrp = Number((sum / historicalCount).toFixed(2));
    historicalMeanFrp = meanFrp;

    const sqDiffSum = frpValues.reduce((a, b) => a + Math.pow(b - meanFrp, 2), 0);
    const stdDevFrp = Number(Math.sqrt(sqDiffSum / historicalCount).toFixed(2));
    historicalStdDevFrp = stdDevFrp;

    // Statistical Z-score calculation. Undefined without a measured FRP to
    // compare against the baseline.
    frpZScore =
      frp === null ? null : Number(((frp - meanFrp) / (stdDevFrp + 2.0)).toFixed(2));

    const latestPrior = priorObservations[0];
    if (latestPrior) {
      const diffMs =
        new Date(hotspot.detectedAt).getTime() - new Date(latestPrior.detectedAt).getTime();
      daysSinceLastDetection = Number((diffMs / (1000 * 60 * 60 * 24)).toFixed(1));
    }
  }

  return {
    frp,
    brightness,
    brightnessTi5,
    tempDelta,
    dayNight: hotspot.dayNight === 'N' ? 'N' : 'D',
    instrument: hotspot.instrument,
    satellite: hotspot.satellite,
    confidence: String(hotspot.confidence),
    nearestFacility,

    facilityDistanceMeters: distanceMeters,
    facilityType,
    isInsideIndustrialPerimeter,
    isNearIndustrialPerimeter,
    nearbyClusterCount3km,
    landCover,
    historicalOverpassesWithin1_5km: historicalCount,
    historicalMeanFrp,
    historicalStdDevFrp,
    frpZScore,
    daysSinceLastDetection,
    priorObservations,
    enrichmentSource: enrichment.enrichmentSource,
    enrichmentStatus: enrichment.enrichmentStatus,
  };
}

export interface CanonicalFeatures {
  values: Record<string, number | null>;
  unresolved: string[];
}

/**
 * Build the model input.
 *
 * Absence is represented as null and reported in `unresolved`. Nothing is
 * substituted: the previous implementation emitted 25000 for an unmeasured
 * facility distance and -1 for absent history, both of which are
 * indistinguishable downstream from real measurements.
 *
 * `landcover_encoded` is null rather than 5 when enrichment found nothing,
 * because 5 means "other" — a real observed category — and conflating the two
 * is exactly the bug this replaces.
 */
export function toCanonicalFeatureRecord(features: ExtractedFeatures): CanonicalFeatures {
  let numConfidence: number | null = null;
  if (typeof features.confidence === 'number') {
    numConfidence = features.confidence / 100;
  } else if (typeof features.confidence === 'string') {
    const lower = features.confidence.toLowerCase();
    if (lower === 'h' || lower === 'high') numConfidence = 0.95;
    else if (lower === 'n' || lower === 'nominal') numConfidence = 0.75;
    else if (lower === 'l' || lower === 'low') numConfidence = 0.4;
    else {
      const parsed = parseFloat(features.confidence);
      numConfidence = Number.isNaN(parsed) ? null : parsed > 1 ? parsed / 100 : parsed;
    }
  }

  const hasEnrichment = features.facilityDistanceMeters !== null;

  const values: Record<string, number | null> = {
    frp: features.frp ?? null,
    brightness: features.brightness ?? null,
    brightness_ti5: features.brightnessTi5 ?? null,
    temp_delta_ti4_ti5: features.tempDelta ?? null,
    confidence: numConfidence,
    is_night: features.dayNight === 'N' ? 1 : 0,
    facility_distance_m: features.facilityDistanceMeters,
    // An unmapped subcategory (the OSM taxonomy emits `waste_disposal`,
    // `railway_yard`, `unknown` and others that the trained vocabulary has no
    // code for) is UNRESOLVED, not `none`. Falling back to 0 produced a
    // self-contradictory vector — a facility 200 m away that does not exist.
    // `none` still encodes to 0, but only via the map, when enrichment
    // genuinely reports no facility.
    facility_type_encoded: hasEnrichment ? FACILITY_TYPE_MAP[features.facilityType] ?? null : null,
    landcover_encoded: hasEnrichment ? LANDCOVER_MAP[features.landCover] ?? null : null,
    nearby_cluster_count_3km: features.nearbyClusterCount3km ?? null,
    historical_recurrence_1_5km: features.historicalOverpassesWithin1_5km ?? null,
    historical_mean_frp: features.historicalMeanFrp ?? null,
    frp_z_score: features.frpZScore ?? null,
    days_since_last_detection: features.daysSinceLastDetection,
  };

  const unresolved = REQUIRED_FEATURES.filter((f) => values[f] === null || values[f] === undefined);

  return { values, unresolved: [...unresolved] };
}
