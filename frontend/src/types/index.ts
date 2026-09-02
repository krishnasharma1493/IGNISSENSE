/**
 * Shared TypeScript types matching backend API contracts.
 */

export const CLASSIFICATION_CLASSES = [
  'industrial_fire',
  'gas_flare',
  'wildfire',
  'agricultural_burning',
  'mining_thermal_activity',
  'other_or_uncertain',
] as const;

export type ClassificationClass = typeof CLASSIFICATION_CLASSES[number];

export interface Hotspot {
  _id: string;
  source: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  detectedAt: string;
  frp: number | null;
  brightness: number | null;
  brightnessTi5: number | null;
  confidence: string | number;
  dayNight: string;
  satellite: string;
  instrument: string;
  scan: number | null;
  track: number | null;
  version: string | null;
  ingestedAt: string;
  region: string;
}

export interface Facility {
  _id: string;
  source: string;
  sourceId: string;
  name: string;
  facilityType: string;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  tags: Record<string, string>;
  region: string;
}

export interface OsmFeature {
  _id: string;
  sourceId: string;
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  name: string;
  featureCategory: 'industrial' | 'oil_gas' | 'mining' | 'power' | 'forest' | 'agriculture' | 'urban' | 'water' | 'other' | string;
  featureSubcategory: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  latitude: number;
  longitude: number;
  industrialType?: string;
  facilityType?: string;
  landUse?: string;
  naturalType?: string;
  operator?: string;
  distance_m?: number;
  region?: string;
}

export interface Classification {
  _id: string;
  hotspotId: string;
  predictedClass: ClassificationClass;
  confidence: number;
  classProbabilities: Record<ClassificationClass, number>;
  persistenceScore: number;
  anomalyScore: number;
  nearestFacilityId: Facility | null;
  facilityDistanceMeters: number | null;
  landCover: string;
  explanation: string[];
  modelVersion: string;
  createdAt: string;
}

export interface Alert {
  _id: string;
  hotspotId: Hotspot | string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
}

export interface AnalyticsSummary {
  totalHotspots: number;
  classifications: Record<ClassificationClass, number>;
  persistentSources: number;
  anomalousSources: number;
  openAlerts: number;
  regions: {
    delhi_ncr: number;
    india_supplementary: number;
  };
  lastDataUpdate: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/**
 * Classification display metadata.
 *
 * Each class carries two colours rather than one. `ink` is dark enough to clear
 * 4.5:1 on the light glass material and is used for panel text, legends, chips
 * and bars. `mark` is the vivid variant used only for map markers, which sit on
 * satellite imagery rather than on the material. Using `mark` inside a panel or
 * `ink` on the map will look wrong in both directions.
 *
 * `icon` is a Material Symbols ligature. Emoji are not used as icons anywhere.
 */
export interface ClassDisplay {
  label: string;
  /** Legible on light glass — panels, legends, chips, text. */
  ink: string;
  /** Vivid — map markers over imagery only. */
  mark: string;
  /** Material Symbols ligature name. */
  icon: string;
}

export const CLASS_CONFIG: Record<ClassificationClass, ClassDisplay> = {
  industrial_fire: {
    label: 'Industrial Fire',
    ink: '#B3261E',
    mark: '#FF3B30',
    icon: 'factory',
  },
  gas_flare: {
    label: 'Gas Flare',
    ink: '#A24A05',
    mark: '#FF8A00',
    icon: 'local_fire_department',
  },
  wildfire: {
    label: 'Wildfire',
    ink: '#1B6B3A',
    mark: '#34C759',
    icon: 'forest',
  },
  agricultural_burning: {
    label: 'Agricultural Burning',
    ink: '#8A6100',
    mark: '#FFCC00',
    icon: 'agriculture',
  },
  mining_thermal_activity: {
    label: 'Mining Thermal',
    ink: '#6B3FA0',
    mark: '#AF52DE',
    icon: 'terrain',
  },
  other_or_uncertain: {
    label: 'Uncertain',
    ink: '#5A6069',
    mark: '#8E8E93',
    icon: 'help',
  },
};

// Delhi NCR bounds
export const DELHI_NCR = {
  center: [77.2, 28.6] as [number, number],
  bbox: { west: 76.8, south: 28.3, east: 77.6, north: 28.9 },
  zoom: 10,
};

// Pan-India bounds
export const ALL_INDIA = {
  center: [78.9629, 20.5937] as [number, number],
  bbox: { west: 68.0, south: 6.5, east: 97.5, north: 37.5 },
  zoom: 4.8,
};

