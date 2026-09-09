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
python src/training/train.py                 # writes models/*.joblib|json + model_metadata.json
python src/inference/service.py 8000         # must be running or backend silently degrades
python src/inference/predict.py              # single-sample smoke check

# Frontend
cd frontend && npm install && npm run dev    # :5173
npm run build                                # tsc -b && vite build
npm run lint                                 # oxlint
```

There is no test runner configured anywhere. `tests/` is an empty placeholder. `verifyPipeline.ts` is
a hand-rolled assertion script, not a framework.

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
and cheap; `E11000` is caught and counted as a duplicate, not an error. Every sensor run writes an
`IngestionLog` row (SUCCESS or FAILED) — that collection is the provenance trail.

`liveIngestionState` in `ingestion.service.ts` is a module-level mutable object holding poll
provenance for `/api/v1/system/status`. It resets on restart.

### The 14-feature contract

The canonical feature vector is defined in three places that must stay in lockstep:

- `ml/models/feature_schema.json` — the declared schema
- `ml/src/training/train.py` `FEATURE_COLUMNS` / `FACILITY_TYPE_MAP` / `LANDCOVER_MAP`
- `backend/src/modules/classifications/feature.extractor.ts` `toCanonicalFeatureRecord`

Changing any encoding requires touching all three plus retraining. The backend's `FACILITY_TYPE_MAP`
has drifted ahead of the trained model — it emits codes 9–13 (cement_plant, oil_gas_facility,
petroleum_well, substation, solar_farm) that never appeared in training data. It also emits
`days_since_last_detection: -1` as the no-history sentinel, which is outside every distribution the
model was trained on.

### OSM enrichment is tile-based and incomplete

`osmExtractor.ts` splits India into 3°×3° tiles (`DEFAULT_TILE_SIZE = 3.0`, ids like `tile_27_77`)
and pulls them from Overpass one at a time, tracking each in the `osmtiles` collection
(pending/completed/failed) so extraction resumes. Most tiles are still pending, so
`enrichHotspot` returns `enrichmentStatus: 'no_osm_coverage'` for the majority of India — which the
extractor then converts to `facility_distance_m: 25000, facility_type_encoded: 0,
landcover_encoded: 5`. Any analysis of classification output has to account for this.

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

### Model training uses a synthetic generator

`train.py::construct_dataset` builds its 10k rows from per-class `np.random` distributions, despite
docstrings and `model_metadata.json` describing FIRMS/OSM provenance. Both CSVs in `ml/data/` are
outputs of that generator, not real data. This is why the reported metrics are 1.0 across every
class — the labels are a deterministic function of the sampled features. Treat the metadata metrics
as meaningless and do not cite them as model performance.

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
