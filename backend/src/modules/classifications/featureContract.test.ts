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

/**
 * The third lockstep location is ml/src/training/train.py. It is what the model
 * was actually fit on, so a map that drifts there is drift the schema file
 * cannot reveal — feature_schema.json is written by hand and can agree with the
 * backend while both disagree with training. The maps are read out of the
 * Python source directly rather than trusted second-hand.
 */
const trainPySource = readFileSync(
  join(__dirname, '../../../../ml/src/training/train.py'),
  'utf8'
);

function parsePyIntMap(source: string, name: string): Record<string, number> {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
  if (!match) throw new Error(`${name} not found in train.py — the lockstep check cannot run`);
  const out: Record<string, number> = {};
  for (const [, key, value] of match[1].matchAll(/'([^']+)'\s*:\s*(-?\d+)/g)) {
    out[key] = Number(value);
  }
  if (Object.keys(out).length === 0) throw new Error(`${name} in train.py parsed as empty`);
  return out;
}

function parsePyStringList(source: string, name: string): string[] {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm'));
  if (!match) throw new Error(`${name} not found in train.py — the lockstep check cannot run`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const trainPy = {
  facilityTypeMap: parsePyIntMap(trainPySource, 'FACILITY_TYPE_MAP'),
  landcoverMap: parsePyIntMap(trainPySource, 'LANDCOVER_MAP'),
  featureColumns: parsePyStringList(trainPySource, 'FEATURE_COLUMNS'),
};

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

  it("agrees with train.py's facility vocabulary, not just the schema file", () => {
    expect(trainPy.facilityTypeMap).toEqual(schema.facility_type_map);

    // The backend map is intentionally larger: it carries aliases that collapse
    // OSM subcategories onto in-vocabulary parents. What it may never do is emit
    // a code the model was not fit on, or disagree about a name they share.
    const trainedCodes = new Set(Object.values(trainPy.facilityTypeMap));
    for (const [name, code] of Object.entries(FACILITY_TYPE_MAP)) {
      expect(trainedCodes.has(code), `${name} -> ${code} is outside train.py's vocabulary`).toBe(
        true
      );
      if (name in trainPy.facilityTypeMap) {
        expect(code, `${name} disagrees with train.py`).toBe(trainPy.facilityTypeMap[name]);
      }
    }
  });

  it("agrees with train.py's landcover vocabulary", () => {
    expect(trainPy.landcoverMap).toEqual(schema.landcover_map);
    expect(LANDCOVER_MAP).toEqual(trainPy.landcoverMap);
  });

  it("agrees with train.py's feature column order", () => {
    expect(trainPy.featureColumns).toEqual(schema.features);
    expect([...REQUIRED_FEATURES, ...OPTIONAL_FEATURES].sort()).toEqual(
      [...trainPy.featureColumns].sort()
    );
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

  it('treats an unmapped facility type as unresolved, never as `none`', () => {
    // The OSM taxonomy emits subcategories the trained vocabulary has no code
    // for (waste_disposal, railway_yard, unknown). Encoding those as 0 asserted
    // "no facility here" alongside a measured 200 m distance.
    const { values, unresolved } = toCanonicalFeatureRecord({
      ...base,
      facilityDistanceMeters: 200,
      facilityType: 'waste_disposal',
      landCover: 'built_up',
    });
    expect(values.facility_type_encoded).toBeNull();
    expect(unresolved).toContain('facility_type_encoded');
  });

  it('still encodes a genuine absence of facility as `none`', () => {
    const { values } = toCanonicalFeatureRecord({
      ...base,
      facilityDistanceMeters: 4200,
      facilityType: 'none',
      landCover: 'bare',
    });
    expect(values.facility_type_encoded).toBe(0);
  });

  it('never substitutes a thermal default for an unreported band', () => {
    const { values, unresolved } = toCanonicalFeatureRecord({
      ...base,
      frp: null,
      brightness: null,
      brightnessTi5: null,
      tempDelta: null,
      facilityDistanceMeters: 137,
      landCover: 'built_up',
    });
    expect(values.frp).toBeNull();
    expect(values.brightness).toBeNull();
    expect(values.brightness_ti5).toBeNull();
    expect(values.temp_delta_ti4_ti5).toBeNull();
    expect(unresolved).toEqual(
      expect.arrayContaining(['frp', 'brightness', 'brightness_ti5', 'temp_delta_ti4_ti5'])
    );
  });

  it('keeps a measured zero rather than rewriting it as absent', () => {
    const { values, unresolved } = toCanonicalFeatureRecord({
      ...base,
      frp: 0,
      facilityDistanceMeters: 137,
      landCover: 'built_up',
    });
    expect(values.frp).toBe(0);
    expect(unresolved).toEqual([]);
  });

  it('passes an absent historical baseline through as null without gating', () => {
    const { values, unresolved } = toCanonicalFeatureRecord({
      ...base,
      historicalMeanFrp: null,
      frpZScore: null,
      facilityDistanceMeters: 137,
      landCover: 'built_up',
    });
    expect(values.historical_mean_frp).toBeNull();
    expect(values.frp_z_score).toBeNull();
    expect(unresolved).toEqual([]);
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
