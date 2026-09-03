import { describe, it, expect } from 'vitest';
import { cacheKey, toPlaceResult } from './geocode.service';

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

describe('toPlaceResult', () => {
  // Representative doc as stored in Mongo (cache miss path also carries
  // key/latitude/longitude/fetchedAt, which must NOT reach the wire).
  const doc = {
    key: '28.614,77.209',
    latitude: 28.6139,
    longitude: 77.209,
    locality: 'Raisina Hill',
    city: 'New Delhi',
    district: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    displayName: 'Raisina Hill, New Delhi, Delhi, 110004, India',
    fetchedAt: new Date('2026-09-02T19:35:59.493Z'),
  };

  it('emits the same key set whether cached is true or false', () => {
    const miss = toPlaceResult(doc, false);
    const hit = toPlaceResult(doc, true);
    expect(Object.keys(miss).sort()).toEqual(Object.keys(hit).sort());
  });

  it('never leaks internal cache-row fields onto the response', () => {
    const result = toPlaceResult(doc, false);
    expect(result).not.toHaveProperty('key');
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('longitude');
    expect(result).not.toHaveProperty('fetchedAt');
  });

  it('carries the place fields through and sets attribution/cached', () => {
    expect(toPlaceResult(doc, false)).toEqual({
      locality: 'Raisina Hill',
      city: 'New Delhi',
      district: 'New Delhi',
      state: 'Delhi',
      country: 'India',
      displayName: 'Raisina Hill, New Delhi, Delhi, 110004, India',
      attribution: '© OpenStreetMap contributors',
      cached: false,
    });
  });
});
