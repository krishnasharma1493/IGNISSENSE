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
import { usePresence } from '../components/motion/usePresence';

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

  const {
    data: selectedHotspot,
    isLoading: hotspotLoading,
    isError: hotspotError,
  } = useHotspot(selectedHotspotId);
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

  /* ── Investigation panel presence ───────────────────────────────────────
     Presentation only; the queries above are untouched. While a newly
     selected detection is still loading, the previous one stays on screen,
     dimmed, inert and marked as loading (its body crossfades when the new one
     arrives), instead of the panel closing and reopening. If the new one fails
     to load, the panel closes. Once nothing is selected, the panel slides out
     with the content it last showed. */
  const panelData = useMemo(
    () =>
      selectedHotspot
        ? {
            hotspot: selectedHotspot,
            classification: selectedClassification ?? null,
            isLoading: hotspotLoading || classLoading,
            nearbyOsmFeatures,
            isNearbyOsmLoading: osmLoading,
          }
        : null,
    [selectedHotspot, selectedClassification, hotspotLoading, classLoading, nearbyOsmFeatures, osmLoading]
  );
  const [heldPanelData, setHeldPanelData] = useState(panelData);
  if (panelData && panelData !== heldPanelData) setHeldPanelData(panelData);
  if ((!selectedHotspotId || hotspotError) && heldPanelData) setHeldPanelData(null);
  const pendingPanelData = useMemo(
    () => (heldPanelData ? { ...heldPanelData, isLoading: true } : null),
    [heldPanelData]
  );
  const panelPending = Boolean(selectedHotspotId) && !panelData && pendingPanelData !== null;
  const panel = usePresence(
    selectedHotspotId && !hotspotError ? panelData ?? pendingPanelData : null,
    200
  );

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

      {panel.value ? (
        <InvestigationPanel
          hotspot={panel.value.hotspot}
          classification={panel.value.classification}
          isLoading={panel.value.isLoading}
          nearbyOsmFeatures={panel.value.nearbyOsmFeatures}
          isNearbyOsmLoading={panel.value.isNearbyOsmLoading}
          exiting={panel.exiting}
          pending={panelPending && !panel.exiting}
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
