# Badminton Stats Overlay — MVP PRD

**Status:** concept/UX PRD after Lavish wireframe review
**Scope:** Chrome MV3 extension for local-first analysis of badminton video watched on YouTube
**Intent:** define the first usable product and its interaction contract; this document does not authorize implementation or claim model accuracy.

## 1. Product promise

While a user watches a badminton match on `youtube.com/watch`, Badminton Stats Overlay (BSO) builds a rally timeline and lightweight statistics locally. It adds a sibling overlay over the player; it never pauses, mutes, scrubs, resizes, replaces, or re-renders the YouTube video. Automatic analysis is a suggestion layer. Manual labeling is always available and exports portable CSV data.

The product is designed for broadcast/pro footage and personal YouTube uploads. There is no account, upload, remote inference service, token meter, or required companion app in the MVP.

## 2. Captain-decided defaults

- **Initial density: Minimal.** On first enable, show a quiet status chip and the stroke feed; stats and court minimap are collapsed. The user can open them without leaving playback. A later settings choice can use the Balanced arrangement (stats + minimap + feed), but Minimal is the MVP first-run default.
- **Court seeding: acceptable for MVP.** Ask for four outer-court image anchors once per video. Do not block the MVP on automatic court detection. Offer a skip-to-manual-labeling path.
- **Labeling: inline-first.** When a stroke suggestion needs attention, show a compact inline suggestion/correction row in the feed. Open the full shuttle-insights-derived labeling panel on demand.
- **Feedback retained as a future review loop:** density, court-seed friction, and labeling prominence remain queueable product questions even though the current defaults are recorded above.

## 3. User journey

1. **Watch:** open a badminton match and watch normally.
2. **Enable:** click the BSO toolbar badge. The popup is the control center.
3. **Seed court:** on the current frame, click the four outer corners of the full doubles court in numbered order. The overlay displays the generated official court lines. This is the only modal setup step; playback continues.
4. **Watch live:** the overlay synchronizes to the playing video and shows the current rally, stroke feed, and optional stats/minimap.
5. **Correct:** accept or reject inline suggestions, or press `O` for the full manual panel. Mark start/end and choose a shot family without pausing playback.
6. **Export:** view the match summary and download shot/rally CSV. The raw data remains local.

## 4. Screens and requirements

### 4.1 Popup / control center

The popup must show:

- YouTube match detected/not detected.
- Court state: seeded, not seeded, or camera change requires re-seed.
- Analysis state and backend status; slow/fallback analysis must be honest.
- **Minimal first-run density** plus panel toggles. Density is a presentation preference, not an analysis setting.
- Actions: enable/continue, seed/re-seed, manual-only, open overlay, export.
- Pro comparison visible as a disabled/late-phase option, not presented as an MVP capability.

### 4.2 Court seed / only modal step

The seed surface must:

- Capture a visual reference from the current video frame without controlling playback.
- Require four numbered clicks for the **outer full-court doubles corners** only.
- Show progress, undo/reset, skip to manual mode, and lock court.
- Render a preview of all derived lines, not just the four clicked points.
- Explain the distinction: user clicks define the four image-to-court anchor correspondences; fixed official court dimensions define every inner line. A homography warps the canonical geometry into the video. Physical dimensions never adapt. If a camera cut/zoom changes the projection beyond tolerance, pause analysis (not playback) and request re-seeding.

### 4.3 Live overlay / main event

The live overlay is a non-blocking sibling layer with three independent panels:

- **Stroke feed:** the time-ordered event log for the current rally (see §6). It is not a chart of the next predicted shot.
- **Stats panel:** rally number, rally duration/shot count, score when available, per-player coarse shot mix, and winner/error attribution.
- **Court minimap:** the canonical court with current player positions, shuttle trajectory, landing point, and an IN/OUT line-call check. Display the distance-to-line estimate only with an uncertainty/confidence state.

MVP first load is Minimal: a small live chip/feed. Stats and minimap are collapsible, movable, and independently reopenable. All panels must show the video time they represent and an analysis-age indicator when results lag playback.

The live state must also include:

- An inline `suggested shot · confidence · accept / correct` row.
- A quiet highlight index badge for the current completed rally.
- Winner/error attribution (`winner`, `forced error`, `unforced error`, or `unclassified`) with an explicit confidence/unknown state.
- A late-phase, opt-in `Compare to pro` entry point, collapsed by default and unavailable until the prerequisites in §7 are met.

### 4.4 Hybrid manual labeling

Carry over the tested shuttle-insights workflow and taxonomy:

- Start/end marks (`S` and `E`) while playback continues.
- 11 shot buttons: Serve, Clear, Drop, Smash, Half Smash, Lift, Net Shot, Net Kill, Push, Drive, Block.
- `1–9` quick labels for the first nine choices; `O` opens the panel; `Esc` closes it.
- Auto suggestion is visually distinct and reversible; `Enter` accepts it, a manual choice replaces it.
- Show segment timestamps, selected shot, and the same five dimension axes where applicable.
- Export CSV from the panel. Manual labels are first-class records, not a degraded/trial mode.

### 4.5 Match summary / export

The summary must show match duration, rally/shot counts, average rally length, shot mix, winner/error attribution, and a ranked list of top rallies. Each top rally shows its video timestamp and index score. MVP does not programmatically seek the player; it exposes a timestamp/review affordance without violating the no-touch playback rule.

CSV must preserve the shuttle-insights-compatible fields:

```text
video_url, shot_id, start_sec, end_sec, label,
longitudinal_position, lateral_position, timing, intention, impact, direction
```

Rally-level fields may be appended in a documented section/record shape: rally id, start/end, shot count, winner, lose reason, highlight index, and aggregate confidence.

## 5. Playback synchronization contract

Synchronization must require no user interaction with the YouTube player:

1. The content script observes the page's current `HTMLVideoElement` and uses `HTMLVideoElement.requestVideoFrameCallback` when available. It reads `mediaTime`, presentation metadata, dimensions, and playback state; it never assigns `currentTime`, `paused`, `muted`, `playbackRate`, `src`, or player styles.
2. Frames are sampled/throttled by wall-clock and media time, then transferred to the MV3 offscreen analysis document. Inference runs off the page UI thread. Results are keyed by media timestamp/rally id.
3. The sibling overlay is positioned from the video element's client rect and re-anchored with `ResizeObserver`/DOM observation for theater/fullscreen/resolution changes. All court coordinates are normalized before display.
4. The renderer consumes the newest result whose timestamp is at or before the current media time. If inference is behind, retain the last result, show its age, and skip work; never wait by blocking playback and never seek to catch up.
5. On a YouTube SPA navigation or video-element replacement, detach/re-attach observers and reset video-local state. On playback-rate changes, use media timestamps rather than frame counts.
6. Detect camera cuts or court reprojection drift from player/court tracking. Mark automatic stats stale and request a re-seed; do not change the physical court model and do not touch the player.

The synchronization acceptance test is: a user can watch continuously, change theater/fullscreen or playback rate, and see the overlay follow the same match time without a pause, seek, mute, player click, or visible layout fight.

## 6. Stroke feed semantics

A stroke-feed item is an observed or manually confirmed event, not a forecast. Required fields:

```text
rally_id, sequence, player_id, shot_family,
hit_media_time, source(auto|manual|corrected),
classification_confidence, geometry_confidence, status
```

- Items are sorted by `hit_media_time` and rendered left-to-right or top-to-bottom in rally order.
- `status` is `suggested`, `accepted`, `corrected`, or `unclassified`.
- Every item identifies the player and coarse shot family; confidence badges refer to classification/geometry confidence, not certainty that the player or rally segmentation is correct.
- A low-confidence suggestion stays editable and should not silently become a match statistic.
- A manual correction updates the same event id and appends provenance; it does not create an unexplained duplicate.
- The feed keeps the current rally visible, collapses older rallies, and exposes the rally timestamp. It does not say or imply “the next shot will be …”.

## 7. Market concepts and exact definitions

### Rally highlights index

The index is a deterministic **replay-candidate ranking heuristic**, not a model confidence score and not automatic clipping. Calculate only for completed rallies after enough history exists (minimum 10 completed rallies):

```text
index = round(100 * (
  0.40 * length_percentile
+ 0.25 * variety
+ 0.20 * outcome_pressure
+ 0.15 * mean_tracking_confidence
))
```

All components are normalized to 0–1:

- `length_percentile`: percentile rank of this rally's shot count among completed rallies in this video.
- `variety`: `min(unique_coarse_shot_families / 4, 1)` for the MVP coarse set (clear/drop/smash/net).
- `outcome_pressure`: `1.0` for a winner or forced-error finish at a tight/game-point score, `0.7` for a winner or forced-error finish in an ordinary score state, `0.4` for an ordinary classified rally end, and `0` when the outcome is unclassified. If score OCR is unavailable, use the ordinary-state value and mark the component partial.
- `mean_tracking_confidence`: mean of the accepted stroke/trajectory confidence values in the rally; missing values reduce confidence rather than becoming 1.

Show the score, component tooltip, sample size, and source timestamp wherever the index is displayed. A top-rally row can expose a timestamp for human review; v1 does not programmatically seek the player.

### In/out line-call check

After a court seed, map the estimated landing point through the homography and compare it to the relevant generated boundary. Display `IN`, `OUT`, distance-to-line, and confidence/unknown. A 40 mm line belongs to the court area it bounds, per BWF Law 1.3. A low-confidence call is a review suggestion, not an official line judge decision.

### Winner/error attribution

Use the final accepted stroke, landing/line state, rally termination, and available score context to label `winner`, `forced error`, `unforced error`, or `unclassified`. Preserve the evidence and confidence. Never infer a winner when the final landing or player identity is unknown.

### Pro-comparison mode (late phase)

This is an opt-in comparison against a curated benchmark of completed pro rallies, not a live coach or next-shot predictor. It is gated to a later phase until benchmark licensing, matching, and enough sample data exist. For a selected completed-rally set, compare like-for-like:

- shot-family mix;
- rally-length distribution;
- court placement/landing zones after homography;
- winner/error mix and sample size.

Show the benchmark name, match/context filters, number of user and pro rallies, coverage/unknown rate, and a note that correlation is not instruction. Keep it collapsed and never interrupt the live rally.

## 8. Official court geometry

Use the standard court from the BWF *Laws of Badminton*, Section 4.1, Diagram A. Let the canonical court coordinate system be `x` across width and `y` along length, with the net at `y = 6.70 m`:

- Full doubles court: **13.40 m long × 6.10 m wide**.
- Lines: **40 mm wide**; every line is part of the area it defines (Law 1.1 and Law 1.3).
- Doubles side lines: `x = 0` and `x = 6.10`.
- Singles side lines: `x = 0.46` and `x = 5.64`, giving **5.18 m** singles width.
- Back boundaries: `y = 0` and `y = 13.40`. These are the singles long-service/back boundaries and the outer rally boundaries for both formats.
- Net: across the court at `y = 6.70 m`; posts are on the doubles side lines (Law 1.5), 1.55 m high.
- Short/front service lines: **1.98 m from the net**, at `y = 4.72 m` and `y = 8.68 m`.
- Centre lines: `x = 3.05 m`, dividing left/right service courts from each short service line toward the relevant back boundary.
- Doubles long service lines: **0.76 m inside each back boundary**, at `y = 0.76 m` and `y = 12.64 m`. They limit doubles service length; they are not the outer back boundaries.

The four user clicks are the four image positions corresponding to `(0,0)`, `(6.10,0)`, `(6.10,13.40)`, and `(0,13.40)` — the outer full-court doubles rectangle. The clicks do **not** define the singles sidelines, short/front service lines, centre lines, doubles long-service lines, net, or physical dimensions. Those are generated from the canonical geometry and projected into the current video by the homography. A camera zoom/pan may change the image projection; it must not change the canonical measurements. A cut that invalidates the projection requests a re-seed.

## 9. MVP boundaries and feasibility notes

In scope: local YouTube capture, player/pose and shuttle/rally pipeline where feasible, one-time manual court seed, four coarse automatic shot families, confidence-aware suggestions, manual 11-class labeling, live feed/stats/minimap, deterministic index, winner/error review states, and CSV export.

Out of scope until validated: automatic court detection, fine-grained 18-class ML classification, authoritative officiating, calibrated smash speed, doubles-specific behavior, automatic highlight clipping, live pro coaching, cloud inference, and any model licensing path not cleared for distribution.

The existing shuttle-insights extension is the reuse foundation for the manual panel, glossary, drag/resize/theme behavior, and CSV schema (83/83 tests in the reuse audit). The technical feasibility report recommends an MV3 offscreen document, `requestVideoFrameCallback`, WebGPU-first ONNX Runtime Web, and a TrackNet browser spike before promising reliable shuttle tracking. The highest-risk implementation item remains TrackNet-in-browser; this PRD intentionally does not hide that risk behind the wireframe.

## 10. Acceptance criteria for the next implementation spike

- A packed MV3 build can attach to a YouTube watch page without modifying playback.
- Overlay timestamps remain aligned during normal playback, rate changes, theater/fullscreen, DOM/video replacement, and a synthetic inference delay.
- Four outer-corner clicks produce the full canonical line set with correct normalized dimensions; re-seed handles a camera cut.
- Minimal is the first-run overlay default; stats/minimap are independently collapsible and the feed is available inline.
- The feed never presents a future-shot prediction and every suggestion can be accepted or corrected with provenance.
- A ten-rally fixture produces deterministic highlights-index components and a ranked result with an explainable score.
- Manual labeling retains the shuttle-insights shortcuts and CSV headers and does not require pausing.
- Unknown/low-confidence line calls, stroke labels, rally endings, and winner attribution remain visibly unknown rather than silently asserted.

## Source evidence

- [BWF Laws of Badminton, Section 4.1](https://system.bwfbadminton.com/documents/folder_1_81/Statutes/CHAPTER-4---RULES-OF-THE-GAME/SECTION%204.1-%20Laws%20of%20Badminton.pdf), Laws 1.1, 1.3, 1.5, Diagram A.
- `data/badminton-statistics-research/report.md` — market whitespace, GGAB-validated stat set, highlights/manual hybrid, pro comparison.
- `data/badminton-reuse-audit/report.md` — shuttle-insights foundation, manual labeling, shortcuts, CSV, drag/resize/theme, 83/83 tests.
- `data/badminton-statistics-technical-research/report.md` — empirical YouTube frame capture, synchronization architecture, offscreen inference, court/homography, and TrackNet risk.
- `.lavish/board.html` — final captain-reviewed playable wireframe prototype (session ended after the requested feedback pass).
