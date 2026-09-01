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
surface. Court setup, stats, court map, stroke feed, manual labeling, and live
controls use video-local normalized layout state. Resize handles clamp to the
video viewport and expose arrow/Home keyboard behavior; a rerender reapplies
the saved layout without changing playback. The setup header retains an
accessible label and native tooltip, but no visible drag copy or grip button.
The focused geometry and DOM regressions are in
`tests/panel-layout.test.mjs` and `tests/live-onboarding.test.mjs`.

The latest supplied design system has no redistributable font binaries. The
extension therefore does not fetch Google Fonts or any other remote resource.
`design-system/tokens/fonts.css` is packaged as a local/system policy sheet and
the typography tokens retain their supplied families followed by
`system-ui`/`ui-monospace` fallbacks. This is the deliberate limitation: exact
Space Grotesk and IBM Plex rendering requires those families to already be
installed. If licensed binaries are supplied later, they must be added as
extension resources and registered from document-level CSS; do not restore a
remote import inside the shadow tree.

## Manual browser check still required

Using only the captain-approved dedicated Chrome instance, load/reload this
worktree's fresh `dist/`, open the existing YouTube watch tab, and use the
native toolbar action. Confirm that Minimal, Balanced, and Full density choices,
all panel toggles, **Set up court**, and **Label it myself** work. Confirm the
overlay panels are visibly treated and separated, each panel header moves only
its panel, resize handles stay within the video, setup corner clicks remain setup
clicks, icon controls retain their hit area, and a manual label can be
saved/corrected/exported while
`paused`, `muted`, `playbackRate`, and `src` remain unchanged. The exact
procedure and playback boundary are in [`docs/e2e-smoke.md`](e2e-smoke.md);
toolbar-popup clicks remain the one native manual step outside page CDP.
