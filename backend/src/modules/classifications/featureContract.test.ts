import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACILITY_TYPE_MAP, LANDCOVER_MAP, REQUIRED_FEATURES, OPTIONAL_FEATURES,
} from './featureContract';

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
});
