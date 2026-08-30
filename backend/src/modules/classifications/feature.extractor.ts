import { IHotspot, Hotspot } from '../hotspots/hotspot.model';
import { findNearestFacility, haversineMeters } from '../facilities/facility.service';
import { IFacility } from '../facilities/facility.model';

export interface ExtractedFeatures {
  // Thermal features from real sensor telemetry
  frp: number;
  brightness: number;
  brightnessTi5: number;
  tempDelta: number; // Brightness - BrightnessTi5 (thermal contrast)
  dayNight: 'D' | 'N';
  instrument: string;
  satellite: string;
  confidence: string;

  // Spatial features from real OSM context
  nearestFacility: IFacility | null;
  facilityDistanceMeters: number | null;
  facilityType: string;
  isInsideIndustrialPerimeter: boolean; // < 400m
  isNearIndustrialPerimeter: boolean; // < 1500m
  nearbyClusterCount3km: number;
  landCover: 'built_up' | 'forest' | 'cropland' | 'bare' | 'other';

  // Temporal & Historical features from real FIRMS history
  historicalOverpassesWithin1_5km: number;
  historicalMeanFrp: number;
  historicalStdDevFrp: number;
  frpZScore: number;
  daysSinceLastDetection: number | null;
  priorObservations: Array<{
    detectedAt: Date;
    frp: number;
    brightness: number;
    satellite: string;
    distanceMeters: number;
  }>;
}

/**
 * Infer land cover from spatial context and known Delhi NCR geography
 */
function inferContextualLandCover(
  lon: number,
  lat: number,
  facilityDist: number | null
): 'built_up' | 'forest' | 'cropland' | 'bare' | 'other' {
  if (facilityDist !== null && facilityDist < 1500) {
    return 'built_up';
  }
  // Delhi Southern/Central Ridge Forest Zone
  if (lon >= 77.12 && lon <= 77.20 && lat >= 28.55 && lat <= 28.65) {
    return 'forest';
  }
  // Yamuna floodplains / agricultural corridors
  if (lon >= 77.22 && lon <= 77.34 && lat >= 28.50 && lat <= 28.85) {
    return 'cropland';
  }
  // Core urban built-up area
  if (lon >= 77.05 && lon <= 77.35 && lat >= 28.50 && lat <= 28.75) {
    return 'built_up';
  }
  // Gangetic agricultural plain
  if (lat >= 24 && lat <= 32 && lon >= 74 && lon <= 88) {
    return 'cropland';
  }
  return 'other';
}

/**
 * Extract comprehensive, verifiable features for a real FIRMS hotspot.
 */
export async function extractFeaturesForHotspot(
  hotspot: IHotspot
): Promise<ExtractedFeatures> {
  const [lon, lat] = hotspot.location.coordinates;
  const frp = hotspot.frp || 10.0;
  const brightness = hotspot.brightness || 310.0;
  const brightnessTi5 = hotspot.brightnessTi5 || 290.0;
  const tempDelta = Math.max(0, brightness - brightnessTi5);

  // 1. Spatial context: nearest real OSM facility
  const { facility, distanceMeters } = await findNearestFacility(lon, lat, 25000);
  const facilityType = facility?.facilityType || 'none';
  const isInsideIndustrialPerimeter = distanceMeters !== null && distanceMeters <= 400;
  const isNearIndustrialPerimeter = distanceMeters !== null && distanceMeters <= 1500;
  const landCover = inferContextualLandCover(lon, lat, distanceMeters);

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
  let historicalMeanFrp = frp;
  let historicalStdDevFrp = 5.0;
  let frpZScore = 0.0;
  let daysSinceLastDetection: number | null = null;

  if (historicalCount > 0) {
    const frpValues = priorObservations.map((p) => p.frp);
    const sum = frpValues.reduce((a, b) => a + b, 0);
    historicalMeanFrp = Number((sum / historicalCount).toFixed(2));

    const sqDiffSum = frpValues.reduce((a, b) => a + Math.pow(b - historicalMeanFrp, 2), 0);
    historicalStdDevFrp = Number(Math.sqrt(sqDiffSum / historicalCount).toFixed(2));

    // Statistical Z-score calculation
    frpZScore = Number(
      ((frp - historicalMeanFrp) / (historicalStdDevFrp + 2.0)).toFixed(2)
    );

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
    nearestFacility: facility,

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
  };
}

export const FACILITY_TYPE_MAP: Record<string, number> = {
  none: 0,
  refinery: 1,
  power_plant: 2,
  chemical: 3,
  brick_kiln: 4,
  steel_mill: 5,
  quarry_mining: 6,
  general_industrial: 7,
  warehouse: 8,
};

export const LANDCOVER_MAP: Record<string, number> = {
  built_up: 0,
  cropland: 1,
  forest: 2,
  bare: 3,
  water: 4,
  other: 5,
};

export function toCanonicalFeatureRecord(features: ExtractedFeatures): Record<string, number> {
  let numConfidence = 0.8;
  if (typeof features.confidence === 'number') {
    numConfidence = features.confidence / 100;
  } else if (typeof features.confidence === 'string') {
    const lower = features.confidence.toLowerCase();
    if (lower === 'h' || lower === 'high') numConfidence = 0.95;
    else if (lower === 'n' || lower === 'nominal') numConfidence = 0.75;
    else if (lower === 'l' || lower === 'low') numConfidence = 0.4;
    else {
      const parsed = parseFloat(features.confidence);
      numConfidence = !isNaN(parsed) ? (parsed > 1 ? parsed / 100 : parsed) : 0.75;
    }
  }

  return {
    frp: Number(features.frp.toFixed(2)),
    brightness: Number(features.brightness.toFixed(2)),
    brightness_ti5: Number(features.brightnessTi5.toFixed(2)),
    temp_delta_ti4_ti5: Number(features.tempDelta.toFixed(2)),
    confidence: Number(numConfidence.toFixed(3)),
    is_night: features.dayNight === 'N' ? 1 : 0,
    facility_distance_m:
      features.facilityDistanceMeters !== null ? Number(features.facilityDistanceMeters.toFixed(1)) : 25000.0,
    facility_type_encoded: FACILITY_TYPE_MAP[features.facilityType] ?? 0,
    landcover_encoded: LANDCOVER_MAP[features.landCover] ?? 5,
    nearby_cluster_count_3km: features.nearbyClusterCount3km,
    historical_recurrence_1_5km: features.historicalOverpassesWithin1_5km,
    historical_mean_frp: Number(features.historicalMeanFrp.toFixed(2)),
    frp_z_score: Number(features.frpZScore.toFixed(2)),
    days_since_last_detection:
      features.daysSinceLastDetection !== null ? features.daysSinceLastDetection : -1,
  };
}

