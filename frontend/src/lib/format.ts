/** Formats a distance in metres for display. Returns null when unmeasured. */
export function formatDistance(m: number | null | undefined): string | null {
  if (m === null || m === undefined || Number.isNaN(m)) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Formats a FIRMS acquisition timestamp as UTC, which is how FIRMS publishes it. */
export function formatUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** `some_feature_type` → `Some Feature Type`. */
export function titleise(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const LAND_COVER_LABEL: Record<string, string> = {
  forest: 'Forest',
  cropland: 'Cropland',
  built_up: 'Built-up',
  bare: 'Bare ground',
  water: 'Water',
  other: 'Other',
};

export function formatLandCover(v: string | null | undefined): string | null {
  if (!v) return null;
  return LAND_COVER_LABEL[v] ?? titleise(v);
}

/**
 * FIRMS reports detection confidence two different ways depending on sensor:
 * MODIS gives a 0–100 percentage, VIIRS gives a letter class. Rendering the
 * VIIRS code raw puts a bare "n" in front of the analyst, which reads as
 * missing data rather than "nominal".
 */
export function formatFirmsConfidence(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;

  const s = String(v).trim();
  const letter: Record<string, string> = {
    l: 'Low',
    n: 'Nominal',
    h: 'High',
  };
  const named = letter[s.toLowerCase()];
  if (named) return named;

  const n = Number(s);
  return Number.isFinite(n) ? `${n}%` : titleise(s);
}

/** Alert reasons are prefixed by the backend; the UI already shows the chip. */
export function stripAlertPrefix(reason: string): string {
  return reason.replace(/^\[(AI CANDIDATE|LIVE SATELLITE ALERT)\]\s*/i, '');
}
