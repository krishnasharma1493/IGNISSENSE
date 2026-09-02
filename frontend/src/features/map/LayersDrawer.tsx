import type { Hotspot, Classification, ClassificationClass } from '../../types';
import { CLASS_CONFIG, CLASSIFICATION_CLASSES } from '../../types';
import Panel from '../../components/ui/Panel';
import LiveFeed from './LiveFeed';

export type DrawerTab = 'layers' | 'filters' | 'feed';

export interface MapFilters {
  timeRange: '24h' | '48h' | '7d' | 'all';
  minConfidence: number;
  minPersistence: number;
  minAnomaly: number;
}

interface LayersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;

  classCounts: Record<ClassificationClass, number>;
  visibleClasses: Set<ClassificationClass>;
  onToggleClass: (c: ClassificationClass) => void;

  showFacilities: boolean;
  onToggleFacilities: () => void;
  showOsmContext: boolean;
  onToggleOsmContext: () => void;
  hasSelection: boolean;

  filters: MapFilters;
  onFiltersChange: (f: MapFilters) => void;

  visibleCount: number;
  totalCount: number;

  hotspots: Hotspot[];
  classifications: Map<string, Classification>;
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string) => void;
}

const TABS: { id: DrawerTab; label: string; icon: string }[] = [
  { id: 'layers', label: 'Layers', icon: 'layers' },
  { id: 'filters', label: 'Filters', icon: 'tune' },
  { id: 'feed', label: 'Feed', icon: 'sensors' },
];

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 py-1.5 ${
        disabled ? 'opacity-45' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-ink">{label}</span>
        {hint ? <span className="block text-[10px] text-ink-3">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]"
      />
    </label>
  );
}

function Slider({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11px] text-ink-2">
          {label}
        </label>
        <span className="num text-[11px] font-medium text-ink">{value}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={95}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-[var(--color-accent)]"
      />
      {hint ? <span className="text-[10px] text-ink-3">{hint}</span> : null}
    </div>
  );
}

/**
 * One surface for everything that used to float separately over the map: the
 * legend, the classification filter pills, the layer toggles and the live feed
 * window. The legend doubles as the classification filter, so a class is turned
 * off in the same place its colour is explained.
 */
export default function LayersDrawer(props: LayersDrawerProps) {
  const {
    open,
    onOpenChange,
    tab,
    onTabChange,
    classCounts,
    visibleClasses,
    onToggleClass,
    showFacilities,
    onToggleFacilities,
    showOsmContext,
    onToggleOsmContext,
    hasSelection,
    filters,
    onFiltersChange,
    visibleCount,
    totalCount,
  } = props;

  if (!open) {
    return (
      <Panel level="chrome" className="overflow-hidden rounded-lg">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="ctl h-9 gap-2 px-3 text-[12px]"
          aria-expanded={false}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden="true">
            layers
          </span>
          Layers &amp; filters
          <span className="num text-[11px] text-ink-3">
            {visibleCount.toLocaleString()}/{totalCount.toLocaleString()}
          </span>
        </button>
      </Panel>
    );
  }

  return (
    <Panel level="panel" className="arrive flex w-[320px] flex-col overflow-hidden rounded-xl">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b border-hairline px-1.5 py-1.5">
        <div role="tablist" aria-label="Map controls" className="flex flex-1 items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTabChange(t.id)}
              data-active={tab === t.id ? 'true' : undefined}
              className="ctl h-7 flex-1 px-2 text-[11px]"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
                data-filled={tab === t.id ? 'true' : undefined}
                aria-hidden="true"
              >
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="ctl h-7 w-7"
          aria-label="Collapse layers and filters"
          aria-expanded
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* ── Layers ─────────────────────────────────────────────────────────── */}
      {tab === 'layers' ? (
        <div className="flex flex-col gap-3 px-3 py-3">
          <div>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              Thermal events
            </h3>
            <ul>
              {CLASSIFICATION_CLASSES.map((c) => {
                const cfg = CLASS_CONFIG[c];
                const on = visibleClasses.has(c);
                return (
                  <li key={c}>
                    <label className="flex cursor-pointer items-center gap-2 py-[3px]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => onToggleClass(c)}
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]"
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: cfg.ink, opacity: on ? 1 : 0.3 }}
                        aria-hidden="true"
                      />
                      <span
                        className={`flex-1 truncate text-[12px] ${on ? 'text-ink' : 'text-ink-4'}`}
                      >
                        {cfg.label}
                      </span>
                      <span className="num text-[11px] text-ink-3">{classCounts[c] ?? 0}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-hairline pt-1">
            <h3 className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              Context
            </h3>
            <Toggle
              label="Industrial facilities"
              hint="OpenStreetMap infrastructure, from zoom 8"
              checked={showFacilities}
              onChange={onToggleFacilities}
            />
            <Toggle
              label="Investigation network"
              hint={
                hasSelection
                  ? 'Nearby features linked to the selected detection'
                  : 'Select a detection to build a network'
              }
              checked={showOsmContext}
              onChange={onToggleOsmContext}
              disabled={!hasSelection}
            />
          </div>
        </div>
      ) : null}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      {tab === 'filters' ? (
        <div className="flex flex-col gap-1 px-3 py-3">
          <div className="flex flex-col gap-1 py-1.5">
            <label htmlFor="time-range" className="text-[11px] text-ink-2">
              Detection window
            </label>
            <select
              id="time-range"
              value={filters.timeRange}
              onChange={(e) =>
                onFiltersChange({ ...filters, timeRange: e.target.value as MapFilters['timeRange'] })
              }
              className="inset-surface cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink"
            >
              <option value="24h">Last 24 hours</option>
              <option value="48h">Last 48 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="all">All stored detections</option>
            </select>
          </div>

          <Slider
            id="min-confidence"
            label="Minimum model confidence"
            value={filters.minConfidence}
            onChange={(v) => onFiltersChange({ ...filters, minConfidence: v })}
          />

          <div className="border-t border-hairline pt-1">
            <p className="py-1 text-[10px] leading-relaxed text-ink-3">
              Persistence and anomaly are independent axes. Raising both narrows to sources that
              recur <em>and</em> deviate from their own baseline.
            </p>
            <Slider
              id="min-persistence"
              label="Minimum persistence"
              value={filters.minPersistence}
              onChange={(v) => onFiltersChange({ ...filters, minPersistence: v })}
            />
            <Slider
              id="min-anomaly"
              label="Minimum anomaly"
              value={filters.minAnomaly}
              onChange={(v) => onFiltersChange({ ...filters, minAnomaly: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2">
            <span className="num text-[11px] text-ink-3">
              {visibleCount.toLocaleString()} of {totalCount.toLocaleString()} shown
            </span>
            <button
              type="button"
              onClick={() =>
                onFiltersChange({
                  timeRange: '48h',
                  minConfidence: 0,
                  minPersistence: 0,
                  minAnomaly: 0,
                })
              }
              className="ctl h-6 px-2 text-[11px]"
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Feed ───────────────────────────────────────────────────────────── */}
      {tab === 'feed' ? (
        <LiveFeed
          hotspots={props.hotspots}
          classifications={props.classifications}
          selectedHotspotId={props.selectedHotspotId}
          onSelectHotspot={props.onSelectHotspot}
        />
      ) : null}
    </Panel>
  );
}
