import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapView from '../features/map/MapView';
import MapControls from '../features/map/MapControls';
import LayersDrawer from '../features/map/LayersDrawer';
import type { DrawerTab, MapFilters } from '../features/map/LayersDrawer';
import InvestigationPanel from '../features/hotspots/InvestigationPanel';
import type { MapBasemap, RenderMode } from '../features/map/basemaps';
import {
  useHotspots,
  useHotspot,
  useFacilities,
  useClassification,
  useNearbyOsmFeatures,
} from '../api/hooks';
import { CLASSIFICATION_CLASSES } from '../types';
import type { Classification, ClassificationClass } from '../types';
import { api } from '../api/client';
import { useSearch } from '../context/SearchContext';

interface MapPageProps {
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string | null) => void;
}

const WINDOW_MS: Record<MapFilters['timeRange'], number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  all: null,
};

export default function MapPage({ selectedHotspotId, onSelectHotspot }: MapPageProps) {
  /* Map presentation */
  const [basemap, setBasemap] = useState<MapBasemap>('satellite');
  const [renderMode, setRenderMode] = useState<RenderMode>('firms');
  const [showFacilities, setShowFacilities] = useState(false);
  const [showOsmContext, setShowOsmContext] = useState(true);
  const [linkedCount, setLinkedCount] = useState(6);

  /* Drawer */
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('layers');

  /* Filtering */
  const [visibleClasses, setVisibleClasses] = useState<Set<ClassificationClass>>(
    () => new Set(CLASSIFICATION_CLASSES)
  );
  const [filters, setFilters] = useState<MapFilters>({
    timeRange: '48h',
    minConfidence: 0,
    minPersistence: 0,
    minAnomaly: 0,
  });

  const { targetLocation, navigateToLocation } = useSearch();

  /* ── Data ───────────────────────────────────────────────────────────────── */
  const { data: hotspotsData } = useHotspots({ limit: '5000' });
  const allHotspots = useMemo(() => hotspotsData?.hotspots ?? [], [hotspotsData]);

  const { data: facilitiesData } = useFacilities({ limit: '1000' });
  const facilities = facilitiesData?.facilities ?? [];

  const { data: classificationsData } = useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: '5000' } });
      const map = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        for (const c of res.data.data.classifications as Classification[]) {
          map.set(c.hotspotId, c);
        }
      }
      return map;
    },
    staleTime: 30_000,
  });
  const classifications = useMemo(
    () => classificationsData ?? new Map<string, Classification>(),
    [classificationsData]
  );

  const { data: selectedHotspot, isLoading: hotspotLoading } = useHotspot(selectedHotspotId);
  const { data: selectedClassification, isLoading: classLoading } =
    useClassification(selectedHotspotId);

  const lng = selectedHotspot?.location.coordinates[0] ?? null;
  const lat = selectedHotspot?.location.coordinates[1] ?? null;
  const { data: osmData, isLoading: osmLoading } = useNearbyOsmFeatures(lng, lat, 20000);
  const nearbyOsmFeatures = useMemo(() => osmData?.features ?? [], [osmData]);

  /* Selecting a detection re-opens the network layer. Handled at the event
     rather than in an effect, so it cannot cascade an extra render. */
  const selectHotspot = (id: string | null) => {
    if (id) setShowOsmContext(true);
    onSelectHotspot(id);
  };

  /* The time-window cutoff is a clock read, so it is held in state and stepped
     on an interval matched to the hotspot refetch rather than being computed
     afresh on every render. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* ── Filtering ──────────────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    const span = WINDOW_MS[filters.timeRange];
    const cutoff = span === null ? null : now - span;

    return allHotspots.filter((h) => {
      if (cutoff !== null && new Date(h.detectedAt).getTime() < cutoff) return false;

      const c = classifications.get(h._id);
      const cls = c?.predictedClass ?? 'other_or_uncertain';
      if (!visibleClasses.has(cls)) return false;

      // Unclassified detections carry no scores, so a threshold above zero
      // excludes them rather than crediting them with an invented value.
      if (filters.minConfidence > 0 && (c?.confidence ?? 0) * 100 < filters.minConfidence) {
        return false;
      }
      if (filters.minPersistence > 0 && (c?.persistenceScore ?? 0) * 100 < filters.minPersistence) {
        return false;
      }
      if (filters.minAnomaly > 0 && (c?.anomalyScore ?? 0) * 100 < filters.minAnomaly) {
        return false;
      }
      return true;
    });
  }, [allHotspots, classifications, visibleClasses, filters, now]);

  const classCounts = useMemo(() => {
    const counts = Object.fromEntries(
      CLASSIFICATION_CLASSES.map((c) => [c, 0])
    ) as Record<ClassificationClass, number>;
    for (const h of allHotspots) {
      const cls = classifications.get(h._id)?.predictedClass ?? 'other_or_uncertain';
      counts[cls] += 1;
    }
    return counts;
  }, [allHotspots, classifications]);

  const toggleClass = (c: ClassificationClass) => {
    setVisibleClasses((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      <MapView
        hotspots={filtered}
        classifications={classifications}
        facilities={facilities}
        selectedHotspotId={selectedHotspotId}
        onHotspotSelect={selectHotspot}
        basemap={basemap}
        renderMode={renderMode}
        showFacilities={showFacilities}
        showOsmContext={showOsmContext}
        nearbyOsmFeatures={nearbyOsmFeatures}
        linkedCount={linkedCount}
        targetLocation={targetLocation}
      />

      {/* Map presentation controls — top-left, clear of the investigation panel */}
      <div className="absolute left-4 top-[60px] z-20">
        <MapControls
          basemap={basemap}
          onBasemapChange={setBasemap}
          renderMode={renderMode}
          onRenderModeChange={setRenderMode}
        />
      </div>

      {/* Layers, filters and feed — one surface, bottom-left */}
      <div className="absolute bottom-4 left-4 z-30">
        <LayersDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          classCounts={classCounts}
          visibleClasses={visibleClasses}
          onToggleClass={toggleClass}
          showFacilities={showFacilities}
          onToggleFacilities={() => setShowFacilities((v) => !v)}
          showOsmContext={showOsmContext}
          onToggleOsmContext={() => setShowOsmContext((v) => !v)}
          hasSelection={Boolean(selectedHotspotId)}
          filters={filters}
          onFiltersChange={setFilters}
          visibleCount={filtered.length}
          totalCount={allHotspots.length}
          hotspots={filtered}
          classifications={classifications}
          selectedHotspotId={selectedHotspotId}
          onSelectHotspot={selectHotspot}
        />
      </div>

      {selectedHotspot ? (
        <InvestigationPanel
          hotspot={selectedHotspot}
          classification={selectedClassification ?? null}
          isLoading={hotspotLoading || classLoading}
          nearbyOsmFeatures={nearbyOsmFeatures}
          isNearbyOsmLoading={osmLoading}
          linkedCount={linkedCount}
          onLinkedCountChange={setLinkedCount}
          onFocusFeature={(coordinates, label) =>
            navigateToLocation({ coordinates, label, zoom: 14 })
          }
          onClose={() => selectHotspot(null)}
        />
      ) : null}
    </div>
  );
}
