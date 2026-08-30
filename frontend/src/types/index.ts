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

// Classification display metadata
export const CLASS_CONFIG: Record<ClassificationClass, { label: string; color: string; icon: string }> = {
  industrial_fire: { label: 'Industrial Fire', color: '#EF4444', icon: '🏭' },
  gas_flare: { label: 'Gas Flare', color: '#F97316', icon: '🔥' },
  wildfire: { label: 'Wildfire', color: '#22C55E', icon: '🌲' },
  agricultural_burning: { label: 'Agricultural Burning', color: '#EAB308', icon: '🌾' },
  mining_thermal_activity: { label: 'Mining Thermal', color: '#A855F7', icon: '⛏️' },
  other_or_uncertain: { label: 'Uncertain', color: '#6B7280', icon: '❓' },
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

