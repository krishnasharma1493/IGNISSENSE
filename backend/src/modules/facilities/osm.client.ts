import axios from 'axios';

export interface RawOsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
}

export interface IngestedOsmFacility {
  source: 'OpenStreetMap';
  sourceId: string;
  sourceType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  facilityType:
    | 'refinery'
    | 'power_plant'
    | 'substation'
    | 'industrial'
    | 'industrial_area'
    | 'mine'
    | 'oil_gas'
    | 'works'
    | 'other';
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  tags: Record<string, string>;
  region: string;
  dataQuality: 'external';
  retrievedAt: Date;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

/**
 * Fetch real industrial facilities in Delhi NCR from OpenStreetMap Overpass API.
 */
export async function fetchDelhiNcrOsmFacilities(
  bbox = { south: 28.2, west: 76.7, north: 28.9, east: 77.7 }
): Promise<IngestedOsmFacility[]> {
  const query = `
    [out:json][timeout:35];
    (
      node["power"="plant"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["power"="plant"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["landuse"="industrial"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["landuse"="industrial"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["industrial"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["industrial"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["man_made"="works"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["man_made"="works"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["power"="substation"]["voltage"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["power"="substation"]["voltage"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    out center tags;
  `;

  let elements: RawOsmElement[] = [];
  let success = false;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[OSM] Querying Overpass API at ${endpoint}...`);
      const response = await axios.post(
        endpoint,
        `data=${encodeURIComponent(query)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Ignissense-SIH26162-Intelligence/1.0 (https://sih.gov.in; intelligence-research)',
          },
          timeout: 30000,
        }
      );

      if (response.data && Array.isArray(response.data.elements)) {
        elements = response.data.elements;
        success = true;
        console.log(`[OSM] Successfully fetched ${elements.length} raw OSM elements from Overpass`);
        break;
      }
    } catch (err: any) {
      console.warn(`[OSM] Overpass mirror ${endpoint} failed: ${err.message}. Trying next mirror...`);
    }
  }

  if (!success || elements.length === 0) {
    console.error('[OSM] All Overpass mirrors failed or returned 0 elements.');
    return [];
  }

  const now = new Date();
  const normalized: IngestedOsmFacility[] = [];

  for (const el of elements) {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;

    if (lon === undefined || lat === undefined) continue;

    const tags = el.tags || {};
    const name = tags.name || tags['name:en'] || tags.operator || deriveDefaultName(tags);
    const facilityType = deriveFacilityType(tags);

    normalized.push({
      source: 'OpenStreetMap',
      sourceId: `${el.type}/${el.id}`,
      sourceType: el.type,
      osmId: el.id,
      name,
      facilityType,
      location: {
        type: 'Point',
        coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))],
      },
      tags,
      region: 'delhi_ncr',
      dataQuality: 'external',
      retrievedAt: now,
    });
  }

  return normalized;
}

function deriveFacilityType(
  tags: Record<string, string>
): IngestedOsmFacility['facilityType'] {
  if (tags.industrial === 'refinery' || tags.petroleum === 'refinery') {
    return 'refinery';
  }
  if (tags.power === 'plant') {
    return 'power_plant';
  }
  if (tags.power === 'substation') {
    return 'substation';
  }
  if (tags.landuse === 'quarry' || tags.resource === 'coal' || tags.mining) {
    return 'mine';
  }
  if (tags.landuse === 'industrial') {
    return 'industrial_area';
  }
  if (tags.man_made === 'works') {
    return 'works';
  }
  if (tags.industrial) {
    return 'industrial';
  }
  return 'other';
}

function deriveDefaultName(tags: Record<string, string>): string {
  if (tags.power === 'plant') {
    const src = tags['plant:source'] || 'Thermal';
    return `${capitalize(src)} Power Station`;
  }
  if (tags.power === 'substation') {
    const v = tags.voltage ? `${tags.voltage}V ` : '';
    return `${v}Power Substation`;
  }
  if (tags.landuse === 'industrial') {
    return 'Industrial Zone';
  }
  if (tags.man_made === 'works') {
    return 'Industrial Works';
  }
  if (tags.industrial) {
    return `${capitalize(tags.industrial)} Facility`;
  }
  return 'Industrial Facility';
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
