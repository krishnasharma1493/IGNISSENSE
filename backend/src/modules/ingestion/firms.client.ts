import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { config } from '../../config';

/**
 * FIRMS API Client
 *
 * Fetches thermal anomaly data from NASA FIRMS.
 *
 * Verified endpoint format (as of August 2026):
 *   Area: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}/{DATE}
 *   Country: https://firms.modaps.eosdis.nasa.gov/api/country/csv/{MAP_KEY}/{SOURCE}/{COUNTRY}/{DAY_RANGE}/{DATE}
 *
 * VIIRS CSV columns:
 *   latitude, longitude, bright_ti4, scan, track, acq_date, acq_time,
 *   satellite, instrument, confidence, version, bright_ti5, frp, daynight
 *
 * MODIS CSV columns:
 *   latitude, longitude, brightness, scan, track, acq_date, acq_time,
 *   satellite, instrument, confidence, version, bright_t31, frp, daynight, type
 */

export interface FirmsRawRecord {
  latitude: string;
  longitude: string;
  bright_ti4?: string; // VIIRS brightness band I4
  brightness?: string; // MODIS brightness
  bright_ti5?: string; // VIIRS brightness band I5
  bright_t31?: string; // MODIS brightness band 31
  scan: string;
  track: string;
  acq_date: string; // YYYY-MM-DD
  acq_time: string; // HHMM (UTC)
  satellite: string;
  instrument: string;
  confidence: string;
  version: string;
  frp: string;
  daynight: string; // 'D' or 'N'
  type?: string; // MODIS only
}

export type FirmsSensor =
  | 'VIIRS_SNPP_NRT'
  | 'VIIRS_NOAA20_NRT'
  | 'VIIRS_NOAA21_NRT'
  | 'MODIS_NRT'
  | 'MODIS_SP'
  | 'VIIRS_NOAA20_SP'
  | 'VIIRS_SNPP_SP';

interface FetchAreaParams {
  bbox: { west: number; south: number; east: number; north: number };
  sensor?: FirmsSensor;
  dayRange?: number; // 1-10
  date?: string; // YYYY-MM-DD, empty for most recent
}

/**
 * Fetch thermal anomaly data for a geographic bounding box from FIRMS.
 *
 * API URL format:
 *   /api/area/csv/{MAP_KEY}/{SOURCE}/{west},{south},{east},{north}/{DAY_RANGE}/{DATE}
 */
export async function fetchFirmsArea(params: FetchAreaParams): Promise<FirmsRawRecord[]> {
  const {
    bbox,
    sensor = 'VIIRS_SNPP_NRT',
    dayRange = 1,
    date,
  } = params;

  if (!config.firms.apiKey) {
    throw new Error(
      'FIRMS_API_KEY is not configured. Register at https://firms.modaps.eosdis.nasa.gov/api/map_key'
    );
  }

  if (dayRange < 1 || dayRange > 10) {
    throw new Error('FIRMS day range must be between 1 and 10');
  }

  const area = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  let url = `${config.firms.baseUrl}/api/area/csv/${config.firms.apiKey}/${sensor}/${area}/${dayRange}`;

  if (date) {
    url += `/${date}`;
  }

  console.log(`[FIRMS] Fetching: ${url.replace(config.firms.apiKey, '<KEY>')}`);

  const response = await axios.get(url, {
    timeout: 30000,
    responseType: 'text',
  });

  if (typeof response.data !== 'string' || response.data.trim().length === 0) {
    console.log('[FIRMS] Empty response — no hotspots detected in area/timeframe');
    return [];
  }

  const records = parse(response.data, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as FirmsRawRecord[];

  console.log(`[FIRMS] Fetched ${records.length} raw records`);
  return records;
}

/**
 * Normalize a raw FIRMS CSV record into the internal hotspot format.
 *
 * Handles differences between VIIRS and MODIS field names:
 *   - VIIRS: bright_ti4 (brightness), bright_ti5
 *   - MODIS: brightness, bright_t31
 */
export function normalizeFirmsRecord(raw: FirmsRawRecord) {
  const latitude = parseFloat(raw.latitude);
  const longitude = parseFloat(raw.longitude);

  if (isNaN(latitude) || isNaN(longitude)) {
    console.warn(`[FIRMS Validation] Dropping record: Invalid numeric coordinates (lat="${raw.latitude}", lon="${raw.longitude}")`);
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    console.warn(`[FIRMS Validation] Dropping record: Coordinate out of bounds ([${longitude}, ${latitude}])`);
    return null;
  }

  // Parse acquisition datetime
  const dateStr = raw.acq_date?.trim(); // YYYY-MM-DD
  const timeStr = (raw.acq_time || '').toString().trim().padStart(4, '0'); // HHMM
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.warn(`[FIRMS Validation] Dropping record: Malformed acquisition date: "${dateStr}"`);
    return null;
  }

  const hours = timeStr.substring(0, 2);
  const minutes = timeStr.substring(2, 4);
  const detectedAt = new Date(`${dateStr}T${hours}:${minutes}:00Z`);

  if (isNaN(detectedAt.getTime())) {
    console.warn(`[FIRMS Validation] Dropping record: Invalid timestamp parsed from date="${dateStr}", time="${timeStr}"`);
    return null;
  }

  // Normalize brightness — VIIRS uses bright_ti4, MODIS uses brightness
  const brightness = raw.bright_ti4
    ? parseFloat(raw.bright_ti4)
    : raw.brightness
      ? parseFloat(raw.brightness)
      : null;

  const brightnessTi5 = raw.bright_ti5
    ? parseFloat(raw.bright_ti5)
    : raw.bright_t31
      ? parseFloat(raw.bright_t31)
      : null;

  let frp = raw.frp ? parseFloat(raw.frp) : null;
  if (frp !== null && (isNaN(frp) || frp < 0)) {
    console.warn(`[FIRMS Validation] Invalid FRP value: ${raw.frp}, setting to 0.0`);
    frp = 0.0;
  }

  const scan = raw.scan ? parseFloat(raw.scan) : null;
  const track = raw.track ? parseFloat(raw.track) : null;

  // Determine region based on coordinates (Delhi NCR check)
  const { bbox } = config.delhiNcr;
  const isInDelhiNcr =
    longitude >= bbox.west &&
    longitude <= bbox.east &&
    latitude >= bbox.south &&
    latitude <= bbox.north;


  return {
    source: 'FIRMS' as const,
    location: {
      type: 'Point' as const,
      coordinates: [longitude, latitude] as [number, number], // GeoJSON order
    },
    detectedAt,
    frp,
    brightness,
    brightnessTi5,
    confidence: raw.confidence,
    dayNight: raw.daynight?.toUpperCase() === 'D' ? 'D' : 'N',
    satellite: raw.satellite,
    instrument: raw.instrument || (raw.bright_ti4 ? 'VIIRS' : 'MODIS'),
    scan,
    track,
    version: raw.version || null,
    ingestedAt: new Date(),
    region: isInDelhiNcr ? 'delhi_ncr' : 'india',
    // Verbatim CSV row, kept for traceability back to the FIRMS product.
    rawSource: { ...raw } as unknown as Record<string, string>,
  };
}
