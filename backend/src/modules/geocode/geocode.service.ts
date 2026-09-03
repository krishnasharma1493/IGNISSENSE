import axios from 'axios';
import { config } from '../../config';
import { GeocodeCache } from './geocode.model';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export interface PlaceResult {
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
  attribution: string;
  cached: boolean;
}

/** ~100 m cells. Hotspot coordinates are far more precise than place names are. */
export function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

// Serialise every outbound call; the OSM policy allows at most one per second.
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, config.nominatim.minIntervalMs - (Date.now() - lastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Shape for the wire response, whether the source was a cache hit or a fresh Nominatim call. */
interface PlaceFields {
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
}

/**
 * The single place this response shape is assembled, so a cache hit and a cache
 * miss can never drift apart into different key sets again.
 */
export function toPlaceResult(doc: PlaceFields, cached: boolean): PlaceResult {
  return {
    locality: doc.locality,
    city: doc.city,
    district: doc.district,
    state: doc.state,
    country: doc.country,
    displayName: doc.displayName,
    attribution: OSM_ATTRIBUTION,
    cached,
  };
}

export async function reverseGeocode(lat: number, lon: number): Promise<PlaceResult> {
  const key = cacheKey(lat, lon);

  const hit = await GeocodeCache.findOne({ key }).lean();
  if (hit) {
    return toPlaceResult(hit, true);
  }

  const res = await schedule(() =>
    axios.get(`${config.nominatim.baseUrl}/reverse`, {
      params: { lat, lon, format: 'jsonv2', zoom: 14, addressdetails: 1 },
      headers: { 'User-Agent': config.nominatim.userAgent },
      timeout: 8000,
    })
  );

  const a = res.data?.address ?? {};
  // Each level is omitted when Nominatim does not supply it — never guessed.
  const doc = {
    key, latitude: lat, longitude: lon,
    locality: a.village ?? a.hamlet ?? a.suburb ?? null,
    city: a.city ?? a.town ?? a.municipality ?? null,
    district: a.state_district ?? a.county ?? null,
    state: a.state ?? null,
    country: a.country ?? null,
    displayName: res.data?.display_name ?? null,
    fetchedAt: new Date(),
  };

  await GeocodeCache.updateOne({ key }, doc, { upsert: true });

  return toPlaceResult(doc, false);
}
