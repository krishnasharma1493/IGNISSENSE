import { Facility, IFacility } from './facility.model';
import { fetchDelhiNcrOsmFacilities } from './osm.client';

export interface IngestFacilitiesResult {
  totalFetched: number;
  totalStored: number;
  totalUpdated: number;
  delhiNcrCount: number;
  retrievedAt: Date;
}

/**
 * Ingest real OpenStreetMap industrial facilities for Delhi NCR into MongoDB Atlas.
 */
export async function syncDelhiNcrOsmFacilities(): Promise<IngestFacilitiesResult> {
  console.log('[Facility Service] Starting OSM Overpass facility sync for Delhi NCR...');
  const facilities = await fetchDelhiNcrOsmFacilities();

  if (facilities.length > 0) {
    const ops = facilities.map((fac) => ({
      updateOne: {
        filter: { sourceId: fac.sourceId },
        update: { $set: fac },
        upsert: true,
      },
    }));

    console.log(`[Facility Service] Performing bulk upsert of ${ops.length} OSM facilities...`);
    await Facility.bulkWrite(ops as any, { ordered: false });
  }

  const totalInDb = await Facility.countDocuments({ region: 'delhi_ncr' });
  console.log(
    `[Facility Service] Sync complete. Ingested/updated: ${facilities.length}, Total in DB: ${totalInDb}`
  );

  return {
    totalFetched: facilities.length,
    totalStored: facilities.length,
    totalUpdated: 0,
    delhiNcrCount: totalInDb,
    retrievedAt: new Date(),
  };
}


/**
 * Find nearest industrial facility using fast geospatial 2dsphere indexing
 */
export async function findNearestFacility(
  lon: number,
  lat: number,
  maxDistanceMeters = 25000
): Promise<{ facility: IFacility | null; distanceMeters: number | null }> {
  try {
    const radiusRad = (maxDistanceMeters / 1000.0) / 6371.0;
    const nearby = await Facility.find({
      location: {
        $geoWithin: {
          $centerSphere: [[lon, lat], radiusRad],
        },
      },
    })
      .limit(5)
      .lean();

    if (nearby.length > 0) {
      let closestDist = Infinity;
      let closestFac: IFacility | null = null;

      for (const fac of nearby) {
        const dist = haversineMeters(
          lon,
          lat,
          fac.location.coordinates[0],
          fac.location.coordinates[1]
        );
        if (dist < closestDist) {
          closestDist = dist;
          closestFac = fac as unknown as IFacility;
        }
      }

      if (closestFac && closestDist <= maxDistanceMeters) {
        return { facility: closestFac, distanceMeters: closestDist };
      }
    }
  } catch (err: any) {
    console.warn('[Facility Service] Geo query notice:', err.message);
  }

  return { facility: null, distanceMeters: null };
}



export function haversineMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const R = 6371000;
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
