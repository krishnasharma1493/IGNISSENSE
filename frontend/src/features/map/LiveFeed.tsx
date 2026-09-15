import { useMemo } from 'react';
import type { Hotspot, Classification } from '../../types';
import { CLASS_CONFIG } from '../../types';
import { useSyncFirms, useSystemStatus } from '../../api/hooks';
import { revealRef } from '../../components/motion/motion';

interface LiveFeedProps {
  hotspots: Hotspot[];
  classifications: Map<string, Classification>;
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string) => void;
}

/**
 * The ingestion stream, most recent acquisition first. Every row is a real
 * FIRMS record; unclassified detections say so rather than borrowing a class.
 */
export default function LiveFeed({
  hotspots,
  classifications,
  selectedHotspotId,
  onSelectHotspot,
}: LiveFeedProps) {
  const sync = useSyncFirms();
  const { data: status } = useSystemStatus();

  const recent = useMemo(
    () =>
      [...hotspots]
        .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
        .slice(0, 40),
    [hotspots]
  );

  const services: { label: string; ok: boolean; detail: string }[] = [
    {
      label: 'NASA FIRMS',
      ok: Boolean(status?.firmsConnected),
      detail: status?.firmsConnected ? 'Live' : 'Waiting',
    },
    {
      label: 'Model',
      ok: status?.modelStatus === 'ready',
      detail: status?.modelStatus === 'ready' ? 'Ready' : 'Offline',
    },
    {
      label: 'Database',
      ok: status?.databaseStatus === 'connected',
      detail: status?.databaseStatus === 'connected' ? 'Connected' : 'Offline',
    },
  ];

  return (
    <div className="tab-enter flex max-h-[46vh] flex-col">
      {/* Service state — the pipeline degrades silently, so it is stated plainly */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-hairline px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {services.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-[11px]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${s.ok ? 'bg-ok' : 'bg-warn'}`}
                aria-hidden="true"
              />
              <span className="text-ink-3">{s.label}</span>
              <span className={`font-medium ${s.ok ? 'text-ink-2' : 'text-warn'}`}>{s.detail}</span>
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => sync.mutate({ scope: 'india', dayRange: 2 })}
          disabled={sync.isPending}
          className="ctl h-6 px-2 text-[11px] disabled:opacity-50"
          title="Check NASA FIRMS for new satellite passes"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden="true">
            sync
          </span>
          {sync.isPending ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {status?.pollStatusMessage ? (
        <p className="border-b border-hairline px-3 py-1.5 text-[10px] text-ink-3">
          {status.pollStatusMessage}
        </p>
      ) : null}

      <ul className="flex-1 overflow-y-auto">
        {recent.length === 0 ? (
          <li className="px-3 py-6 text-center text-[11px] text-ink-3">
            No fires match the current filters. Try a longer time range.
          </li>
        ) : (
          recent.map((h) => {
            const c = classifications.get(h._id);
            const cls = c?.predictedClass ?? null;
            const cfg = cls ? CLASS_CONFIG[cls] : null;
            const isSelected = h._id === selectedHotspotId;
            const [lng, lat] = h.location.coordinates;

            return (
              // New detections fade in as they arrive on the refetch.
              <li key={h._id} ref={revealRef} data-reveal="fade">
                <button
                  type="button"
                  onClick={() => onSelectHotspot(h._id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`flex w-full items-center justify-between gap-3 border-b border-hairline px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-accent-soft' : 'hover:bg-[rgba(15,18,22,0.04)]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: cfg?.ink ?? 'var(--color-ink-4)' }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink">
                        {cfg?.label ?? 'Not classified'}
                      </span>
                      <span className="num block truncate text-[10px] text-ink-3">
                        {h.instrument} · {lat.toFixed(3)}, {lng.toFixed(3)}
                      </span>
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="num block text-[11px] font-medium text-ink">
                      {h.frp !== null ? `${h.frp.toFixed(1)} MW` : '—'}
                    </span>
                    <span className="num block text-[10px] text-ink-3">
                      {new Date(h.detectedAt).toISOString().slice(11, 16)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <p className="border-t border-hairline px-3 py-1.5 text-[10px] text-ink-3">
        All times in UTC
        {status?.counts ? ` · ${status.counts.totalHotspots.toLocaleString()} detections in total` : ''}
      </p>
    </div>
  );
}
