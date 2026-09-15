import type { ReactNode } from 'react';
import { ProvenanceTag } from './Provenance';
import type { Provenance } from './Provenance';

/** A headline figure. Values use proportional figures; they don't align in a column. */
export function Stat({
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
        className="mt-0.5 text-[20px] font-semibold leading-none tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value === null || value === undefined ? <span className="text-ink-4">—</span> : value}
      </div>
      {hint ? <div className="mt-1 text-[10px] text-ink-3">{hint}</div> : null}
    </div>
  );
}

/** A titled block whose header states where its numbers came from. */
export function Card({
  title,
  provenance,
  meta,
  action,
  children,
}: {
  title: string;
  provenance: Provenance;
  meta?: string;
  /** A small control on the right of the header, e.g. a chart/table toggle. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-hairline bg-white/60">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[12px] font-semibold text-ink">{title}</h2>
          <ProvenanceTag kind={provenance} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta ? <span className="num text-[11px] text-ink-3">{meta}</span> : null}
          {action}
        </div>
      </header>
      <div className="flex-1 p-3.5">{children}</div>
    </section>
  );
}
