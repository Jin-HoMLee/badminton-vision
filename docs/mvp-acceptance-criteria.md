# MVP acceptance criteria and session record

**Status:** acceptance record for the MVP acceptance session (2026-09-13)
**Captain's match URL:** https://www.youtube.com/watch?v=99riPBazzfk&t=1057s
**Scope authority:** captain's intent, planning board decision D5 = option A
(2026-09-05), and the 2026-09-05 acceptance-gate additions below.

This document is itself a deliverable: it enumerates every panel, button,
setting, display, and toggle in the MVP scope, the racket A/B verdict method,
and all seven acceptance-gate additions verbatim, then records a pass/fail
observation for each item from one combined real-Chrome session. Pose and
player detection are in scope; racket detection, shuttle detection, and
automatic court detection are later-version scope except where named below.
BlazePose stays gated/disabled — its re-test was explicitly postponed by the
captain (2026-09-05) and this session does not lift that gate.

Legend: `[x]` pass (observed working as specified), `[ ]` not yet exercised,
**FAIL** = observed defect (see notes), **N/A** = out of MVP scope by design.

---

## 1. Popup / control center

- [ ] YouTube match detected/not detected indicator (`data-bso-youtube-detected`)
- [ ] Detected-video block shows real tab title/channel/duration (fixture only
      as labeled `fixture preview` outside a watch page)
- [ ] Inference state display, independent of court-map state
      (`data-bso-runtime-phase`, `data-bso-runtime-analyzer`)
- [ ] Court-map state display: not-set-up / calibrated / recalibrating
      (`data-bso-court-map-state`)
- [ ] Analysis state and backend status display (WebGPU / WebGL fallback /
      WASM), honest about slow/fallback analysis
- [ ] Status chip never shows fixture-era static defaults as live state
- [ ] Density selector — **Minimal** (first-run default), **Balanced**,
      **Full**
- [ ] **Panel Controls** disclosure — per-panel toggle for each on-demand
      panel (Stats, Stroke feed, Court map, Manual labeling, Settings, Live
      controls), persisted per video
- [ ] **Evidence visibility** disclosure (collapsed by default; expands with
      focus moving to first switch):
  - [ ] Pose switch
  - [ ] Player-box switch
  - [ ] Racket switch
  - [ ] Shuttle switch
  - [ ] **Court projection** switch (the single toggle for court-line
        rendering)
- [ ] **Pose Detection Model** selector:
  - [ ] LiteOpenPose (bundled production default) selectable and active
  - [ ] MoveNet selectable (fetches from TF Hub)
  - [ ] BlazePose listed but grayed out / unselectable, tooltip explains
        "work in progress" (must stay gated — see §8)
- [ ] **Racket Detection Model** selector:
  - [ ] EfficientDet-Lite0 (bundled production default) selectable and active
  - [ ] YOLO-World (experimental) listed; selectable only when local assets
        are prepared, otherwise disabled with explicit reason
- [ ] Settings header gear button opens the Settings panel
- [ ] Action: **Turn on inference** / Enable button — capture begins only
      after this explicit action
- [ ] Action: **Set up court** / **Recalibrate court** button
- [ ] Action: **Label it myself** / manual-only path
- [ ] Action: **Export** (CSV)
- [ ] **Compare to pro** shown as a disabled/late-phase option, not an MVP
      capability
- [ ] Popup info callouts with long bodies collapse to a one-sentence summary
      with a hover/focus tooltip for the full text (intro status, court,
      camera-cut, action-error, pose-model-switch-failure callouts)

## 2. Optional court setup / map-only step

- [ ] First-use **Set up court** action shown before any fit exists
- [ ] Four numbered clicks captured in order: near-left, near-right,
      far-right, far-left
- [ ] Progress indicator advances per click
- [ ] **Undo** last point
- [ ] **Reset** clears all points
- [ ] **Skip to manual** path available at any point during setup
- [ ] Preview renders all derived lines (not just the four clicked points)
- [ ] **Lock court** commits the fit; becomes **Recalibrate court** afterward
- [ ] Floating corner-label buttons + number-key shortcuts (1–4) place the
      current corner at the clamped marked spot; direct clicks still place
      anywhere
- [ ] Camera-cut invalidation triggers an automatic re-seed request; raw
      pose/shuttle/racket evidence keeps running throughout
- [ ] Setup surface clips above the YouTube control strip
      (`--overlay-controls-reserve`) so native controls stay clickable

## 3. Live overlay / main event

- [ ] Minimal first load shows only the pure detection layer + one compact
      **Panels** access point
- [ ] **Panels** access point opens Stats, Stroke feed, Court map, Manual
      labeling, Settings on demand
- [ ] **Stroke feed** panel: time-ordered event log for current rally,
      collapse/expand (chevron), close (x), drag by header, resize from
      corner, bounded scrollable body
- [ ] **Stats** panel: rally number, rally duration/shot count, score when
      available, per-player shot mix, winner/error attribution;
      collapse/expand/close/drag/resize
- [ ] **Court minimap** panel: canonical court, player positions, shuttle
      trajectory/landing, IN/OUT line-call check with confidence after
      calibration; explicit **Set up court** action before calibration,
      **Recalibrate court** after; collapse/expand/close/drag/resize
- [ ] **Settings** panel: read-only About content (version from manifest,
      links), independent of inference on/off; collapse/expand/close/drag/resize
- [ ] Every panel shows the video time it represents and an analysis-age
      indicator when results lag playback
- [ ] Inline `suggested shot · confidence · accept / correct` row
- [ ] Quiet highlight-index badge for the current completed rally
- [ ] Winner/error attribution states: winner, forced error, unforced error,
      unclassified — with explicit confidence/unknown state
- [ ] **Compare to pro** entry point collapsed by default, unavailable
      (late-phase, N/A for MVP functional test beyond "correctly inert")
- [ ] All panels clamp to the video viewport and stay above the native
      YouTube control strip
- [ ] Collapse (chevron) and close (x) are distinct actions; state survives
      navigation/reload
- [ ] A dragged/resized panel's saved placement survives a density change
- [ ] Native player controls (pause, seek, time bar, settings, fullscreen)
      remain clickable through the overlay at all times, including during
      four-corner setup

## 4. Hybrid manual labeling

- [ ] Manual labeling panel opens via pencil action or `O` key; `Esc` closes
- [ ] **S** / **E** keys mark start/end while playback continues (no pause)
- [ ] 11 shot buttons: Serve, Clear, Drop, Smash, Half Smash, Lift, Net Shot,
      Net Kill, Push, Drive, Block
- [ ] `1`–`9` quick labels map to the first nine shot choices
- [ ] Auto suggestion visually distinct and reversible; `Enter` accepts it, a
      manual choice replaces it
- [ ] Segment timestamps, selected shot, and dimension axes shown
- [ ] **Save label** persists a new record
- [ ] Re-open a saved row, change its label, **Save correction** updates the
      same event id (no duplicate)
- [ ] **Export CSV** downloads a row with the current video URL and label
- [ ] CSV import restores rows, de-duplicating by event id / 0.5s window
- [ ] Saved-label list renders in the same bounded scrollable feed contract

## 5. Match summary / export

- [ ] Summary shows match duration, rally/shot counts, average rally length,
      shot mix, winner/error attribution
- [ ] Ranked top-rallies list, each with video timestamp and index score (no
      programmatic seek — timestamp is a review affordance only)
- [ ] CSV preserves shuttle-insights-compatible fields (`video_url, shot_id,
      start_sec, end_sec, label, longitudinal_position, lateral_position,
      timing, intention, impact, direction`)

## 6. Playback synchronization / no-touch-playback contract

- [ ] Overlay tracks media time through normal playback, rate changes,
      theater/fullscreen, and DOM/video replacement without a
      pause/seek/mute/player click
- [ ] `paused`, `muted`, `playbackRate`, `currentSrc/src` never change from
      the extension; only natural `currentTime` advances
- [ ] Stale results are retained with a visible age indicator, never
      backfilled by seeking

---

## 7. Racket A/B verdict: EfficientDet vs YOLO-World (experimental)

**Method:** on the same clip/passage of the captain's match, under the same
conditions (same rally, same frames reviewed), switch the popup's **Racket
Detection Model** between EfficientDet-Lite0 (production default) and
YOLO-World (experimental) and record for each: per-frame detection presence/
absence on visually-confirmed racket frames, box precision (visually judged
against the visible racket), per-frame latency/throughput, and any failure/
fallback behavior. Because YOLO-World is research-measured at ~2-6s/frame
(archive-grade, not for live play), the comparison scrubs/pauses to matched
frames rather than comparing live playback smoothness.

- [ ] EfficientDet-Lite0 run recorded on the match clip
- [ ] YOLO-World (experimental) run recorded on the **same** clip/frames
- [ ] Verdict written with the evidence behind it (see `docs/racket-ab-verdict.md`)

## 8. BlazePose gate (do not lift)

- [ ] BlazePose entry remains listed but grayed out/unselectable in the Pose
      Detection Model picker, with a tooltip explaining the freeze risk
- [ ] A stored `bvSelectedPoseModel` preference naming BlazePose still
      falls back to LiteOpenPose
- [ ] This session does **not** attempt to lift or re-test the gate

---

## 9. Acceptance-gate additions (2026-09-05, captain-requested review of a Roboflow agent's plan)

Each of these must be exercised and its outcome recorded, not just the happy
path:

1. **Negative test:** a non-badminton sports video must NOT produce a stable
   match state.
2. **A 30-minute playback run** with seeks, pauses, tab switches, and quality
   changes: no unbounded memory growth, no overlay leaks, stale results
   discarded after a seek or navigation.
3. **Coordinate mapping** verified in normal, theater, and fullscreen player
   modes, including device-pixel-ratio and letterboxing.
4. **The overlay disappears or pauses** when the video is paused, hidden, or
   navigated away from.
5. **Offline behavior:** the packed extension still runs core detection after
   a network disconnect (remote-fetch models such as MoveNet/BlazePose may
   degrade gracefully; local vendors must keep working).
6. **Match-state stability:** no flickering between states on isolated/
   ambiguous frames.
7. **Per-class visual spot-checks** on the captain's match: players, rackets,
   shuttle trail (when the runtime is enabled), court overlay.

Recorded outcomes for each are in the "Acceptance-gate additions — results"
section below.

---

## 10. Regression / test suite pass

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run runtime-smoke`
- [ ] `node scripts/validate-extension.js`

---

# Session record

_(Filled in during the combined real-Chrome session. Each item above gets a
pass/fail note here; screenshots/logs are referenced by path.)_
