import { describe, it, expect } from 'vitest';
import { computeCatchupDayRange } from './catchup.service';

const now = new Date('2026-09-02T12:00:00Z');

describe('computeCatchupDayRange', () => {
  it('returns null when the last poll is recent', () => {
    expect(computeCatchupDayRange(new Date('2026-09-02T11:58:00Z'), now)).toBeNull();
  });

  it('returns a day range covering the gap', () => {
    expect(computeCatchupDayRange(new Date('2026-08-31T12:00:00Z'), now)).toBe(3);
  });

  it('clamps to the FIRMS maximum of 10', () => {
    expect(computeCatchupDayRange(new Date('2026-01-01T00:00:00Z'), now)).toBe(10);
  });

  it('returns the maximum when no prior poll exists', () => {
    expect(computeCatchupDayRange(null, now)).toBe(10);
  });
});
