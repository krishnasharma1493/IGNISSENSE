# IGNISSENSE — SIH 2026 demo film

**Problem Statement 26162 · Team AstraX** · 1920×1080, 30 fps, 2:39 · no narration

> The `.mp4` files and the `composition/` project are **not in this repository** — they are too
> large for git (the master is 189 MB, over GitHub's 100 MB per-file limit). They are attached to
> the GitHub Release instead. The notes below are kept in git because they document what is real in
> the film and what was staged.

| File | What it is |
|---|---|
| `ignissense-demo.mp4` | The film. Show this one. |
| `ignissense-demo-compact.mp4` | Same film, re-encoded smaller for upload or email. |
| `onscreen-copy.md` | Every word that appears on screen, with its timecode. |
| `shotlist.md` | Scene by scene: what is on screen, which take it came from, why it is there. |
| `rationale.md` | The editing decisions and why they were made. |
| `verification.md` | What is real, what is historical, what was made for the film, what was left out. |
| `composition/` | The Hyperframes project, so the film can be rebuilt or re-cut. |

## It is built to be watched with the sound off

There is no narration. The argument is carried by the product, by short captions, and by four focus
boxes drawn over the UI element each caption is talking about. The audio is a quiet synthesised bed and
six interface sounds placed on interactions you can see happen — nothing in it is load-bearing.

## Read this before a judge does

`verification.md` lists every claim and where it came from. Two things a careful evaluator will probe:

- The case detection (Hazira, HS-6ADD57) is a genuine NASA FIRMS observation from **2026-09-10**, held
  in the database since 2026-09-13. The pipeline around it is live and polls every five minutes; that
  one row is not a live arrival. The panel shows both timestamps on screen.
- **Four things in the film are not recordings of the product**: the fan diagram in the opening, the
  pipeline card at 0:29, and the two evidence cards at 1:52 and 2:02. Both evidence cards print their
  source path, `ml/models/model_metadata.json`. Everything else is the real application under a real
  cursor.

## Rebuilding it

`composition/` is a standard Hyperframes project — scene clips, music, fonts, and an `index.html` that
is a GSAP timeline. `plan2.json` is the timeline it was generated from: every scene start, duration
and source in-point. From that folder:

```
npx hyperframes check
npx hyperframes render --quality delivery --video-frame-format jpg --browser-gpu
```

Rendering needs ffmpeg and ffprobe on PATH.
