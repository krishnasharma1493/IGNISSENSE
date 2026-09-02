# IGNISSENSE — Frontend Redesign & Full-Stack Hardening

**Date:** 2026-09-02
**Status:** Approved for planning
**Scope:** Liquid Glass navbar, data integrity, PostGIS geo-enrichment, honest ML pipeline, reverse geocoding

---

## 1. Problem statement

IGNISSENSE ingests real NASA FIRMS thermal anomalies and presents them on a MapLibre
dashboard. The ingestion half of that sentence is true. The intelligence half is not.

Three findings from inspection of the running system (3,770 hotspots, 3,533 classifications,
55,225 OSM features) drive this work:

1. **The XGBoost model is trained on synthetic data.** `ml/src/training/train.py::construct_dataset`
   generates 10,000 rows from per-class `np.random` distributions. Labels are a deterministic
   function of the sampled features, which is why every reported metric is exactly `1.0`.
   `models/model_metadata.json` claims provenance `"NASA_FIRMS_OSM_CANONICAL_V1"` and
   `"weakly_supervised_heuristic_v1 (anchored in satellite telemetry and verified OSM
   perimeters)"`. That claim is false.

2. **Geographic enrichment covers 3.6% of India.** The `osmtiles` collection holds 110 tiles,
   of which 4 are `completed` and 106 are `pending`. Measured against the live classification
   set: `facilityDistanceMeters` is null for 3,259 of 3,533 records (92.2%),
   `nearestFacilityId` is null for 3,511 (99.4%), and `landCover` is `other` for 3,274 (92.7%).

3. **Missing features are silently replaced with plausible values.**
   `toCanonicalFeatureRecord` substitutes `facility_distance_m: 25000` and
   `landcover_encoded: 5` when enrichment fails. Code `5` is `other`, a legitimate value in the
   training vocabulary, so nothing downstream can distinguish "we measured bare ground" from
   "we never looked." For ~92% of India the model receives placeholders indistinguishable from
   measurements.

A fourth issue compounds these: the serving contract has drifted out of the training
vocabulary. The backend `FACILITY_TYPE_MAP` emits codes 9–13 (`cement_plant`,
`oil_gas_facility`, `petroleum_well`, `substation`, `solar_farm`) that never appeared in
training, which only knew 0–8. And `days_since_last_detection: -1` is used as the no-history
sentinel while training sampled that feature in the range 0.2–90.

The 71% `other_or_uncertain` rate observed in production is the honest signature of a model
being fed placeholder features.

### What is already correct

FIRMS ingestion is genuinely real and should not be rewritten. The live API is called with a
server-side key, VIIRS/MODIS field differences are reconciled correctly, coordinates and
timestamps are validated, `ingestedAt` is stored separately from `detectedAt`, deduplication
is enforced by a unique compound index on
`location.coordinates + detectedAt + satellite + instrument`, `E11000` is correctly treated as
a duplicate rather than an error, and every sensor run writes an `IngestionLog` row.

## 2. Goals

- Present a Liquid Glass navbar that reads as refractive material, not generic glassmorphism.
- Never display a fabricated value, and never let a substituted value pass as a measurement.
- Achieve genuine India-wide geographic enrichment.
- Make the ML pipeline correct and honest, so a properly trained model can be dropped in.
- Resolve hotspot coordinates to real place names from real geospatial data.

## 3. Non-goals

- Training a production-quality classifier. There is no labelled Indian thermal-event dataset
  in this repository. This work builds the path to a trained model; it does not claim to
  deliver one.
- Rewriting FIRMS ingestion, which is already correct.
- Authentication, user accounts, or RBAC (PRD §42 explicitly excludes these).
- Changing the `{ success, data?, error? }` API envelope that the frontend axios interceptor
  depends on.

---

## 4. Phase 1 — Liquid Glass navbar

### 4.1 The material

Generic glassmorphism blurs the backdrop. Liquid Glass *refracts* it. The design is four
layers on the existing `AppBar`, composed so that the expensive parts stay small.

| Layer | Treatment | Purpose |
|---|---|---|
| Body | `backdrop-filter: blur(24px) saturate(180%) brightness(1.03)` | Base material |
| Rim lens | 12px band at the lower edge, separately tuned stronger backdrop-filter | Thicker glass bends light most at the rim; this is the optical warping |
| Specular | 1px inset top highlight + one broad low-opacity sheen | Depth, without neon |
| Organic edge | SVG `feTurbulence` + `feDisplacementMap`, scoped to the rim band only | Liquid warp, not decorative bubbles |

Blur is deliberately moderate at 24px. The brief forbids blur that costs map readability, and
the bar is 44px tall so the composited area stays small over a moving WebGL canvas.

### 4.2 Browser support risk and fallback

`backdrop-filter: url(#svg-filter)` has uneven support: Chrome yes, Firefox no, Safari
partial. The displacement layer is therefore **progressive enhancement, feature-detected at
runtime** via `CSS.supports('backdrop-filter', 'url(#x)')`.

Where unsupported, the rim degrades to a tuned gradient plus blur band that still reads as
glass. A spike verifies actual rendering before the effect ships; an effect that silently
does nothing in the demo browser is worse than no effect.

Continuous corner radius uses `corner-shape: squircle` where supported and a tuned
`border-radius` otherwise.

### 4.3 Navigation active state

Today the active tab is an accent-filled chip sitting *on* the glass. It will instead become a
thicker lens *within* the same material: marginally brighter backdrop, inset top highlight,
soft inner shadow at its base, and the label stepping up in weight. It should read as a raised
droplet of the same glass rather than a coloured sticker applied to it.

### 4.4 Motion and accessibility

All motion respects `prefers-reduced-motion`, which drops the displacement layer entirely.
Contrast of every label against the material must meet 4.5:1 over both bright and dark
satellite imagery; this is verified by measurement, not by eye. Focus rings, keyboard order
and touch target sizes are preserved from the current implementation.

### 4.5 Responsive behaviour

Desktop shows brand, section labels, search, status and export. Tablet drops section text
labels to icons. Mobile collapses search into an icon that expands to a full-width sheet, and
the status cluster reduces to its indicator dot. No horizontal overflow at 375, 768, 1024 or
1440.

### 4.6 Files

- `frontend/src/components/ui/LiquidGlass.tsx` (new) — material primitive
- `frontend/src/components/ui/GlassFilters.tsx` (new) — SVG filter defs, mounted once
- `frontend/src/components/AppBar.tsx` — adopt the material and new active state
- `frontend/src/index.css` — material tokens and layers

No other files change in Phase 1.

---

## 5. Phase 2 — Data integrity

### 5.1 Remove the silent database fallback

`config/database.ts` currently falls back to `mongodb-memory-server` when Atlas is
unreachable, auto-seeds it, and logs in a way that is indistinguishable from a real run. This
is precisely the silent-fallback-to-dummy-data pattern the brief prohibits.

New behaviour: on Atlas failure the server starts in an explicitly degraded mode, which is

- surfaced in `/api/v1/system/status` as `databaseMode: 'ephemeral'`,
- rendered as a persistent, non-dismissable banner in the UI,
- and never described anywhere in the interface as live data.

Controlled by an explicit `ALLOW_EPHEMERAL_DB` environment flag, defaulting to `false`. With
the flag false, the server refuses to start rather than lying about its data.

### 5.2 Raw source preservation

Persist the raw FIRMS CSV row on the hotspot document as `rawSource`, satisfying the brief's
traceability requirement. Stored as a subdocument, excluded from list endpoints by default to
keep payloads small.

### 5.3 Ingestion catch-up

`setInterval` in-process means a restart mid-cycle silently skips a poll. On boot, the
ingestion service reads the most recent successful `IngestionLog` and, if the gap exceeds the
poll interval, issues a catch-up fetch with a `dayRange` sized to cover the gap (clamped to
the API's 1–10 limit).

### 5.4 Honest metadata

`ml/models/model_metadata.json` is rewritten to state its actual provenance: synthetic data
generated by `construct_dataset`, with metrics marked as meaningless for that reason. The
existing docstrings in `train.py` that claim FIRMS/OSM provenance are corrected.

### 5.5 Terminology

The refresh cadence is a 5-minute poll of a near-real-time satellite product. The interface
says **"near real-time"**, never "real-time", and always shows the actual latest acquisition
timestamp rather than a relative "live" label.

---

## 6. Phase 3 — Geofabrik + PostGIS enrichment

### 6.1 Why the current approach cannot work

Overpass is a query API for interactive extracts, not a bulk source. 106 remaining tiles at
3°×3° over India will take hours to days, is rate-limited, and fails on dense tiles. The
resulting data is also a point-in-time snapshot with no refresh story.

### 6.2 Architecture

A `postgis` service is added to `docker-compose`. The Geofabrik India extract
(`india-latest.osm.pbf`, ~1.2 GB) is loaded with `osm2pgsql` into PostGIS with GiST spatial
indexes. A new `backend/src/modules/geo/` module computes enrichment features via SQL against
PostGIS.

MongoDB remains the system of record for hotspots, classifications, alerts and ingestion logs.
PostGIS is used exclusively as the geographic reference layer. The existing `osm_features`
Mongo collection is retained as a **read model for the map layer only**, so the frontend's
`/osm/features/nearby` contract does not change.

### 6.3 Features computed

Within defined radii (500 m, 1 km, 3 km, 10 km) per hotspot: nearest industrial/power/mining
feature and its distance and type; land-use polygon containing or nearest to the point;
building count and density; road count and nearest road class; water body proximity;
protected/natural area membership; settlement proximity and class; agricultural area
membership.

### 6.4 Explicit handling of missing data

Every computed feature carries a resolution status. Where OSM genuinely has no data for a
location — which is common and expected in rural India — the feature is recorded as
**unresolved**, never as a substituted value. This is the core correction to the current
behaviour and it propagates into Phase 4.

### 6.5 Operational note

This phase requires teammates to run Postgres locally and download a 1.2 GB extract. A
documented `make setup-geo` target and a pre-built Docker volume option are provided to keep
demo-machine setup tractable.

---

## 7. Phase 4 — Honest ML pipeline

### 7.1 Stop substituting

`toCanonicalFeatureRecord` no longer emits `25000` for unknown distance or `-1` for unknown
recency. Unresolved features are passed as explicit nulls to the inference service, which is
updated to reject rather than silently coerce them.

### 7.2 Feature completeness

A `featureCompleteness` record is persisted with every classification:

```
{
  featureVersion: string,
  required: string[],
  resolved: string[],
  unresolved: string[],
  completenessRatio: number
}
```

### 7.3 Explicit unclassified state

A new terminal state `unclassified_insufficient_features` is introduced. It is **not** a
seventh model class; it is a pipeline outcome recorded when the spatial feature group is
unresolved, and it short-circuits inference entirely.

The gate is **not** a bare ratio, because the features are not equally important. The four
spatial features — `facility_distance_m`, `facility_type_encoded`, `landcover_encoded`, and
the 3 km cluster count — are declared **required**. If any of them is unresolved, the
detection is `unclassified_insufficient_features`. The thermal features come from FIRMS and
are effectively always present; the historical features legitimately have no value for a
first-ever detection at a coordinate, and that is a real observation rather than missing data,
so they are declared **optional** and passed as explicit nulls. `completenessRatio` is still
recorded for analysis but does not itself gate the decision.

This restores meaning to `other_or_uncertain`, which becomes a genuine model verdict again
rather than an artefact of missing data. The frontend already distinguishes provenance
visually and gains a third treatment for this state.

### 7.4 Encoding drift

`FACILITY_TYPE_MAP` and `LANDCOVER_MAP` are reconciled across the three locations that must
stay in lockstep — `ml/models/feature_schema.json`, `ml/src/training/train.py`, and
`backend/src/modules/classifications/feature.extractor.ts` — and a test asserts they remain
identical.

Codes 9–13 are resolved by **collapsing them into in-vocabulary parents**, not by extending
the vocabulary. Extending it would require the current model to have learned splits it has
never seen, which it has not:

| Out-of-vocabulary | Collapses to |
|---|---|
| `cement_plant` (9) | `general_industrial` (7) |
| `oil_gas_facility` (10) | `refinery` (1) |
| `petroleum_well` (11) | `refinery` (1) |
| `substation` (12) | `power_plant` (2) |
| `solar_farm` (13) | `power_plant` (2) |

These five types are then added to the vocabulary properly **as part of retraining**, when the
training data actually contains them. Until that point the serving vocabulary is exactly the
0–8 the model was trained on, which is the only state in which its output is defined.

### 7.5 Persistence

Stored per prediction: predicted class, confidence, full class probabilities, model version,
feature version, prediction timestamp, and the feature-completeness record above.

### 7.6 Retraining path

A weak-supervision labeller is built over real FIRMS detections joined to real PostGIS
features, producing a labelled dataset with documented rules. The model can then be retrained
and honestly evaluated with spatial cross-validation.

**This spec does not claim the retrained model will be good.** It claims the pipeline will be
correct and the model swappable. Any reported metric must come from evaluation on held-out
real data, and until that exists the interface must not present classification as reliable.

---

## 8. Phase 5 — Reverse geocoding

Backend-proxied Nominatim with a 1 request/second limiter and a descriptive `User-Agent`, per
the OSM usage policy. Results cached in a `geocodeCache` collection keyed by coordinates
rounded to three decimal places (~100 m), with a TTL of 90 days.

Returns village/locality, town/city, district, state, country — each level omitted when
Nominatim does not supply it, never guessed. OSM attribution is rendered in the hotspot panel
wherever a resolved place name appears.

Endpoint: `GET /api/v1/geocode/reverse?lat=&lon=`, returning the standard envelope. The
frontend calls it lazily on hotspot selection, not during list rendering.

---

## 9. Testing

There is currently no test runner; `verifyPipeline.ts` is a hand-rolled assertion script.
**Vitest** is added to backend and frontend.

Coverage targets the things that actually break:

| Area | Test |
|---|---|
| Dedup idempotency | Ingesting an identical batch twice produces zero additional rows |
| FIRMS normalize | VIIRS vs MODIS field reconciliation; malformed dates, out-of-range coordinates, negative FRP |
| Feature completeness | Unresolved features yield `unclassified_insufficient_features`, never a substituted value |
| Encoding lockstep | The three facility/landcover maps are asserted identical |
| Geocode cache | Second call for a nearby coordinate hits cache; rate limiter is respected |
| Envelope | Every route returns `{ success, data? , error? }` |

`verifyPipeline.ts` is migrated into Vitest rather than kept alongside it.

---

## 10. Sequencing and risks

Phases ship in order, each independently reviewable. Phase 1 is self-contained and touches
only four frontend files. Phases 3 and 4 are coupled: enrichment quality gates classification
honesty, so Phase 4 lands after Phase 3 is producing real features.

**Risks.**

The Liquid Glass displacement effect may not render in the demo browser; mitigated by feature
detection, a tuned fallback, and a spike before implementation.

PostGIS setup adds real operational burden to demo machines; mitigated by Docker and a
documented setup target.

Retraining may not yield a usable model within the available time. This is accepted: the
deliverable is a correct pipeline and an honest interface, not a claim of model quality.
If the model remains untrained at demo time, the interface reports classification as
unavailable rather than presenting synthetic predictions as real.

---

## 11. Verification

Before this work is called complete:

- FIRMS data is confirmed fetched from the live API and stored, by inspecting the database.
- Re-ingesting an identical batch is confirmed to create zero duplicate rows.
- Classification is confirmed to consume real stored features, with completeness recorded.
- Unresolved OSM features are confirmed to produce `unclassified_insufficient_features` and
  never a substituted number.
- Clicking a hotspot is confirmed to resolve its actual coordinates to a real place name.
- Frontend markers are confirmed to originate from the database.
- A search of both codebases confirms no remaining mock or fabricated fallback.
- The navbar is reviewed against this spec's material description at 375, 768, 1024, 1440.
- Contrast is measured, not eyeballed.

Model correctness is explicitly **not** verifiable here, for lack of ground truth. It will be
reported as "pipeline correct, model untrained".
