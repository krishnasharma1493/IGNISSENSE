import { useState, useRef, useEffect } from 'react';
import { useSyncFirms, useAnalyticsSummary, useHotspots, useFacilities, useSystemStatus } from '../api/hooks';
import { useSearch } from '../context/SearchContext';
import type { SearchResultItem } from '../context/SearchContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Classification } from '../types';

interface TopNavBarProps {
  selectedRegion?: string;
  onRegionChange?: (region: string) => void;
  onSelectSearchResult?: (result: SearchResultItem) => void;
}

export default function TopNavBar({
  selectedRegion = 'Delhi NCR',
  onSelectSearchResult,
}: TopNavBarProps) {
  const syncMutation = useSyncFirms();
  const { data: analytics } = useAnalyticsSummary();
  const { data: systemStatus } = useSystemStatus();
  const { searchQuery, setSearchQuery, performSearch, navigateToLocation } = useSearch();


  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Hotspots and facilities for search auto-complete
  const { data: hotspotsData } = useHotspots({ limit: '1000' });
  const { data: facilitiesData } = useFacilities({ limit: '1000' });
  const hotspots = hotspotsData?.hotspots || [];
  const facilities = facilitiesData?.facilities || [];

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

  // Global search suggestions
  const searchResults = performSearch(searchQuery, hotspots, facilities, classificationsMap);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: Cmd+K or /
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSyncLiveFirms = async () => {
    try {
      await syncMutation.mutateAsync({ scope: 'india', dayRange: 2 });
    } catch (e: any) {
      console.error('Live sync error:', e.message);
    }
  };

  const handleSelectResult = (result: SearchResultItem) => {
    navigateToLocation({
      coordinates: result.coordinates,
      label: result.title,
      zoom: result.data?.zoom || 14,
      hotspotId: result.data?.hotspotId,
      facilityId: result.data?.facilityId,
    });
    if (onSelectSearchResult) {
      onSelectSearchResult(result);
    }
    setIsOpen(false);
  };

  return (
    <header className="absolute top-5 left-6 right-6 z-50 flex justify-between items-center liquid-glass-structural rounded-2xl px-6 h-16 pointer-events-auto">
      {/* Brand */}
      <div className="flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-xl liquid-glass-interactive flex items-center justify-center p-1.5 shadow-inner border border-white/20 bg-slate-950/40">
          <img
            src="/logo-white.png"
            alt="IGNISSENSE Logo"
            className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]"
          />
        </div>
        <div>
          <h1 className="sf-headline font-black text-on-surface tracking-tight text-sm leading-none flex items-center gap-1.5">
            IGNISSENSE
          </h1>
          <div className="sf-metadata text-[10px] text-outline font-semibold uppercase tracking-wider mt-0.5">
            {selectedRegion} • GIS WORKSTATION
          </div>
        </div>
      </div>

      {/* Center: Global Search Bar */}
      <div ref={containerRef} className="relative w-80 md:w-96 lg:w-[460px]">
        <div className="flex items-center gap-2 liquid-glass-interactive rounded-full px-4 py-2 focus-within:border-white/40 focus-within:ring-2 focus-within:ring-white/10 transition-all">
          <span className="material-symbols-outlined text-outline text-[18px]">search</span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search coordinates, facilities, hotspots, regions..."
            className="bg-transparent border-none outline-none w-full text-xs text-on-surface placeholder:text-outline/70 font-medium sf-subhead"
          />
          {searchQuery ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setIsOpen(false);
              }}
              className="text-outline hover:text-white p-0.5 rounded-full"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          ) : (
            <span className="hidden sm:inline-block text-[10px] font-mono text-outline/80 bg-white/5 px-2 py-0.5 rounded-md border border-white/10">
              ⌘K
            </span>
          )}
        </div>

        {/* Global Search Suggestions Dropdown */}
        {isOpen && searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-2.5 liquid-glass-contextual rounded-2xl overflow-hidden max-h-96 overflow-y-auto z-[60]">
            {searchResults.length === 0 ? (
              <div className="p-5 text-center text-xs text-on-surface-variant sf-subhead">
                No matching coordinates, facilities, or hotspots found.
                <div className="text-[11px] text-outline mt-1 font-mono">
                  Tip: Enter coords like &quot;28.6139, 77.2090&quot; or facility names like &quot;Refinery&quot;
                </div>
              </div>
            ) : (
              <div className="py-2">
                <div className="px-4 py-1 text-[10px] font-bold font-mono uppercase text-outline tracking-wider">
                  Suggestions ({searchResults.length})
                </div>
                {searchResults.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectResult(item)}
                    className="px-4 py-2.5 hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3 border-b border-white/5 last:border-none transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg liquid-glass-interactive flex items-center justify-center text-primary flex-shrink-0">
                        <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-on-surface truncate sf-headline">{item.title}</div>
                        <div className="text-[11px] text-on-surface-variant truncate sf-subhead">{item.subtitle}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono uppercase text-outline flex-shrink-0 px-2 py-0.5 rounded bg-white/5 border border-white/10">
                      {item.category.split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trailing Actions & NASA FIRMS Sync */}
      <div className="flex items-center gap-2.5">
        {/* Prominent Glowing LIVE INDIA Button */}
        <button
          onClick={() => {
            navigateToLocation({
              coordinates: [78.9629, 20.5937],
              label: 'Pan-India NASA FIRMS Live Fire Stream',
              zoom: 4.8,
            });
            if (onSelectSearchResult) {
              onSelectSearchResult({
                id: 'live-india-focus',
                type: 'region',
                title: 'Pan-India NASA FIRMS Live Stream',
                subtitle: `${analytics?.totalHotspots || 805} Active Fires Detected Across India`,
                coordinates: [78.9629, 20.5937],
                icon: 'local_fire_department',
                category: 'Live Stream',
                data: { zoom: 4.8 },
              });
            }
          }}
          className="liquid-btn flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-red-600/85 hover:bg-red-500/95 text-white font-bold text-xs uppercase tracking-wider shadow-[0_4px_20px_rgba(239,68,68,0.45)] border-t border-white/40 cursor-pointer"
          title="Switch to Pan-India Live NASA FIRMS Fire Map"
        >
          <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff] animate-ping" />
          <span className="sf-headline">LIVE INDIA</span>
        </button>

        {/* Live NASA FIRMS Connection Badge */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl liquid-glass-interactive font-mono text-xs text-on-surface-variant">
          <span
            className={`w-2 h-2 rounded-full ${
              systemStatus?.firmsConnected ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-amber-400'
            }`}
          />
          <span className="text-[11px] text-slate-200 font-bold">
            NASA FIRMS: {systemStatus?.firmsConnected ? 'CONNECTED' : 'STANDBY'}
          </span>
          <span className="text-white/20">•</span>
          <span className="text-[10px] text-primary font-bold">
            ML: {systemStatus?.modelStatus === 'ready' ? 'READY' : 'OFFLINE'}
          </span>
        </div>

        {/* Live NASA FIRMS Poll Button */}
        <button
          onClick={handleSyncLiveFirms}
          disabled={syncMutation.isPending}
          className="liquid-btn hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl liquid-glass-interactive text-on-surface font-mono text-xs uppercase"
          title="Query NASA FIRMS API for newly published satellite passes"
        >
          <span
            className="material-symbols-outlined text-[16px] text-primary"
            style={{ animation: syncMutation.isPending ? 'spin-slow 1s linear infinite' : 'none' }}
          >
            sync
          </span>
          <span>{syncMutation.isPending ? 'Ingesting...' : 'Poll FIRMS'}</span>
        </button>

        {/* Live Satellite Event Counter */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full liquid-glass-interactive font-mono text-xs text-on-surface-variant">
          <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_5px_#91d963] animate-pulse" />
          <span className="text-slate-200 font-semibold">{systemStatus?.counts.totalHotspots ?? analytics?.totalHotspots ?? 0} Active</span>
        </div>

        <button
          className="liquid-btn w-9 h-9 rounded-full liquid-glass-interactive flex items-center justify-center text-on-surface-variant hover:text-white"
          title="Notifications"
        >
          <span className="material-symbols-outlined text-[19px]">notifications</span>
        </button>
        <button
          className="liquid-btn w-9 h-9 rounded-full liquid-glass-interactive flex items-center justify-center text-on-surface-variant hover:text-white"
          title="Settings"
        >
          <span className="material-symbols-outlined text-[19px]">settings</span>
        </button>
        <div className="w-9 h-9 rounded-full liquid-glass-interactive flex items-center justify-center ml-1 shadow-inner">
          <span className="material-symbols-outlined text-[20px] text-primary">account_circle</span>
        </div>
      </div>
    </header>
  );
}

