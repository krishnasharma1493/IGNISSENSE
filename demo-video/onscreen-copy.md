# IGNISSENSE — SIH 2026 demo film · on-screen copy

Silent film, 2:39.5. Every word that appears on screen, in order. Nothing is spoken.

| In | Where | Copy |
|---|---|---|
| 0:00.6 | caption plate | **NASA FIRMS** — The feed reports where a satellite saw heat. |
| 0:04.2 | caption plate | It does not report what was burning. |
| 0:10.8 | diagram | ONE DETECTION |
| 0:11.3 | diagram | Industrial fire · Gas flare · Wildfire · Agricultural burning · Mining activity · Uncertain |
| 0:12.6 | diagram | 4,218 detections in the past seven days. |
| 0:13.3 | diagram | The type decides who should act on it. |
| 0:19.1 | caption plate | **IGNISSENSE** — Every detection gets a type. |
| 0:19.3 | caption plate | Six classes, one XGBoost model. |
| 0:29.7 | pipeline | HOW A DETECTION IS CLASSIFIED |
| 0:29.8 | pipeline | Context the satellite never measured |
| 0:30.5 | pipeline | **NASA FIRMS** — 4 products / every 5 minutes |
| 0:30.9 | pipeline | **Spatial context** — 341,086 OSM features / nearest within 25 km |
| 0:31.3 | pipeline | **History at the spot** — prior passes within 1.5 km / FRP baseline and z-score |
| 0:31.8 | pipeline | **XGBoost** — 14 features / 6 classes with probabilities |
| 0:41.0 | caption plate | **RUNNING** — Four FIRMS products, polled every five minutes. |
| 0:49.0 | caption plate | **ALERTING** — Raised by rule, not by the classifier. |
| 0:49.3 | caption plate | Anomaly ≥ 0.65 within 1.5 km of mapped infrastructure. |
| 1:00.0 | caption plate | **THE CASE** — Hazira · Surat · Gujarat |
| 1:00.3 | caption plate | 37.0 MW · VIIRS NOAA-20 · 2026-09-10 08:43 UTC |
| 1:10.0 | caption plate | **SPATIAL CONTEXT** — ArcelorMittal Nippon Steel India, 1.1 km away. |
| 1:10.3 | caption plate | Nearest of 341,086 OpenStreetMap features. |
| 1:21.0 | caption plate | **CLASSIFICATION** — Industrial fire, 80%. |
| 1:21.3 | caption plate | The other five probabilities are shown too. |
| 1:32.0 | caption plate | **TWO SEPARATE SCORES** — Persistence 0.95. Anomaly 0.90. |
| 1:32.3 | caption plate | A plant that burns nightly stays normal. |
| 1:43.0 | caption plate | **WHY IT WAS RAISED** — 37.0 MW against an 8.0 MW baseline. |
| 1:43.3 | caption plate | +3.4σ across 50 prior overpasses within 1.5 km. |
| 1:54.7 | evidence card | HELD-OUT EVALUATION |
| 1:54.8 | evidence card | **47,382 detections the model never saw** |
| 1:55.0 | evidence card | XGBoost · 14 features — 65.5% / F1 0.549 |
| 1:55.2 | evidence card | Nearest-facility rule — 42.0% / F1 0.413 |
| 1:55.3 | evidence card | Majority class — 25.3% / F1 0.067 |
| 1:55.8 | evidence card | Test rows are 2024 detections inside 0.5° map blocks assigned wholly to the test partition, so no site in it was seen during training. |
| 1:56.0 | evidence card | source · ml/models/model_metadata.json |
| 2:04.7 | evidence card | WHERE THE SIGNAL COMES FROM |
| 2:04.8 | evidence card | **Ablations on the same test set** |
| 2:05.0 | evidence card | All 14 features — 65.5% |
| 2:05.2 | evidence card | Without history features — 55.7% (−9.8) |
| 2:05.3 | evidence card | Without OpenStreetMap features — 57.9% (−7.6) |
| 2:05.5 | evidence card | Fire radiometry only — 41.9% (−23.6) |
| 2:05.8 | evidence card | Labels came from the FIRMS type flag, VIIRS Nightfire flare sites, Maus et al. 2022 mining polygons and ESA WorldCover. None of those is an input the model can read. |
| 2:06.0 | evidence card | source · ml/models/model_metadata.json |
| 2:16.1 | caption plate | **WHEN IT CANNOT TELL** — No industrial site mapped within 25 km. |
| 2:16.3 | caption plate | Stored unclassified. The model is not called. |
| 2:26.1 | caption plate | **AT SCALE** — 12,585 detections. 125 behaving unusually. |
| 2:26.3 | caption plate | A short list to check, instead of a feed of red dots. |
| 2:34.8 | outro | IGNISSENSE |
| 2:35.2 | outro | Six-class classification of NASA FIRMS thermal hotspots over India |
| 2:35.4 | outro | Team AstraX · Smart India Hackathon 2026 · Problem Statement 26162 |
