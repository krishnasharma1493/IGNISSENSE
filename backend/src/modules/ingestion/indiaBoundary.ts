import boundary from '../../data/india_boundary.json';

/**
 * India coverage boundary for FIRMS ingestion.
 *
 * FIRMS is queried with a rectangle (68–97.5°E, 6.5–37.5°N) that also covers Sri
 * Lanka, Pakistan, Nepal, Bangladesh, Myanmar and parts of China. Those detections
 * have no OSM context, fall outside the problem statement, and were being stored
 * and shown as unclassified. Ingestion keeps only points inside this polygon.
 *
 * Source: Natural Earth 10 m admin-0 countries, India point of view
 * (ne_10m_admin_0_countries_ind), so the boundary follows India's official claims
 * — Pakistan-administered Kashmir and Aksai Chin are inside. Simplified to 0.002°
 * (99.999% of the original area retained).
 */

type Ring = number[][];
type Polygon = Ring[];

interface PreparedPolygon {
  rings: Polygon;
  west: number;
  south: number;
  east: number;
  north: number;
}

const geometry = boundary.geometry as { type: string; coordinates: unknown };
const polygons: Polygon[] =
  geometry.type === 'MultiPolygon'
    ? (geometry.coordinates as Polygon[])
    : [geometry.coordinates as Polygon];

const prepared: PreparedPolygon[] = polygons.map((rings) => {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of rings[0]) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  return { rings, west, south, east, north };
});

export const INDIA_BOUNDARY_SOURCE: string = boundary.properties.source;

/** Even-odd ray casting. */
function ringContains(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function isInsideIndia(longitude: number, latitude: number): boolean {
  for (const p of prepared) {
    if (longitude < p.west || longitude > p.east || latitude < p.south || latitude > p.north) continue;
    if (!ringContains(p.rings[0], longitude, latitude)) continue;
    // Inside the outer ring; a hole containing the point excludes it.
    let inHole = false;
    for (let h = 1; h < p.rings.length; h++) {
      if (ringContains(p.rings[h], longitude, latitude)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}
