import type { ReactNode } from 'react';
import { stagger } from '../motion/motion';

/**
 * The em-dash is the only thing a missing value may render as.
 *
 * The previous build filled nulls with plausible-looking defaults — `frp || 12.0`,
 * `satellite || 'Aqua'`, `anomalyScore || '0.75'` — which put invented numbers in
 * front of an analyst with no way to tell them from measurements. Routing every
 * value through these components makes that impossible to do by accident: there
 * is no code path here that substitutes a number for absence.
 */

export const MISSING = '—';

function Missing({ what }: { what?: string }) {
  return (
    <span className="text-ink-4" title={what ? `${what} not reported for this detection` : undefined}>
      {MISSING}
    </span>
  );
}

interface FieldProps {
  label: string;
  /** Rendered as-is when present. `null`/`undefined` becomes an em-dash. */
  value: ReactNode | null | undefined;
  /** Appended after the value when the value is present. */
  unit?: string;
  /** Monospace tabular figures. Use for anything numeric. */
  numeric?: boolean;
  className?: string;
}

/** One label/value pair in a stacked list. */
export function Field({ label, value, unit, numeric = false, className = '' }: FieldProps) {
  const present = value !== null && value !== undefined && value !== '';
  return (
    <div className={`flex items-baseline justify-between gap-3 py-[5px] ${className}`}>
      <dt className="shrink-0 text-[11px] text-ink-3">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-[12px] font-medium text-ink ${
          numeric ? 'num' : ''
        }`}
      >
        {present ? (
          <>
            {value}
            {unit ? <span className="ml-0.5 text-[10px] font-normal text-ink-3">{unit}</span> : null}
          </>
        ) : (
          <Missing what={label} />
        )}
      </dd>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  /** Optional qualitative band shown beneath, e.g. "High". */
  band?: string;
  /** Colour for the value. Defaults to ink. */
  tone?: string;
}

/** A single emphasised number. Used for the headline thermal readouts. */
export function Metric({ label, value, unit, band, tone }: MetricProps) {
  const present = value !== null && value !== undefined && value !== '';
  return (
    <div className="inset-surface flex flex-col gap-0.5 rounded-md px-2.5 py-2">
      <span className="text-[10px] uppercase tracking-[0.05em] text-ink-3">{label}</span>
      <span className="num text-[17px] font-semibold leading-tight" style={tone ? { color: tone } : undefined}>
        {present ? (
          <>
            {value}
            {unit ? <span className="ml-0.5 text-[11px] font-normal text-ink-3">{unit}</span> : null}
          </>
        ) : (
          <Missing what={label} />
        )}
      </span>
      {band ? <span className="text-[10px] text-ink-3">{band}</span> : null}
    </div>
  );
}

interface BarProps {
  label: string;
  /** 0..1 */
  value: number;
  color: string;
  /** Emphasise this row as the winning class. */
  emphasis?: boolean;
  /** Position in a list of bars; staggers the grow-in. */
  index?: number;
}

/** A labelled proportion bar. Percentage is always shown as text, never colour alone. */
export function Bar({ label, value, color, emphasis = false, index = 0 }: BarProps) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-[11px] ${
            emphasis ? 'font-semibold text-ink' : 'text-ink-2'
          }`}
        >
          {label}
        </span>
        <span
          className={`num shrink-0 text-[11px] ${emphasis ? 'font-semibold' : ''}`}
          style={{ color: emphasis ? color : 'var(--color-ink-3)' }}
        >
          {pct}%
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(15,18,22,0.07)]"
        role="img"
        aria-label={`${label}: ${pct} percent`}
      >
        <div
          className="bar-grow h-full rounded-full transition-[width] duration-300"
          style={stagger(index, { width: `${pct}%`, backgroundColor: color, opacity: emphasis ? 1 : 0.55 })}
        />
      </div>
    </div>
  );
}
