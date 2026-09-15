import { useId } from 'react';

export interface TrajectoryPoint {
  detectedAt: string;
  frp: number;
  satellite: string;
  instrument: string;
  isCurrentSelection: boolean;
}

const W = 300;
const H = 88;
const PAD_T = 10;
const PAD_B = 16;

/**
 * Fire radiative power across every historical overpass recorded at this
 * coordinate. Real detections only — the series comes straight from
 * `/analytics/hotspot-history`, and a coordinate seen once renders an empty
 * state rather than a fabricated trend line.
 */
export default function FrpTrajectory({ points }: { points: TrajectoryPoint[] }) {
  const gradientId = useId();

  if (points.length < 2) {
    return (
      <div className="inset-surface flex flex-col items-center justify-center gap-1 rounded-md px-3 py-5 text-center">
        <span className="material-symbols-outlined text-ink-4" style={{ fontSize: 18 }} aria-hidden="true">
          timeline
        </span>
        <span className="text-[11px] font-medium text-ink-2">First detection at this spot</span>
        <span className="text-[10px] text-ink-3">
          A trend appears once satellites have seen this location at least twice.
        </span>
      </div>
    );
  }

  const frps = points.map((p) => p.frp);
  const maxFrp = Math.max(...frps);
  const minFrp = Math.min(...frps);
  // Guard the degenerate case where every pass reported the same FRP.
  const span = maxFrp - minFrp || maxFrp || 1;

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (frp: number) => PAD_T + (1 - (frp - minFrp) / span) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.frp).toFixed(1)}`).join(' ');
  const area = `0,${H - PAD_B} ${line} ${W},${H - PAD_B}`;

  const first = points[0];
  const last = points[points.length - 1];
  const dayLabel = (iso: string) => new Date(iso).toISOString().slice(5, 10);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="inset-surface relative rounded-md px-2 pb-1 pt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="chart-wipe h-[88px] w-full overflow-visible"
          role="img"
          aria-label={`Fire power over ${points.length} satellite passes, from ${minFrp.toFixed(
            1
          )} to ${maxFrp.toFixed(1)} megawatts`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cls-industrial-ink)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-cls-industrial-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Baseline */}
          <line
            x1="0"
            y1={H - PAD_B}
            x2={W}
            y2={H - PAD_B}
            stroke="rgba(15,18,22,0.14)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline
            points={line}
            fill="none"
            stroke="var(--color-cls-industrial-ink)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {points.map((p, i) => (
            <circle
              key={`${p.detectedAt}-${i}`}
              cx={x(i)}
              cy={y(p.frp)}
              r={p.isCurrentSelection ? 3.5 : 2}
              fill={p.isCurrentSelection ? 'var(--color-accent)' : 'var(--color-cls-industrial-ink)'}
              stroke="#ffffff"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {`${new Date(p.detectedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${p.frp.toFixed(
                  1
                )} MW · ${p.instrument} (${p.satellite})`}
              </title>
            </circle>
          ))}
        </svg>

        <span className="num absolute left-2 top-1 text-[10px] text-ink-3">
          {maxFrp.toFixed(1)} MW
        </span>
      </div>

      <div className="flex items-baseline justify-between text-[10px] text-ink-3">
        <span className="num">{dayLabel(first.detectedAt)}</span>
        <span>
          <span className="font-semibold text-accent-strong">Blue</span> marks this detection
        </span>
        <span className="num">{dayLabel(last.detectedAt)}</span>
      </div>
    </div>
  );
}
