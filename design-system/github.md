repo: Jin-HoMLee/badminton-vision
branch: main

## Last sync

date: 2026-09-04T16:45:00Z

### Updated in this project

- **Font policy reversed upstream, adopted here.** Upstream abandoned the Google Fonts `@import` fix entirely — the ship-fonts-as-`web_accessible_resources` plan from the last sync was dropped in favor of a stricter no-remote-font policy (`docs/overlay-ui.md`: "does not fetch Google Fonts or any other remote resource"). `tokens/fonts.css` here now only declares the family names under `:root,:host` with `system-ui`/`ui-monospace` fallback — no `@import`, matching upstream exactly. This supersedes the "still to fix upstream" item from 2026-08-31.
- **Panel drag gap closed — matched with a richer contract.** Upstream shipped `src/panel-layout.js` plus collapse/expand, resize, and a `bottomReserve` clamp so panels can never cover YouTube's control strip. `Panel.jsx` now has a built-in header collapse chevron (distinct from a caller's close action), a resize grip (drag or arrow-key + Home-to-reset), and `aria-grabbed`/`aria-keyshortcuts` on the drag handle. `LiveOverlay.jsx`'s panel actions were relabeled from ambiguous "Hide" chevrons to explicit "Close" (×) so collapse and close read as distinct, per upstream's explicit requirement.
- **Callout compact-tooltip pattern adopted.** Upstream collapses long popup callout bodies to their first sentence with an ellipsis, opening the full text in a hover/focus tooltip (`data-bso-callout-compact` contract). `Callout.jsx` gained a `tooltip` prop doing the same for multi-sentence string bodies; single-sentence bodies are unaffected.
- **Popup section order matched.** Upstream asserts "Panel Controls" renders above "Evidence visibility" in tests. `Popup.jsx`'s "Panels on the video" section now precedes "What's being tracked" (evidence).
- Generated real PNG derivatives (`assets/icon-{16,32,48,128}.png`) from the existing SVG sources — Chrome's manifest icon surfaces reject SVG (a real bug upstream hit and fixed by checking in PNGs), so the design system now ships the same raster assets upstream committed.
- Confirmed still-adopted: the shuttlecock mark geometry (byte-identical), the `:root,:host` token fix from the previous sync, `ui.callout`/`ui.infoTip`/`ui.legend` primitives.

### Open gaps (unchanged from design side; nothing further to build without more source)

- Upstream's evidence-visibility model is now a single popup disclosure with one consolidated "Court projection" toggle, replacing a prior two-control split. This kit's per-tracker toggles (`court`, `players`, `body`, `shuttle`, `score`, `racket`) are a coarser, PRD-derived model and were not restructured to match 1:1 — flagging for a future pass if upstream's exact toggle taxonomy needs mirroring.
- Upstream added a large ML-pipeline/offscreen-inference subsystem (`src/ml-pipeline/`, `src/extension/offscreen/*`) — implementation detail with no surfaced UI; nothing to design against.

## Screen map

| Screen | Built from |
| --- | --- |
| `ui_kits/extension/popup.html` | `src/popup.html`, `src/popup.js`, `.bv-popup*` in `src/styles.css` |
| `ui_kits/extension/index.html` (seed step) | `src/seed-card.js`, `src/calibration.js`, `.bv-seed-*` |
| `ui_kits/extension/index.html` (live overlay) | `src/content.js`, `src/ui.js`, `src/panel-layout.js`, `.bv-overlay-*`, `.bv-panel-*` |
| `ui_kits/extension/index.html` (labeling panel) | `src/ui.js`, `.bv-label-panel`, `.bv-shot-picker` |
| `ui_kits/extension/summary.html` | `src/summary.html`, `src/summary.js`, `.bv-summary-*` |
| `components/core/Panel.jsx` | `src/panel-layout.js`, `src/ui.js` panel()/collapse/resize contract, `docs/overlay-ui.md` |
| `components/feedback/Callout.jsx` | `src/ui.js` callout() tooltip mode, `docs/overlay-ui.md` §"Popup info callout tooltips" |
| `tokens/fonts.css` | `design-system/tokens/fonts.css`, `docs/overlay-ui.md` font-policy note |
| `components/data/CourtDiagram.jsx` | `src/calibration.js`, README §8 (BWF Laws §4.1, Diagram A) |
| `assets/icon*.svg`, `icon*.png`, `logo-mark.svg` | consumed by `manifest.json` action + icons |

## Sync history

### 2026-08-31T22:56:10Z

- Diagnosed the reported "faint overlay / dead buttons" bug and made every token file shadow-DOM safe (`:root,:host`).
- Adherence audit only — no screens rebuilt that round; upstream `c4e3b854` carried no design changes to absorb.
- Open gaps at the time: `Panel` draggable unimplemented in `src/ui.js`; plain-language copy missing from labeling panel/summary.

### 2026-08-31T16:29:25Z

- Upstream shipped a real MV3 extension (`src/`, `manifest.json`, `docs/`, `analysis/`) — the previous sync saw a README only.
- Rebuilt the court-seed step as a movable card to match `src/seed-card.js`; overlay panels went opaque over video.

### 2026-08-30T18:08:00Z

- Read the full MVP PRD (the repo's only file) and derived the product's five surfaces from it.
- Authored tokens, 17 foundation cards and 21 components from scratch — the repo shipped no code, design file, logo, fonts or icons.
- Built the Chrome-extension UI kit: popup, court seed, live overlay, labeling panel, match summary.
