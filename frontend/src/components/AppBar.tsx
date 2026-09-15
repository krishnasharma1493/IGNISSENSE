import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useHotspots, useFacilities, useSystemStatus, useSyncFirms, useAlerts } from '../api/hooks';
import { useSearch, parseCoordinates } from '../context/SearchContext';
import type { SearchResultItem } from '../context/SearchContext';
import type { Classification } from '../types';
import Panel from './ui/Panel';
import { useProximitySpring } from './dock/useProximitySpring';

export type PageTab = 'map' | 'dashboard' | 'alerts' | 'analytics';

const TABS: { id: PageTab; label: string; icon: string }[] = [
  { id: 'map', label: 'Map', icon: 'public' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'alerts', label: 'Alerts', icon: 'notifications' },
  { id: 'analytics', label: 'Analytics', icon: 'monitoring' },
];

interface AppBarProps {
  activeTab: PageTab;
  onTabChange: (t: PageTab) => void;
  onSelectSearchResult: (r: SearchResultItem) => void;
  onExport: () => void;
}

/** The background pill a dock item grows; purely decorative. */
function DockPill() {
  return <span className="dock-pill" aria-hidden="true" />;
}

/**
 * The single chrome surface, rendered as a top dock. Brand, section navigation,
 * search, pipeline state and export all live here, so the map keeps the whole
 * viewport beneath it.
 *
 * Controls marked `data-dock-item` own a background pill that grows toward the
 * pointer (see dock/useProximitySpring). The pill grows inside the item's share
 * of the gap and inside the bar; the item's content never scales or shifts
 * sideways, so labels never cover each other. The search field is not a dock
 * item: it is a text input, and moving it under the cursor would move the caret.
 */
export default function AppBar({
  activeTab,
  onTabChange,
  onSelectSearchResult,
  onExport,
}: AppBarProps) {
  const { searchQuery, setSearchQuery, performSearch, navigateToLocation } = useSearch();
  const { data: status } = useSystemStatus();
  const { data: openAlerts } = useAlerts({ status: 'open' });
  const sync = useSyncFirms();

  const [searchOpen, setSearchOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useProximitySpring(dockRef);

  const { data: hotspotsData } = useHotspots({ limit: '1000' });
  const { data: facilitiesData } = useFacilities({ limit: '1000' });
  const { data: classifications } = useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: '5000' } });
      const map = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        for (const c of res.data.data.classifications as Classification[]) map.set(c.hotspotId, c);
      }
      return map;
    },
    staleTime: 30_000,
  });

  const results = performSearch(
    searchQuery,
    hotspotsData?.hotspots ?? [],
    facilitiesData?.facilities ?? [],
    classifications ?? new Map()
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (document.activeElement?.tagName ?? '').toUpperCase()
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setStatusOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (r: SearchResultItem) => {
    navigateToLocation({
      coordinates: r.coordinates,
      label: r.title,
      zoom: r.data?.zoom ?? 14,
      hotspotId: r.data?.hotspotId,
      facilityId: r.data?.facilityId,
    });
    onSelectSearchResult(r);
    setSearchOpen(false);
  };

  const submit = () => {
    const q = searchQuery.trim();
    if (!q) return;
    const coords = parseCoordinates(q);
    if (coords) {
      navigateToLocation({
        coordinates: coords,
        label: `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`,
        zoom: 14,
      });
      setSearchOpen(false);
      return;
    }
    if (results.length) choose(results[0]);
  };

  const services = [
    { label: 'NASA FIRMS satellite feed', ok: Boolean(status?.firmsConnected) },
    { label: 'Fire-type model', ok: status?.modelStatus === 'ready' },
    { label: 'Database', ok: status?.databaseStatus === 'connected' },
  ];
  const allOk = services.every((s) => s.ok);
  const openAlertCount = openAlerts?.count ?? 0;

  return (
    <header
      ref={dockRef}
      className="glass-dock absolute left-4 right-4 top-4 z-50 flex h-11 items-center gap-2 rounded-lg px-2"
    >
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2 pl-1 pr-1">
        <img src="/logo-dark.png" alt="" className="h-4 w-4 object-contain" aria-hidden="true" />
        <span className="text-[13px] font-semibold tracking-tight text-ink">IGNISSENSE</span>
      </div>

      <span className="h-4 w-px shrink-0 bg-hairline" aria-hidden="true" />

      {/* Sections. gap-2 leaves every pill 3px of growth per side without touching. */}
      <nav aria-label="Sections" className="flex shrink-0 items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-dock-item
            onClick={() => onTabChange(t.id)}
            aria-current={activeTab === t.id ? 'page' : undefined}
            aria-label={t.id === 'alerts' && openAlertCount > 0 ? `${t.label}, ${openAlertCount} open` : t.label}
            data-active={activeTab === t.id ? 'true' : undefined}
            className="ctl dock-item dock-tab h-7 px-2.5 text-[12px]"
          >
            <DockPill />
            <span className="dock-content">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
                data-filled={activeTab === t.id ? 'true' : undefined}
                aria-hidden="true"
              >
                {t.icon}
              </span>
              <span className="hidden md:inline" aria-hidden="true">
                {t.label}
              </span>
              {t.id === 'alerts' && openAlertCount > 0 ? (
                // Keyed on the count, so the badge pops when a new alert arrives.
                <span
                  key={openAlertCount}
                  className="badge-pop num rounded-full bg-danger-soft px-1.5 py-px text-[10px] font-semibold text-danger"
                  aria-hidden="true"
                >
                  {openAlertCount}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </nav>

      {/* Search */}
      <div ref={searchRef} className="relative mx-auto w-full max-w-[380px]">
        <div className="inset-surface flex items-center gap-1.5 rounded-md px-2 py-1 focus-within:border-accent-line">
          <span
            className="material-symbols-outlined text-ink-3"
            style={{ fontSize: 15 }}
            aria-hidden="true"
          >
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Search places, facilities or coordinates"
            aria-label="Search places, facilities or coordinates"
            className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-4"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="ctl h-5 w-5"
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden="true">
                close
              </span>
            </button>
          ) : (
            <kbd className="num hidden shrink-0 rounded border border-hairline px-1 text-[10px] text-ink-4 sm:block">
              ⌘K
            </kbd>
          )}
        </div>

        {searchOpen && searchQuery.trim() ? (
          <Panel
            level="popover"
            className="pop-in absolute left-0 right-0 top-full z-[60] mt-1.5 max-h-[60vh] overflow-y-auto rounded-lg py-1"
          >
            {results.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-ink-3">
                No matches. Try a region like Faridabad, a facility name, or coordinates like{' '}
                <span className="num text-ink-2">28.6139, 77.2090</span>.
              </p>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => choose(r)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[rgba(15,18,22,0.05)]"
                >
                  <span
                    className="material-symbols-outlined shrink-0 text-ink-3"
                    style={{ fontSize: 16 }}
                    aria-hidden="true"
                  >
                    {r.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-[10px] text-ink-3">{r.subtitle}</span>
                  </span>
                </button>
              ))
            )}
          </Panel>
        ) : null}
      </div>

      {/* Pipeline state. Flex, not block: a layout-contained dock item has no text
          baseline, so inside a block line box it would ride up by the descender. */}
      <div ref={statusRef} className="relative flex shrink-0 items-center">
        <button
          type="button"
          data-dock-item
          onClick={() => setStatusOpen((v) => !v)}
          className="ctl dock-item h-7 px-2.5 text-[11px]"
          aria-expanded={statusOpen}
          aria-label={`System status: ${allOk ? 'all systems running' : 'something needs attention'}`}
        >
          <DockPill />
          <span className="dock-content">
            <span
              className={`h-1.5 w-1.5 rounded-full ${allOk ? 'bg-ok live-dot' : 'bg-warn'}`}
              aria-hidden="true"
            />
            <span className="hidden lg:inline">{allOk ? 'Live' : 'Needs attention'}</span>
          </span>
        </button>

        {statusOpen ? (
          <Panel level="popover" className="pop-in-end absolute right-0 top-full z-[60] mt-1.5 w-64 rounded-lg p-3">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              System status
            </h2>
            <ul className="mb-2 flex flex-col gap-1">
              {services.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-ink-2">{s.label}</span>
                  <span className={`flex items-center gap-1.5 font-medium ${s.ok ? 'text-ok' : 'text-warn'}`}>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${s.ok ? 'bg-ok' : 'bg-warn'}`}
                      aria-hidden="true"
                    />
                    {s.ok ? 'Running' : 'Offline'}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="border-t border-hairline pt-2 text-[11px]">
              <div className="flex justify-between gap-2 py-0.5">
                <dt className="text-ink-3">Last satellite update</dt>
                <dd className="num text-ink-2">
                  {status?.lastSuccessfulPoll
                    ? new Date(status.lastSuccessfulPoll).toISOString().slice(11, 16) + ' UTC'
                    : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2 py-0.5">
                <dt className="text-ink-3">Model</dt>
                <dd className="num truncate text-ink-2">{status?.modelVersion ?? '—'}</dd>
              </div>
              {status?.demoMode ? (
                <div className="mt-1.5 rounded-md bg-warn-soft px-2 py-1.5 text-[10px] leading-relaxed text-warn">
                  Demo data: running on a temporary in-memory database, not the live store.
                </div>
              ) : null}
            </dl>

            <button
              type="button"
              onClick={() => sync.mutate({ scope: 'india', dayRange: 2 })}
              disabled={sync.isPending}
              className="ctl mt-2 h-7 w-full border border-hairline text-[11px] disabled:opacity-50"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden="true">
                sync
              </span>
              {sync.isPending ? 'Checking for new fires…' : 'Check for new fires'}
            </button>
          </Panel>
        ) : null}
      </div>

      <button
        type="button"
        data-dock-item
        onClick={onExport}
        className="ctl dock-item h-7 shrink-0 px-2.5 text-[11px]"
        aria-label="Export detections"
      >
        <DockPill />
        <span className="dock-content">
          <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden="true">
            download
          </span>
          <span className="hidden lg:inline" aria-hidden="true">
            Export
          </span>
        </span>
      </button>
    </header>
  );
}
