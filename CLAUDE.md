# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

IGNISSENSE — Smart India Hackathon 2026, Problem Statement 26162. An AI-enabled GIS platform that
ingests NASA FIRMS satellite thermal anomalies over India, enriches them with OpenStreetMap spatial
context, classifies them into six thermal-event classes with an XGBoost model, and surfaces them on a
MapLibre dashboard. Primary demo region is Delhi NCR; ingestion actually runs India-wide.

Three independently-run services: **backend** (Express, :5001), **ml** inference service (Python
stdlib HTTP, :8000), **frontend** (Vite, :5173). The backend calls the ML service over HTTP; nothing
imports the model in-process.

## Commands

```bash
# Backend (needs backend/.env with MONGODB_URI + FIRMS_MAP_KEY)
cd backend && npm install && npm run dev     # tsx watch, :5001
npm run build && npm start                   # tsc -> dist, then node
npm run typecheck                            # tsc --noEmit
npm run lint                                 # eslint src/
npm test                                     # vitest run (8 suites under src/)
npm run seed                                 # one-shot OSM + FIRMS Delhi NCR seed
npm run ingest:live                          # one-shot live FIRMS pull + classify

# Backend operational scripts (no npm alias — run directly)
npx tsx src/scripts/verifyPipeline.ts        # closest thing to a test suite (assert-based)
npx tsx src/scripts/extractIndia.ts          # India-wide OSM tile extraction; resumes from tile state
npx tsx src/scripts/extractIndia.ts --report # tile progress without extracting
npx tsx src/scripts/extractIndia.ts --retry  # failed tiles only
npx tsx src/scripts/validateEnrichment.ts    # enrichment sanity checks against known coordinates

# ML
cd ml && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
python src/inference/service.py 8000         # must be running or backend silently degrades
python src/inference/predict.py              # single-sample smoke check against the active artifact
python src/evaluation/parity_check.py --url http://127.0.0.1:8000   # service vs training-time scoring

# ML — real training pipeline (see "Model training" below; order matters)
python src/ingestion/fetch_sources.py firms --years 2022 2023 2024   # FIRMS India yearly archives
python src/ingestion/fetch_sources.py reference                     # VNF flares, mining polygons, India PBF
FIRMS_MAP_KEY=... python src/ingestion/fetch_sources.py firms-context   # NOAA-21 NRT 2024 context
python src/features/osm_elements.py --pbf data/raw/reference/india-latest.osm.pbf --out data/interim/osm_elements_india.ndjson
python src/labeling/build_labels.py candidates
python src/ingestion/fetch_sources.py worldcover --tiles $(cat data/interim/worldcover_tiles.txt)
python src/labeling/build_labels.py finalize
# local mongod on 127.0.0.1:27018 (never production), then from backend/:
npx tsx src/scripts/training/loadTrainingContext.ts --reset --osm ../ml/data/interim/osm_elements_india.ndjson --firms-dir ../ml/data/raw/firms
npx tsx src/scripts/training/loadTrainingContext.ts --firms-dir ../ml/data/raw/firms_context/VIIRS_NOAA21_NRT
npx tsx src/scripts/training/extractTrainingFeatures.ts --input ../ml/data/interim/labels_for_extraction.csv --output ../ml/data/interim/features.ndjson
python src/training/train.py                 # real data -> models/xgb_fire_classifier_v2.* + model_metadata.json
python src/training/train.py --data-source synthetic   # fallback only -> *_synthetic.*, never the active artifact
npx tsx src/scripts/training/verifyRealModel.ts --test-csv ../ml/data/interim/verify_test_rows.csv --live

# Frontend
cd frontend && npm install && npm run dev    # :5173
npm run build                                # tsc -b && vite build
npm run lint                                 # oxlint
```

Vitest is configured in `backend/vitest.config.ts` and runs with `npm test` from `backend/`. It picks
up `src/**/*.test.ts` — eight suites covering FIRMS normalisation, the ingestion service and its
scheduler, catch-up, the India boundary check, geocoding, classification, and `featureContract.test.ts`,
which parses `ml/src/training/classes.py` and fails if the 14-feature contract drifts. The root
`tests/` directory is an empty placeholder; nothing lives there. `verifyPipeline.ts` is a separate
hand-rolled assertion script for end-to-end checks against a running stack, not part of the Vitest run.

## Architecture

### The one pipeline that matters

`server.ts` boots Express immediately, then connects to Mongo, then starts a 5-minute
`setInterval` calling `ingestFirmsIndia({ dayRange: 2 })`. That loop is the whole system:

```
firms.client.fetchFirmsArea      4 sensors: VIIRS SNPP/NOAA20/NOAA21 NRT + MODIS_NRT, CSV over HTTP
  → normalizeFirmsRecord         VIIRS bright_ti4/ti5 vs MODIS brightness/bright_t31 reconciled here
  → processAndStoreRecords       in-batch dedup, then Hotspot.create relying on a unique index
  → classifyHotspot              ONLY for genuinely new docs, in chunks of 15
      → extractFeaturesForHotspot
          → enrichHotspot        OSM spatial context (osm_features, 2dsphere on `geometry`)
          → Hotspot geo queries  cluster density 3km/72h, history 1.5km all-time, FRP z-score
      → toCanonicalFeatureRecord 14-feature vector, the train/serve contract
      → POST MODEL_SERVICE_URL/predict
      → Classification upsert + conditional Alert upsert
```

Dedup is enforced by a unique compound index on
`location.coordinates + detectedAt + satellite + instrument`. Re-polling the same window is expected
and cheap; `E11000` is caught and counted as a duplicate, not an error. Known defect: the index is
multikey (it indexes each element of the coordinate array separately), so two *distinct* detections
in the same overpass that share only a latitude or only a longitude value also collide and one is
dropped as a "duplicate" — about 0.3–0.4% of VIIRS and 0.6–1.1% of MODIS archive rows. Every sensor run writes an
`IngestionLog` row (SUCCESS or FAILED) — that collection is the provenance trail.

`liveIngestionState` in `ingestion.service.ts` is a module-level mutable object holding poll
provenance for `/api/v1/system/status`. It resets on restart.

### The 14-feature contract

The canonical feature vector is defined in three places that must stay in lockstep:

- `ml/models/feature_schema.json` — the declared schema
- `ml/src/training/classes.py` `FEATURE_COLUMNS` / `FACILITY_TYPE_MAP` / `LANDCOVER_MAP` / `CLASSES`
  (imported by `train.py` and `build_labels.py`)
- `backend/src/modules/classifications/featureContract.ts` + `feature.extractor.ts` `toCanonicalFeatureRecord`

Changing any encoding requires touching all three plus retraining; `featureContract.test.ts` parses
`classes.py` and fails on drift, and `train.py` refuses to run if `feature_schema.json` disagrees.
Null handling between the canonical record and XGBoost lives only in
`ml/src/inference/feature_frame.py`, which both `service.py` and `train.py` import: optional
features are zero-filled except `days_since_last_detection`, which passes through as NaN.

### OSM enrichment is tile-based and incomplete

`osmExtractor.ts` splits India into 3°×3° tiles (`DEFAULT_TILE_SIZE = 3.0`, ids like `tile_27_77`)
and pulls them from Overpass one at a time, tracking each in the `osmtiles` collection
(pending/completed/failed) so extraction resumes. Only 4 of 110 tiles were ever pulled that way, so
`osm_features` covered a sliver of India and most detections resolved no facility within 25 km. The
extractor passes that absence through as null, and the completeness gate records the row as
`unclassified_insufficient_features` without calling the model.

The collection was then filled India-wide from the Geofabrik extract (341k features):
`ml/src/features/osm_elements.py` applies the same tag filter as `buildOverpassQuery` with Overpass
`out center` geometry, and `src/scripts/importOsmElements.ts` loads it through `normalizeOsmElement`
with the extractor's upsert-by-`sourceId`, so a later Overpass run updates rather than duplicates.
`osmtiles` still shows those tiles as pending — it tracks Overpass progress, not this import.
Gated rows are not re-evaluated on their own; after any OSM change run
`src/scripts/reclassifyGated.ts` (`--include-legacy --stale-model` also re-runs rows from older
model versions). A detection with no mapped facility within 25 km remains unclassified by design.

`taxonomy.ts` is the single source of truth mapping raw OSM tags to the bounded
category/subcategory taxonomy; both the extractor and the enrichment service import it.

`enrichHotspot` picks its backend at call time: if `osm_features` has >100 docs it uses the
India-wide collection, otherwise it falls back to the legacy Delhi-NCR-only `facilities` collection.
Note the field names differ from the hotspot model — OSM features store geometry under `geometry`
(not `location`) and category under `featureCategory`.

### Degradation paths (both are silent by design)

- **Mongo unreachable** → `connectDatabase` spins up `mongodb-memory-server` and auto-seeds OSM +
  FIRMS into it. Logs look identical to a real run. Always confirm which one you're on before
  drawing conclusions about data.
- **ML service down** → `runModelInference` catches, returns `other_or_uncertain` at 0.50 confidence
  and suffixes the model version with `-OFFLINE`. That suffix is the only way to tell fallback rows
  from real inference in the `classifications` collection.

### Scores computed in TypeScript, not by the model

`persistenceScore` and `anomalyScore` are deterministic heuristics in `classification.service.ts`,
independent of the XGBoost output. Alerts are generated by rule, not by the classifier:
`anomalyScore >= 0.65 && facilityDistanceMeters <= 1500`, severity bucketed at 0.80/0.65.
`explanation[]` is likewise template-generated from the extracted features.

### Model training uses real FIRMS archive data

The active artifact is `ml/models/xgb_fire_classifier_v2.joblib` (`XGB-FIRMS-v2.0.0-INDIA-SP2023`).
`service.py` loads it first (override with `IGNISSENSE_MODEL_ARTIFACT`); `model_metadata.json` holds
its provenance, metrics, baselines, ablations and `LIMITATIONS.json`.

- **Detections**: FIRMS standard-processing India yearly files (VIIRS S-NPP, NOAA-20, MODIS) 2022–2024,
  plus NOAA-21 NRT 2024 as unlabelled context. Loaded into a *local* mongod (127.0.0.1:27018) through
  the production normalisers; `trainingDb.ts` refuses any non-local or production URI.
- **Labels** (`build_labels.py`) never read OSM or model inputs: FIRMS `type` (0 vegetation, 2 static,
  3 offshore), EOG VIIRS Nightfire flare sites, Maus et al. 2022 mining polygons, ESA WorldCover 2021
  footprint fractions. Rules are in the module docstring.
- **Features** are computed by the production `extractFeaturesForHotspot` + `toCanonicalFeatureRecord`
  (`extractTrainingFeatures.ts`), so there is no Python reimplementation of any feature. Rows the
  completeness gate would reject are excluded from training and test.
- **Splits**: 0.5° blocks assigned wholly to one partition (stratified so rare sources are spread);
  train/val = 2023, test = 2024.

The old generator lives in `ml/src/training/synthetic.py` and runs only with
`train.py --data-source synthetic`, which writes `*_synthetic.*` and never the active artifact.
`ml/data/firms_*_dataset.csv` and `xgb_fire_classifier_v1.*` are outputs of that generator.

### Backend module convention

Every domain under `src/modules/<name>/` follows `<name>.model.ts` (Mongoose schema) +
`<name>.routes.ts` (Express Router exported as `<name>Routes`) + optional `.service.ts`. Routes are
mounted in `app.ts` under `/api/v1/<name>`.

All API responses use the envelope `{ success: boolean, data?: T, error?: { code, message } }`. The
frontend's axios interceptor in `src/api/client.ts` depends on this shape.

Routes: `system/status`, `hotspots`, `facilities` (+`/nearby`, POST `/sync-osm`), `classifications`,
`alerts` (PATCH `/:id`), `ingestion` (`/status`, POST `/firms`), `analytics`
(`/summary`, `/temporal-trend`, `/hotspot-history/:id`), `osm` (`/enrich`, `/features/nearby`,
`/report`, `/tiles`, `/tiles/failed`, POST `/extract`, `/extract/retry`).

### Frontend

React 19 + Vite + TypeScript, TanStack Query for server state, MapLibre GL for the map, Tailwind v4
via `@tailwindcss/vite`, oxlint (not ESLint). Features live in `src/features/<domain>/`. Basemap and
API base come from `VITE_MAP_STYLE_URL` / `VITE_API_BASE_URL`.

## Working notes

- `PRDmain.md` and `DESIGN.md` are the aspirational spec. They describe intent, not current
  behaviour — verify against code before treating them as ground truth. The same applies to the
  provenance claims in ML docstrings and `model_metadata.json`.
- The backend burns FIRMS API quota every 5 minutes while running (limit is 5000 transactions per
  10 minutes per key). Stop it when you're done investigating.
- FIRMS `dayRange` is capped at 1–5 by the live API (it rejects more with HTTP 400) and validated
  client-side against `FIRMS_MAX_DAY_RANGE` in `firms.client.ts`.
- `stitchDash/` holds static HTML design mockups, not application code.
