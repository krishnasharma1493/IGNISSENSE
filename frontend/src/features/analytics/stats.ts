/** Linear-interpolated quantile of an ascending-sorted array; null when empty. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** UTC calendar day of an ISO timestamp, e.g. "2026-09-14". */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** The `n` latest distinct days, ascending. */
export function latestDays(isoTimestamps: string[], n: number): string[] {
  const days = Array.from(new Set(isoTimestamps.map(utcDay))).sort();
  return days.slice(Math.max(0, days.length - n));
}

/** Compact MW label: 0.8 · 6.4 · 42 · 1.2k. */
export function formatMw(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}
