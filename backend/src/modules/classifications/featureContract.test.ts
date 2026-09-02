import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACILITY_TYPE_MAP, LANDCOVER_MAP, REQUIRED_FEATURES, OPTIONAL_FEATURES,
} from './featureContract';
import { toCanonicalFeatureRecord } from './feature.extractor';

const schema = JSON.parse(
  readFileSync(join(__dirname, '../../../../ml/models/feature_schema.json'), 'utf8')
);

describe('feature contract lockstep', () => {
  it('emits no facility code outside the trained vocabulary', () => {
    const trained = new Set<number>(Object.values(schema.facility_type_map));
    for (const [name, code] of Object.entries(FACILITY_TYPE_MAP)) {
      expect(trained.has(code), `${name} -> ${code} is out of vocabulary`).toBe(true);
    }
  });

  it('matches the schema landcover map exactly', () => {
    expect(LANDCOVER_MAP).toEqual(schema.landcover_map);
  });

  it('covers every schema feature exactly once', () => {
    const declared = [...REQUIRED_FEATURES, ...OPTIONAL_FEATURES].sort();
    expect(declared).toEqual([...schema.features].sort());
  });

  it('keeps FACILITY_TYPE_MAP as the only facility encoding reachable from the classifications module', () => {
    // FACILITY_TYPE_ENCODING (backend/src/modules/osm/taxonomy.ts) used to carry the same
    // out-of-vocabulary codes (9-13) this contract exists to eliminate. It was dead code —
    // imported but never used in feature.extractor.ts — so it was deleted outright rather
    // than left as a landmine. These two guards fail if either half of that landmine is
    // re-armed: the symbol reappearing in taxonomy.ts, or feature.extractor.ts importing it.
    const taxonomySource = readFileSync(
      join(__dirname, '../osm/taxonomy.ts'),
      'utf8'
    );
    expect(
      taxonomySource.includes('FACILITY_TYPE_ENCODING'),
      'FACILITY_TYPE_ENCODING must not be reintroduced in osm/taxonomy.ts — ' +
        'facility_type_encoded fed to the classifier must come only from featureContract.ts'
    ).toBe(false);

    const extractorSource = readFileSync(
      join(__dirname, './feature.extractor.ts'),
      'utf8'
    );
    expect(
      extractorSource.includes('FACILITY_TYPE_ENCODING'),
      'feature.extractor.ts must not import FACILITY_TYPE_ENCODING — ' +
        'the model input vocabulary must come only from featureContract.ts'
    ).toBe(false);
  });
});

const base: any = {
  frp: 10, brightness: 330, brightnessTi5: 300, tempDelta: 30,
  confidence: 'n', dayNight: 'N',
  facilityDistanceMeters: null, facilityType: 'none', landCover: 'other',
  nearbyClusterCount3km: 2,
  historicalOverpassesWithin1_5km: 0, historicalMeanFrp: 0, frpZScore: 0,
  daysSinceLastDetection: null,
};

describe('toCanonicalFeatureRecord', () => {
  it('never substitutes 25000 for an unmeasured facility distance', () => {
    const { values } = toCanonicalFeatureRecord(base);
    expect(values.facility_distance_m).toBeNull();
  });

  it('reports unresolved required features', () => {
    const { unresolved } = toCanonicalFeatureRecord(base);
    expect(unresolved).toContain('facility_distance_m');
  });

  it('never substitutes -1 for absent history', () => {
    const { values } = toCanonicalFeatureRecord(base);
    expect(values.days_since_last_detection).toBeNull();
  });

  it('does not treat absent history as unresolved', () => {
    const { unresolved } = toCanonicalFeatureRecord(base);
    expect(unresolved).not.toContain('days_since_last_detection');
  });

  it('passes measured values through untouched', () => {
    const { values, unresolved } = toCanonicalFeatureRecord({
      ...base, facilityDistanceMeters: 137, landCover: 'built_up',
    });
    expect(values.facility_distance_m).toBe(137);
    expect(values.landcover_encoded).toBe(0);
    expect(unresolved).toEqual([]);
  });
});
