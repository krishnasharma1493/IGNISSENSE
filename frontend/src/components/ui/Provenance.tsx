import type { ReactNode } from 'react';

/**
 * Where a number came from is the primary structure of the investigation panel,
 * not a footnote. Every block of values carries one of these tags.
 *
 *   observed  — read directly off the NASA FIRMS record. Ground truth.
 *   model     — output of the XGBoost service. A prediction, not a measurement.
 *   heuristic — computed in TypeScript by the backend (persistence, anomaly).
 *               Deterministic, but not the model and not observed.
 *   context   — OpenStreetMap spatial enrichment.
 */
export type Provenance = 'observed' | 'model' | 'heuristic' | 'context';

const PROVENANCE_META: Record<
  Provenance,
  { label: string; source: string; className: string }
> = {
  observed: {
    label: 'Measured',
    source: 'NASA FIRMS',
    className: 'text-ink-2 bg-[rgba(15,18,22,0.06)] border-hairline',
  },
  model: {
    label: 'AI prediction',
    source: 'XGBoost',
    className: 'text-accent-strong bg-accent-soft border-accent-line',
  },
  heuristic: {
    label: 'Calculated',
    source: 'by rules',
    className: 'text-warn bg-warn-soft border-[rgba(138,97,0,0.25)]',
  },
  context: {
    label: 'Map data',
    source: 'OpenStreetMap',
    className: 'text-ink-2 bg-[rgba(15,18,22,0.06)] border-hairline',
  },
};

export function ProvenanceTag({ kind }: { kind: Provenance }) {
  const meta = PROVENANCE_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.07em] ${meta.className}`}
    >
      {meta.label}
      <span className="opacity-45" aria-hidden="true">
        ·
      </span>
      <span className="font-normal opacity-80">{meta.source}</span>
    </span>
  );
}

interface SectionProps {
  title: string;
  kind: Provenance;
  /** Right-aligned annotation — a count, a version, a radius. */
  meta?: ReactNode;
  children: ReactNode;
}

/** A titled block of values with its provenance stated in the header. */
export function Section({ title, kind, meta, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-2.5">
      {/* Wraps rather than truncates. The title names the block and the tag says
          where its numbers came from — clipping either one loses the point. */}
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline pb-1.5">
        <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink">
          {title}
        </h3>
        <ProvenanceTag kind={kind} />
        {meta ? (
          <span className="num ml-auto min-w-0 truncate text-[10px] text-ink-3">{meta}</span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
