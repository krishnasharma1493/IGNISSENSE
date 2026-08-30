import { OsmFeature, IOsmFeature } from './osmFeature.model';
import { Facility } from '../facilities/facility.model';
import type { FeatureCategory } from './taxonomy';
import { CATEGORY_TO_LANDCOVER } from './taxonomy';

/**
 * Geospatial Enrichment Service
 *
 * Provides a single reusable `enrichHotspot()` function that queries the
 * India-wide OSM database to generate spatial context for any FIRMS hotspot.
 *
 * IMPORTANT: This service is used by BOTH:
 *   - Live FIRMS ingestion (real-time classification)
 *   - Historical reprocessing (training data construction)
 *   - Model inference
 *   - Hotspot investigation
 *
 * The same enrichment logic is used for training and inference to prevent
 * feature drift between training-time and production-time feature definitions.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NearbyFeatureInfo {
  name: string;
  type: string;
  category: FeatureCategory;
  subcategory: string;
  distance_m: number;
  osmId: number;
  sourceId: string;
}

export interface EnrichmentResult {
  // Industrial context
  nearestIndustrialFacility: NearbyFeatureInfo | null;
  nearestRefinery: NearbyFeatureInfo | null;
  nearestPowerPlant: NearbyFeatureInfo | null;
  nearestOilGas: NearbyFeatureInfo | null;
  industrialFeaturesWithin5km: number;

  // Mining context
  nearestMine: NearbyFeatureInfo | null;
  miningFeaturesWithin5km: number;

  // Environmental context (from OSM as proxy; designed for future external dataset)
  forestContextNearby: boolean;
  agricultureContextNearby: boolean;

  // General
  nearbyFeatureCount: number;
  enrichmentStatus: 'enriched' | 'partial' | 'no_osm_coverage';
  enrichmentSource: string;

  // Derived for ML feature compatibility
  facilityType: string;         // Best matching facility type
  facilityDistanceMeters: number | null;
  inferredLandCover: 'built_up' | 'forest' | 'cropland' | 'bare' | 'water' | 'other';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_RADIUS_M = 25000; // 25 km search radius
const INDUSTRIAL_RADIUS_M = 10000;  // 10 km for industrial feature counting
const CONTEXT_RADIUS_M = 5000;      // 5 km for environmental context detection
const EARTH_RADIUS_M = 6371000;

// ─── Main Enrichment Function ────────────────────────────────────────────────

/**
 * Enrich a hotspot coordinate with spatial context from the India-wide OSM database.
 *
 * Query Strategy:
 *   1. Single $nearSphere query per category type (parallelized)
 *   2. All queries hit the 2dsphere index on osm_features
 *   3. Falls back to legacy facilities collection if osm_features is empty
 */
export async function enrichHotspot(
  longitude: number,
  latitude: number,
  maxRadiusM: number = DEFAULT_MAX_RADIUS_M
): Promise<EnrichmentResult> {
  const point = { type: 'Point' as const, coordinates: [longitude, latitude] as [number, number] };

  // Check if India-wide OSM data is available
  const osmFeatureCount = await OsmFeature.estimatedDocumentCount();
  const useOsmFeatures = osmFeatureCount > 100;

  if (useOsmFeatures) {
    return enrichFromOsmFeatures(longitude, latitude, point, maxRadiusM);
  }

  // Fallback to legacy facilities collection (Delhi NCR only)
  return enrichFromLegacyFacilities(longitude, latitude, point, maxRadiusM);
}

// ─── OSM Features Enrichment ─────────────────────────────────────────────────

async function enrichFromOsmFeatures(
  longitude: number,
  latitude: number,
  point: { type: 'Point'; coordinates: [number, number] },
  maxRadiusM: number
): Promise<EnrichmentResult> {
  // Run all spatial queries in parallel
  const [
    nearestIndustrial,
    nearestRefinery,
    nearestPowerPlant,
    nearestOilGas,
    nearestMine,
    industrialCount,
    miningCount,
    nearestForest,
    nearestAgri,
    totalNearby,
  ] = await Promise.all([
    // Industrial
    findNearestByCategories(point, ['industrial'], maxRadiusM),
    findNearestBySubcategory(point, 'refinery', maxRadiusM),
    findNearestBySubcategories(point, ['power_plant', 'thermal_power_station'], maxRadiusM),
    findNearestByCategories(point, ['oil_gas'], maxRadiusM),
    // Mining
    findNearestByCategories(point, ['mining'], maxRadiusM),
    // Counts within radius
    countFeaturesNearby(point, ['industrial', 'oil_gas', 'power'], INDUSTRIAL_RADIUS_M),
    countFeaturesNearby(point, ['mining'], INDUSTRIAL_RADIUS_M),
    // Environmental
    findNearestByCategories(point, ['forest'], CONTEXT_RADIUS_M),
    findNearestByCategories(point, ['agriculture'], CONTEXT_RADIUS_M),
    // Total nearby
    countAllFeaturesNearby(point, maxRadiusM),
  ]);

  // Determine enrichment status
  const hasAnyContext = !!(nearestIndustrial || nearestRefinery || nearestPowerPlant ||
    nearestOilGas || nearestMine || nearestForest || nearestAgri);
  const enrichmentStatus = hasAnyContext ? 'enriched'
    : totalNearby > 0 ? 'partial'
    : 'no_osm_coverage';

  // Derive the "best" facility info for ML compatibility
  const bestFacility = pickBestFacility(nearestIndustrial, nearestRefinery, nearestPowerPlant, nearestOilGas, nearestMine);

  // Infer land cover from nearest context features
  const inferredLandCover = inferLandCover(
    longitude, latitude,
    nearestForest, nearestAgri, bestFacility,
    nearestMine
  );

  return {
    nearestIndustrialFacility: nearestIndustrial,
    nearestRefinery,
    nearestPowerPlant,
    nearestOilGas,
    industrialFeaturesWithin5km: industrialCount,
    nearestMine,
    miningFeaturesWithin5km: miningCount,
    forestContextNearby: nearestForest !== null,
    agricultureContextNearby: nearestAgri !== null,
    nearbyFeatureCount: totalNearby,
    enrichmentStatus,
    enrichmentSource: 'osm_india_v1',
    facilityType: bestFacility ? bestFacility.subcategory : 'none',
    facilityDistanceMeters: bestFacility ? bestFacility.distance_m : null,
    inferredLandCover,
  };
}

// ─── Legacy Facilities Fallback ──────────────────────────────────────────────

async function enrichFromLegacyFacilities(
  longitude: number,
  latitude: number,
  point: { type: 'Point'; coordinates: [number, number] },
  maxRadiusM: number
): Promise<EnrichmentResult> {
  // Query legacy facilities collection
  const radiusRad = maxRadiusM / EARTH_RADIUS_M;
  const nearby = await Facility.find({
    location: {
      $geoWithin: {
        $centerSphere: [point.coordinates, radiusRad],
      },
    },
  })
    .limit(10)
    .lean();

  let bestFacilityInfo: NearbyFeatureInfo | null = null;
  let bestDistance = Infinity;

  for (const fac of nearby) {
    const dist = haversineMeters(
      longitude, latitude,
      fac.location.coordinates[0], fac.location.coordinates[1]
    );
    if (dist < bestDistance) {
      bestDistance = dist;
      bestFacilityInfo = {
        name: fac.name,
        type: fac.facilityType,
        category: 'industrial' as FeatureCategory,
        subcategory: fac.facilityType,
        distance_m: dist,
        osmId: fac.osmId,
        sourceId: fac.sourceId,
      };
    }
  }

  return {
    nearestIndustrialFacility: bestFacilityInfo,
    nearestRefinery: bestFacilityInfo?.type === 'refinery' ? bestFacilityInfo : null,
    nearestPowerPlant: bestFacilityInfo?.type === 'power_plant' ? bestFacilityInfo : null,
    nearestOilGas: bestFacilityInfo?.type === 'oil_gas' ? bestFacilityInfo : null,
    industrialFeaturesWithin5km: nearby.length,
    nearestMine: bestFacilityInfo?.type === 'mine' ? bestFacilityInfo : null,
    miningFeaturesWithin5km: 0,
    forestContextNearby: false,
    agricultureContextNearby: false,
    nearbyFeatureCount: nearby.length,
    enrichmentStatus: nearby.length > 0 ? 'partial' : 'no_osm_coverage',
    enrichmentSource: 'legacy_facilities_delhi_ncr',
    facilityType: bestFacilityInfo?.subcategory || 'none',
    facilityDistanceMeters: bestFacilityInfo ? bestFacilityInfo.distance_m : null,
    inferredLandCover: bestFacilityInfo && bestDistance < 1500 ? 'built_up' : 'other',
  };
}

// ─── Spatial Query Helpers ───────────────────────────────────────────────────

async function findNearestByCategories(
  point: { type: 'Point'; coordinates: [number, number] },
  categories: FeatureCategory[],
  maxDistanceM: number
): Promise<NearbyFeatureInfo | null> {
  try {
    const features = await OsmFeature.find({
      featureCategory: { $in: categories },
      geometry: {
        $nearSphere: {
          $geometry: point,
          $maxDistance: maxDistanceM,
        },
      },
    })
      .limit(1)
      .lean();

    if (features.length === 0) return null;

    const f = features[0];
    const dist = haversineMeters(
      point.coordinates[0], point.coordinates[1],
      f.longitude, f.latitude
    );

    return {
      name: f.name,
      type: f.featureSubcategory,
      category: f.featureCategory as FeatureCategory,
      subcategory: f.featureSubcategory,
      distance_m: dist,
      osmId: f.osmId,
      sourceId: f.sourceId,
    };
  } catch {
    return null;
  }
}

async function findNearestBySubcategory(
  point: { type: 'Point'; coordinates: [number, number] },
  subcategory: string,
  maxDistanceM: number
): Promise<NearbyFeatureInfo | null> {
  try {
    const features = await OsmFeature.find({
      featureSubcategory: subcategory,
      geometry: {
        $nearSphere: {
          $geometry: point,
          $maxDistance: maxDistanceM,
        },
      },
    })
      .limit(1)
      .lean();

    if (features.length === 0) return null;

    const f = features[0];
    const dist = haversineMeters(
      point.coordinates[0], point.coordinates[1],
      f.longitude, f.latitude
    );

    return {
      name: f.name,
      type: f.featureSubcategory,
      category: f.featureCategory as FeatureCategory,
      subcategory: f.featureSubcategory,
      distance_m: dist,
      osmId: f.osmId,
      sourceId: f.sourceId,
    };
  } catch {
    return null;
  }
}

async function findNearestBySubcategories(
  point: { type: 'Point'; coordinates: [number, number] },
  subcategories: string[],
  maxDistanceM: number
): Promise<NearbyFeatureInfo | null> {
  try {
    const features = await OsmFeature.find({
      featureSubcategory: { $in: subcategories },
      geometry: {
        $nearSphere: {
          $geometry: point,
          $maxDistance: maxDistanceM,
        },
      },
    })
      .limit(1)
      .lean();

    if (features.length === 0) return null;

    const f = features[0];
    const dist = haversineMeters(
      point.coordinates[0], point.coordinates[1],
      f.longitude, f.latitude
    );

    return {
      name: f.name,
      type: f.featureSubcategory,
      category: f.featureCategory as FeatureCategory,
      subcategory: f.featureSubcategory,
      distance_m: dist,
      osmId: f.osmId,
      sourceId: f.sourceId,
    };
  } catch {
    return null;
  }
}

async function countFeaturesNearby(
  point: { type: 'Point'; coordinates: [number, number] },
  categories: FeatureCategory[],
  radiusM: number
): Promise<number> {
  try {
    const radiusRad = radiusM / EARTH_RADIUS_M;
    return OsmFeature.countDocuments({
      featureCategory: { $in: categories },
      geometry: {
        $geoWithin: {
          $centerSphere: [point.coordinates, radiusRad],
        },
      },
    });
  } catch {
    return 0;
  }
}

async function countAllFeaturesNearby(
  point: { type: 'Point'; coordinates: [number, number] },
  radiusM: number
): Promise<number> {
  try {
    const radiusRad = radiusM / EARTH_RADIUS_M;
    return OsmFeature.countDocuments({
      geometry: {
        $geoWithin: {
          $centerSphere: [point.coordinates, radiusRad],
        },
      },
    });
  } catch {
    return 0;
  }
}

// ─── Facility Selection Logic ────────────────────────────────────────────────

/**
 * Pick the "best" (closest relevant) facility from the various nearest queries.
 * Priority: closest distance wins, but refineries and power plants get a slight
 * priority boost (they are the most relevant for industrial fire classification).
 */
function pickBestFacility(
  ...candidates: (NearbyFeatureInfo | null)[]
): NearbyFeatureInfo | null {
  const valid = candidates.filter((c): c is NearbyFeatureInfo => c !== null);
  if (valid.length === 0) return null;

  // Sort by distance, then by relevance priority
  valid.sort((a, b) => a.distance_m - b.distance_m);
  return valid[0];
}

// ─── Land Cover Inference ────────────────────────────────────────────────────

/**
 * Infer land cover from nearby OSM features.
 *
 * This is an initial proxy using OSM context. Designed to be replaced
 * with authoritative land cover data (ESA WorldCover / ISRO LULC)
 * when integrated.
 *
 * Logic:
 *   - If within 1.5km of industrial/power/oil_gas facility → built_up
 *   - If nearest forest feature is closer than nearest facility → forest
 *   - If nearest agriculture feature is closer than nearest facility → cropland
 *   - If near mining → bare
 *   - Otherwise → other (evidence unavailable, NOT evidence absent)
 */
function inferLandCover(
  lon: number,
  lat: number,
  nearestForest: NearbyFeatureInfo | null,
  nearestAgri: NearbyFeatureInfo | null,
  nearestFacility: NearbyFeatureInfo | null,
  nearestMine: NearbyFeatureInfo | null
): 'built_up' | 'forest' | 'cropland' | 'bare' | 'water' | 'other' {
  const facilityDist = nearestFacility?.distance_m ?? Infinity;
  const forestDist = nearestForest?.distance_m ?? Infinity;
  const agriDist = nearestAgri?.distance_m ?? Infinity;
  const mineDist = nearestMine?.distance_m ?? Infinity;

  // Industrial proximity dominates
  if (facilityDist < 1500) return 'built_up';

  // Mining proximity
  if (mineDist < 2000) return 'bare';

  // Closest context wins
  const minDist = Math.min(forestDist, agriDist, facilityDist);

  if (minDist === forestDist && forestDist < CONTEXT_RADIUS_M) return 'forest';
  if (minDist === agriDist && agriDist < CONTEXT_RADIUS_M) return 'cropland';
  if (facilityDist < INDUSTRIAL_RADIUS_M) return 'built_up';

  // No nearby OSM context — evidence unavailable
  return 'other';
}

// ─── Haversine Distance ──────────────────────────────────────────────────────

export function haversineMeters(
  lon1: number, lat1: number,
  lon2: number, lat2: number
): number {
  const R = EARTH_RADIUS_M;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
