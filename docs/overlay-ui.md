# Overlay UI packaging notes

## Reproduced failure and fix

The trigger is loading a package whose `styles.css` is linked inside the
content script's `ShadowRoot` while its imported token sheets declare only
`:root`. The masking condition is that all of the overlay's geometry, surface,
border, shadow, font, and control-size declarations consume `var(--...)` values
from those sheets. In a shadow tree, document `:root` does not provide those
custom properties. The visible symptoms are transparent/faint panels, stacks
falling back to the same top-left position, controls with collapsed icon/button
dimensions, and the topmost panel intercepting clicks.

A current stale build reproduced this with computed `left: 0px`, `right: auto`,
transparent panel background, no border, and a 46px-wide collapsed button for
both stacks. Adding the design-system `:host` contract produced the intended
16px offsets, 288px feed width, opaque panel treatment, 1px border, and 30px
control dimensions. The fresh package is produced only by `npm run build`; its
CSS import closure is checked and its manifest has no retired `message_serialization`
key or retired overlay entrypoints.

## Overlay interaction reproduction and boundary

The end-user trigger is the normal toolbar **Enable** action, followed by the
four-corner court setup, or a density/manual-label action that renders the live
panels. The masking condition is either an action arriving while the content
script is still hydrating stored video state, or a narrow/theater/fullscreen
video rectangle where a panel's default placement would cover a target. The
visible symptom in the old path was an apparently missing/covered setup surface,
a visible **Drag to move** grip on the court card, or a drag of a panel that
also activated a button/court target. A stale retired overlay could add another
mask after extension reload.

The current path keeps one guarded content host, waits for hydration, and makes
only each panel's non-interactive header a move surface. Buttons, court-layer
clicks, video playback, and the normalized evidence SVG remain outside that
surface. Court setup, stats, court map, stroke feed, manual labeling, live
controls, and the live Evidence visibility panel use video-local normalized
layout state. Resize handles clamp to the
video viewport and expose arrow/Home keyboard behavior; a rerender reapplies
the saved layout without changing playback. The setup header retains an
accessible label and native tooltip, but no visible drag copy or grip button.
The focused geometry and DOM regressions are in
`tests/panel-layout.test.mjs` and `tests/live-onboarding.test.mjs`.

## Native player controls stay interactive

YouTube draws its bottom control strip (progress bar, play/pause, volume,
settings) over the video's bottom edge. Overlay panels therefore reserve that
strip: every panel constraint carries `bottomReserve`
(`PLAYER_CONTROLS_RESERVE = 72` in `src/content.js`, exposed as
`--overlay-controls-reserve` in `src/styles.css`), `src/panel-layout.js` clamps
any move/resize/saved layout so a panel's bottom edge never enters the strip,
and the CSS defaults for the bottom-anchored map/controls panels sit above it.
The overlay root and the evidence/calibration layers stay `pointer-events:
none`; only interactive panel surfaces re-enable input. The court-setup seed
layer intentionally keeps full-click capture during the four-corner flow:
its near-corner targets sit around y≈82% and can fall inside the strip on
small players, so setup keeps priority until the court is locked. The focused
gates are `tests/panel-layout.test.mjs` (reserve geometry) and
the strip-clear/drag/resize regression in `tests/live-onboarding.test.mjs`.

## Panel collapse and evidence visibility

Every live panel (stats, court map, stroke feed, manual labeling, live
controls, evidence visibility) has a header collapse/expand button
(`data-bso-panel-collapse`, `aria-expanded`); a collapsed panel renders only
its header bar (`bv-panel-collapsed`, no body/footer/resize surface) and keeps
the header as its drag surface. Collapse state is per-panel and per-video
(`collapsedPanelsByVideo`, `TOGGLE_PANEL_COLLAPSE`), mirroring the layout-state
pattern. The Evidence visibility panel is now a panel like the rest: it is
gated by `state.panels.evidence` (default on, preserved across density
presets), hideable from its header, and re-openable from the popup's panel
toggle list. The manual labeling panel rebuilds its body content only when
expanded; nothing is lost by collapsing because the form is rebuilt on expand.

## Court setup lines

The court projection drawn during and after setup uses bright highlight
tokens (`--court-setup-line: var(--lime-400)`, `--court-setup-net:
var(--lime-300)`) instead of the muted diagram tokens. The after-setup
projection is a per-video show/hide preference (`courtLinesByVideo`,
`SET_COURT_LINES`): the Evidence visibility panel carries a **Court setup
lines** toggle (`data-bso-court-lines-toggle`) so the projection is not forced
over the video. During active seeding the lines always render (they are the
setup feedback); only the persistent after-lock projection is toggleable.

The regression gates for all three contracts are in
`tests/panel-layout.test.mjs`, `tests/live-onboarding.test.mjs`,
`tests/overlay-ui.test.mjs`, and `tests/state.test.mjs`.

The latest supplied design system has no redistributable font binaries. The
extension therefore does not fetch Google Fonts or any other remote resource.
`design-system/tokens/fonts.css` is packaged as a local/system policy sheet and
the typography tokens retain their supplied families followed by
`system-ui`/`ui-monospace` fallbacks. This is the deliberate limitation: exact
Space Grotesk and IBM Plex rendering requires those families to already be
installed. If licensed binaries are supplied later, they must be added as
extension resources and registered from document-level CSS; do not restore a
remote import inside the shadow tree.

## Toolbar icon packaging

[Chrome manifest icons use raster image formats, not SVG](https://developer.chrome.com/docs/extensions/develop/ui/configure-icons).
The original
`action.default_icon` and top-level `icons` paths were present in a clean
`dist/`, and all four supplied logo SVGs were well-formed and self-contained,
so the generic puzzle icon was not caused by a missing path, invalid logo, or
stale build output. It was Chrome rejecting an otherwise valid SVG in an
unsupported manifest surface.

The manifest now references checked-in 16, 32, 48, and 128px PNG derivatives
of the design-system SVG sources. `scripts/build.mjs` copies that explicit set,
verifies both manifest surfaces, dimensions, local-only paths, and source SVG
structure, while `tests/build.test.mjs` checks the clean package inventory.
Chrome may continue showing an icon cached from a previously loaded unpacked
extension until that extension is reloaded (or removed and loaded again); that
post-fix profile state is distinct from the package failure and should not be
worked around by changing asset names or replacing the supplied logo.

## Manual browser check still required

Using only the captain-approved dedicated Chrome instance, load/reload this
worktree's fresh `dist/`, open the existing YouTube watch tab, and use the
native toolbar action. Confirm that Minimal, Balanced, and Full density choices,
all panel toggles, the Evidence visibility panel, **Set up court**, and
**Label it myself** work. Confirm the overlay panels are visibly treated and
separated, each panel header moves only
its panel, resize handles stay within the video, setup corner clicks remain setup
clicks, icon controls retain their hit area, and a manual label can be
saved/corrected/exported. Confirm the native player controls (pause, seek,
time bar, settings) stay clickable with the overlay active and that panels
dragged toward the bottom clamp above the control strip; collapse and re-expand
every panel from its header (state survives navigation/reload), hide and
re-open Evidence visibility from the popup, and toggle **Court setup lines** in
the Evidence visibility panel while
`paused`, `muted`, `playbackRate`, and `src` remain unchanged. The exact
procedure and playback boundary are in [`docs/e2e-smoke.md`](e2e-smoke.md);
toolbar-popup clicks remain the one native manual step outside page CDP.
