import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import type { Hotspot, Facility, Classification } from '../types';

export interface SearchResultItem {
  id: string;
  type: 'coordinate' | 'hotspot' | 'facility' | 'region' | 'classification';
  title: string;
  subtitle: string;
  coordinates: [number, number]; // [lng, lat]
  icon: string;
  category: string;
  data?: any;
}

export interface TargetLocation {
  coordinates: [number, number]; // [lng, lat]
  label: string;
  zoom?: number;
  hotspotId?: string;
  facilityId?: string;
}

interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  targetLocation: TargetLocation | null;
  setTargetLocation: (target: TargetLocation | null) => void;
  performSearch: (
    query: string,
    hotspots: Hotspot[],
    facilities: Facility[],
    classifications: Map<string, Classification>
  ) => SearchResultItem[];
  navigateToLocation: (target: TargetLocation) => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

const PRESET_REGIONS: Array<{ name: string; aliases: string[]; coordinates: [number, number]; zoom: number }> = [
  { name: 'Delhi NCR (Central)', aliases: ['delhi', 'ncr', 'new delhi', 'central delhi', 'connaught place'], coordinates: [77.2090, 28.6139], zoom: 11 },
  { name: 'Noida / Greater Noida', aliases: ['noida', 'greater noida', 'gautam buddha nagar'], coordinates: [77.3910, 28.5355], zoom: 12.5 },
  { name: 'Gurugram Industrial Hub', aliases: ['gurugram', 'gurgaon', 'manesar', 'udyog vihar'], coordinates: [77.0266, 28.4595], zoom: 12.5 },
  { name: 'Faridabad Industrial Zone', aliases: ['faridabad', 'ballabhgarh', 'nit faridabad'], coordinates: [77.3178, 28.4089], zoom: 12.5 },
  { name: 'Ghaziabad / Sahibabad', aliases: ['ghaziabad', 'sahibabad', 'loni', 'modinagar'], coordinates: [77.4538, 28.6692], zoom: 12.5 },
  { name: 'Sonipat / Kundli RIICO', aliases: ['sonipat', 'sonepat', 'kundli', 'murthal', 'rai industrial'], coordinates: [77.0151, 28.9931], zoom: 12 },
  { name: 'Bawana Industrial Area', aliases: ['bawana', 'narela', 'dsiidc bawana'], coordinates: [77.0378, 28.7957], zoom: 13.5 },
  { name: 'Okhla Industrial Area', aliases: ['okhla', 'okhla phase', 'nehru place', 'badarpur'], coordinates: [77.2789, 28.5355], zoom: 13.5 },
];

export function parseCoordinates(query: string): [number, number] | null {
  const cleaned = query.trim().replace(/[°NSEWnsew]/g, '');
  
  // Format: "lat, lng" or "lat lng" (e.g., 28.6139, 77.2090 or 77.2090, 28.6139)
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const num1 = parseFloat(match[1]);
  const num2 = parseFloat(match[2]);

  if (isNaN(num1) || isNaN(num2)) return null;

  // In India: Latitude is ~8-37°N, Longitude is ~68-98°E
  // If first number is lat (~20-35) and second is lng (~70-90):
  if (num1 >= -90 && num1 <= 90 && num2 >= -180 && num2 <= 180) {
    if (num1 < 40 && num2 > 60) {
      // num1 = lat, num2 = lng -> return [lng, lat]
      return [num2, num1];
    }
    if (num2 < 40 && num1 > 60) {
      // num1 = lng, num2 = lat -> return [num1, num2]
      return [num1, num2];
    }
    // Default fallback: assume lat, lng order
    return [num2, num1];
  }
  return null;
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [targetLocation, setTargetLocation] = useState<TargetLocation | null>(null);

  const navigateToLocation = useCallback((target: TargetLocation) => {
    setTargetLocation(target);
  }, []);

  const performSearch = useCallback(
    (
      query: string,
      hotspots: Hotspot[],
      facilities: Facility[],
      classifications: Map<string, Classification>
    ): SearchResultItem[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];

      const results: SearchResultItem[] = [];

      // 1. Direct coordinate match
      const parsedCoords = parseCoordinates(q);
      if (parsedCoords) {
        results.push({
          id: `coord-${parsedCoords[0]}-${parsedCoords[1]}`,
          type: 'coordinate',
          title: `Fly to Coordinates`,
          subtitle: `${parsedCoords[1].toFixed(4)}° N, ${parsedCoords[0].toFixed(4)}° E`,
          coordinates: parsedCoords,
          icon: 'location_searching',
          category: 'Coordinates',
        });
      }

      // 2. Preset Regions / Municipalities / Industrial Belts
      for (const region of PRESET_REGIONS) {
        if (
          region.name.toLowerCase().includes(q) ||
          region.aliases.some((alias) => alias.includes(q) || q.includes(alias))
        ) {
          results.push({
            id: `region-${region.name}`,
            type: 'region',
            title: region.name,
            subtitle: `Geospatial Focus Area • ${region.coordinates[1].toFixed(4)}° N, ${region.coordinates[0].toFixed(4)}° E`,
            coordinates: region.coordinates,
            icon: 'domain',
            category: 'Regions & Industrial Zones',
            data: { zoom: region.zoom },
          });
        }
      }

      // 3. Hotspots / Thermal Events Search (by ID, Event Code, FRP, Satellite)
      let hotspotMatches = 0;
      for (const h of hotspots) {
        if (hotspotMatches >= 6) break;
        const hId = h._id.toLowerCase();
        const eventCode = `evt-${h._id.slice(-4).toLowerCase()}`;
        const hsCode = `hs-${h._id.slice(-4).toLowerCase()}`;
        const classification = classifications.get(h._id);
        const clsName = classification?.predictedClass.replace(/_/g, ' ').toLowerCase() || '';

        if (
          hId.includes(q) ||
          eventCode.includes(q) ||
          hsCode.includes(q) ||
          clsName.includes(q) ||
          h.satellite.toLowerCase().includes(q) ||
          h.instrument.toLowerCase().includes(q) ||
          h.region.toLowerCase().includes(q)
        ) {
          const [lng, lat] = h.location.coordinates;
          const conf = classification ? `${Math.round(classification.confidence * 100)}%` : `${h.confidence || 0}%`;
          results.push({
            id: h._id,
            type: 'hotspot',
            title: `Thermal Hotspot ${h._id.slice(-6).toUpperCase()}`,
            subtitle: `${(classification?.predictedClass || 'Thermal Observation').replace(/_/g, ' ')} • FRP: ${h.frp?.toFixed(1) || '0'} MW • ${conf} Conf`,
            coordinates: [lng, lat],
            icon: 'local_fire_department',
            category: 'Thermal Events (Hotspots)',
            data: { hotspotId: h._id, zoom: 14 },
          });
          hotspotMatches++;
        }
      }

      // 4. OSM Facilities Search (by name, type, sourceId, tags)
      let facilityMatches = 0;
      for (const fac of facilities) {
        if (facilityMatches >= 6) break;
        const facName = (fac.name || '').toLowerCase();
        const facType = (fac.facilityType || '').replace(/_/g, ' ').toLowerCase();
        const sourceId = (fac.sourceId || '').toLowerCase();

        if (facName.includes(q) || facType.includes(q) || sourceId.includes(q)) {
          const [lng, lat] = fac.location.coordinates;
          results.push({
            id: fac._id,
            type: 'facility',
            title: fac.name || 'Industrial Facility',
            subtitle: `${(fac.facilityType || 'Industrial').replace(/_/g, ' ')} • OSM Infrastructure`,
            coordinates: [lng, lat],
            icon: 'factory',
            category: 'Industrial Facilities (OSM)',
            data: { facilityId: fac._id, zoom: 14.5 },
          });
          facilityMatches++;
        }
      }

      return results;
    },
    []
  );

  const value = useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      targetLocation,
      setTargetLocation,
      performSearch,
      navigateToLocation,
    }),
    [searchQuery, targetLocation, performSearch, navigateToLocation]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
