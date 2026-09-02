import type { StyleSpecification } from 'maplibre-gl';

export type MapBasemap = 'satellite' | 'light' | 'streets';

function raster(
  id: string,
  tiles: string[],
  attribution: string,
  maxzoom = 20
): StyleSpecification {
  return {
    version: 8,
    sources: {
      [id]: { type: 'raster', tiles, tileSize: 256, attribution },
    },
    layers: [{ id: `${id}-layer`, type: 'raster', source: id, minzoom: 0, maxzoom }],
  };
}

const CARTO = (variant: string) =>
  ['a', 'b', 'c', 'd'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/${variant}/{z}/{x}/{y}@2x.png`
  );

export const BASEMAP_STYLES: Record<MapBasemap, StyleSpecification> = {
  satellite: raster(
    'esri-sat',
    ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    '&copy; Esri, Earthstar Geographics'
  ),
  light: raster('carto-light', CARTO('light_all'), '&copy; OpenStreetMap &copy; CARTO'),
  streets: raster('carto-voyager', CARTO('voyager'), '&copy; OpenStreetMap &copy; CARTO'),
};

export const BASEMAP_META: Record<MapBasemap, { label: string; icon: string }> = {
  satellite: { label: 'Satellite', icon: 'satellite_alt' },
  light: { label: 'Light', icon: 'light_mode' },
  streets: { label: 'Streets', icon: 'map' },
};

/** Marker colouring strategy. FIRMS renders every detection in a uniform red. */
export type RenderMode = 'firms' | 'classified';

/** The uniform red FIRMS uses for thermal anomalies on its own products. */
export const FIRMS_RED = '#FF2D20';

export const OSM_CATEGORY_STYLE: Record<string, { color: string; icon: string; label: string }> = {
  industrial: { color: '#0A6C8C', icon: 'factory', label: 'Industrial' },
  power: { color: '#8A6100', icon: 'bolt', label: 'Power' },
  mining: { color: '#6B3FA0', icon: 'terrain', label: 'Mining' },
  oil_gas: { color: '#A24A05', icon: 'oil_barrel', label: 'Oil & gas' },
  forest: { color: '#1B6B3A', icon: 'forest', label: 'Forest' },
  agriculture: { color: '#5C7A1E', icon: 'agriculture', label: 'Agriculture' },
  urban: { color: '#5A6069', icon: 'apartment', label: 'Urban' },
  water: { color: '#1A6FA8', icon: 'water_drop', label: 'Water' },
  other: { color: '#5A6069', icon: 'place', label: 'Other' },
};

/** Points on a geodesic circle, used for the investigation perimeter ring. */
export function geodesicCircle(
  center: [number, number],
  radiusKm: number,
  points = 96
): [number, number][] {
  const [lng, lat] = center;
  const dx = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dy = radiusKm / 110.574;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * 2 * Math.PI;
    coords.push([lng + dx * Math.cos(t), lat + dy * Math.sin(t)]);
  }
  return coords;
}

/** Great-circle distance in metres. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
