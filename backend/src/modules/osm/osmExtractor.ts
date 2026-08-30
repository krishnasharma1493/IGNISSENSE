import axios from 'axios';
import { classifyOsmTags, deriveOsmName, FeatureCategory } from './taxonomy';

/**
 * OSM Extractor — Overpass Query Builder & Element Normalizer
 *
 * Handles the low-level mechanics of:
 * 1. Generating India geographic tiles (3° × 3° grid)
 * 2. Building targeted Overpass QL queries per tile
 * 3. Fetching from Overpass API with mirror failover
 * 4. Normalizing raw OSM elements into our canonical schema
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TileBbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface RawOsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface NormalizedOsmFeature {
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  sourceId: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  latitude: number;
  longitude: number;
  featureCategory: FeatureCategory;
  featureSubcategory: string;
  name: string;
  tags: Record<string, string>;
  industrialType?: string;
  facilityType?: string;
  landUse?: string;
  naturalType?: string;
  operator?: string;
  source: 'OpenStreetMap';
  tileId: string;
  region: string;
  extractedAt: Date;
}

// ─── India Bounding Box ──────────────────────────────────────────────────────

export const INDIA_BBOX: TileBbox = {
  south: 6.0,
  west: 68.0,
  north: 38.0,
  east: 98.0,
};

// ─── Tile Generation ─────────────────────────────────────────────────────────
// 3° × 3° tiles across India → ~120 tiles
// This balances Overpass query reliability (< 30s per tile in most cases)
// against total number of requests.

export const DEFAULT_TILE_SIZE = 3.0;

export function generateIndiaTiles(tileSize: number = DEFAULT_TILE_SIZE): Array<{
  tileId: string;
  bbox: TileBbox;
}> {
  const tiles: Array<{ tileId: string; bbox: TileBbox }> = [];

  for (let lat = INDIA_BBOX.south; lat < INDIA_BBOX.north; lat += tileSize) {
    for (let lon = INDIA_BBOX.west; lon < INDIA_BBOX.east; lon += tileSize) {
      const south = Number(lat.toFixed(1));
      const west = Number(lon.toFixed(1));
      const north = Number(Math.min(lat + tileSize, INDIA_BBOX.north).toFixed(1));
      const east = Number(Math.min(lon + tileSize, INDIA_BBOX.east).toFixed(1));

      tiles.push({
        tileId: `tile_${south}_${west}`,
        bbox: { south, west, north, east },
      });
    }
  }

  return tiles;
}

// ─── Overpass Query Builder ──────────────────────────────────────────────────
// Targeted query: extracts only ML-relevant features, NOT all OSM data.

export function buildOverpassQuery(bbox: TileBbox): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  return `
[out:json][timeout:180][maxsize:67108864];
(
  // Industrial facilities
  nwr["industrial"](${b});
  nwr["man_made"="works"](${b});
  nwr["landuse"="industrial"](${b});
  nwr["building"="factory"](${b});
  nwr["building"="warehouse"](${b});
  nwr["craft"="brickmaker"](${b});

  // Power infrastructure
  nwr["power"="plant"](${b});
  nwr["power"="generator"](${b});
  nwr["power"="substation"]["voltage"](${b});

  // Oil & Gas
  nwr["man_made"="petroleum_well"](${b});
  nwr["man_made"="oil_well"](${b});
  nwr["man_made"="flare"](${b});
  nwr["pipeline"="substation"](${b});

  // Mining
  nwr["landuse"="quarry"](${b});
  nwr["mining"](${b});
  nwr["resource"](${b});

  // Land context — forest, agriculture (large polygons: ways only to reduce noise)
  way["landuse"="forest"](${b});
  way["natural"="wood"](${b});
  way["natural"="scrub"](${b});
  way["landuse"="farmland"](${b});
  way["landuse"="orchard"](${b});
  way["landuse"="meadow"](${b});

  // Nature reserves / national parks
  relation["boundary"="national_park"](${b});
  relation["leisure"="nature_reserve"](${b});

  // Other relevant
  nwr["landuse"="landfill"](${b});
  nwr["landuse"="brownfield"](${b});
);
out center tags;
  `.trim();
}

// ─── Overpass API Mirrors ────────────────────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/**
 * Fetch OSM elements for a single tile from Overpass API.
 * Tries multiple mirrors with exponential backoff.
 */
export async function fetchTileFromOverpass(
  bbox: TileBbox,
  maxRetries: number = 2
): Promise<{ elements: RawOsmElement[]; endpoint: string }> {
  const query = buildOverpassQuery(bbox);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await axios.post(
          endpoint,
          `data=${encodeURIComponent(query)}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Ignissense-SIH26162/1.0 (OSM-India-Extraction; https://sih.gov.in)',
            },
            timeout: 200000, // 200s for large tiles
            maxContentLength: 100 * 1024 * 1024, // 100 MB
          }
        );

        if (response.data && Array.isArray(response.data.elements)) {
          return {
            elements: response.data.elements,
            endpoint,
          };
        }
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429) {
          // Rate limited — wait before trying next mirror
          const backoffMs = Math.min(30000, 5000 * Math.pow(2, attempt));
          console.warn(
            `[OSM Extractor] Rate limited by ${endpoint}. Backing off ${backoffMs}ms...`
          );
          await sleep(backoffMs);
        } else {
          console.warn(
            `[OSM Extractor] Mirror ${endpoint} failed (attempt ${attempt + 1}): ${err.message}`
          );
        }
      }
    }

    // Wait before retrying all mirrors
    if (attempt < maxRetries) {
      const waitMs = 10000 * (attempt + 1);
      console.log(`[OSM Extractor] Waiting ${waitMs}ms before retry round ${attempt + 2}...`);
      await sleep(waitMs);
    }
  }

  throw new Error(`All Overpass mirrors failed after ${maxRetries + 1} attempts`);
}

// ─── Element Normalizer ──────────────────────────────────────────────────────

/**
 * Normalize a raw OSM element into our canonical OsmFeature schema.
 * Returns null if the element cannot be normalized (missing coordinates, etc.).
 */
export function normalizeOsmElement(
  element: RawOsmElement,
  tileId: string
): NormalizedOsmFeature | null {
  // Extract coordinates
  const lon = element.lon ?? element.center?.lon;
  const lat = element.lat ?? element.center?.lat;

  if (lon === undefined || lat === undefined) {
    return null;
  }

  // Validate coordinate ranges
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return null;
  }

  const tags = element.tags || {};

  // Skip elements with no useful tags
  if (Object.keys(tags).length === 0) {
    return null;
  }

  // Classify using our controlled taxonomy
  const { category, subcategory } = classifyOsmTags(tags);

  // Derive human-readable name
  const name = deriveOsmName(tags, category, subcategory);

  const longitude = Number(lon.toFixed(6));
  const latitude = Number(lat.toFixed(6));

  return {
    osmId: element.id,
    osmType: element.type,
    sourceId: `${element.type}/${element.id}`,
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
    latitude,
    longitude,
    featureCategory: category,
    featureSubcategory: subcategory,
    name,
    tags,
    industrialType: tags.industrial || undefined,
    facilityType: tags.power || tags.man_made || undefined,
    landUse: tags.landuse || undefined,
    naturalType: tags.natural || undefined,
    operator: tags.operator || undefined,
    source: 'OpenStreetMap',
    tileId,
    region: 'india',
    extractedAt: new Date(),
  };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
