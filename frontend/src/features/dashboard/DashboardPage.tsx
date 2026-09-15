import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAnalyticsSummary, useHotspots, useTemporalTrend, useSystemStatus } from '../../api/hooks';
import { CLASS_CONFIG, CLASSIFICATION_CLASSES } from '../../types';
import type { Classification, ClassificationClass } from '../../types';
import { ClassChip } from '../../components/ui/Chip';
import { Card, Stat } from '../../components/ui/Card';
import { formatUtc } from '../../lib/format';
import CountUp from '../../components/motion/CountUp';
import { revealRef, stagger } from '../../components/motion/motion';
import TrendChart from './TrendChart';

interface DashboardPageProps {
  onInvestigate: (hotspotId: string) => void;
  onOpenMap: () => void;
}

/** The live operational view: what was detected, how it was classified, what came in last. */
export default function DashboardPage({ onInvestigate, onOpenMap }: DashboardPageProps) {
  const { data: analytics, isLoading } = useAnalyticsSummary();
  const { data: status } = useSystemStatus();
  const { data: hotspotsData } = useHotspots({ limit: '100' });
  const { data: trend, isLoading: trendLoading } = useTemporalTrend(7);

  const hotspots = hotspotsData?.hotspots ?? [];

  const { data: classificationsData, isLoading: classificationsLoading } = useQuery({
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
      <header ref={revealRef} data-reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Fire activity</h1>
          <p className="mt-0.5 text-[12px] text-ink-2">
            Live satellite fire detections across India, sorted by likely fire type and linked to
            nearby infrastructure.
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
          Demo data: the backend is using a temporary in-memory database, so these numbers
          aren&rsquo;t live.
        </p>
      ) : null}

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total detections" value={isLoading ? null : total} />
        <Stat
          label="Industrial fire"
          value={isLoading ? null : counts?.industrial_fire ?? null}
          tone={CLASS_CONFIG.industrial_fire.ink}
          hint="AI predictions · verify on site"
        />
        <Stat
          label="Gas flare"
          value={isLoading ? null : counts?.gas_flare ?? null}
          tone={CLASS_CONFIG.gas_flare.ink}
        />
        <Stat
          label="Recurring sites"
          value={isLoading ? null : analytics?.persistentSources ?? null}
          hint="Fires seen repeatedly in one place"
        />
        <Stat
          label="Unusual sites"
          value={isLoading ? null : analytics?.anomalousSources ?? null}
          hint="Hotter or newer than usual for the spot"
        />
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="Detections · last 7 days"
          provenance="observed"
          meta={points.length ? `${points.reduce((s, p) => s + p.count, 0).toLocaleString()} detections` : undefined}
        >
          {trendLoading ? (
            <div className="grid h-[180px] place-items-center">
              <p className="text-[12px] text-ink-3">Loading…</p>
            </div>
          ) : (
            <TrendChart points={points} />
          )}
        </Card>

        <Card title="Fire types" provenance="model" meta={total ? `${total.toLocaleString()} detections` : undefined}>
          {isLoading ? (
            <p className="text-[12px] text-ink-3">Loading…</p>
          ) : !total ? (
            <p className="text-[12px] text-ink-3">No detections yet. They&rsquo;ll appear here as satellites report fires.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {distribution.map(({ cls, count, pct }, i) => (
                <li key={cls} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <ClassChip cls={cls as ClassificationClass} />
                    <span className="num text-[11px] text-ink-2">
                      <CountUp value={count} />
                      <span className="ml-1 text-ink-3">
                        <CountUp value={pct} decimals={1} suffix="%" />
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(15,18,22,0.07)]">
                    <div
                      className="bar-grow h-full rounded-full"
                      style={stagger(i, { width: `${pct}%`, backgroundColor: CLASS_CONFIG[cls].ink })}
                    />
                  </div>
                </li>
              ))}

              {/* Not run through the classifier at all — kept visually distinct from the
                  six thermal-event classes above, which is why it isn't a seventh ClassChip. */}
              <li className="mt-1 flex flex-col gap-1 border-t border-dashed border-hairline pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-[11px] font-medium text-ink-3"
                    title="The model couldn't run because no industrial site, mine or power plant is mapped nearby."
                  >
                    Not classified · no mapped sites nearby
                  </span>
                  <span className="num text-[11px] text-ink-2">
                    <CountUp value={unclassifiedCount} />
                    <span className="ml-1 text-ink-3">
                      <CountUp value={unclassifiedPct} decimals={1} suffix="%" />
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(15,18,22,0.07)]">
                  <div
                    className="bar-grow h-full rounded-full bg-[rgba(15,18,22,0.3)]"
                    style={stagger(distribution.length, { width: `${unclassifiedPct}%` })}
                  />
                </div>
              </li>
            </ul>
          )}
        </Card>
      </div>

      {/* ── Recent detections ──────────────────────────────────────────────── */}
      <Card title="Latest detections" provenance="observed" meta={`${hotspots.length} most recent`}>
        {hotspots.length === 0 ? (
          <p className="text-[12px] text-ink-3">No detections yet.</p>
        ) : (
          <div className="-mx-3.5 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline">
                  {['Detected (UTC)', 'Location', 'Fire power', 'Sensor', 'Fire type', 'Confidence'].map(
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
                      ref={revealRef}
                      data-reveal="fade"
                      onClick={() => onInvestigate(h._id)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && onInvestigate(h._id)}
                      className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-[rgba(15,18,22,0.04)]"
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
                        ) : classificationsLoading ? (
                          // Classifications arrive in a separate request. Until they do, the
                          // row's class is unknown — not "unclassified".
                          <span className="text-[11px] text-ink-4">Loading…</span>
                        ) : (
                          <span className="text-[11px] text-ink-4">Not classified</span>
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
