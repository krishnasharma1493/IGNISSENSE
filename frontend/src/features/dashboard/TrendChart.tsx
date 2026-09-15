import { stagger } from '../../components/motion/motion';

export interface TrendPoint {
  date: string;
  count: number;
  meanFrp: number;
  maxFrp: number;
}

/**
 * Detection volume per day, with mean radiative power overlaid when there is
 * room for it. Bars are the counts; the line is mean FRP on its own scale, so
 * the two are labelled separately rather than sharing a misleading axis.
 */
export default function TrendChart({
  points,
  showFrp = false,
}: {
  points: TrendPoint[];
  showFrp?: boolean;
}) {
  if (points.length === 0) {
    return (
      <div className="grid h-[180px] place-items-center rounded-md border border-dashed border-hairline-strong">
        <p className="text-[12px] text-ink-3">No fires detected in this period.</p>
      </div>
    );
  }

  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const maxFrp = Math.max(...points.map((p) => p.meanFrp), 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-2">
        {/* Count axis */}
        <div className="flex w-8 shrink-0 flex-col justify-between py-px text-right">
          <span className="num text-[10px] text-ink-3">{maxCount}</span>
          <span className="num text-[10px] text-ink-3">0</span>
        </div>

        <div className="relative h-[180px] flex-1">
          {/* Gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span
              key={t}
              className="absolute left-0 right-0 border-t border-hairline"
              style={{ top: `${t * 100}%` }}
              aria-hidden="true"
            />
          ))}

          <div className="absolute inset-0 flex items-end gap-[3px]">
            {points.map((p, i) => {
              const h = Math.max(2, (p.count / maxCount) * 100);
              return (
                // The column must be full height for the bar's percentage
                // height to resolve against something; against an auto-height
                // parent it collapses to the minimum and the chart reads empty.
                <div key={p.date} className="group relative flex h-full flex-1 items-end">
                  {/* Full height, scaled down to the value: the bar grows in
                      and follows data changes on the compositor, without
                      re-laying-out the column. */}
                  <div
                    className="chart-bar h-full w-full rounded-t-[2px] bg-accent hover:opacity-80"
                    style={stagger(i, { transform: `scaleY(${h / 100})` })}
                  />
                  <span
                    className="chart-tip pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-hairline bg-white px-2 py-1 text-[10px] shadow-md group-hover:block"
                    aria-hidden="true"
                  >
                    <span className="num block font-medium text-ink">{p.date}</span>
                    <span className="num block text-ink-2">{p.count} detections</span>
                    <span className="num block text-ink-3">mean {p.meanFrp.toFixed(1)} MW</span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Mean FRP overlay */}
          {showFrp ? (
            <svg
              className="chart-wipe pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                points={points
                  .map((p, i) => {
                    const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
                    const y = 100 - (p.meanFrp / maxFrp) * 92;
                    return `${x},${y}`;
                  })
                  .join(' ')}
                fill="none"
                stroke="var(--color-cls-industrial-ink)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}
        </div>

        {showFrp ? (
          <div className="flex w-10 shrink-0 flex-col justify-between py-px">
            <span className="num text-[10px] text-cls-industrial-ink">{maxFrp.toFixed(0)} MW</span>
            <span className="num text-[10px] text-ink-3">0</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 pl-10 text-[10px] text-ink-3">
        <span className="num">{points[0].date}</span>
        {showFrp ? (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-accent" aria-hidden="true" />
              Detections
            </span>
            <span className="flex items-center gap-1">
              <span className="h-px w-3 bg-cls-industrial-ink" aria-hidden="true" />
              Mean FRP
            </span>
          </span>
        ) : null}
        <span className="num">{points[points.length - 1].date}</span>
      </div>
    </div>
  );
}
