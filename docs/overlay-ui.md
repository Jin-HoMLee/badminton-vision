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
all panel toggles, **Set up court**, and **Label it myself** work. Confirm the
overlay panels are visibly treated and separated, icon controls retain their
hit area, and a manual label can be saved/corrected/exported while
`paused`, `muted`, `playbackRate`, and `src` remain unchanged. The exact
procedure and playback boundary are in [`docs/e2e-smoke.md`](e2e-smoke.md);
toolbar-popup clicks remain the one native manual step outside page CDP.
