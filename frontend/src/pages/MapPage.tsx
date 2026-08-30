import { useState, useMemo, useEffect, useRef } from 'react';
import MapView from '../features/map/MapView';
import InvestigationPanel from '../features/hotspots/InvestigationPanel';
import { useHotspots, useHotspot, useFacilities, useClassification } from '../api/hooks';
import { CLASS_CONFIG, CLASSIFICATION_CLASSES, DELHI_NCR } from '../types';
import type { Classification, ClassificationClass } from '../types';
import { api } from '../api/client';
import { useQuery } from '@tanstack/react-query';
import { useSearch, parseCoordinates } from '../context/SearchContext';
import type { SearchResultItem } from '../context/SearchContext';

interface MapPageProps {
  initialSelectedHotspotId?: string | null;
  initialInvestigate?: boolean;
}

export default function MapPage({
  initialSelectedHotspotId = null,
  initialInvestigate = false,
}: MapPageProps) {
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(initialSelectedHotspotId);
  const [isInvestigating, setIsInvestigating] = useState<boolean>(initialInvestigate);
  const [selectedClasses, setSelectedClasses] = useState<Set<ClassificationClass>>(
    new Set(CLASSIFICATION_CLASSES)
  );
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [timeRange, setTimeRange] = useState<string>('48h');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Search system
  const { targetLocation, setTargetLocation, performSearch, navigateToLocation } = useSearch();
  const [localSearch, setLocalSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialSelectedHotspotId) {
      setSelectedHotspotId(initialSelectedHotspotId);
    }
  }, [initialSelectedHotspotId]);

  useEffect(() => {
    if (initialInvestigate && initialSelectedHotspotId) {
      setIsInvestigating(true);
    }
  }, [initialInvestigate, initialSelectedHotspotId]);

  // If targetLocation has a hotspotId, select it
  useEffect(() => {
    if (targetLocation?.hotspotId) {
      setSelectedHotspotId(targetLocation.hotspotId);
    }
  }, [targetLocation]);

  // Fetch real-time hotspots
  const { data: hotspotsData } = useHotspots({ limit: '1000' });
  const allHotspots = hotspotsData?.hotspots || [];

  // Fetch industrial facilities
  const { data: facilitiesData } = useFacilities({ limit: '1000' });
  const facilities = facilitiesData?.facilities || [];

  // Fetch details for selected hotspot
  const { data: selectedHotspot, isLoading: hotspotLoading } = useHotspot(selectedHotspotId);
  const { data: selectedClassification, isLoading: classLoading } = useClassification(selectedHotspotId);

  // Bulk fetch classifications
  const { data: allClassifications } = useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: '2000' } });
      const results = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        res.data.data.classifications.forEach((c: Classification) => {
          results.set(c.hotspotId, c);
        });
      }
      return results;
    },
    staleTime: 30000,
  });

  const classificationsMap = allClassifications || new Map<string, Classification>();

  // Filter hotspots based on user controls
  const filteredHotspots = useMemo(() => {
    return allHotspots.filter((h) => {
      const c = classificationsMap.get(h._id);
      const cls = c?.predictedClass || 'other_or_uncertain';
      if (!selectedClasses.has(cls)) return false;

      const conf = c ? Math.round(c.confidence * 100) : 50;
      if (conf < minConfidence) return false;

      return true;
    });
  }, [allHotspots, classificationsMap, selectedClasses, minConfidence]);

  // Map local search results
  const searchResults = useMemo(() => {
    return performSearch(localSearch, allHotspots, facilities, classificationsMap);
  }, [localSearch, allHotspots, facilities, classificationsMap, performSearch]);

  // Click outside to close tactical search dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExecuteSearch = () => {
    const q = localSearch.trim();
    if (!q) return;

    const coords = parseCoordinates(q);
    if (coords) {
      navigateToLocation({
        coordinates: coords,
        label: `Coordinates: ${coords[1].toFixed(4)}° N, ${coords[0].toFixed(4)}° E`,
        zoom: 14,
      });
      setIsSearchOpen(false);
      return;
    }

    if (searchResults.length > 0) {
      handleSelectSearchResult(searchResults[0]);
    }
  };

  const handleSelectSearchResult = (item: SearchResultItem) => {
    navigateToLocation({
      coordinates: item.coordinates,
      label: item.title,
      zoom: item.data?.zoom || 14,
      hotspotId: item.data?.hotspotId,
      facilityId: item.data?.facilityId,
    });
    if (item.data?.hotspotId) {
      setSelectedHotspotId(item.data.hotspotId);
    }
    setIsSearchOpen(false);
  };

  const handleMyLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          navigateToLocation({
            coordinates: [pos.coords.longitude, pos.coords.latitude],
            label: 'Your Current Location',
            zoom: 14,
          });
        },
        () => {
          navigateToLocation({
            coordinates: DELHI_NCR.center,
            label: 'Delhi NCR (Central)',
            zoom: DELHI_NCR.zoom,
          });
        }
      );
    } else {
      navigateToLocation({
        coordinates: DELHI_NCR.center,
        label: 'Delhi NCR (Central)',
        zoom: DELHI_NCR.zoom,
      });
    }
  };

  const toggleClass = (cls: ClassificationClass) => {
    const next = new Set(selectedClasses);
    if (next.has(cls)) {
      if (next.size > 1) next.delete(cls);
    } else {
      next.add(cls);
    }
    setSelectedClasses(next);
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Full-viewport map */}
      <MapView
        hotspots={filteredHotspots}
        facilities={facilities}
        classifications={classificationsMap}
        selectedHotspotId={selectedHotspotId}
        onHotspotSelect={(id) => {
          setSelectedHotspotId(id);
          setIsInvestigating(true);
        }}
        classFilter={null}
        targetLocation={targetLocation}
      />

      {/* Floating Right Column: Search + Filters + Quick Anomaly Card (when NOT in full investigation panel) */}
      {!isInvestigating && (
        <aside className="absolute top-[104px] right-6 z-40 w-80 flex flex-col gap-4 pointer-events-none">
          {/* Tactical Search Bar */}
          <div ref={searchContainerRef} className="glass-panel rounded-xl p-3.5 pointer-events-auto tech-border-glow relative">
            <div className="flex items-center gap-2 bg-surface-container-lowest/90 rounded-lg p-2 border border-outline-variant/60 transition-colors">
              <span className="material-symbols-outlined text-outline text-[18px]">search</span>
              <input
                value={localSearch}
                onChange={(e) => {
                  setLocalSearch(e.target.value);
                  setIsSearchOpen(true);
                }}
                onFocus={() => setIsSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleExecuteSearch();
                  if (e.key === 'Escape') setIsSearchOpen(false);
                }}
                className="bg-transparent border-none outline-none w-full text-on-surface font-label-sm placeholder:text-outline uppercase text-xs focus:ring-0 p-0"
                placeholder="COORDINATES / ASSET ID / FACILITY"
                type="text"
              />
              {localSearch && (
                <button
                  onClick={() => {
                    setLocalSearch('');
                    setIsSearchOpen(false);
                    setTargetLocation(null);
                  }}
                  className="text-outline hover:text-on-surface text-xs"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
              <button
                onClick={handleMyLocation}
                className="text-primary hover:text-primary-fixed ml-1"
                title="Locate / Center Position"
              >
                <span className="material-symbols-outlined text-[18px]">my_location</span>
              </button>
            </div>

            {/* Tactical Search Suggestions Dropdown */}
            {isSearchOpen && localSearch.trim() && (
              <div className="absolute left-0 right-0 top-full mt-2 glass-panel rounded-xl border border-outline-variant/60 shadow-2xl overflow-hidden max-h-80 overflow-y-auto z-50 bg-surface-container-low/95 backdrop-blur-xl">
                {searchResults.length === 0 ? (
                  <div className="p-3 text-center text-xs text-on-surface-variant font-label-sm">
                    No matching assets or coordinates.
                    <div className="text-[10px] text-outline mt-1 font-mono">
                      Try: &quot;28.6139, 77.2090&quot; or &quot;Refinery&quot; or &quot;Bawana&quot;
                    </div>
                  </div>
                ) : (
                  <div className="py-1.5">
                    <div className="px-3 py-1 text-[9px] font-bold font-mono uppercase text-outline tracking-wider">
                      Quick Matches ({searchResults.length})
                    </div>
                    {searchResults.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleSelectSearchResult(item)}
                        className="px-3 py-2 hover:bg-surface-container-high cursor-pointer flex items-center justify-between gap-2 border-b border-outline-variant/20 last:border-none transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="material-symbols-outlined text-[16px] text-primary flex-shrink-0">
                            {item.icon}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-on-surface truncate">{item.title}</div>
                            <div className="text-[10px] text-on-surface-variant truncate font-mono">{item.subtitle}</div>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono uppercase text-outline flex-shrink-0 px-1 py-0.5 rounded bg-surface-container border border-outline-variant/30">
                          {item.category.split(' ')[0]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Filters Toggle */}
          <div className="glass-panel rounded-xl pointer-events-auto overflow-hidden">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="w-full p-3 flex justify-between items-center hover:bg-surface-container-high/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-sm">filter_alt</span>
                <span className="font-label-sm text-xs text-on-surface uppercase tracking-widest">Data Filters</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-label-sm text-[10px] text-primary">{filteredHotspots.length} Visible</span>
                <span className="material-symbols-outlined text-on-surface-variant text-sm">
                  {showFilters ? 'expand_less' : 'expand_more'}
                </span>
              </div>
            </button>

            {showFilters && (
              <div className="px-4 pb-4 space-y-4 border-t border-outline-variant/30">
                {/* Time Range */}
                <div className="pt-3">
                  <label className="font-label-sm text-[10px] text-outline-variant uppercase block mb-2">
                    Time Range
                  </label>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-2 text-on-surface font-label-sm text-xs focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none"
                  >
                    <option value="24h">Last 24 Hours</option>
                    <option value="48h">Last 48 Hours (Live Passes)</option>
                    <option value="7d">Last 7 Days</option>
                  </select>
                </div>

                {/* Event Classifications Checkboxes */}
                <div>
                  <label className="font-label-sm text-[10px] text-outline-variant uppercase block mb-2">
                    Event Classifications
                  </label>
                  <div className="space-y-1.5">
                    {CLASSIFICATION_CLASSES.map((cls) => {
                      const cfg = CLASS_CONFIG[cls];
                      return (
                        <label
                          key={cls}
                          className="flex items-center gap-2 font-label-sm text-xs text-on-surface cursor-pointer select-none py-0.5"
                        >
                          <input
                            type="checkbox"
                            checked={selectedClasses.has(cls)}
                            onChange={() => toggleClass(cls)}
                            className="rounded border-outline-variant bg-surface-container-lowest text-primary focus:ring-primary cursor-pointer w-3.5 h-3.5"
                          />
                          <span
                            className="w-2 h-2 rounded-full shadow-[0_0_6px_currentColor]"
                            style={{ backgroundColor: cfg.color, color: cfg.color }}
                          />
                          <span>{cfg.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Confidence Slider */}
                <div className="pt-2 border-t border-outline-variant/30">
                  <div className="flex justify-between font-label-sm text-[10px] mb-2">
                    <span className="text-outline-variant uppercase">Min Confidence</span>
                    <span className="text-primary font-bold">{minConfidence}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="95"
                    step="5"
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(Number(e.target.value))}
                    className="w-full h-1 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Active Anomaly Details (Investigation Card) — only when a hotspot is selected */}
          {selectedHotspotId && selectedHotspot && (
            <div className="glass-panel rounded-xl pointer-events-auto overflow-hidden group shadow-2xl border border-primary/40">
              <div className="p-4 border-b border-outline-variant/50 flex justify-between items-center bg-surface-container/40">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-industrial-fire text-sm animate-pulse">emergency</span>
                  <h3 className="font-label-sm text-xs text-on-surface uppercase tracking-widest font-bold">Thermal Anomaly</h3>
                </div>
                <button
                  onClick={() => setSelectedHotspotId(null)}
                  className="text-on-surface-variant hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-outline-variant text-[10px] uppercase">FRP</span>
                    <span className="font-body-lg text-on-surface font-bold text-red-400">{selectedHotspot.frp?.toFixed(1) || 'N/A'} MW</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-outline-variant text-[10px] uppercase">Confidence</span>
                    <span className="font-body-lg text-tertiary font-bold">
                      {selectedClassification ? `${Math.round(selectedClassification.confidence * 100)}%` : selectedHotspot.confidence || 'N/A'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-label-sm text-outline-variant text-[10px] uppercase">Coordinates</span>
                  <span className="font-label-sm text-on-surface text-xs font-mono text-primary font-bold">
                    {selectedHotspot.location.coordinates[1].toFixed(4)}° N, {selectedHotspot.location.coordinates[0].toFixed(4)}° E
                  </span>
                </div>
                {selectedClassification && (
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-outline-variant text-[10px] uppercase">Classification</span>
                    <span className="font-label-sm text-primary text-xs uppercase tracking-wider font-extrabold flex items-center gap-1.5">
                      <span>{CLASS_CONFIG[selectedClassification.predictedClass]?.icon || '🔥'}</span>
                      <span>{CLASS_CONFIG[selectedClassification.predictedClass]?.label || selectedClassification.predictedClass}</span>
                    </span>
                  </div>
                )}
                {/* Mini Chart */}
                <div className="h-16 w-full border border-outline-variant/30 rounded flex items-end px-1 gap-1 pt-4 relative bg-black/40">
                  <span className="absolute top-1 left-2 font-label-sm text-[8px] text-outline-variant uppercase font-mono">Thermal Trend - 2H</span>
                  <div className="w-1/6 bg-primary/20 h-[20%] rounded-t-sm" />
                  <div className="w-1/6 bg-primary/30 h-[30%] rounded-t-sm" />
                  <div className="w-1/6 bg-primary/40 h-[45%] rounded-t-sm" />
                  <div className="w-1/6 bg-tertiary/60 h-[70%] rounded-t-sm" />
                  <div className="w-1/6 bg-industrial-fire/80 h-[90%] rounded-t-sm" />
                  <div className="w-1/6 bg-industrial-fire h-[100%] rounded-t-sm shadow-[0_0_8px_#ef4444]" />
                </div>
                {/* Active Working Investigate Button */}
                <button
                  onClick={() => setIsInvestigating(true)}
                  className="w-full mt-2 py-2.5 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 hover:border-primary rounded-xl font-label-sm text-xs uppercase font-extrabold transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(112,210,255,0.2)] cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-[18px]">precision_manufacturing</span>
                  <span>Investigate</span>
                </button>
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Full Multi-Sensor Investigation Dossier Panel */}
      {isInvestigating && selectedHotspot && (
        <InvestigationPanel
          hotspot={selectedHotspot}
          classification={selectedClassification || null}
          isLoading={hotspotLoading || classLoading}
          onClose={() => setIsInvestigating(false)}
        />
      )}

      {/* Floating Legend (bottom-left, above the footer) */}
      <div className="absolute bottom-24 left-24 z-30 glass-panel rounded-xl p-4 w-48 pointer-events-auto">
        <h3 className="font-label-sm text-[10px] text-on-surface uppercase tracking-widest mb-3 pb-2 border-b border-outline-variant/30">
          Legend
        </h3>
        <ul className="space-y-2 font-label-sm text-[11px] text-on-surface-variant">
          <li className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-industrial-fire shadow-[0_0_8px_rgba(255,75,75,0.6)]" />
            <span>Industrial Fire</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-gas-flare shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            <span>Gas Flare</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-wildfire shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
            <span>Wildfire</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-agri shadow-[0_0_8px_rgba(250,204,21,0.6)]" />
            <span>Agricultural</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-mining shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
            <span>Mining / Quarry</span>
          </li>
          <li className="flex items-center gap-2 mt-2 pt-2 border-t border-outline-variant/30">
            <span className="material-symbols-outlined text-[14px] text-tertiary">factory</span>
            <span>Facility (OSM)</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
