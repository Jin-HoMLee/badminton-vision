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

The end-user trigger is the normal toolbar **Enable** action, which starts raw
pose/shuttle/racket evidence independently. The four-corner court setup is an
optional follow-up only for the court map, alongside density/manual-label
actions that render the live panels. The masking condition is either an action
arriving while the content script is still hydrating stored video state, or a
narrow/theater/fullscreen video rectangle where a panel's default placement
would cover a target. The
visible symptom in the old path was an apparently missing/covered setup surface,
a visible **Drag to move** grip on the court card, or a drag of a panel that
also activated a button/court target. A stale retired overlay could add another
mask after extension reload.

The current path keeps one guarded content host, waits for hydration, and makes
only each panel's non-interactive header a move surface. Buttons, court-layer
clicks, video playback, and the normalized evidence SVG remain outside that
surface. Minimal mode draws only the pure detection layer (court projection
when enabled, pose keypoints/skeleton, shuttle path/candidate, and supplied
racket evidence) plus one compact **Panels** access point. Stats, court map,
stroke feed, manual labeling, and live controls are on-demand surfaces; the
popup is the canonical place to persist their video-local visibility choices.
Evidence visibility is also popup-owned: its one compact disclosure contains
the layer switches and court-projection switch, so no evidence controls are
mounted as an independently movable overlay. Resize handles clamp to the video
viewport and expose arrow/Home keyboard behavior; a rerender reapplies the
saved layout without changing playback. The setup header retains an accessible
label and native tooltip, but no visible drag copy or grip button. The focused
geometry, default-layer, and DOM regressions are in `tests/panel-layout.test.mjs`
and `tests/live-onboarding.test.mjs`.

## Playback-time interaction freeze diagnosis

The initiating trigger is an enabled live session receiving synchronized runtime
updates while a YouTube video is playing. `requestVideoFrameCallback` advances
the media synchronizer on every decoded frame; before this fix,
`publishRuntimeView` used the 250 ms age cadence (and every new result) to call
`render()`. `render()` called `root.replaceChildren()`, explicitly cleared
`panelGesture`, and recreated each feed/scroll/focus node. A drag therefore lost
its gesture between pointerdown and pointerup, a click could land on a retired
button, and a feed scroll/focus could reset. Pausing is only the masking
condition: no frame callbacks arrive, so the destructive periodic render stops.

Pointer hit testing was not the initiating fault. In the headed dedicated Chrome
check, the disabled playing and paused paths both reported the overlay anchor as
`pointer-events: none`; a center hit test reached YouTube's `VIDEO`. The
existing high z-index is therefore intentional and does not block the video.
Disabling inference alone is not a sufficient counterfactual: synchronized
clock ticks still reached the 250 ms age-render branch even with no result.
Separately, the old document-wide `MutationObserver` treated unrelated
YouTube child-list/class/style churn as a geometry change and repeatedly read
and wrote panel layout while playback was active. That was additional main
thread/render work, not stale pointer capture or a frame-transport playback
mutation; capture remains one-in-flight and the video invariants are
read-only.

The fix keeps runtime updates non-destructive. `src/content.js` patches runtime
attributes, timestamps, the evidence SVG, and reconciled
feed rows in place; it preserves panel headers, controls, scroll surfaces, and
pointer capture. Structural changes explicitly release capture before retiring
a surface, so no stale gesture can block the next interaction. Runtime-owned
stats and court-map bodies are selectively refreshed on result changes while
their panel chrome remains attached. Geometry observation ignores overlay churn
and unrelated page mutations, schedules relevant video-container geometry work
once per frame, and still reacts to direct video insertion, replacement, and
geometry changes. Inference, frame transport, playback, panel layout, and
calibration are unchanged. The intentional load-shedding is measured by those
regressions: a playing runtime result causes zero structural root renders,
preserves the same header and feed/scroll nodes through a drag, and an
unrelated DOM mutation causes zero video geometry reads while a video ancestor
mutation causes one. The playing-path regressions are covered by the runtime
seeding, panel-presentation, feed-reconciliation, pointer-capture, direct-video,
and geometry tests in `tests/live-onboarding.test.mjs`; the headed procedure
and playback invariants remain in [`docs/e2e-smoke.md`](e2e-smoke.md).

Runtime views stay structural only when they actually change structure. A
`cameraCut: true` result re-enters the court-setup flow once (`CAMERA_CUT` flips
`seeding`, which would otherwise look like a user-driven setup and suppress the
swap); later playing results leave that reseed layer intact, so corner input
resumes immediately. While that camera-cut reseed is active, the overlay mounts
only the reseed flow and withholds the raw evidence layer — the pre-cut
drawing would be stale over the new camera angle — until the reseed resolves,
unlike user-initiated setup, which keeps raw evidence mounted. If the
manual-labeling form is open when the cut arrives, that swap is deferred so
the in-flight form is never replaced; closing the form renders the reseed
flow, so the reseed is only delayed, never dropped.

## Native player controls stay interactive

YouTube draws its bottom control strip (progress bar, play/pause, volume,
settings) over the video's bottom edge. The overlay enforces the strip two
ways:

- **Layers pass through by default.** The anchor, the overlay root, and every
direct child of the root are `pointer-events: none` unless they are an actual
interactive surface. Only the on-demand panel surfaces, the compact access
point/menu, and the court-setup seed layer opt back in; the evidence SVG, the
calibration projection, and any future full-size layer can never eat a click.
Panel chrome follows the same rule: `pointer-events: none` on the panel with
`auto` on the header, footer, resize handle, and every real control (buttons,
rows, the scrollable feed list). Empty panel body space passes through, so a
panel can never intercept the player — including popups that open above it such
as YouTube's settings menu.
- **Geometry reserves the strip.** Every panel constraint carries
`bottomReserve` (`PLAYER_CONTROLS_RESERVE = 72` in `src/content.js`, exposed
as `--overlay-controls-reserve` in `src/styles.css`), `src/panel-layout.js`
clamps move/resize/saved layouts **and the panel height itself** so a panel
measured taller than the free area is capped above the strip (see the
height-cap regression in `tests/panel-layout.test.mjs`), and the CSS defaults
for the bottom-anchored map/controls panels sit above it. The shadow
stylesheet loads asynchronously; `src/content.js` re-applies the layout when
it finishes loading so a first render measured before CSS applies can never
keep stale full-size panel rects over the video.

The court-setup seed layer used to capture the whole video during the
four-corner flow. It now ends at the reserve: `clip-path: inset(0 0
var(--overlay-controls-reserve) 0)` keeps the strip clickable mid-setup
(scrim included), and on small players the near-corner guide markers are
clamped above the strip (`seedFlow` in `src/content.js`) so the guide itself
stays clickable. The focused gates are `tests/panel-layout.test.mjs`
(reserve geometry and the height cap) and `tests/live-onboarding.test.mjs`
(strip control points, seed guide clamp, layer pass-through, and the
drag/resize/collapse regression).

## Panel collapse, close, and evidence visibility

Every on-demand live panel (stats, court map, stroke feed, manual labeling,
live controls) has a header collapse/expand button
(`data-bso-panel-collapse`, `aria-expanded`, chevron icon); a collapsed panel
renders only its header bar (`bv-panel-collapsed`, no body/footer/resize
surface) and keeps the header as its drag surface. Collapse state is
per-panel and per-video (`collapsedPanelsByVideo`, `TOGGLE_PANEL_COLLAPSE`),
mirroring the layout-state pattern. Minimal mode does not mount these panels
until the **Panels** access point or popup opens one.

Evidence visibility is a single popup disclosure inside the main control
panel. Its **Evidence visibility** trigger exposes `aria-expanded` and
`aria-controls`; the compact default is collapsed, and expanding it reveals
the existing pose, player-box, racket, shuttle, and **Court projection**
switches. Opening moves focus to the first available switch; closing returns
focus to the trigger. The switches still dispatch the same `SET_TRACKER` and
`SET_COURT_LINES` actions and retain their video-local preferences. Legacy
standalone evidence-panel messages are ignored and cannot mount an overlay.
Panel and detection-layer visibility choices are stored per video. The manual
labeling panel rebuilds its body content only when expanded; nothing is lost by
collapsing because the form is rebuilt on expand.

The popup's section order is containers-before-content: **Panel Controls**
renders above **Evidence visibility**, with **How much to show** and the pose
model selector below (order is asserted in
`tests/live-onboarding.test.mjs`). Panel Controls' helper copy names its role
next to the overlay quick surface: the popup sets which panels appear over the
video (saved per video) while the video's **Panels** button offers the same
panels as quick shortcuts during playback.

The popup status chip never passes fixture-era defaults off as live state:
nothing in the live path writes `state.rally` (rally segmentation reports
unavailable), so a production session reads **Live analysis** with the
accelerator spelled out as a capability (WebGPU acceleration / WebGL
(fallback) / WASM (software)); a runtime-reported rally id renders as
**Rally #N**, and the fixture-probe analyzer reads as **Fixture analysis**
(`fixture probe · not production CV`) — no demo or fixture context renders
a static count. The chip's timestamp detail is the media clock only once
the content script has written `state.time`; the unwritten `12:04.320`
default never appears while a session is starting or in fallback.

## Court projection

The court map distinguishes its video-local configuration state. Before any
fit, it shows **NOT SET UP**, explains that mapped coordinates are unavailable,
and offers **Set up court**. After a committed fit it shows **CALIBRATED** and
offers **Recalibrate court**. During a new draft it shows **RECALIBRATING** and
withholds the previous mapped output until the replacement is locked; cancelling
restores the prior fit. Clearing returns to setup without stopping raw
evidence; camera-cut invalidation is the withholding reseed flow described
above.

Court line rendering uses the bright highlight tokens
(`--court-setup-line: var(--lime-400)`, `--court-setup-net: var(--lime-300)`)
instead of the muted diagram tokens — both for the live setup draft on the
seed surface and for the calibrated projection rendered after lock.
There is exactly **one** toggle for it — **Court projection** in the popup's
Evidence visibility disclosure (`data-bso-court-projection-toggle`), backed by
the per-video `courtLinesByVideo` store (`SET_COURT_LINES`). The retired second
control ("Court setup lines") was the same rendering with a second switch and
has been consolidated into this single labeled toggle.

## Stroke feed

The feed list (`.bv-feed`) renders **every** stroke — runtime evidence and
manual labels alike — inside a bounded, scrollable body (`max-height: 212px;
overflow-y: auto`); the saved-label list in the manual panel uses the same
scrollable feed contract at 160px. No row is ever clipped silently.

## Popup video identity and local detection

The popup's detected-video block shows the **real** current tab: the content
script publishes page-visible metadata (`bvVideoInfo`: tab title minus the
`- YouTube` suffix, media duration, channel/description/category metadata)
and the popup renders title, channel, and duration for a detected watch page,
failing open to the tab title while metadata is still being read. The local
`BSOVideoDiscovery.detectBadmintonVideo` heuristic uses those page metadata
fields only; a positive signal is labeled `badminton detected`, while a page
without a signal remains `sport unconfirmed` rather than being silently
misclassified. The demo fixture appears only outside a watch page, clearly
labeled `fixture preview`. Desktop and mobile YouTube watch URLs are covered by
the MV3 match patterns.

The live root also owns one `.bv-overlay-canvas` sized from the rendered video
content rectangle and capped to device-pixel-ratio 2. It is an evidence drawing
surface with `pointer-events: none`; the accessible SVG evidence layer remains
alongside it. `positionToVideo` resizes both surfaces through the same
`ResizeObserver`/layout path, so neither surface changes playback or drifts
through theater/fullscreen transitions.

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

## Popup info callout tooltips

The popup callout boxes carrying long explanatory copy (`ui.callout` with
`tooltip: true` - the intro status callouts for runtime/inference, court,
camera cut, action errors, and the pose-model switch failure box) no longer
carry long persistent body text: the standing copy collapses to the
body's first sentence and the full body opens in a tooltip on hover or
keyboard focus. The summary line is the keyboard-focusable trigger
(`tabindex="0"`) and its `aria-describedby` points at the sibling
`role="tooltip"` node that always holds the whole body, so no information is
lost for keyboard or screen-reader users. Ellipsis clamping on the summary
line (`overflow: hidden; text-overflow: ellipsis`) guarantees the callout
never overflows its layout on the 360px popup width. The stylesheet shows the
tooltip on `.bv-callout-copy:hover` / `:focus-within`; the contract markers
are `data-bso-callout-compact`, `.bv-callout-body`, and `.bv-callout-tooltip`
in `src/styles.css` and `src/ui.js`. Single-sentence bodies and callouts
outside the popup are untouched; regression gates are in
`tests/overlay-ui.test.mjs`.

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
all panel toggles, the **Evidence visibility** disclosure, **Set up court**, and
**Label it myself** work. Confirm Minimal leaves only detection evidence and one compact **Panels** access
point on the video; open that point to reach stats, feed, map, and manual
labeling. Confirm the popup's on-video controls are canonical and panel/evidence
choices persist independently per video. Expand the Evidence visibility
disclosure and confirm its accessible expanded state, retained pose, player-box,
racket, shuttle, and **Court projection** switches, and keyboard focus
transition. Confirm no evidence panel or evidence shortcut is mounted in the
video overlay. Confirm the
overlay panels are visibly treated and separated, each panel header moves only
its panel, resize handles stay within the video, setup corner clicks remain setup
clicks, icon controls retain their hit area, and a manual label can be
saved/corrected/exported. Confirm the native player controls (pause, seek,
time bar, settings) stay clickable with the overlay active — **including while
the four-corner setup is on screen** — that empty panel areas and the
settings menu pass clicks through, that panels dragged toward the bottom clamp
above the control strip, and that a panel taller than the player still cannot
cover the strip. Collapse (chevron) and close (x) must read as distinct
actions; collapse and re-expand every panel from its header (state survives
navigation/reload), and toggle **Court projection** in the popup disclosure
while the popup's detected block shows the real tab title/channel/duration (the
fixture appears only as a labeled preview outside a watch page) and
`paused`, `muted`, `playbackRate`, and `src` remain unchanged. The exact
procedure and playback boundary are in [`docs/e2e-smoke.md`](e2e-smoke.md);
toolbar-popup clicks remain the one native manual step outside page CDP.
