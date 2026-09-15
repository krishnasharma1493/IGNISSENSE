import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useHotspots, useSystemStatus } from '../../api/hooks';
import { CLASS_CONFIG } from '../../types';
import type { Classification, ClassificationClass } from '../../types';
import { ClassChip } from '../../components/ui/Chip';
import { Card, Stat } from '../../components/ui/Card';
import { formatUtc } from '../../lib/format';
import { formatMw, latestDays, quantile, utcDay } from './stats';

/**
 * Analytics — how the model reads recent detections.
 *
 * The Dashboard is the live operational view (what was detected, what is open).
 * This page is the evidence behind it: the class mix over time, how confident the
 * model is per class, the radiative power each class actually carries, and what
 * the sensors observed. Everything is computed from the latest detections the API
 * serves and their classifications; no model metric is shown that the API does
 * not provide.
 *
 * Colour: the six class hues are the app-wide encoding and several pairs are not
 * separable under colour-vision deficiency, so no chart here relies on two class
 * colours touching. Classes are faceted into labelled rows (small multiples),
 * every row carries its name, and the class-mix chart has a table view.
 */

const SAMPLE = 5000;
const WINDOW_DAYS = 14;
/** Fixed order; the adjacent pairs of this sequence pass the normal-vision separation check. */
const ORDER: ClassificationClass[] = [
  'agricultural_burning',
  'mining_thermal_activity',
  'industrial_fire',
  'wildfire',
  'gas_flare',
  'other_or_uncertain',
];
const CONF_BINS = 10;
// Validated pair (light surface #f8f9fa): CVD ΔE 17.5, normal-vision ΔE 19.9, both inside the lightness band.
const DAY_COLOR = '#2b91c2';
const NIGHT_COLOR = '#51479e';

type Row = ClassificationClass | 'none';

interface Derived {
  days: string[];
  analysed: number;
  classified: number;
  perDay: Map<string, Record<Row, number>>;
  rowTotals: Record<Row, number>;
  confidence: Record<ClassificationClass, number[]>;
  frp: Record<ClassificationClass, number[]>;
  sensors: { instrument: string; day: number; night: number }[];
  medianConfidence: number | null;
  lowConfidenceShare: number | null;
  from: string | null;
  to: string | null;
}

const emptyRow = (): Record<Row, number> => ({
  agricultural_burning: 0,
  mining_thermal_activity: 0,
  industrial_fire: 0,
  wildfire: 0,
  gas_flare: 0,
  other_or_uncertain: 0,
  none: 0,
});

function useClassifications() {
  return useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: String(SAMPLE) } });
      const map = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        for (const c of res.data.data.classifications as Classification[]) map.set(c.hotspotId, c);
      }
      return map;
    },
    staleTime: 30_000,
  });
}

function ClassLabel({ row }: { row: Row }) {
  return row === 'none' ? (
    <span className="text-[11px] font-medium text-ink-3">Not classified</span>
  ) : (
    <ClassChip cls={row} icon={false} />
  );
}

/* ── Class mix by day: one labelled row per class, own scale per row ─────── */

function ClassMix({ d }: { d: Derived }) {
  const rows: Row[] = [...ORDER, 'none'];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const values = d.days.map((day) => d.perDay.get(day)?.[row] ?? 0);
        const peak = Math.max(...values, 0);
        const color = row === 'none' ? 'rgba(15,18,22,0.28)' : CLASS_CONFIG[row].ink;
        return (
          <div key={row} className="grid grid-cols-[140px_1fr_64px] items-end gap-3">
            <div className="flex h-9 items-center">
              <ClassLabel row={row} />
            </div>
            <div
              className="relative flex h-9 items-end gap-[2px] border-b border-hairline"
              role="img"
              aria-label={`${row === 'none' ? 'Not classified' : CLASS_CONFIG[row].label}: ${d.rowTotals[row]} detections, daily peak ${peak}`}
            >
              {values.map((v, i) => (
                <div key={d.days[i]} className="group relative flex h-full flex-1 items-end justify-center">
                  {v > 0 ? (
                    <div
                      className="w-full max-w-[24px] rounded-t-[4px] transition-opacity group-hover:opacity-75"
                      style={{ height: `${Math.max(6, (v / Math.max(peak, 1)) * 100)}%`, backgroundColor: color }}
                    />
                  ) : null}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-hairline bg-white px-2 py-1 text-[10px] shadow-md group-hover:block">
                    <span className="num block font-semibold text-ink">{v.toLocaleString()}</span>
                    <span className="num block text-ink-3">{d.days[i]}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex h-9 flex-col items-end justify-center">
              <span className="num text-[11px] font-medium text-ink">{d.rowTotals[row].toLocaleString()}</span>
              <span className="num text-[10px] text-ink-3">peak {peak}</span>
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-[140px_1fr_64px] gap-3">
        <span />
        <div className="flex justify-between text-[10px] text-ink-3">
          <span className="num">{d.days[0]}</span>
          <span className="num">{d.days[d.days.length - 1]}</span>
        </div>
        <span />
      </div>
      <p className="text-[10px] text-ink-3">Each row has its own scale, so small classes stay readable. Compare rows by their totals.</p>
    </div>
  );
}

function ClassMixTable({ d }: { d: Derived }) {
  const rows: Row[] = [...ORDER, 'none'];
  return (
    <div className="-mx-3.5 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className="px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.05em] text-ink-3">
              Day (UTC)
            </th>
            {rows.map((r) => (
              <th key={r} scope="col" className="px-2 py-1.5 text-right text-[10px] font-medium uppercase tracking-[0.05em] text-ink-3">
                {r === 'none' ? 'Not classified' : CLASS_CONFIG[r].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.days.map((day) => (
            <tr key={day} className="border-b border-hairline last:border-0">
              <th scope="row" className="num px-3.5 py-1 text-[11px] font-normal text-ink-2">
                {day}
              </th>
              {rows.map((r) => (
                <td key={r} className="num px-2 py-1 text-right text-[11px] text-ink-2">
                  {(d.perDay.get(day)?.[r] ?? 0).toLocaleString()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Confidence distribution per class ───────────────────────────────────── */

function ConfidenceByClass({ d }: { d: Derived }) {
  return (
    <div className="flex flex-col gap-2">
      {ORDER.map((cls) => {
        const vals = d.confidence[cls];
        const sorted = [...vals].sort((a, b) => a - b);
        const med = quantile(sorted, 0.5);
        const bins = new Array<number>(CONF_BINS).fill(0);
        for (const v of vals) bins[Math.min(CONF_BINS - 1, Math.floor(v * CONF_BINS))]++;
        const peak = Math.max(...bins, 1);
        return (
          <div key={cls} className="grid grid-cols-[140px_1fr_92px] items-end gap-3">
            <div className="flex h-8 items-center">
              <ClassChip cls={cls} icon={false} />
            </div>
            <div
              className="relative flex h-8 items-end gap-[2px] border-b border-hairline"
              role="img"
              aria-label={`${CLASS_CONFIG[cls].label}: ${vals.length} predictions, median confidence ${med === null ? 'not available' : Math.round(med * 100) + '%'}`}
            >
              {bins.map((b, i) => (
                <div key={i} className="group relative flex h-full flex-1 items-end justify-center">
                  {b > 0 ? (
                    <div
                      className="w-full max-w-[24px] rounded-t-[4px] group-hover:opacity-75"
                      style={{ height: `${Math.max(6, (b / peak) * 100)}%`, backgroundColor: CLASS_CONFIG[cls].ink }}
                    />
                  ) : null}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-hairline bg-white px-2 py-1 text-[10px] shadow-md group-hover:block">
                    <span className="num block font-semibold text-ink">{b.toLocaleString()}</span>
                    <span className="num block text-ink-3">
                      {i * 10}–{(i + 1) * 10}% confidence
                    </span>
                  </span>
                </div>
              ))}
              {med !== null ? (
                <span
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-ink"
                  style={{ left: `${med * 100}%` }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="flex h-8 flex-col items-end justify-center">
              <span className="num text-[11px] font-medium text-ink">
                {med === null ? '—' : `median ${Math.round(med * 100)}%`}
              </span>
              <span className="num text-[10px] text-ink-3">n {vals.length.toLocaleString()}</span>
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-[140px_1fr_92px] gap-3">
        <span />
        <div className="flex justify-between text-[10px] text-ink-3">
          <span className="num">0%</span>
          <span className="num">50%</span>
          <span className="num">100%</span>
        </div>
        <span />
      </div>
      <p className="text-[10px] text-ink-3">Bars are 10-point confidence bins; the dark rule marks the median.</p>
    </div>
  );
}

/* ── Radiative power per class, log scale ────────────────────────────────── */

function FrpByClass({ d }: { d: Derived }) {
  const summaries = ORDER.map((cls) => {
    const s = [...d.frp[cls]].sort((a, b) => a - b);
    return { cls, n: s.length, p25: quantile(s, 0.25), med: quantile(s, 0.5), p75: quantile(s, 0.75) };
  });
  const hi = Math.max(10, ...summaries.map((s) => s.p75 ?? 0));
  const lo = 0.5;
  const top = 10 ** Math.ceil(Math.log10(hi));
  const x = (v: number) =>
    ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(top) - Math.log10(lo))) * 100;
  const ticks = [1, 10, 100, 1000, 10000].filter((t) => t <= top);

  return (
    <div className="flex flex-col gap-2">
      {summaries.map(({ cls, n, p25, med, p75 }) => (
        <div key={cls} className="grid grid-cols-[140px_1fr_156px] items-center gap-3">
          <ClassChip cls={cls} icon={false} />
          <div className="relative h-6" role="img" aria-label={`${CLASS_CONFIG[cls].label}: median ${med === null ? 'not available' : formatMw(med) + ' megawatts'}`}>
            {ticks.map((t) => (
              <span key={t} className="absolute bottom-0 top-0 w-px bg-hairline" style={{ left: `${x(t)}%` }} aria-hidden="true" />
            ))}
            {p25 !== null && p75 !== null ? (
              <span
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                style={{ left: `${x(p25)}%`, width: `${Math.max(0.5, x(p75) - x(p25))}%`, backgroundColor: CLASS_CONFIG[cls].ink }}
                aria-hidden="true"
              />
            ) : null}
            {med !== null ? (
              <span
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                style={{ left: `${x(med)}%`, backgroundColor: CLASS_CONFIG[cls].ink }}
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div className="flex flex-col items-end">
            <span className="num text-[11px] font-medium text-ink">
              {med === null ? '—' : `median ${formatMw(med)} MW`}
            </span>
            <span className="num text-[10px] text-ink-3">
              {p25 === null || p75 === null ? `n ${n}` : `IQR ${formatMw(p25)}–${formatMw(p75)} · n ${n.toLocaleString()}`}
            </span>
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[140px_1fr_120px] gap-3">
        <span />
        <div className="relative h-4 text-[10px] text-ink-3">
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>
              {t >= 1000 ? `${t / 1000}k` : t}
            </span>
          ))}
        </div>
        <span />
      </div>
      <p className="text-[10px] text-ink-3">Log scale, MW. The bar spans the middle 50% of detections; the dot is the median.</p>
    </div>
  );
}

/* ── Sensor and overpass split ───────────────────────────────────────────── */

function SensorSplit({ d }: { d: Derived }) {
  return (
    <div className="flex flex-col gap-3">
      {d.sensors.map(({ instrument, day, night }) => {
        const total = day + night;
        const dayPct = total ? (day / total) * 100 : 0;
        return (
          <div key={instrument} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-ink">{instrument}</span>
              <span className="num text-[11px] text-ink-2">{total.toLocaleString()} detections</span>
            </div>
            <div className="flex h-2 w-full gap-[2px]" role="img" aria-label={`${instrument}: ${day} day passes, ${night} night passes`}>
              {day > 0 ? <span className="h-full rounded-l-full" style={{ width: `${dayPct}%`, backgroundColor: DAY_COLOR }} /> : null}
              {night > 0 ? (
                <span className="h-full flex-1 rounded-r-full" style={{ backgroundColor: NIGHT_COLOR }} />
              ) : null}
            </div>
            <div className="flex justify-between text-[10px] text-ink-3">
              <span className="num">Day {day.toLocaleString()} · {Math.round(dayPct)}%</span>
              <span className="num">Night {night.toLocaleString()} · {Math.round(100 - dayPct)}%</span>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 text-[10px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: DAY_COLOR }} aria-hidden="true" />
          Day pass
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: NIGHT_COLOR }} aria-hidden="true" />
          Night pass
        </span>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AnalyticsPage({ onOpenMap }: { onOpenMap: () => void }) {
  const { data: status } = useSystemStatus();
  const { data: hotspotsData, isLoading } = useHotspots({ limit: String(SAMPLE) });
  const { data: classificationsData } = useClassifications();
  const [mixView, setMixView] = useState<'chart' | 'table'>('chart');

  const d = useMemo<Derived | null>(() => {
    const hotspots = hotspotsData?.hotspots ?? [];
    if (hotspots.length === 0) return null;
    const classifications = classificationsData ?? new Map<string, Classification>();
    const days = latestDays(hotspots.map((h) => h.detectedAt), WINDOW_DAYS);
    const inWindow = new Set(days);

    const perDay = new Map<string, Record<Row, number>>(days.map((day) => [day, emptyRow()]));
    const rowTotals = emptyRow();
    const confidence = Object.fromEntries(ORDER.map((c) => [c, [] as number[]])) as Record<ClassificationClass, number[]>;
    const frp = Object.fromEntries(ORDER.map((c) => [c, [] as number[]])) as Record<ClassificationClass, number[]>;
    const sensors = new Map<string, { day: number; night: number }>();
    let analysed = 0;
    let classified = 0;

    for (const h of hotspots) {
      const day = utcDay(h.detectedAt);
      if (!inWindow.has(day)) continue;
      analysed++;
      const c = classifications.get(h._id);
      const row: Row = c?.pipelineStatus === 'classified' && c.predictedClass ? c.predictedClass : 'none';
      perDay.get(day)![row]++;
      rowTotals[row]++;
      if (row !== 'none') {
        classified++;
        if (c?.confidence !== null && c?.confidence !== undefined) confidence[row].push(c.confidence);
        if (h.frp !== null) frp[row].push(h.frp);
      }
      const s = sensors.get(h.instrument) ?? { day: 0, night: 0 };
      if (h.dayNight === 'N') s.night++;
      else s.day++;
      sensors.set(h.instrument, s);
    }

    const allConf = ORDER.flatMap((c) => confidence[c]).sort((a, b) => a - b);
    return {
      days,
      analysed,
      classified,
      perDay,
      rowTotals,
      confidence,
      frp,
      sensors: Array.from(sensors, ([instrument, v]) => ({ instrument, ...v })).sort(
        (a, b) => b.day + b.night - (a.day + a.night)
      ),
      medianConfidence: quantile(allConf, 0.5),
      lowConfidenceShare: allConf.length ? allConf.filter((v) => v < 0.5).length / allConf.length : null,
      from: days[0] ?? null,
      to: days[days.length - 1] ?? null,
    };
  }, [hotspotsData, classificationsData]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Analytics</h1>
          <p className="mt-0.5 text-[12px] text-ink-2">
            How the model reads recent detections: class mix over time, how confident it is, and what the sensors observed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-[11px] text-ink-3">
            {d?.from && d.to ? `${d.from} → ${d.to} · latest ${SAMPLE.toLocaleString()} detections` : '—'}
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
          The backend is running against an in-memory database. Every figure below reflects seeded data rather than the live store.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Detections analysed" value={isLoading || !d ? null : d.analysed.toLocaleString()} hint={d ? `${d.days.length} UTC days` : undefined} />
        <Stat
          label="Classified"
          value={!d || !d.analysed ? null : `${((d.classified / d.analysed) * 100).toFixed(1)}%`}
          hint="Reached the model"
        />
        <Stat
          label="Median confidence"
          value={d?.medianConfidence == null ? null : `${Math.round(d.medianConfidence * 100)}%`}
          hint="Across classified detections"
        />
        <Stat
          label="Model"
          value={status?.modelVersion ? status.modelVersion.replace(/^XGB-FIRMS-/, '') : null}
          hint={d?.lowConfidenceShare == null ? undefined : `${Math.round(d.lowConfidenceShare * 100)}% of predictions below 50% confidence`}
        />
      </div>

      {!d ? (
        <p className="rounded-lg border border-hairline bg-white/60 px-3.5 py-6 text-center text-[12px] text-ink-3">
          {isLoading ? 'Loading detections…' : 'No detections stored yet.'}
        </p>
      ) : (
        <>
          <Card
            title={`Class mix by day · ${d.days.length} days`}
            provenance="model"
            meta={`${d.analysed.toLocaleString()} detections`}
            action={
              <div className="flex rounded-md border border-hairline p-px" role="group" aria-label="Class mix view">
                {(['chart', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={mixView === v}
                    onClick={() => setMixView(v)}
                    className="ctl h-6 px-2 text-[11px] capitalize"
                  >
                    {v}
                  </button>
                ))}
              </div>
            }
          >
            {mixView === 'chart' ? <ClassMix d={d} /> : <ClassMixTable d={d} />}
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Model confidence by class" provenance="model" meta={`${d.classified.toLocaleString()} predictions`}>
              <ConfidenceByClass d={d} />
            </Card>
            <Card title="Radiative power by class" provenance="observed">
              <FrpByClass d={d} />
            </Card>
          </div>

          <Card title="Sensors and overpass" provenance="observed" meta={`${d.sensors.length} instruments`}>
            <SensorSplit d={d} />
          </Card>

          <p className="text-[10px] text-ink-3">
            Updated {formatUtc(new Date().toISOString()) ?? '—'}. Classes are model predictions — decision support, not confirmed incidents.
          </p>
        </>
      )}
    </div>
  );
}
