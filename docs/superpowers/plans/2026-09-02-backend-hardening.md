# IGNISSENSE Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the IGNISSENSE backend honest — no silent fallbacks, no substituted values passed off as measurements, explicit "insufficient data" outcomes, and real place names from real geospatial data.

**Architecture:** Three independent workstreams over the existing Express/Mongoose backend. Phase 2 removes silent degradation and adds traceability. Phase 4 stops the feature extractor inventing values and introduces an explicit `unclassified_insufficient_features` outcome distinct from a model verdict. Phase 5 adds a rate-limited, cached Nominatim proxy. Phase 3 (PostGIS) is blocked on a tooling decision and is specified separately at the end.

**Tech Stack:** TypeScript, Express, Mongoose, Vitest, axios. Python stdlib HTTP for the ML service.

**Spec:** `docs/superpowers/specs/2026-09-02-ignissense-hardening-design.md`

## Global Constraints

- API responses keep the envelope `{ success: boolean, data?: T, error?: { code, message } }`. The frontend axios interceptor in `frontend/src/api/client.ts` depends on this shape.
- Never substitute a plausible value for a missing one. Absence is represented as `null` and recorded as unresolved.
- The interface says **"near real-time"**, never "real-time".
- Backend module convention: `src/modules/<name>/<name>.model.ts`, `<name>.routes.ts` (exported as `<name>Routes`), optional `<name>.service.ts`. Routes mount in `app.ts` under `/api/v1/<name>`.
- The canonical feature vector is defined in three places that must stay in lockstep: `ml/models/feature_schema.json`, `ml/src/training/train.py`, `backend/src/modules/classifications/feature.extractor.ts`.
- Required spatial features: `facility_distance_m`, `facility_type_encoded`, `landcover_encoded`, `nearby_cluster_count_3km`. Optional: the historical group.
- Facility codes 9–13 collapse to in-vocabulary parents: 9→7, 10→1, 11→1, 12→2, 13→2.
- FIRMS `dayRange` is clamped 1–10 by the API.
- Commit after every task. Never commit a failing test suite.

---

## File Structure

**Created:**
- `backend/vitest.config.ts` — test runner config
- `backend/src/modules/ingestion/firms.normalize.test.ts` — normalization behaviour lock
- `backend/src/modules/ingestion/catchup.service.ts` — boot-time gap recovery
- `backend/src/modules/classifications/featureContract.ts` — required/optional declaration, encoding maps, single source of truth
- `backend/src/modules/classifications/featureContract.test.ts` — lockstep assertions
- `backend/src/modules/geocode/geocode.model.ts` — cache collection
- `backend/src/modules/geocode/geocode.service.ts` — Nominatim client + limiter
- `backend/src/modules/geocode/geocode.routes.ts` — `/api/v1/geocode/reverse`
- `backend/src/modules/geocode/geocode.test.ts`

**Modified:**
- `backend/src/config/index.ts` — `allowEphemeralDb`, `nominatim` config
- `backend/src/config/database.ts` — remove silent fallback
- `backend/src/modules/hotspots/hotspot.model.ts` — `rawSource`
- `backend/src/modules/ingestion/firms.client.ts` — carry raw row through normalize
- `backend/src/modules/ingestion/ingestion.service.ts` — persist raw, call catch-up
- `backend/src/modules/classifications/classification.model.ts` — completeness, versions, timestamp
- `backend/src/modules/classifications/feature.extractor.ts` — stop substituting
- `backend/src/modules/classifications/classification.service.ts` — gate inference
- `backend/src/modules/system/system.routes.ts` — `databaseMode`
- `backend/src/app.ts` — mount geocode routes
- `ml/src/inference/service.py` — reject nulls
- `ml/models/model_metadata.json` — honest provenance
- `frontend/src/types/index.ts` — unclassified state
- `frontend/src/features/hotspots/InvestigationPanel.tsx` — render unclassified, place name

---

# PHASE 2 — Data integrity

### Task 1: Test harness

**Files:**
- Create: `backend/vitest.config.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `npm test` and `npm run test:watch` in `backend/`.

- [ ] **Step 1: Install Vitest**

```bash
cd backend && npm install -D vitest@2
```

- [ ] **Step 2: Create the config**

```typescript
// backend/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
});
```

- [ ] **Step 3: Add scripts**

In `backend/package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify the runner starts**

Run: `cd backend && npm test`
Expected: exits 0 with "No test files found" (or passes once Task 2 lands).

- [ ] **Step 5: Commit**

```bash
git add backend/vitest.config.ts backend/package.json backend/package-lock.json
git commit -m "test: add vitest harness to backend"
```

---

### Task 2: Lock FIRMS normalization behaviour

Write these tests *before* touching ingestion, so Phase 2 changes cannot silently alter parsing.

**Files:**
- Create: `backend/src/modules/ingestion/firms.normalize.test.ts`

**Interfaces:**
- Consumes: `normalizeFirmsRecord` from `./firms.client`.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/ingestion/firms.normalize.test.ts
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
```

- [ ] **Step 2: Run and confirm they pass**

Run: `cd backend && npm test`
Expected: 7 passing. These document existing correct behaviour; if any fail, the failure is a real pre-existing bug — stop and report it rather than editing the test to match.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/ingestion/firms.normalize.test.ts
git commit -m "test: lock FIRMS normalization behaviour"
```

---

### Task 3: Remove the silent database fallback

**Files:**
- Modify: `backend/src/config/index.ts`
- Modify: `backend/src/config/database.ts`
- Modify: `backend/src/modules/system/system.routes.ts`

**Interfaces:**
- Produces: `getDatabaseMode(): 'atlas' | 'ephemeral'` exported from `config/database.ts`; `databaseMode` field on `/api/v1/system/status`.

- [ ] **Step 1: Add the config flag**

In `backend/src/config/index.ts`, inside the exported object after `demoMode`:

```typescript
  // When false (default) the server refuses to start rather than silently
  // serving an in-memory database as if it were live data.
  allowEphemeralDb: process.env.ALLOW_EPHEMERAL_DB === 'true',
```

- [ ] **Step 2: Rewrite the connect path**

Replace the body of `connectDatabase` in `backend/src/config/database.ts`:

```typescript
let databaseMode: 'atlas' | 'ephemeral' = 'atlas';

export function getDatabaseMode() {
  return databaseMode;
}

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  try {
    console.log('[DB] Connecting to MongoDB...');
    await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 4000 });
    databaseMode = 'atlas';
    console.log('[DB] Connected.');
    return;
  } catch (err: any) {
    if (!config.allowEphemeralDb) {
      console.error(
        `[DB] Connection failed: ${err.message}\n` +
        '[DB] Refusing to start with an ephemeral database. Data served from an\n' +
        '[DB] in-memory store is not live FIRMS data and must not be presented as such.\n' +
        '[DB] Fix MONGODB_URI, or set ALLOW_EPHEMERAL_DB=true to accept a degraded,\n' +
        '[DB] clearly-labelled development mode.'
      );
      throw err;
    }
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServerInstance = await MongoMemoryServer.create();
  await mongoose.connect(memoryServerInstance.getUri());
  databaseMode = 'ephemeral';
  console.warn('[DB] ⚠ EPHEMERAL MODE — data is not persistent and is not live.');
}
```

Delete the auto-seed `setTimeout` block entirely; seeding on an ephemeral store is what made the two modes indistinguishable in the logs.

- [ ] **Step 3: Surface it in system status**

In `backend/src/modules/system/system.routes.ts`, import `getDatabaseMode` from `../../config/database` and add to the response payload:

```typescript
      databaseMode: getDatabaseMode(),
```

- [ ] **Step 4: Verify both paths**

Run: `cd backend && MONGODB_URI=mongodb://127.0.0.1:1/x npx tsx src/server.ts`
Expected: the refusal message, process exits non-zero.

Run: `cd backend && MONGODB_URI=mongodb://127.0.0.1:1/x ALLOW_EPHEMERAL_DB=true npx tsx src/server.ts`
Expected: the ⚠ EPHEMERAL MODE warning, server starts. Then `curl -s localhost:5001/api/v1/system/status | grep ephemeral` shows the mode.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config backend/src/modules/system/system.routes.ts
git commit -m "fix: refuse to start on an ephemeral database unless explicitly allowed"
```

---

### Task 4: Preserve the raw FIRMS row

**Files:**
- Modify: `backend/src/modules/ingestion/firms.client.ts`
- Modify: `backend/src/modules/hotspots/hotspot.model.ts`
- Modify: `backend/src/modules/hotspots/hotspot.routes.ts`

**Interfaces:**
- Produces: `rawSource: Record<string, string>` on the hotspot document, excluded from list responses.

- [ ] **Step 1: Carry the raw row through normalize**

At the end of the returned object in `normalizeFirmsRecord` (`firms.client.ts`), add:

```typescript
    // Verbatim CSV row, kept for traceability back to the FIRMS product.
    rawSource: { ...raw } as unknown as Record<string, string>,
```

- [ ] **Step 2: Add the schema field**

In `hotspot.model.ts`, add to the interface `rawSource?: Record<string, string>;` and to the schema:

```typescript
    rawSource: {
      type: Schema.Types.Mixed,
      default: null,
      select: false, // excluded unless explicitly requested
    },
```

- [ ] **Step 3: Allow opt-in retrieval**

In `hotspot.routes.ts`, in the `GET /:id` handler, change the query to honour `?includeRaw=true`:

```typescript
    const projection = req.query.includeRaw === 'true' ? '+rawSource' : '';
    const hotspot = await Hotspot.findById(req.params.id).select(projection).lean();
```

- [ ] **Step 4: Verify**

Restart the backend, wait for one poll, then:

```bash
curl -s "localhost:5001/api/v1/hotspots?limit=1" | grep -c rawSource   # expect 0
ID=$(curl -s "localhost:5001/api/v1/hotspots?limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['hotspots'][0]['_id'])")
curl -s "localhost:5001/api/v1/hotspots/$ID?includeRaw=true" | grep -c acq_date  # expect 1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ingestion/firms.client.ts backend/src/modules/hotspots
git commit -m "feat: preserve raw FIRMS CSV row for traceability"
```

---

### Task 5: Ingestion catch-up on boot

**Files:**
- Create: `backend/src/modules/ingestion/catchup.service.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Produces: `computeCatchupDayRange(lastSuccessAt: Date | null, now: Date): number | null` and `runCatchupIfNeeded(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/ingestion/catchup.service.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/ingestion/catchup.service.test.ts`
Expected: FAIL — cannot resolve `./catchup.service`.

- [ ] **Step 3: Implement**

```typescript
// backend/src/modules/ingestion/catchup.service.ts
import { IngestionLog } from './ingestion.model';
import { ingestFirmsIndia } from './ingestion.service';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FIRMS_MAX_DAY_RANGE = 10;

/**
 * A restart mid-cycle silently skips a poll. On boot we look at how long it has
 * been since the last successful ingestion and, if that exceeds one poll
 * interval, request a day range wide enough to cover the gap.
 *
 * Returns null when no catch-up is warranted.
 */
export function computeCatchupDayRange(lastSuccessAt: Date | null, now: Date): number | null {
  if (lastSuccessAt === null) return FIRMS_MAX_DAY_RANGE;
  const gapMs = now.getTime() - lastSuccessAt.getTime();
  if (gapMs <= POLL_INTERVAL_MS) return null;
  const days = Math.ceil(gapMs / (24 * 60 * 60 * 1000));
  return Math.min(FIRMS_MAX_DAY_RANGE, Math.max(1, days));
}

export async function runCatchupIfNeeded(): Promise<void> {
  const last = await IngestionLog.findOne({ status: 'SUCCESS' })
    .sort({ retrievedAt: -1 })
    .select('retrievedAt')
    .lean();

  const dayRange = computeCatchupDayRange(last?.retrievedAt ?? null, new Date());
  if (dayRange === null) {
    console.log('[Catchup] Last poll is recent; no gap to recover.');
    return;
  }

  console.log(`[Catchup] Recovering a gap in coverage with dayRange=${dayRange}.`);
  await ingestFirmsIndia({ dayRange });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/ingestion/catchup.service.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Wire into boot**

In `backend/src/server.ts`, replace the `setTimeout(runLiveSyncLoop, 5000)` line with:

```typescript
    setTimeout(async () => {
      const { runCatchupIfNeeded } = await import('./modules/ingestion/catchup.service');
      await runCatchupIfNeeded();
      setInterval(runLiveSyncLoop, 5 * 60 * 1000);
    }, 5000);
```

and delete the standalone `setInterval` line beneath it, so the interval starts only after catch-up completes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ingestion/catchup.service.ts backend/src/modules/ingestion/catchup.service.test.ts backend/src/server.ts
git commit -m "feat: recover skipped FIRMS polls after a restart"
```

---

### Task 6: Honest model metadata and terminology

**Files:**
- Modify: `ml/models/model_metadata.json`
- Modify: `ml/src/training/train.py` (docstrings only)
- Modify: `frontend/src/components/AppBar.tsx`

- [ ] **Step 1: Correct the metadata**

Replace the `training_dataset_version`, `label_generation_method` and `metrics` keys in `ml/models/model_metadata.json`:

```json
  "training_dataset_version": "SYNTHETIC_GENERATOR_V1",
  "label_generation_method": "synthetic — per-class numpy random distributions from construct_dataset(); labels are a deterministic function of the sampled features",
  "provenance_warning": "This model has NOT been trained on NASA FIRMS or OpenStreetMap data. The metrics below are meaningless: they measure the model's ability to invert a generator it was handed, not real-world classification accuracy. Do not cite them as model performance.",
```

- [ ] **Step 2: Correct the docstring**

In `ml/src/training/train.py`, replace the `construct_dataset` docstring first line with:

```python
    """Generate a SYNTHETIC training set from per-class numpy distributions.

    This is not FIRMS or OSM data. Labels are a deterministic function of the
    sampled features, which is why evaluation metrics come out at 1.0. Replace
    this with the weak-supervision labeller over real detections before any
    metric from this pipeline is reported as model performance.
    """
```

- [ ] **Step 3: Fix the terminology**

In `frontend/src/components/AppBar.tsx`, change the status button label from `'Live'` to `'Near real-time'` and the `aria-label` accordingly. The 5-minute poll of an NRT satellite product does not support the word "live".

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build`
Expected: builds clean.

- [ ] **Step 5: Commit**

```bash
git add ml/models/model_metadata.json ml/src/training/train.py frontend/src/components/AppBar.tsx
git commit -m "docs: state synthetic model provenance honestly; say near real-time"
```

---

# PHASE 4 — Honest ML pipeline

### Task 7: Single-source the feature contract

**Files:**
- Create: `backend/src/modules/classifications/featureContract.ts`
- Create: `backend/src/modules/classifications/featureContract.test.ts`
- Modify: `backend/src/modules/classifications/feature.extractor.ts`

**Interfaces:**
- Produces: `FACILITY_TYPE_MAP`, `LANDCOVER_MAP`, `REQUIRED_FEATURES`, `OPTIONAL_FEATURES`, `FEATURE_VERSION`, `MODEL_VOCABULARY_MAX_FACILITY_CODE`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/classifications/featureContract.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/classifications/featureContract.test.ts`
Expected: FAIL — cannot resolve `./featureContract`.

- [ ] **Step 3: Implement the contract**

```typescript
// backend/src/modules/classifications/featureContract.ts

/** Bump when the meaning or membership of the feature vector changes. */
export const FEATURE_VERSION = 'v1.1.0';

/**
 * Facility type codes.
 *
 * The trained model knows codes 0-8 only. Types discovered later in the
 * India-wide OSM taxonomy collapse onto their nearest in-vocabulary parent
 * rather than extending the vocabulary — feeding a tree a code it never saw in
 * training produces undefined behaviour, not a graceful degradation. These
 * types get their own codes when the model is retrained on data containing them.
 */
export const FACILITY_TYPE_MAP: Record<string, number> = {
  none: 0,
  refinery: 1,
  power_plant: 2,
  chemical: 3,
  brick_kiln: 4,
  steel_mill: 5,
  quarry_mining: 6,
  general_industrial: 7,
  warehouse: 8,

  chemical_plant: 3,
  steel_plant: 5,
  thermal_power_station: 2,
  hydroelectric: 2,
  mine: 6,
  coal_mine: 6,
  opencast_mine: 6,
  quarry: 6,
  factory: 7,
  manufacturing: 7,
  works: 7,
  industrial_area: 7,
  industrial: 7,

  // Collapsed to in-vocabulary parents (see docstring above).
  cement_plant: 7,        // was 9
  oil_gas_facility: 1,    // was 10
  lpg_plant: 1,
  pipeline_station: 1,
  oil_terminal: 1,
  gas_flare: 1,
  petroleum_well: 1,      // was 11
  substation: 2,          // was 12
  solar_farm: 2,          // was 13
  wind_farm: 2,
};

export const LANDCOVER_MAP: Record<string, number> = {
  built_up: 0,
  cropland: 1,
  forest: 2,
  bare: 3,
  water: 4,
  other: 5,
};

/**
 * Spatial features. If any of these is unresolved the detection cannot be
 * classified — these are what separate an industrial fire from a crop burn.
 */
export const REQUIRED_FEATURES = [
  'frp',
  'brightness',
  'brightness_ti5',
  'temp_delta_ti4_ti5',
  'confidence',
  'is_night',
  'facility_distance_m',
  'facility_type_encoded',
  'landcover_encoded',
  'nearby_cluster_count_3km',
] as const;

/**
 * Historical features. A first-ever detection at a coordinate legitimately has
 * no history; that is a real observation, not missing data, so it is passed as
 * null rather than blocking classification.
 */
export const OPTIONAL_FEATURES = [
  'historical_recurrence_1_5km',
  'historical_mean_frp',
  'frp_z_score',
  'days_since_last_detection',
] as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/classifications/featureContract.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Re-point the extractor**

In `feature.extractor.ts`, delete the local `FACILITY_TYPE_MAP` and `LANDCOVER_MAP` declarations and re-export from the contract so existing importers keep working:

```typescript
export { FACILITY_TYPE_MAP, LANDCOVER_MAP } from './featureContract';
import { FACILITY_TYPE_MAP, LANDCOVER_MAP } from './featureContract';
```

- [ ] **Step 6: Verify nothing else broke**

Run: `cd backend && npm run typecheck && npm test`
Expected: clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/classifications/featureContract.ts backend/src/modules/classifications/featureContract.test.ts backend/src/modules/classifications/feature.extractor.ts
git commit -m "fix: collapse out-of-vocabulary facility codes, single-source the feature contract"
```

---

### Task 8: Stop substituting missing features

**Files:**
- Modify: `backend/src/modules/classifications/feature.extractor.ts`
- Create test cases in: `backend/src/modules/classifications/featureContract.test.ts`

**Interfaces:**
- Produces: `toCanonicalFeatureRecord(features): { values: Record<string, number | null>, unresolved: string[] }` — note the changed return type; Task 9 consumes it.

- [ ] **Step 1: Write the failing test**

Append to `featureContract.test.ts`:

```typescript
import { toCanonicalFeatureRecord } from './feature.extractor';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/classifications/featureContract.test.ts`
Expected: FAIL — currently returns a flat record and substitutes `25000` / `-1`.

- [ ] **Step 3: Rewrite the function**

Replace `toCanonicalFeatureRecord` in `feature.extractor.ts`:

```typescript
import { REQUIRED_FEATURES } from './featureContract';

export interface CanonicalFeatures {
  values: Record<string, number | null>;
  unresolved: string[];
}

/**
 * Build the model input.
 *
 * Absence is represented as null and reported in `unresolved`. Nothing is
 * substituted: the previous implementation emitted 25000 for an unmeasured
 * facility distance and -1 for absent history, both of which are
 * indistinguishable downstream from real measurements.
 *
 * `landcover_encoded` is null rather than 5 when enrichment found nothing,
 * because 5 means "other" — a real observed category — and conflating the two
 * is exactly the bug this replaces.
 */
export function toCanonicalFeatureRecord(features: ExtractedFeatures): CanonicalFeatures {
  let numConfidence: number | null = null;
  if (typeof features.confidence === 'number') {
    numConfidence = features.confidence / 100;
  } else if (typeof features.confidence === 'string') {
    const lower = features.confidence.toLowerCase();
    if (lower === 'h' || lower === 'high') numConfidence = 0.95;
    else if (lower === 'n' || lower === 'nominal') numConfidence = 0.75;
    else if (lower === 'l' || lower === 'low') numConfidence = 0.4;
    else {
      const parsed = parseFloat(features.confidence);
      numConfidence = Number.isNaN(parsed) ? null : parsed > 1 ? parsed / 100 : parsed;
    }
  }

  const hasEnrichment = features.facilityDistanceMeters !== null;

  const values: Record<string, number | null> = {
    frp: features.frp ?? null,
    brightness: features.brightness ?? null,
    brightness_ti5: features.brightnessTi5 ?? null,
    temp_delta_ti4_ti5: features.tempDelta ?? null,
    confidence: numConfidence,
    is_night: features.dayNight === 'N' ? 1 : 0,
    facility_distance_m: features.facilityDistanceMeters,
    facility_type_encoded: hasEnrichment ? FACILITY_TYPE_MAP[features.facilityType] ?? 0 : null,
    landcover_encoded: hasEnrichment ? LANDCOVER_MAP[features.landCover] ?? null : null,
    nearby_cluster_count_3km: features.nearbyClusterCount3km ?? null,
    historical_recurrence_1_5km: features.historicalOverpassesWithin1_5km ?? null,
    historical_mean_frp: features.historicalMeanFrp ?? null,
    frp_z_score: features.frpZScore ?? null,
    days_since_last_detection: features.daysSinceLastDetection,
  };

  const unresolved = REQUIRED_FEATURES.filter((f) => values[f] === null || values[f] === undefined);

  return { values, unresolved: [...unresolved] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/classifications/featureContract.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/classifications
git commit -m "fix: stop substituting placeholder values for unmeasured features"
```

---

### Task 9: Explicit unclassified outcome

**Files:**
- Modify: `backend/src/modules/classifications/classification.model.ts`
- Modify: `backend/src/modules/classifications/classification.service.ts`

**Interfaces:**
- Consumes: `toCanonicalFeatureRecord` from Task 8.
- Produces: `pipelineStatus: 'classified' | 'unclassified_insufficient_features'` and `featureCompleteness` on every Classification document.

- [ ] **Step 1: Extend the schema**

In `classification.model.ts`, add to the interface and schema:

```typescript
  pipelineStatus: 'classified' | 'unclassified_insufficient_features';
  featureVersion: string;
  predictedAt: Date;
  featureCompleteness: {
    required: string[];
    unresolved: string[];
    completenessRatio: number;
  };
```

```typescript
    pipelineStatus: {
      type: String,
      required: true,
      enum: ['classified', 'unclassified_insufficient_features'],
      default: 'classified',
    },
    featureVersion: { type: String, required: true },
    predictedAt: { type: Date, required: true, default: Date.now },
    featureCompleteness: {
      required: { type: [String], default: [] },
      unresolved: { type: [String], default: [] },
      completenessRatio: { type: Number, default: 1 },
    },
```

Make `confidence` and `classProbabilities` optional (`required: false`), since an unclassified detection has neither.

- [ ] **Step 2: Gate inference in the service**

In `classification.service.ts`, inside `classifyHotspot`, replace step 3 with:

```typescript
  // 3. Gate on feature completeness before spending an inference call.
  const canonical = toCanonicalFeatureRecord(features);
  const ratio =
    (REQUIRED_FEATURES.length - canonical.unresolved.length) / REQUIRED_FEATURES.length;

  const completeness = {
    required: [...REQUIRED_FEATURES],
    unresolved: canonical.unresolved,
    completenessRatio: Number(ratio.toFixed(3)),
  };

  let inference;
  let pipelineStatus: 'classified' | 'unclassified_insufficient_features';

  if (canonical.unresolved.length > 0) {
    // No OSM coverage here. Saying "uncertain" would imply the model looked and
    // was unsure; it never ran.
    pipelineStatus = 'unclassified_insufficient_features';
    inference = {
      predictedClass: null,
      confidence: null,
      classProbabilities: null,
      modelVersion: CURRENT_MODEL_METADATA.version,
      isModelLive: false,
    };
  } else {
    pipelineStatus = 'classified';
    inference = await runModelInference(canonical.values as Record<string, number>);
  }
```

Update the `findOneAndUpdate` payload to persist `pipelineStatus`, `featureVersion: FEATURE_VERSION`, `predictedAt: new Date()`, and `featureCompleteness`, and to write `predictedClass` only when classified.

Guard alert generation with `pipelineStatus === 'classified'` — an unclassified detection must not raise an alert.

- [ ] **Step 3: Verify against real data**

```bash
cd backend && npx tsx -e "
import mongoose from 'mongoose';
import { config } from './src/config';
import { Hotspot } from './src/modules/hotspots/hotspot.model';
import { classifyHotspot } from './src/modules/classifications/classification.service';
await mongoose.connect(config.mongodbUri);
const h = await Hotspot.findOne({}).sort({ detectedAt: -1 });
const c = await classifyHotspot(h as any);
console.log(c.pipelineStatus, c.featureCompleteness.unresolved);
await mongoose.disconnect();
"
```
Expected: for a hotspot outside the 4 extracted OSM tiles, `unclassified_insufficient_features` with `facility_distance_m` listed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/classifications
git commit -m "feat: record an explicit unclassified outcome when features are unresolved"
```

---

### Task 10: ML service rejects nulls

**Files:**
- Modify: `ml/src/inference/service.py`

- [ ] **Step 1: Add validation at the top of the predict handler**

```python
REQUIRED = [
    "frp", "brightness", "brightness_ti5", "temp_delta_ti4_ti5", "confidence",
    "is_night", "facility_distance_m", "facility_type_encoded",
    "landcover_encoded", "nearby_cluster_count_3km",
]

missing = [k for k in REQUIRED if features.get(k) is None]
if missing:
    # The caller is responsible for gating on completeness. Coercing a null to
    # a number here would reintroduce exactly the substitution bug the backend
    # was changed to remove.
    self._send_json(422, {
        "success": False,
        "error": {
            "code": "INCOMPLETE_FEATURES",
            "message": f"Required features unresolved: {', '.join(missing)}",
        },
    })
    return
```

- [ ] **Step 2: Verify**

```bash
curl -s -X POST localhost:8000/predict -H 'content-type: application/json' \
  -d '{"features":{"frp":10,"facility_distance_m":null}}' | head -3
```
Expected: HTTP 422 with `INCOMPLETE_FEATURES`.

- [ ] **Step 3: Commit**

```bash
git add ml/src/inference/service.py
git commit -m "fix: reject null features rather than coercing them"
```

---

### Task 11: Surface the unclassified state in the UI

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/features/hotspots/InvestigationPanel.tsx`
- Modify: `frontend/src/features/map/MapView.tsx`

- [ ] **Step 1: Extend the type**

In `frontend/src/types/index.ts`, add to the `Classification` interface:

```typescript
  pipelineStatus: 'classified' | 'unclassified_insufficient_features';
  featureVersion: string;
  predictedAt: string;
  featureCompleteness: {
    required: string[];
    unresolved: string[];
    completenessRatio: number;
  };
```

and make `predictedClass`, `confidence`, `classProbabilities` nullable.

- [ ] **Step 2: Render the state**

In `InvestigationPanel.tsx`, inside the Classification `Section`, before the existing branch:

```tsx
          ) : classification.pipelineStatus === 'unclassified_insufficient_features' ? (
            <div className="inset-surface rounded-md px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">Not classified</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                The classifier did not run. OpenStreetMap coverage has not been extracted for
                this location, so the spatial features it requires could not be measured.
              </p>
              <p className="num mt-1.5 text-[10px] text-ink-3">
                Unresolved: {classification.featureCompleteness.unresolved.join(', ')}
              </p>
            </div>
```

- [ ] **Step 3: Distinguish on the map**

In `MapView.tsx`, in the `hotspotGeoJson` memo, treat an unclassified detection as having no class:

```typescript
        const isUnclassified = c?.pipelineStatus === 'unclassified_insufficient_features';
        const cls = !c || isUnclassified ? 'other_or_uncertain' : c.predictedClass!;
        const classLabel = isUnclassified ? '' : c ? CLASS_CONFIG[cls].label : '';
```

The popup already renders "Unclassified detection" when `classLabel` is empty.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat: distinguish unclassified detections from uncertain predictions"
```

---

# PHASE 5 — Reverse geocoding

### Task 12: Geocode cache model and Nominatim client

**Files:**
- Create: `backend/src/modules/geocode/geocode.model.ts`
- Create: `backend/src/modules/geocode/geocode.service.ts`
- Create: `backend/src/modules/geocode/geocode.test.ts`
- Modify: `backend/src/config/index.ts`

**Interfaces:**
- Produces: `cacheKey(lat, lon): string`, `reverseGeocode(lat, lon): Promise<PlaceResult>`, where

```typescript
export interface PlaceResult {
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
  attribution: string;
  cached: boolean;
}
```

- [ ] **Step 1: Add config**

In `backend/src/config/index.ts`:

```typescript
  nominatim: {
    baseUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    // The OSM usage policy requires a real identifying User-Agent.
    userAgent: process.env.NOMINATIM_USER_AGENT || 'IGNISSENSE/1.0 (SIH 2026 26162)',
    minIntervalMs: 1100, // policy: max 1 request/second
  },
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/modules/geocode/geocode.test.ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/geocode/geocode.test.ts`
Expected: FAIL — cannot resolve `./geocode.service`.

- [ ] **Step 4: Implement the model**

```typescript
// backend/src/modules/geocode/geocode.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IGeocodeCache extends Document {
  key: string;
  latitude: number;
  longitude: number;
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
  fetchedAt: Date;
}

const schema = new Schema<IGeocodeCache>({
  key: { type: String, required: true, unique: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  locality: { type: String, default: null },
  city: { type: String, default: null },
  district: { type: String, default: null },
  state: { type: String, default: null },
  country: { type: String, default: null },
  displayName: { type: String, default: null },
  fetchedAt: { type: Date, default: Date.now },
});

// Expire after 90 days; administrative naming changes slowly but does change.
schema.index({ fetchedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const GeocodeCache = mongoose.model<IGeocodeCache>('GeocodeCache', schema);
```

- [ ] **Step 5: Implement the service**

```typescript
// backend/src/modules/geocode/geocode.service.ts
import axios from 'axios';
import { config } from '../../config';
import { GeocodeCache } from './geocode.model';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export interface PlaceResult {
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
  attribution: string;
  cached: boolean;
}

/** ~100 m cells. Hotspot coordinates are far more precise than place names are. */
export function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

// Serialise every outbound call; the OSM policy allows at most one per second.
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, config.nominatim.minIntervalMs - (Date.now() - lastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function reverseGeocode(lat: number, lon: number): Promise<PlaceResult> {
  const key = cacheKey(lat, lon);

  const hit = await GeocodeCache.findOne({ key }).lean();
  if (hit) {
    return {
      locality: hit.locality, city: hit.city, district: hit.district,
      state: hit.state, country: hit.country, displayName: hit.displayName,
      attribution: OSM_ATTRIBUTION, cached: true,
    };
  }

  const res = await schedule(() =>
    axios.get(`${config.nominatim.baseUrl}/reverse`, {
      params: { lat, lon, format: 'jsonv2', zoom: 14, addressdetails: 1 },
      headers: { 'User-Agent': config.nominatim.userAgent },
      timeout: 8000,
    })
  );

  const a = res.data?.address ?? {};
  // Each level is omitted when Nominatim does not supply it — never guessed.
  const doc = {
    key, latitude: lat, longitude: lon,
    locality: a.village ?? a.hamlet ?? a.suburb ?? null,
    city: a.city ?? a.town ?? a.municipality ?? null,
    district: a.state_district ?? a.county ?? null,
    state: a.state ?? null,
    country: a.country ?? null,
    displayName: res.data?.display_name ?? null,
    fetchedAt: new Date(),
  };

  await GeocodeCache.updateOne({ key }, doc, { upsert: true });

  return { ...doc, attribution: OSM_ATTRIBUTION, cached: false };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/geocode/geocode.test.ts`
Expected: 3 passing.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/geocode backend/src/config/index.ts
git commit -m "feat: add cached, rate-limited Nominatim reverse geocoding"
```

---

### Task 13: Geocode endpoint

**Files:**
- Create: `backend/src/modules/geocode/geocode.routes.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Implement the route**

```typescript
// backend/src/modules/geocode/geocode.routes.ts
import { Router, Request, Response } from 'express';
import { reverseGeocode } from './geocode.service';

export const geocodeRoutes = Router();

geocodeRoutes.get('/reverse', async (req: Request, res: Response) => {
  const lat = parseFloat(String(req.query.lat));
  const lon = parseFloat(String(req.query.lon));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_COORDINATES', message: 'lat and lon must be valid coordinates' },
    });
  }

  try {
    res.json({ success: true, data: await reverseGeocode(lat, lon) });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: { code: 'GEOCODE_UNAVAILABLE', message: err.message },
    });
  }
});
```

- [ ] **Step 2: Mount it**

In `backend/src/app.ts`, alongside the other route mounts:

```typescript
import { geocodeRoutes } from './modules/geocode/geocode.routes';
app.use('/api/v1/geocode', geocodeRoutes);
```

- [ ] **Step 3: Verify, including the cache**

```bash
curl -s "localhost:5001/api/v1/geocode/reverse?lat=28.6139&lon=77.2090" | python3 -m json.tool
curl -s "localhost:5001/api/v1/geocode/reverse?lat=28.6139&lon=77.2090" | grep '"cached": true'
curl -s "localhost:5001/api/v1/geocode/reverse?lat=999&lon=0" | grep INVALID_COORDINATES
```
Expected: real Delhi place data; second call cached; invalid rejected.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/geocode/geocode.routes.ts backend/src/app.ts
git commit -m "feat: expose GET /api/v1/geocode/reverse"
```

---

### Task 14: Place name in the investigation panel

**Files:**
- Modify: `frontend/src/api/hooks.ts`
- Modify: `frontend/src/features/hotspots/InvestigationPanel.tsx`

- [ ] **Step 1: Add the hook**

```typescript
// frontend/src/api/hooks.ts
export interface PlaceResult {
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
  attribution: string;
  cached: boolean;
}

export function useReverseGeocode(lat: number | null, lon: number | null) {
  return useQuery({
    queryKey: ['geocode', lat, lon],
    queryFn: async () => {
      const res = await api.get('/geocode/reverse', { params: { lat, lon } });
      return res.data.data as PlaceResult;
    },
    enabled: lat !== null && lon !== null,
    staleTime: Infinity,
    retry: false,
  });
}
```

- [ ] **Step 2: Render it under the coordinates**

In `InvestigationPanel.tsx`, call `useReverseGeocode(lat, lng)` and render beneath the coordinate button:

```tsx
        {place ? (
          <p className="mt-0.5 text-[11px] leading-snug text-ink-2">
            {[place.locality, place.city, place.district, place.state]
              .filter(Boolean)
              .join(' · ')}
            <span className="ml-1 text-[10px] text-ink-3">{place.attribution}</span>
          </p>
        ) : null}
```

- [ ] **Step 3: Verify in the browser**

Start all three services, click a hotspot, confirm a real Indian place name appears with OSM attribution, and confirm the second click on the same hotspot does not issue a new network request.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat: resolve hotspot coordinates to a real place name"
```

---

# PHASE 3 — Geofabrik + PostGIS (BLOCKED)

**This phase cannot start on the current machine.** Verified absent: `docker`, `docker compose`, `psql`, `osm2pgsql`. Free disk is 59 GB.

A full `osm2pgsql` import of `india-latest.osm.pbf` commonly lands between 60 and 100 GB with default tables, which does not fit. A **filtered import** using a Lua style file that keeps only the tags this project actually queries (`landuse`, `natural`, `power`, `man_made`, `industrial`, `highway`, `building`, `water`, `place`) reduces this to roughly 10–15 GB and fits comfortably.

Proceeding requires one of:

1. **Install Docker Desktop** — then `postgis/postgis:16-3.4` runs containerised with no host Postgres. Cleanest, ~700 MB download.
2. **Install via Homebrew** — `brew install postgresql@16 postgis osm2pgsql`. No Docker, but modifies the host system.
3. **Defer Phase 3** — Phases 2/4/5 already deliver the honesty guarantees. Enrichment stays at 4/110 tiles and the UI reports most detections as `unclassified_insufficient_features`, which is accurate.

Installing system software is not something to do unilaterally, so this phase stops here pending that decision. Once chosen, Phase 3 gets its own plan document covering: docker-compose service, Lua filter, import script, `backend/src/modules/geo/` query layer with per-feature resolution status, and backfill re-classification.

---

## Self-Review

**Spec coverage.** §5.1→T3, §5.2→T4, §5.3→T5, §5.4→T6, §5.5→T6, §7.1→T8, §7.2→T9, §7.3→T9+T11, §7.4→T7, §7.5→T9, §7.6→deferred with Phase 3 (needs real features first), §8→T12/13/14, §9→T1/2/5/7/8/12. §6 blocked and documented above.

**Placeholders.** None. Every code step carries runnable content.

**Type consistency.** `toCanonicalFeatureRecord` returns `{ values, unresolved }` from Task 8 onward; Task 9 and Task 10's `REQUIRED` list use the same feature names as `REQUIRED_FEATURES` in Task 7. `PlaceResult` is identical in Task 12 (backend) and Task 14 (frontend). `pipelineStatus` uses the same two literals in Tasks 9, 10 and 11.

**Known gap.** Task 9 changes the meaning of existing rows: the 3,533 classifications already stored predate `pipelineStatus` and will read as `classified` via the schema default despite most having been produced from substituted features. A backfill re-classification must run after Task 9 — `reclassifyAllHotspots()` already exists in `classification.service.ts` and should be invoked once, which will correctly move roughly 92% of them to `unclassified_insufficient_features`. This is folded into Task 9's verification step.
