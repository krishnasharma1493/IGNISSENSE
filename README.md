# IGNISSENSE

**Smart India Hackathon 2026 — Problem Statement 26162**
AI-Based Detection and Classification of Industrial Fires

IGNISSENSE pulls NASA FIRMS satellite thermal anomalies over India every five minutes, works out
what is physically near each detection using OpenStreetMap, and runs an XGBoost model to decide
which of six kinds of thermal event it is. Results land on a MapLibre dashboard with the reasoning
attached, so an analyst can see why a pixel was called an industrial fire and not stubble burning.

Ingestion runs India-wide. Delhi NCR is the demo region.

| Class | What it covers |
|---|---|
| `industrial_fire` | Furnaces, kilns, steel and cement works, refinery incidents |
| `gas_flare` | Oil and gas flaring |
| `wildfire` | Forest and scrub fire |
| `agricultural_burning` | Crop residue burning |
| `mining_thermal_activity` | Thermal sources inside mapped mining footprints |
| `other_or_uncertain` | Everything the model will not commit to |

## How a detection becomes a classification

```
FIRMS CSV over HTTP          4 sensors: VIIRS S-NPP / NOAA-20 / NOAA-21 NRT, MODIS NRT
  → normalizeFirmsRecord     reconciles VIIRS bright_ti4/ti5 against MODIS brightness/bright_t31
  → processAndStoreRecords   in-batch dedup, then a unique compound index rejects repeats
  → enrichHotspot            nearest OSM industrial / power / oil-gas / mining feature
  → feature extraction       cluster density 3km/72h, recurrence 1.5km all-time, FRP z-score
  → toCanonicalFeatureRecord the 14-feature vector shared by training and serving
  → POST /predict            Python inference service on :8000
  → Classification + Alert   alerts by rule, not by the classifier
```

Re-polling the same time window is expected and cheap: duplicates are caught by the index and
counted, not treated as errors. Every sensor run writes an `IngestionLog` row, which is the
provenance trail.

Two things fail quietly by design, and both are worth knowing before you draw conclusions from a
running instance:

- If MongoDB is unreachable and `ALLOW_EPHEMERAL_DB=true`, the backend starts an in-memory database
  and seeds it. The logs look like a normal run.
- If the ML service is down, classification returns `other_or_uncertain` at 0.50 confidence and
  suffixes the model version with `-OFFLINE`. That suffix is the only way to tell fallback rows
  apart in the `classifications` collection.

## The model

Active artifact: `ml/models/xgb_fire_classifier_v2.joblib` (`XGB-FIRMS-v2.0.0-INDIA-SP2023`),
committed to this repo so the stack runs after a clone.

Trained on 223,799 labelled detections from FIRMS standard-processing India country files. Labels
are not hand-drawn: they are rule-based derivations from four independent published sources — FIRMS
`type`, the EOG VIIRS Nightfire flare catalogue, Maus et al. (2022) mining polygons, and ESA
WorldCover 2021. No label reads OSM or any model input feature. Training and validation come from
2023, test from 2024, and 0.5° blocks are assigned wholly to one partition so nothing leaks across
the split.

Held-out 2024 test performance, against the same labelling rules:

| | Accuracy | Macro F1 |
|---|---|---|
| **XGBoost (prevalence-weighted)** | **0.697** | 0.525 |
| **XGBoost (class-capped)** | **0.655** | **0.549** |
| OSM proximity rule | 0.420 | 0.413 |
| Majority class | 0.253 | 0.067 |

Roughly 65–70% accuracy on a six-class problem is a real result rather than a strong one, and the
comparison that matters is the second row: a sensible hand-written rule that just looks at what is
nearby gets 0.42. Features are computed by the production TypeScript extractor, not a Python
reimplementation, so there is no training/serving skew to argue about.

`ml/models/model_metadata.json` carries the full provenance, per-class metrics, confusion matrix,
ablations and feature importances. `ml/models/LIMITATIONS.json` lists thirteen known limitations in
plain language, including the ways the label sources leak into the history features. Read that file
before quoting the metrics anywhere.

One constraint shapes everything: a detection with no mapped industrial, power, oil/gas or mining
OSM feature within 25 km is not classified at all. It is recorded as
`unclassified_insufficient_features` and the model is never called. This keeps the system honest,
but it means remote wildfires are under-represented — 4,233 of 11,936 test wildfires were excluded
by that gate.

## Running it

Three services, started independently.

**Prerequisites:** Node.js ≥ 18, Python ≥ 3.10, a MongoDB URI (Atlas free tier is fine), and a free
NASA FIRMS MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key

```bash
# 1. ML inference service — start this first, or the backend degrades silently
cd ml
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python src/inference/service.py 8000

# 2. Backend
cd backend
cp .env.example .env        # fill in MONGODB_URI and FIRMS_MAP_KEY
npm install
npm run dev                 # :5001

# 3. Frontend
cd frontend
cp .env.example .env
npm install
npm run dev                 # :5173
```

The backend polls FIRMS every five minutes while it runs. The quota is 5000 transactions per 10
minutes per key, so stop it when you are done.

```bash
cd backend && npm test      # vitest, 8 suites
```

`featureContract.test.ts` parses `ml/src/training/classes.py` and fails if the 14-feature contract
drifts between the TypeScript extractor and the Python trainer. That contract is declared in three
places and all three have to agree: `ml/models/feature_schema.json`, `ml/src/training/classes.py`,
and `backend/src/modules/classifications/featureContract.ts`.

## Layout

```
backend/     Express 5 + TypeScript + Mongoose. Ingestion loop, enrichment, API (:5001)
frontend/    React 19 + Vite + MapLibre GL + TanStack Query (:5173)
ml/          Training, labelling, inference. Python stdlib HTTP server, no framework (:8000)
```

Each backend domain lives in `src/modules/<name>/` as `<name>.model.ts` plus `<name>.routes.ts`
and an optional `<name>.service.ts`, mounted in `app.ts` under `/api/v1/<name>`. Every response
uses the envelope `{ success, data?, error? }`, which the frontend's axios interceptor depends on.

## Reproducing the model

`ml/data/` is not in the repo. It reaches about 6 GB: a 1.6 GB India OSM extract, ESA WorldCover
tiles, and the FIRMS yearly archives. `model_metadata.json` records a SHA-256 for every FIRMS file
used, so the training set can be rebuilt exactly.

Order matters here. The labelling step needs the WorldCover tile list that the candidate step
writes out, and feature extraction runs through the production TypeScript extractor against a
local mongod, never a production database.

```bash
cd ml
python src/ingestion/fetch_sources.py firms --years 2022 2023 2024
python src/ingestion/fetch_sources.py reference          # VNF flares, mining polygons, India PBF
FIRMS_MAP_KEY=... python src/ingestion/fetch_sources.py firms-context   # NOAA-21 NRT 2024
python src/features/osm_elements.py --pbf data/raw/reference/india-latest.osm.pbf \
       --out data/interim/osm_elements_india.ndjson
python src/labeling/build_labels.py candidates
python src/ingestion/fetch_sources.py worldcover --tiles $(cat data/interim/worldcover_tiles.txt)
python src/labeling/build_labels.py finalize

# start a local mongod on 127.0.0.1:27018, then from backend/
cd ../backend
npx tsx src/scripts/training/loadTrainingContext.ts --reset \
       --osm ../ml/data/interim/osm_elements_india.ndjson --firms-dir ../ml/data/raw/firms
npx tsx src/scripts/training/loadTrainingContext.ts \
       --firms-dir ../ml/data/raw/firms_context/VIIRS_NOAA21_NRT
npx tsx src/scripts/training/extractTrainingFeatures.ts \
       --input ../ml/data/interim/labels_for_extraction.csv \
       --output ../ml/data/interim/features.ndjson

cd ../ml
python src/training/train.py      # writes xgb_fire_classifier_v2.* + model_metadata.json
```

`train.py` refuses to run if `feature_schema.json` disagrees with `classes.py`. To check that a
rebuilt model matches what the service actually serves:

```bash
python src/inference/service.py 8000 &
python src/evaluation/parity_check.py --url http://127.0.0.1:8000
```

## License

MIT. See [LICENSE](LICENSE).
