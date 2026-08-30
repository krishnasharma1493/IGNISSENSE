import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SideNavBar from './components/SideNavBar';
import type { PageTab } from './components/SideNavBar';
import TopNavBar from './components/TopNavBar';
import Footer from './components/Footer';
import MapPage from './pages/MapPage';
import DashboardPage from './features/dashboard/DashboardPage';
import AlertsPage from './features/alerts/AlertsPage';
import { useHotspots, useAlerts } from './api/hooks';
import { SearchProvider } from './context/SearchContext';
import type { SearchResultItem } from './context/SearchContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
});

function AppContent() {
  const [activeTab, setActiveTab] = useState<PageTab>('map');
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);

  const { data: hotspotsData } = useHotspots({ limit: '1000' });
  const { data: alertsData } = useAlerts({ status: 'open' });

  const handleInvestigateHotspot = (hotspotId: string) => {
    setSelectedHotspotId(hotspotId);
    setActiveTab('map');
  };

  const handleSelectSearchResult = (result: SearchResultItem) => {
    if (result.data?.hotspotId) {
      setSelectedHotspotId(result.data.hotspotId);
    }
    setActiveTab('map');
  };

  const handleExportGeoJson = () => {
    const hotspots = hotspotsData?.hotspots || [];
    const geoJson = {
      type: 'FeatureCollection',
      metadata: {
        generatedAt: new Date().toISOString(),
        region: 'Delhi NCR Focus',
        source: 'NASA FIRMS VIIRS/MODIS + OpenStreetMap Enrichment',
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
          satellite: h.satellite,
          instrument: h.instrument,
          confidence: h.confidence,
          region: h.region,
        },
      })),
    };

    const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ignissense-delhincr-hotspots-${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    setShowExportModal(false);
  };

  const handleExportCsv = () => {
    const hotspots = hotspotsData?.hotspots || [];
    const headers = 'ID,Longitude,Latitude,DetectedAt,FRP_MW,Brightness_K,Instrument,Satellite,Confidence,Region\n';
    const rows = hotspots
      .map(
        (h) =>
          `"${h._id}",${h.location.coordinates[0]},${h.location.coordinates[1]},"${h.detectedAt}",${h.frp || 0},${h.brightness || 0},"${h.instrument}","${h.satellite}","${h.confidence}","${h.region}"`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ignissense-delhincr-hotspots-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setShowExportModal(false);
  };

  return (
    <div className="bg-background text-on-surface h-screen w-screen overflow-hidden relative font-body-md text-body-md antialiased">
      {/* Map layer is always rendered as the base layer (z-0) */}
      <div className="absolute inset-0 z-0">
        <MapPage
          initialSelectedHotspotId={selectedHotspotId}
          initialInvestigate={!!selectedHotspotId}
        />
      </div>


      {/* Floating UI Layer */}
      <TopNavBar
        selectedRegion="Delhi NCR"
        onSelectSearchResult={handleSelectSearchResult}
      />
      <SideNavBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExportDossier={() => setShowExportModal(true)}
      />

      {/* Overlay pages (Dashboard/Alerts/Analytics) slide over the map */}
      {activeTab !== 'map' && (
        <div
          className={`absolute inset-0 z-30 overflow-auto pt-24 pl-24 pb-20 pr-6 transition-colors duration-200 ${
            activeTab === 'alerts'
              ? 'bg-[#F8F9FA]/95 backdrop-blur-xl'
              : 'bg-background/90 backdrop-blur-sm'
          }`}
        >
          {activeTab === 'dashboard' && (

            <DashboardPage onNavigateToMap={(hId) => (hId ? handleInvestigateHotspot(hId) : setActiveTab('map'))} />
          )}
          {activeTab === 'alerts' && (
            <AlertsPage
              onInvestigateHotspot={handleInvestigateHotspot}
              onNavigateToMap={(hId) => (hId ? handleInvestigateHotspot(hId) : setActiveTab('map'))}
            />
          )}
          {activeTab === 'analytics' && (
            <DashboardPage onNavigateToMap={(hId) => (hId ? handleInvestigateHotspot(hId) : setActiveTab('map'))} />
          )}
        </div>
      )}

      <Footer />

      {/* Export Incident Dossier Modal (PRD Compliant) */}
      {showExportModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel rounded-xl p-6 max-w-md w-full shadow-2xl border border-outline-variant/50">
            <div className="flex items-center gap-3 text-primary mb-3">
              <span className="material-symbols-outlined text-[24px]">download</span>
              <h3 className="font-headline-md text-[20px] font-black text-on-surface">Export Incident Dossier</h3>
            </div>
            <p className="font-body-md text-on-surface-variant text-[14px] mb-4 leading-relaxed">
              Export verified NASA satellite detections and spatial intelligence for offline GIS analysis, SDMA briefings, or regulatory reporting.
            </p>
            <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/30 font-label-sm text-on-surface mb-4">
              <div className="flex justify-between py-1 border-b border-outline-variant/20">
                <span className="text-on-surface-variant text-xs uppercase">Active Observations</span>
                <span className="font-bold text-primary font-mono">{hotspotsData?.count || 0} Events</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-on-surface-variant text-xs uppercase">AI Alert Candidates</span>
                <span className="font-bold text-tertiary font-mono">{alertsData?.count || 0} Alerts</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 mb-4">
              <button
                onClick={handleExportGeoJson}
                className="w-full py-2.5 px-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 text-left flex items-center justify-between text-sm transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">public</span>
                  <span className="font-semibold text-on-surface">Standard GeoJSON (.geojson)</span>
                </div>
                <span className="text-xs text-outline">For QGIS / ArcGIS</span>
              </button>
              <button
                onClick={handleExportCsv}
                className="w-full py-2.5 px-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 text-left flex items-center justify-between text-sm transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-[18px]">table_chart</span>
                  <span className="font-semibold text-on-surface">Tabular Dataset (.csv)</span>
                </div>
                <span className="text-xs text-outline">For Excel / R</span>
              </button>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 rounded-lg border border-outline-variant/50 text-on-surface hover:bg-surface-container-high text-sm font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
