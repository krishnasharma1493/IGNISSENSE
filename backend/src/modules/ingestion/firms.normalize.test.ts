import { describe, it, expect } from 'vitest';
import { normalizeFirmsRecord } from './firms.client';

const viirs = {
  latitude: '28.6139', longitude: '77.2090',
  bright_ti4: '340.5', bright_ti5: '300.2',
  scan: '0.5', track: '0.45',
  acq_date: '2026-09-01', acq_time: '0830',
  satellite: 'N', instrument: 'VIIRS',
  confidence: 'n', version: '2.0NRT', frp: '12.3', daynight: 'D',
};

describe('normalizeFirmsRecord', () => {
  it('maps VIIRS bright_ti4/ti5 onto brightness fields', () => {
    const r = normalizeFirmsRecord(viirs as any)!;
    expect(r.brightness).toBe(340.5);
    expect(r.brightnessTi5).toBe(300.2);
  });

  it('maps MODIS brightness/bright_t31 onto the same fields', () => {
    const r = normalizeFirmsRecord({
      ...viirs, bright_ti4: undefined, bright_ti5: undefined,
      brightness: '331.0', bright_t31: '295.0', instrument: 'MODIS',
    } as any)!;
    expect(r.brightness).toBe(331.0);
    expect(r.brightnessTi5).toBe(295.0);
  });

  it('parses acquisition time as UTC', () => {
    const r = normalizeFirmsRecord(viirs as any)!;
    expect(r.detectedAt.toISOString()).toBe('2026-09-01T08:30:00.000Z');
  });

  it('stores coordinates in GeoJSON [lng, lat] order', () => {
    const r = normalizeFirmsRecord(viirs as any)!;
    expect(r.location.coordinates).toEqual([77.209, 28.6139]);
  });

  it('rejects out-of-range coordinates', () => {
    expect(normalizeFirmsRecord({ ...viirs, latitude: '99' } as any)).toBeNull();
  });

  it('rejects a malformed acquisition date', () => {
    expect(normalizeFirmsRecord({ ...viirs, acq_date: '01-09-2026' } as any)).toBeNull();
  });

  it('records ingestedAt separately from detectedAt', () => {
    const r = normalizeFirmsRecord(viirs as any)!;
    expect(r.ingestedAt.getTime()).toBeGreaterThan(r.detectedAt.getTime());
  });
});
