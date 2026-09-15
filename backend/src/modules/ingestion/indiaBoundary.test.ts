import { describe, it, expect } from 'vitest';
import { isInsideIndia, INDIA_BOUNDARY_SOURCE } from './indiaBoundary';

// [longitude, latitude]
const INSIDE: Record<string, [number, number]> = {
  Delhi: [77.21, 28.61],
  Ballari: [76.666, 15.183],
  Leh: [77.58, 34.16],
  Tawang: [91.86, 27.59],
  'Port Blair': [92.73, 11.62],
  // India's official boundary includes these; a de facto boundary would drop them.
  Gilgit: [74.31, 35.92],
  Muzaffarabad: [73.47, 34.37],
  'Aksai Chin': [79.3, 35.2],
};

const OUTSIDE: Record<string, [number, number]> = {
  Colombo: [79.86, 6.93],
  Jaffna: [80.01, 9.66],
  Lahore: [74.36, 31.52],
  Kathmandu: [85.32, 27.72],
  Dhaka: [90.41, 23.81],
  Yangon: [96.16, 16.87],
  'Arabian Sea': [66.0, 15.0],
};

describe('isInsideIndia', () => {
  it('uses the India point-of-view boundary', () => {
    expect(INDIA_BOUNDARY_SOURCE).toContain('ne_10m_admin_0_countries_ind');
  });

  for (const [name, [lon, lat]] of Object.entries(INSIDE)) {
    it(`keeps ${name}`, () => expect(isInsideIndia(lon, lat)).toBe(true));
  }

  for (const [name, [lon, lat]] of Object.entries(OUTSIDE)) {
    it(`drops ${name}`, () => expect(isInsideIndia(lon, lat)).toBe(false));
  }
});
