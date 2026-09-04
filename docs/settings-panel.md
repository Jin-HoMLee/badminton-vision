# Settings panel (Area 4)

## What Phase 1 ships

The minimal settings surface is an on-demand overlay panel
(`data-bso-panel="settings"`, title **Settings**) in the same movable,
resizable, collapsible furniture class as Stats, Stroke feed, Court map, and
Live controls. It opens from three places, all driving the same per-video
`panels.settings` toggle:

- the popup header gear (the former permanently disabled "Settings
  unavailable in local demo" button) — `settingsHeaderButton()` in
  `src/popup.js`, reachable only on a YouTube watch page;
- the popup **Panel Controls** disclosure ("Settings" row), the canonical
  per-video chooser shared with the other panels;
- the overlay access-point menu (`data-bso-overlay-shortcut="settings"`).

The panel renders read-only About content — extension version from
`chrome.runtime.getManifest()` and the `SETTINGS_ABOUT_LINKS` link registry in
`src/content.js` — plus a local-first note. It is independent furniture like
manual labeling: it mounts even while inference is off (render() does not
early-return when only the settings panel is visible) and never starts or
stops the runtime. Like every other stale layer it withholds during a
camera-cut reseed (`!(state.seeding && state.cameraCut)` in `render()`).

## State registration (mirrors the existing panels)

- `state.panels.settings` visibility boolean, per-video persistence through
  `panelsByVideo` / `panelOverridesByVideo`; density presets never own it
  (`panelsForDensity` excludes it), so an open settings panel survives
  density changes and an explicit toggle survives as an override.
- `settings` is registered in `PANEL_VISIBILITY_KEYS`, `PANEL_LAYOUT_KEYS`,
  and `PANEL_COLLAPSE_KEYS` in `src/state.js`; defaults start closed
  (`panels.settings: false`).
- Move/resize/collapse geometry is the standard normalized per-video contract:
  `PANEL_LAYOUT_CONSTRAINTS.settings` in `src/content.js`, the CSS default
  slot `.bv-overlay-root > [data-bso-panel="settings"]` in `src/styles.css`,
  and the `ui.panel` chrome (chevron collapse, x close, header drag, resize
  handle).
- First-open stacking: a settings panel with **no saved layout** for the video
  first-opens at its CSS default slot (right edge, `top: 58px`) and, when an
  already-open panel occupies that spot, stacks below it at mount time
  (`settingsFirstOpenPlacement()` in `src/content.js`). The offset is clamped
  to the overlay bounds, is deterministic per render, and is never persisted
  (no `SET_PANEL_LAYOUT` write), so a saved drag always wins and a later open
  with the slot free returns to the CSS default.
- Panel-body hit testing stays conservative: the panel background passes
  pointer events through; only the header/footer/resize surface and the About
  links (`a` elements, already covered by the `.bv-panel-body a` rule) opt in.

## Phase 2 extension point (display/inference settings)

Phase 2 must not rework any panel registration. The seams are:

1. **Values:** add keys to `defaults.settings` in `src/state.js`. Settings are
   one serializable, global object mirroring the toggle-backed
   `trackerSettings` pattern; video-local concerns stay in the panels /
   collapse / layout maps. Add reducer actions through
   `BVState.reduceExtensionState` as needed (e.g. a `SET_SETTINGS` branch
   validating the new keys).
2. **Rendering:** append sections to `settingsPanel()` in `src/content.js`
   below the About block, reusing `BVUI.toggle` / `BVUI.segmented` from
   `src/ui.js` and dispatching through `reduceExtensionState` + `persist()` +
   `render()` exactly like `togglePanelCollapsed` does. The body is a plain
   flex column, so section order is the extension point.
3. **Links:** extend `SETTINGS_ABOUT_LINKS` in `src/content.js` (label, href,
   optional description). Links open in a new tab on user click only; the
   extension never fetches them.
4. **Popup:** the gear, Panel Controls row, and overlay shortcut already open
   the panel; Phase 2 only adds controls inside the panel body.

Coverage: state-level gates in `tests/state.test.mjs`, content/popup wiring in
`tests/live-onboarding.test.mjs`, geometry fixture in
`tests/panel-layout.test.mjs`.
