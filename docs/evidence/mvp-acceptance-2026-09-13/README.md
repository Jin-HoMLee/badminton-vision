# MVP acceptance session evidence - 2026-09-13

Curated screenshots plus the raw 30-minute soak-test log from the combined
real-Chrome MVP acceptance session against the captain's match
(<https://www.youtube.com/watch?v=99riPBazzfk&t=1057s>). The screenshots are a
subset; the full session captured ~30 screenshots plus the raw A/B comparison
frame captures, which are not committed here for size (see
`docs/mvp-acceptance-criteria.md` for the full session record and the exact
observations each image backs).

`30min-soak-log.jsonl` is the complete, unedited output of acceptance-gate
addition #2 (see `docs/mvp-acceptance-criteria.md` §9.2): one JSON line per
sample/action over the full 1800-second run, recording `usedJSHeapSize`,
`overlayHosts`, `canvasCount`, and runtime state at each step.

| File | What it shows |
| --- | --- |
| `01-popup-initial.png` | Popup on first load: real video title/channel/duration, badminton-detected badge, Panel Controls / Evidence visibility disclosures, density selector. |
| `02-panels-menu-pose-player.png` | Live overlay: Panels access-point menu open, real-time pose skeleton and player bounding boxes on both players. |
| `03-stats-panel-honest-empty.png` | Stats panel on an unset-up match: honest `unknown` rally/shots/length, "no CV evidence and no saved labels" - no fabricated state. |
| `04-court-calibrated.png` | Court map after a real 4-corner lock: `CALIBRATED`, mini-court with a plotted position, "Recalibrate court" now offered. |
| `05-manual-label-panel.png` | Manual labeling panel: Start/End timestamps, all shot-family buttons, Export/Import CSV, Save label. |
| `06-manual-label-saved-fullscreen.png` | Saved manual label editing (Save correction) in fullscreen player mode; court map and pose overlay both correctly aligned at fullscreen resolution (DPR 2). |
| `07-theater-mode.png` | Theater mode: panels and overlay correctly repositioned to the wider player. |
| `08-settings-panel.png` | Settings panel: version from manifest, local-first-analysis copy, source/licenses link. |
| `09-summary-page.png` | Match summary page (own extension tab): real manual-label statistics vs. clearly separately-labeled fixture/demo context. |
| `10-negative-test-before-fix.png` | Negative test on a real basketball video, **before** the fix: status line incorrectly read "Badminton match found" despite the "sport unconfirmed" badge beside it. |
| `11-negative-test-after-fix.png` | Same page, **after** the fix: status line now reads "YouTube video found" - never claims a badminton match once the sport signal is confirmed negative. |
| `12-racket-ab-efficientdet-frame1.png` | Racket A/B frame 1 (score 13-12): EfficientDet-Lite0 boxes drawn on the real captured frame, 113ms. |
| `13-racket-ab-efficientdet-frame2.png` | Racket A/B frame 2 (score 17-17): EfficientDet-Lite0 boxes on the same-conditions second frame, 112ms. YOLO-World detected nothing on either frame in 847-848ms; see `docs/racket-ab-verdict.md`. |
