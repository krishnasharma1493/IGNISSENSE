import { CLASS_CONFIG } from '../../types';
import type { ClassificationClass } from '../../types';

interface ClassChipProps {
  cls: ClassificationClass;
  /** Show the Material Symbols glyph alongside the label. */
  icon?: boolean;
  size?: 'sm' | 'md';
}

/**
 * The canonical way to name a thermal-event class in the interface.
 * Uses the class's `ink` colour, which is the light-glass-legible variant.
 */
export function ClassChip({ cls, icon = true, size = 'sm' }: ClassChipProps) {
  const cfg = CLASS_CONFIG[cls];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-semibold ${
        size === 'sm' ? 'px-1.5 py-[2px] text-[10px]' : 'px-2 py-[3px] text-[11px]'
      }`}
      style={{
        color: cfg.ink,
        backgroundColor: `${cfg.ink}14`,
        borderColor: `${cfg.ink}33`,
      }}
    >
      {icon ? (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: size === 'sm' ? 12 : 14 }}
          aria-hidden="true"
        >
          {cfg.icon}
        </span>
      ) : null}
      {cfg.label}
    </span>
  );
}

/** A small colour key dot. Always accompanied by a text label by the caller. */
export function ClassDot({ cls }: { cls: ClassificationClass }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: CLASS_CONFIG[cls].ink }}
      aria-hidden="true"
    />
  );
}

type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_TONE: Record<Severity, { fg: string; bg: string; bd: string }> = {
  critical: { fg: '#8C1D18', bg: 'rgba(179,38,30,0.12)', bd: 'rgba(179,38,30,0.30)' },
  high: { fg: '#B3261E', bg: 'rgba(179,38,30,0.09)', bd: 'rgba(179,38,30,0.24)' },
  medium: { fg: '#8A6100', bg: 'rgba(138,97,0,0.10)', bd: 'rgba(138,97,0,0.26)' },
  low: { fg: '#1B6B3A', bg: 'rgba(27,107,58,0.10)', bd: 'rgba(27,107,58,0.26)' },
};

export function SeverityChip({ severity }: { severity: Severity }) {
  const tone = SEVERITY_TONE[severity] ?? SEVERITY_TONE.low;
  return (
    <span
      className="inline-flex items-center rounded-md border px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.05em]"
      style={{ color: tone.fg, backgroundColor: tone.bg, borderColor: tone.bd }}
    >
      {severity}
    </span>
  );
}

const STATUS_META: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  open: { label: 'Open', fg: '#B3261E', bg: 'rgba(179,38,30,0.09)', bd: 'rgba(179,38,30,0.24)' },
  acknowledged: {
    label: 'Investigating',
    fg: '#8A6100',
    bg: 'rgba(138,97,0,0.10)',
    bd: 'rgba(138,97,0,0.26)',
  },
  resolved: { label: 'Resolved', fg: '#1B6B3A', bg: 'rgba(27,107,58,0.10)', bd: 'rgba(27,107,58,0.26)' },
};

export function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    fg: '#5A6069',
    bg: 'rgba(15,18,22,0.06)',
    bd: 'rgba(15,18,22,0.14)',
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-[2px] text-[10px] font-semibold"
      style={{ color: meta.fg, backgroundColor: meta.bg, borderColor: meta.bd }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.fg }} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/**
 * PRD §36 requires the interface to state plainly that these are decision-support
 * candidates rather than confirmed incidents. This chip is that statement, and it
 * appears wherever an alert or a classification is presented.
 */
export function CandidateChip() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-hairline bg-[rgba(15,18,22,0.05)] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-2"
      title="Machine-generated decision support. Not a confirmed incident."
    >
      <span className="material-symbols-outlined" style={{ fontSize: 11 }} aria-hidden="true">
        smart_toy
      </span>
      AI candidate
    </span>
  );
}

/**
 * Shown in place of `CandidateChip` when the classifier never ran — e.g. a
 * detection gated out for lack of resolvable spatial features. Same
 * achromatic treatment; the icon and label deliberately avoid implying any
 * machine-generated verdict.
 */
export function NotClassifiedChip() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-hairline bg-[rgba(15,18,22,0.05)] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-2"
      title="The classifier did not run: required spatial features could not be measured."
    >
      <span className="material-symbols-outlined" style={{ fontSize: 11 }} aria-hidden="true">
        layers_clear
      </span>
      Not classified
    </span>
  );
}
