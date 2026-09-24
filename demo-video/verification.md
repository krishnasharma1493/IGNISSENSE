# Verification notes — what is real, what is not

Filmed against the running stack on 2026-09-23 / 24: the Express backend on :5001 connected to MongoDB
Atlas (`databaseMode: atlas`, `demoMode: false`), the Python inference service on :8000 serving
`xgb_fire_classifier_v2.joblib`, and the Vite frontend on :5173.

## Real

- **All product footage.** Three headless-Chrome Playwright sessions at 1920×1080 with Metal-backed
  WebGL. Every click, wheel-zoom, dropdown and scroll on screen is a real interaction with the running
  application. No interface element is re-created or mocked anywhere in the film.
- **The detections.** NASA FIRMS near-real-time observations, pulled by the backend's own five-minute
  loop from the live area API. The backend ingested and classified a fresh batch about twenty minutes
  before the main take and kept polling through it.
- **The database.** Atlas, holding 341,086 OpenStreetMap features and roughly 12,500 detections at
  capture time. Confirmed not the `mongodb-memory-server` fallback.
- **The model.** The real XGBoost artifact, `XGB-FIRMS-v2.0.0-INDIA-SP2023`, XGBoost 3.4.1, answering
  over HTTP. Every classification on screen carries that version string with no `-OFFLINE` suffix.
- **The case.** HS-6ADD57, 21.10231°N 72.63628°E, Hazira · Surat · Gujarat. 36.95 MW, brightness
  338.06 K, VIIRS NOAA-20, day pass. Industrial fire 0.8003, gas flare 0.0831. Persistence 0.95,
  anomaly 0.90, 1,141 m from ArcelorMittal Nippon Steel India (OSM `way/104647203`), land cover
  built-up, 50 prior overpasses within 1.5 km, baseline FRP 8.0 MW, +3.4σ. Read back from the API
  before filming and visible on screen in the film.
- **The refused detection.** HS-2B7E73, Bhatkut · Kishtwar · Jammu and Kashmir, 0.4 MW, night pass,
  observed 2026-09-15. Stored `unclassified_insufficient_features` with `facility_distance_m`,
  `facility_type_encoded` and `landcover_encoded` unresolved.
- **Both evidence cards.** Verbatim from `ml/models/model_metadata.json`: accuracy 0.6549, macro F1
  0.5488, baselines 0.4204 and 0.2529, ablations 0.5574 / 0.5792 / 0.4192. Read, not re-run.
- **The six class names and colours** in the opening diagram are `CLASS_CONFIG` from
  `frontend/src/types/index.ts`, unchanged.
- **4,218 detections in the past seven days** is the figure the dashboard prints, and the dashboard
  showing it appears later in the same film.

## Historical, and stated as such

- **The case detection is 14 days old.** Observed 2026-09-10, in the database since 2026-09-13. The
  pipeline around it is live and polling every five minutes; that one row is not a live arrival. The
  panel shows its "Detected" and "Received" timestamps on screen, and no caption claims otherwise.
- **The refused detection** was observed 2026-09-15. Showing it required widening the map's time
  filter to "All detections", which happens visibly on screen.

## Window and scope shown on screen

- The map's default filter is 48 hours, which is what the opening scenes show. The map layer requests
  at most 5,000 detections, so a national view is a sample of that window rather than a full census;
  the drawer prints "Showing 5,000 of 5,000" when it is capped.
- Alert and dashboard totals move every five minutes. Every aggregate on screen — 12,585 detections,
  125 unusual, 50 open alerts, 4,218 over seven days — is as at capture time, not a fixed property.

## Made for the film, and not part of the product

- **The opening fan diagram, the pipeline card, the two evidence cards and the outro.** These are the
  only frames that are not a recording of the application. Both evidence cards print their source path.
- **Caption plates and focus boxes** are composition. Every figure on a plate is legible on the
  application's own surface in the same shot; every focus box outlines a real element in the real UI.
- **The music bed** was synthesised for this film (D-minor drone, deterministic, seed 26162). Sound
  effects are from the Kenney library bundled with the `/brag` plugin, placed only on six moments where
  the interaction that makes them is visible.
- **There is no narration of any kind.** The previous cut's synthesised voice track was removed, not
  replaced.

## Capture artefacts

- Playwright's screencast ran about 11% slower than wall-clock, so on-screen motion plays back slightly
  slower than it happens live. Clips were resampled to constant 30 fps. No speed ramping, no trimming
  of dead time inside a shot, no frame interpolation.
- A hover tooltip sits on the map in the refusal scene because the cursor had to stay where it clicked.
  It is real UI.

## Omitted, and why

- **Export (GeoJSON / CSV).** It ends in a file download, which reads as a still frame. The design
  point it carries — predictions are deliberately excluded from exports — is not made in the film.
- **127 rows in the database are `unclassified_model_unavailable`**, written while the inference
  service was down at some earlier point. None appear in the film. They are a real state of the system
  and are disclosed here rather than shown.
- **A Bawana take of the OpenStreetMap scene was shot and discarded**, because that overlay only draws
  when a detection is selected and the shot showed an empty map. It was re-shot at Hazira against the
  selected detection.

## Claims deliberately not made

No accuracy figure appears without its held-out split and its baselines. Nothing claims real-time
detection, fire prediction, ground verification, or that a classification is a finding rather than a
prediction. The alerts page's own wording — "Confirm each one on the ground before acting" — is left
legible on screen.
