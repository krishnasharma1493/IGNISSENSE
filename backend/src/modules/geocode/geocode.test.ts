import { describe, it, expect } from 'vitest';
import { cacheKey } from './geocode.service';

describe('cacheKey', () => {
  it('rounds to three decimal places (~100m)', () => {
    expect(cacheKey(28.61392, 77.20901)).toBe('28.614,77.209');
  });

  it('collapses coordinates within the same ~100m cell', () => {
    expect(cacheKey(28.6139, 77.2090)).toBe(cacheKey(28.61391, 77.20899));
  });

  it('separates coordinates in different cells', () => {
    expect(cacheKey(28.614, 77.209)).not.toBe(cacheKey(28.620, 77.209));
  });
});
