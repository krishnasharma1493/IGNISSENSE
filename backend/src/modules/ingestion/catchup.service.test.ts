import { describe, it, expect } from 'vitest';
import { computeCatchupDayRange } from './catchup.service';
import { FIRMS_MAX_DAY_RANGE } from './firms.client';

const now = new Date('2026-09-02T12:00:00Z');

describe('computeCatchupDayRange', () => {
  it('returns null when the last poll is recent', () => {
    expect(computeCatchupDayRange(new Date('2026-09-02T11:58:00Z'), now)).toBeNull();
  });

  it('returns a day range covering the gap', () => {
    expect(computeCatchupDayRange(new Date('2026-08-31T12:00:00Z'), now)).toBe(3);
  });

  it('clamps to the widest window FIRMS accepts', () => {
    expect(computeCatchupDayRange(new Date('2026-01-01T00:00:00Z'), now)).toBe(FIRMS_MAX_DAY_RANGE);
  });

  it('returns the maximum when no prior poll exists', () => {
    expect(computeCatchupDayRange(null, now)).toBe(FIRMS_MAX_DAY_RANGE);
  });
});

describe('the requested window never exceeds what FIRMS will serve', () => {
  it('stays within the ceiling for any gap, however long', () => {
    const gaps = [null, new Date('2020-01-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z')];
    for (const last of gaps) {
      const range = computeCatchupDayRange(last as Date | null, now);
      if (range !== null) {
        expect(range).toBeGreaterThanOrEqual(1);
        expect(range).toBeLessThanOrEqual(FIRMS_MAX_DAY_RANGE);
      }
    }
  });
});
