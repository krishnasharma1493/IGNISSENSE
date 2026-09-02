import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAnalyticsSummary, useHotspots, useTemporalTrend, useSystemStatus } from '../../api/hooks';
import { CLASS_CONFIG, CLASSIFICATION_CLASSES } from '../../types';
import type { Classification, ClassificationClass } from '../../types';
import { ClassChip } from '../../components/ui/Chip';
import { ProvenanceTag } from '../../components/ui/Provenance';
import { formatUtc } from '../../lib/format';
import TrendChart from './TrendChart';

interface DashboardPageProps {
  variant: 'dashboard' | 'analytics';
  onInvestigate: (hotspotId: string) => void;
  onOpenMap: () => void;
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string | null;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-white/60 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.05em] text-ink-3">{label}</div>
      <div
        className="num mt-0.5 text-[20px] font-semibold leading-none"
        style={tone ? { color: tone } : undefined}
      >
        {value === null || value === undefined ? <span className="text-ink-4">—</span> : value}
      </div>
      {hint ? <div className="mt-1 text-[10px] text-ink-3">{hint}</div> : null}
    </div>
  );
}

function Card({
  title,
  provenance,
  meta,
  children,
}: {
  title: string;
  provenance: 'observed' | 'model' | 'heuristic' | 'context';
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-hairline bg-white/60">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[12px] font-semibold text-ink">{title}</h2>
          <ProvenanceTag kind={provenance} />
        </div>
        {meta ? <span className="num shrink-0 text-[11px] text-ink-3">{meta}</span> : null}
      </header>
      <div className="flex-1 p-3.5">{children}</div>
    </section>
  );
}

export default function DashboardPage({ variant, onInvestigate, onOpenMap }: DashboardPageProps) {
  const isAnalytics = variant === 'analytics';
  const { data: analytics, isLoading } = useAnalyticsSummary();
  const { data: status } = useSystemStatus();
  const { data: hotspotsData } = useHotspots({ limit: '100' });
  const { data: trend } = useTemporalTrend(isAnalytics ? 14 : 7);

  const hotspots = hotspotsData?.hotspots ?? [];

  const { data: classificationsData } = useQuery({
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
  const classifications = classificationsData ?? new Map<string, Classification>();

  const total = analytics?.totalHotspots ?? null;
  const counts = analytics?.classifications;

  const distribution = useMemo(
    () =>
      CLASSIFICATION_CLASSES.map((c) => ({
        cls: c,
        count: counts?.[c] ?? 0,
        pct: total ? ((counts?.[c] ?? 0) / total) * 100 : 0,
      })).sort((a, b) => b.count - a.count),
    [counts, total]
  );

  const unclassifiedCount = analytics?.unclassified ?? 0;
  const unclassifiedPct = total ? (unclassifiedCount / total) * 100 : 0;

  const points = trend?.points ?? [];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            {isAnalytics ? 'Analytics' : 'Thermal overview'}
          </h1>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {isAnalytics
              ? 'Detection volume and radiative power over time, aggregated across India.'
              : 'Satellite thermal detections across India, classified and enriched with spatial context.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-[11px] text-ink-3">
            Updated {formatUtc(analytics?.lastDataUpdate) ?? '—'}
          </span>
          <button type="button" onClick={onOpenMap} className="ctl h-7 border border-hairline px-2.5 text-[12px]">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden="true">
              public
            </span>
            Open map
          </button>
        </div>
      </header>

      {status?.demoMode ? (
        <p className="rounded-lg border border-[rgba(138,97,0,0.26)] bg-warn-soft px-3 py-2 text-[12px] text-warn">
          The backend is running against an in-memory database. Every figure below reflects seeded
          data rather than the live store.
        </p>
      ) : null}

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total detections" value={isLoading ? null : total?.toLocaleString() ?? null} />
        <Stat
          label="Industrial fire"
          value={isLoading ? null : counts?.industrial_fire ?? null}
          tone={CLASS_CONFIG.industrial_fire.ink}
          hint="Candidates, not confirmed"
        />
        <Stat
          label="Gas flare"
          value={isLoading ? null : counts?.gas_flare ?? null}
          tone={CLASS_CONFIG.gas_flare.ink}
        />
        <Stat
          label="Persistent sources"
          value={isLoading ? null : analytics?.persistentSources ?? null}
          hint="Recurrence-based"
        />
        <Stat
          label="Anomalous sources"
          value={isLoading ? null : analytics?.anomalousSources ?? null}
          hint="Deviating from baseline"
        />
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={`grid gap-3 ${isAnalytics ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <div className={isAnalytics ? 'lg:col-span-2' : ''}>
          <Card
            title={`Detection volume · ${isAnalytics ? 14 : 7} days`}
            provenance="observed"
            meta={points.length ? `${points.reduce((s, p) => s + p.count, 0).toLocaleString()} detections` : undefined}
          >
            <TrendChart points={points} showFrp={isAnalytics} />
          </Card>
        </div>

        <Card title="Class distribution" provenance="model" meta={total ? `${total.toLocaleString()} classified` : undefined}>
          {!total ? (
            <p className="text-[12px] text-ink-3">No classifications recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {distribution.map(({ cls, count, pct }) => (
                <li key={cls} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <ClassChip cls={cls as ClassificationClass} />
                    <span className="num text-[11px] text-ink-2">
                      {count.toLocaleString()}
                      <span className="ml-1 text-ink-3">{pct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(15,18,22,0.07)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: CLASS_CONFIG[cls].ink }}
                    />
                  </div>
                </li>
              ))}

              {/* Not run through the classifier at all — kept visually distinct from the
                  six thermal-event classes above, which is why it isn't a seventh ClassChip. */}
              <li className="mt-1 flex flex-col gap-1 border-t border-dashed border-hairline pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium text-ink-3">
                    Not classified · no OSM coverage
                  </span>
                  <span className="num text-[11px] text-ink-2">
                    {unclassifiedCount.toLocaleString()}
                    <span className="ml-1 text-ink-3">{unclassifiedPct.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(15,18,22,0.07)]">
                  <div
                    className="h-full rounded-full bg-[rgba(15,18,22,0.3)]"
                    style={{ width: `${unclassifiedPct}%` }}
                  />
                </div>
              </li>
            </ul>
          )}
        </Card>
      </div>

      {/* ── Recent detections ──────────────────────────────────────────────── */}
      <Card title="Recent detections" provenance="observed" meta={`${hotspots.length} most recent`}>
        {hotspots.length === 0 ? (
          <p className="text-[12px] text-ink-3">No detections stored.</p>
        ) : (
          <div className="-mx-3.5 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline">
                  {['Acquired (UTC)', 'Position', 'FRP', 'Sensor', 'Classification', 'Confidence'].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={`px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.05em] text-ink-3 ${
                          i >= 4 ? 'text-right' : ''
                        }`}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {hotspots.slice(0, 12).map((h) => {
                  const c = classifications.get(h._id);
                  return (
                    <tr
                      key={h._id}
                      onClick={() => onInvestigate(h._id)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && onInvestigate(h._id)}
                      className="cursor-pointer border-b border-hairline last:border-0 hover:bg-[rgba(15,18,22,0.04)]"
                    >
                      <td className="num px-3.5 py-1.5 text-[11px] text-ink-2">
                        {h.detectedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="num px-3.5 py-1.5 text-[11px] text-ink-2">
                        {h.location.coordinates[1].toFixed(3)}, {h.location.coordinates[0].toFixed(3)}
                      </td>
                      <td className="num px-3.5 py-1.5 text-[11px] font-medium text-ink">
                        {h.frp !== null ? `${h.frp.toFixed(1)} MW` : <span className="text-ink-4">—</span>}
                      </td>
                      <td className="px-3.5 py-1.5 text-[11px] text-ink-2">{h.instrument}</td>
                      <td className="px-3.5 py-1.5 text-right">
                        {c?.predictedClass ? (
                          <ClassChip cls={c.predictedClass} icon={false} />
                        ) : (
                          <span className="text-[11px] text-ink-4">Unclassified</span>
                        )}
                      </td>
                      <td className="num px-3.5 py-1.5 text-right text-[11px] text-ink-2">
                        {c && c.confidence !== null ? (
                          `${Math.round(c.confidence * 100)}%`
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
