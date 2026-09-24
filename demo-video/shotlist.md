# IGNISSENSE — SIH 2026 demo film · shot list

1920×1080, 30 fps, 2:39.5, no narration. Cross-dissolves of 0.44 s (0.6 s on the open). Every clip carries
a 0.5 s handle at each end, so the outgoing scene is still rendering under the incoming fade.

Take A is the main continuous Playwright session against the running stack; take B is a short
supplementary session for the flight and the OpenStreetMap scene; take C re-shot the national views
at a wider framing. Source timecodes are positions inside those recordings.

| # | In | Out | Surface | On screen | Source | Camera | Why it is here |
|---|---|---|---|---|---|---|---|
| 01 | 0:00.0 | 0:10.0 | Map · FIRMS colouring | India at national zoom, every detection the same red. | take A 00:33.6 | 1.000 → 1.012 | Problem: the feed reports heat, not cause. |
| 02 | 0:10.0 | 0:18.5 | Map, dimmed · fan diagram | One detection branching to the six classes it could be, in the product's own colours. | take C 00:38.5 + composition | 1.006 → 1.000 | Makes the ambiguity explicit, and states the scale. |
| 03 | 0:18.5 | 0:29.5 | Map · render-mode toggle | Real click on 'By fire type'. The country recolours; per-class counts fill the drawer. | take C 00:47.2 | 1.000 → 1.012 | The solution, as one state change on one frame. |
| 04 | 0:29.5 | 0:40.5 | Pipeline | Four stages on a drawn line, each with the real parameter it uses. | composition | static | How a detection acquires context the satellite never measured. |
| 05 | 0:40.5 | 0:48.5 | Drawer · Live feed | FIRMS / model / database health, newest detections arriving. | take C 01:05.4 | 1.010 → 1.000 | It runs, on a schedule. |
| 06 | 0:48.5 | 0:59.5 | Alerts · severity = Critical | Real select, then the 1,141 m ArcelorMittal row and its detail pane. | take A 02:08.1 | 1.000 → 1.011 | Alerting is a rule, held apart from the classifier. |
| 07 | 0:59.5 | 1:09.5 | Map · flight to Hazira | 'View on map' hands the case over; the camera flies India → the steelworks. | take B 00:45.8 | flat, MapLibre supplies the motion | Moves from a national list to one site. |
| 08 | 1:09.5 | 1:20.5 | Panel · What's nearby | Nearest site, type, distance, land cover. Focus box on the four rows. | take B 01:03.1 | 1.010 → 1.000 | The OpenStreetMap join, as the product reports it. |
| 09 | 1:20.5 | 1:31.5 | Panel · Fire type | Six probabilities and the model version. Focus box on the class block. | take A 02:47.5 | 1.000 → 1.010 | The prediction, with its uncertainty left visible. |
| 10 | 1:31.5 | 1:42.5 | Panel · History at this spot | Persistence and anomaly side by side. Focus box on the two tiles. | take A 03:02.5 | 1.009 → 1.000 | The distinction PS 26162 needs. |
| 11 | 1:42.5 | 1:54.5 | Panel · Past detections → Why | FRP across prior overpasses, then the written explanation. | take A 03:19.2 | 1.000 → 1.010 | Evidence behind the alert. |
| 12 | 1:54.5 | 2:04.5 | Evidence card | Held-out accuracy against two baselines. | composition | static | Does it work, measured on unseen blocks. |
| 13 | 2:04.5 | 2:15.5 | Evidence card | Ablations, and where the labels came from. | composition | static | Which inputs carry the signal. |
| 14 | 2:15.5 | 2:25.5 | Map · a refused detection | Kishtwar, J&K. 'Couldn't classify this fire.' Focus box on the message. | take A 04:26.9 | 1.009 → 1.000 | The system declines instead of guessing. |
| 15 | 2:25.5 | 2:34.5 | Dashboard | Totals, 7-day trend, class split, latest detections. | take A 04:41.9 | 1.011 → 1.000 | What an operator is left holding. |
| 16 | 2:34.5 | 2:39.5 | Outro | Wordmark, one line, team and problem statement. | composition | static | Identify the project. |

## Focus boxes

A 2 px outline in the application's own accent, drawn over a real UI element 2.2 s into the scene and
faded before the cut. It is nested inside the video wrapper, so it scales with the camera and stays
registered to the element underneath.

- **08** at 1:11.7 — the four nearest-site rows
- **09** at 1:22.7 — the six class probabilities
- **10** at 1:33.7 — the persistence and anomaly tiles
- **14** at 2:17.7 — the 'Couldn't classify this fire' message
