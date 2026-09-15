import { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppBar from './components/AppBar';
import type { PageTab } from './components/AppBar';
import Panel from './components/ui/Panel';
import MapPage from './pages/MapPage';
import DashboardPage from './features/dashboard/DashboardPage';
import AnalyticsPage from './features/analytics/AnalyticsPage';
import AlertsPage from './features/alerts/AlertsPage';
import { useHotspots } from './api/hooks';
import { SearchProvider } from './context/SearchContext';
import type { SearchResultItem } from './context/SearchContext';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<PageTab>('map');
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { data: hotspotsData } = useHotspots({ limit: '5000' });
  const hotspots = hotspotsData?.hotspots ?? [];

  const investigate = (hotspotId: string) => {
    setSelectedHotspotId(hotspotId);
    setActiveTab('map');
  };

  const onSearchResult = (r: SearchResultItem) => {
    if (r.data?.hotspotId) setSelectedHotspotId(r.data.hotspotId);
    setActiveTab('map');
  };

  useEffect(() => {
    if (!exportOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExportOpen(false);
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen]);

  const stamp = new Date().toISOString().slice(0, 10);

  const exportGeoJson = () => {
    download(
      new Blob(
        [
          JSON.stringify(
            {
              type: 'FeatureCollection',
              metadata: {
                generatedAt: new Date().toISOString(),
                source: 'NASA FIRMS (VIIRS/MODIS) with OpenStreetMap enrichment',
                totalFeatures: hotspots.length,
              },
              features: hotspots.map((h) => ({
                type: 'Feature',
                geometry: h.location,
                properties: {
                  id: h._id,
                  detectedAt: h.detectedAt,
                  frp: h.frp,
                  brightness: h.brightness,
                  brightnessTi5: h.brightnessTi5,
                  satellite: h.satellite,
                  instrument: h.instrument,
                  confidence: h.confidence,
                  dayNight: h.dayNight,
                  region: h.region,
                },
              })),
            },
            null,
            2
          ),
        ],
        { type: 'application/geo+json' }
      ),
      `ignissense-detections-${stamp}.geojson`
    );
    setExportOpen(false);
  };

  const exportCsv = () => {
    const header =
      'id,longitude,latitude,detected_at,frp_mw,brightness_k,brightness_ti5_k,instrument,satellite,firms_confidence,day_night,region\n';
    // Null stays empty in the CSV rather than becoming a zero.
    const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    const rows = hotspots
      .map((h) =>
        [
          `"${h._id}"`,
          h.location.coordinates[0],
          h.location.coordinates[1],
          `"${h.detectedAt}"`,
          cell(h.frp),
          cell(h.brightness),
          cell(h.brightnessTi5),
          `"${cell(h.instrument)}"`,
          `"${cell(h.satellite)}"`,
          `"${cell(h.confidence)}"`,
          `"${cell(h.dayNight)}"`,
          `"${cell(h.region)}"`,
        ].join(',')
      )
      .join('\n');
    download(new Blob([header + rows], { type: 'text/csv' }), `ignissense-detections-${stamp}.csv`);
    setExportOpen(false);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas text-ink antialiased">
      {/* The map is the base layer and stays mounted, so returning to it never
          costs a re-initialisation of the WebGL context. */}
      <div className="absolute inset-0 z-0">
        <MapPage selectedHotspotId={selectedHotspotId} onSelectHotspot={setSelectedHotspotId} />
      </div>

      {activeTab !== 'map' ? (
        <div className="absolute inset-0 z-30 overflow-y-auto bg-canvas px-6 pb-8 pt-[68px]">
          {activeTab === 'dashboard' ? (
            <DashboardPage onInvestigate={investigate} onOpenMap={() => setActiveTab('map')} />
          ) : null}
          {activeTab === 'analytics' ? <AnalyticsPage onOpenMap={() => setActiveTab('map')} /> : null}
          {activeTab === 'alerts' ? <AlertsPage onInvestigate={investigate} /> : null}
        </div>
      ) : null}

      <AppBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSelectSearchResult={onSearchResult}
        onExport={() => setExportOpen(true)}
      />

      {exportOpen ? (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(15,18,22,0.35)] p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setExportOpen(false)}
        >
          <Panel
            level="popover"
            className="arrive w-full max-w-sm rounded-xl p-4"
          >
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1}>
              <h2 id="export-title" className="text-[14px] font-semibold text-ink">
                Export detections
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
                Observed FIRMS fields only. Model classifications are excluded — they are decision
                support, and exporting them alongside measurements invites them to be read as
                observations.
              </p>

              <p className="num mt-3 rounded-md border border-hairline bg-[rgba(15,18,22,0.035)] px-2.5 py-2 text-[11px] text-ink-2">
                {hotspots.length.toLocaleString()} detections in the current result set
              </p>

              <div className="mt-3 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={exportGeoJson}
                  className="ctl h-9 w-full justify-between border border-hairline px-3 text-[12px]"
                >
                  <span className="font-medium text-ink">GeoJSON</span>
                  <span className="text-[11px] text-ink-3">QGIS, ArcGIS</span>
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="ctl h-9 w-full justify-between border border-hairline px-3 text-[12px]"
                >
                  <span className="font-medium text-ink">CSV</span>
                  <span className="text-[11px] text-ink-3">Excel, R, pandas</span>
                </button>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setExportOpen(false)}
                  className="ctl h-7 px-3 text-[12px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SearchProvider>
        <AppContent />
      </SearchProvider>
    </QueryClientProvider>
  );
}
