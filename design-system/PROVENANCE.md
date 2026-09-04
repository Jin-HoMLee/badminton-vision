# Design-system provenance

Copied from the portable archive `Badminton Vision Design System.zip` for the public Badminton Vision extension implementation.

## Refresh record

- **2026-09-04 refresh**: replaced the whole tree with a refreshed Claude Design export, provided by the captain as `~/Downloads/Badminton Vision Design System.zip` (129 files, dated 2026-09-04). `github.md` carries the design-side changelog (`2026-09-04T16:45:00Z`) with the full sync history; this record summarizes what changed versus the prior system:
  - `tokens/fonts.css`: comment updated to state the upstream-aligned no-remote-font policy (it now names `@import`/`@font-face` in prose). The declared rule content is unchanged: `:root,:host` family-name declarations with `system-ui`/`ui-monospace` fallback, no `@import`, no `@font-face`, no remote URL. All other token sheets are byte-identical.
  - `_ds_manifest.json`: same 140 tokens with identical names/values (now listed fonts-first), same components/cards/starting points; `brandFonts` status changed `ok` → `no-face` for all three families (the export now reflects that no font binaries ship).
  - `components/core/Panel.jsx` (+ `.d.ts`): built-in header collapse chevron (distinct from a caller close action), bottom-right resize grip (drag or arrow keys, Home resets), draggable header handle with `aria-grabbed`/`aria-keyshortcuts`, transform-based movement; mirrors the repo's `src/panel-layout.js` collapse/resize/drag contract.
  - `components/feedback/Callout.jsx` (+ `.d.ts`): new `tooltip` prop collapses multi-sentence string bodies to their first sentence with the full body in a hover/focus `role="tooltip"` (`aria-describedby`), mirroring the popup's `data-bso-callout-compact` pattern.
  - `ui_kits/extension/*.jsx`: refreshed click-throughs — popup "Panels on the video" section ordered above "What's being tracked" (Panel Controls above Evidence visibility), live-overlay panel actions relabeled "Close" (×), collapse chevron kept distinct.
  - `assets/icon-{16,32,48,128}.png`: regenerated exact-size raster derivatives (same SVG sources; the SVG files are unchanged).
  - `readme.md`: adds "Self-explaining by default" and "Consuming these tokens inside a shadow DOM" sections.
  - New package files kept per package: `_ds_bundle.js`, `thumbnail.html`, `.thumbnail` (WebP preview). No repo file was dropped.
  - Test fallout of the refresh: `tests/build.test.mjs` and `tests/overlay-ui.test.mjs` asserted the *raw* `fonts.css` text contained no `@import`/`@font-face` substrings, which the new policy comment legitimately contains; both now strip comments before asserting the stylesheet declares no font-loading mechanism or remote URL.

## Original provenance (pre-refresh)

The source system is an authored proposal aligned with the public repository README, not a third-party library. `readme.md`, `tokens/`, `components/`, `assets/`, `guidelines/`, and `ui_kits/extension/` are retained so the UI can be maintained against its source material. `_ds_manifest.json`, `_adherence.oxlintrc.json`, and `github.md` are retained as provenance and maintenance metadata.

The complete `design-system/` tree is repository source and preview material; it is not the production package. `scripts/build.mjs` explicitly copies only the local token CSS files, authored SVG logo sources used by the runtime, and exact-size PNG manifest-icon derivatives rendered from those sources. Preview HTML/cards, JSX source, documentation, generated manifests, `_ds_bundle.js`, and component source are consequently excluded from `dist/`. The supplied system contains no redistributable font binaries: `tokens/fonts.css` is a local/system fallback contract and intentionally has no Google Fonts import, `@font-face`, or remote URL. The extension does not depend on remote scripts, fonts, model binaries, or private endpoints. Production DOM components in `src/ui.js` consume the copied token files and supplied assets while keeping the MV3 build dependency-free.
