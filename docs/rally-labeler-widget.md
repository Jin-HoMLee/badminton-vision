# Developer rally-boundary review widget

## Scope and enablement

The rally-boundary editor is a developer-only overlay for adjudicating proposed
rally intervals beside the real YouTube player. It is disabled by default and
does not run inference.

On a YouTube watch page:

1. Open **Settings** from the popup gear or overlay access menu.
2. Expand **Developer tools**.
3. Enable **Rally boundary review**.
4. Import one source review JSON file, or start an empty full-duration review
   for the current video.

Turning the developer toggle off hides the widget without deleting its review.
The toggle is global; review documents, panel geometry, and collapse state are
video-local. Review documents are stored in
`bvState.rallyReviewsByVideo[videoKey]`, using the same
`BVState.videoKeyForUrl` identity as manual labels.

This remains behind the developer setting. It is not automatic rally inference
or a general product rollout.

## Playback and timeline interaction

The widget uses the content script's existing video discovery, replacement, SPA
navigation, rendered-video anchoring, and media-time updates. The blue playhead
tracks the active `HTMLVideoElement.currentTime`. Dragging that playhead (or an
empty stretch of the timeline track) assigns `currentTime` so the YouTube video
follows the help line. This is the only intentional playback write from the
widget: it does not touch `paused`, `muted`, `playbackRate`, `src`, player
geometry, or player styles. Play, pause, rate, theater, and fullscreen remain
YouTube controls.

- **Zoom in/out** expands or contracts the complete review window around the
  center of the visible viewport.
- A single compact toolbar directly above the timeline contains **Zoom out**,
  scale, **Zoom in**, **Scroll left/right**, **Undo/Redo**, and the right-aligned
  **Set start/end from playhead** actions. Every action has a visible button
  treatment, familiar icon, accessible label, tooltip, and disabled state where
  it cannot currently apply. **Add missing rally** is available in that same
  toolbar.
- The timeline's native horizontal scrollbar exposes the expanded range.
- **Undo** and **Redo** reverse saved interval boundary changes, additions,
  removals/restores, and review evidence/state changes. They write the restored
  document immediately; disabled buttons indicate an empty history stack.
- Each active rally is exactly one interval bar. Bars are packed horizontally
  on one lane in time order; a second row opens only when two ranges would
  overlap. The contained left and right edge hit zones edit start and end.
  There are no separate boundary markers.
- Click/tap the bar body to select it and seek the blue playhead and YouTube
  player to that interval's start. Selection never changes review state. The
  bar body is not draggable. Only the start/end edge hit zones stretch or
  shorten the interval; edge drags snap/clip to the blue playhead when they
  pass near it.
- Timeline colors and the editor badges below use the same coding: orange
  dashed = pending review, green = approved, lime = added, purple =
  corrected, red labeled removed = false-positive removal kept at its original
  start/end. The selected bar gets a bright ring only; selection is not a
  correction. The playhead line is centered on the exact media second so it
  coincides with interval edges at the same time.
- **Set start from playhead** / **Set end from playhead** copy the current
  playhead time onto the selected interval (clamped and ordered so start stays
  before end). Newly added missing rallies use the same editor and edge handles.
- With an edge focused, `Left`/`Right` changes it by 0.1 seconds and
  `Shift+Left`/`Shift+Right` changes it by 1 second. The compact Start/End
  fields are the one authoritative editable current range. They accept human
  clocks (`h:mm:ss.sss`, `m:ss.sss`) as well as plain seconds; the stored value
  remains a millisecond-rounded second number. The original proposal is shown
  once as compact provenance only when the current range differs.
- While a comment, reviewed-by, date, or clock field inside the widget is focused,
  widget keybinds and YouTube page shortcuts are suppressed for those keys.
  Focus leaving the field restores both.
- **Reviewed by** is the human recording the decision. It uses a plain-language
  label and remembers the last non-empty value (for example `Jin-Ho Lee`) so it
  does not need retyping on every interval. **Review date** autofills with the
  current UTC timestamp whenever the field is empty on open or save.
- Every edit is clamped to the review window and enforces `start < end`.
  Changing seconds reopens comment/verifier/date evidence.

**Add missing rally** creates a stable `source-id:addition-NNN` interval around
the observed media time and persists it immediately. **Remove false positive**
turns either a proposed or added interval into a durable removal kept at the
same start/end on the timeline (red, labeled removed) and requires the same
non-empty comment/Reviewed by/date evidence as an approval so later analysis
can see why it was removed. If those fields are empty, the panel keeps the
interval and shows an inline error that names the exact empty fields. Removal
evidence stays editable; the bar can be restored.

When the developer widget is enabled on a fresh supported video, the
workspace is created automatically after video metadata is available. It uses
the active video's canonical identity and duration, starts with zero intervals,
and remains incomplete until the reviewer explicitly confirms the empty set or
adds/reviews a rally. JSON import still replaces that video-local document
only after its identity check succeeds.

Imported reviews keep every interval as a visible, selectable timeline
record, including short late-window records: bars have a small visual minimum
and their narrower edge hit zones leave a center body target. The viewport's
bounded pan controls then expose records beyond the first fit-width view without
changing media time or selection.

The timeline navigation buttons are disabled when the review fits the viewport,
and become bounded earlier/later pan controls only after zoom creates real
horizontal pan state. Panning does not change media time or interval selection;
zoom and layout rerenders recompute the boundary state. Set start/end use
separate interval/playhead icons, while the collapsed playback-help affordance
is a compact question-mark button with the accessible name `Show help`.
Review actions reuse the approved, corrected, and removed semantic tokens used
by their resulting timeline bars as subordinate leading-border/icon cues. The
neon priority fill remains reserved for the single primary action; neutral
secondary action surfaces never imply a timeline outcome. Text and icons stay
present as non-color cues.

The panel's user-resize bounds follow the rendered YouTube presentation
container. Fullscreen removes the theater-mode width ceiling and permits a
larger user-sized panel while preserving its current pixel size when valid;
leaving fullscreen clamps it back inside the normal player margins and above
the native control strip. Layout and fullscreen/resize transitions recompute
these bounds without forcing the panel to full width.

Hit testing treats every visible pixel of the rally panel as a hit target: the
Developer playback help callout, black/empty body background, buttons, fields,
and timeline controls. Clicks never reach YouTube while the cursor is over the
panel; within the panel, the foreground control under the cursor still receives
the event first. The panel body scroll position is preserved across selection
changes, button clicks, and other re-renders so the view does not jump back to
the top. Developer playback help is placed after the primary review content
near the bottom of the panel; it can be dismissed and restored with **Show
playback help** in that same lower area. Overlay panels use one restrained
translucent surface token so
video details remain faintly visible behind them without blur; text, fields,
controls, focus states, and boundaries remain opaque/readable, and transparency
never changes pointer hit-testing. Control confirmations are explicit results
for empty-set and inactive/negative-control sources, not additional rally
labels.

## Canonical JSON contract

Exports use UTF-8 JSON with schema `badminton-vision.rally-review`, version 1.
`src/rally-labeler.js` is the canonical normalizer and serializer. Seconds are
finite non-negative JSON numbers rounded to milliseconds.

```json
{
  "schema": "badminton-vision.rally-review",
  "version": 1,
  "source": {
    "id": "bwf-ws-2026",
    "label": "BWF women's singles 2026",
    "videoKey": "youtube:VIDEO_ID",
    "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
    "reviewWindow": { "startSec": 100, "endSec": 220 }
  },
  "intervals": [
    {
      "id": "bwf-ws-2026:rally-001",
      "sourceId": "bwf-ws-2026",
      "original": { "startSec": 110, "endSec": 114.5 },
      "corrected": { "startSec": 110.125, "endSec": 114.75 },
      "action": "correction",
      "comment": "Serve contact and shuttle-down transition checked.",
      "verifier": "reviewer-handle",
      "verifiedAt": "2026-09-20"
    }
  ],
  "controls": [
    {
      "id": "club-fixed-cam:empty",
      "sourceId": "bwf-ws-2026",
      "kind": "empty-set",
      "label": "No rallies in the review window",
      "state": "rejected",
      "comment": "Rallies are visible in this source.",
      "verifier": "reviewer-handle",
      "verifiedAt": "2026-09-20"
    }
  ]
}
```

### Identities and interval fields

- `source.id`, `intervals[].id`, and `controls[].id` are stable identities.
  Import rejects duplicates.
- `source.videoKey` must match the active video's canonical key. A missing key
  is filled from the active video; a conflicting key is rejected rather than
  leaking data across videos.
- Proposed intervals keep immutable `original` seconds. `corrected` carries the
  current accepted/editable seconds. An addition has `original: null`; a
  removal retains its original and last corrected values even though it has no
  active bar.
- Interval `action` is `unresolved`, `approve`, `correction`, `addition`, or
  `removal`.
- Control `kind` is `empty-set` or `inactive`; `state` is `unresolved`,
  `confirmed`, or `rejected`. `rejected` explicitly records that the proposed
  negative control is not true; it is not an unresolved omission.
- `verifiedAt` is `YYYY-MM-DD` or an ISO UTC timestamp.

The importer also accepts the corpus-oriented shorthand below and normalizes it
to the canonical shape. This preserves the manifest's `source`, `start`, and
`end` seconds semantics while generating stable sequential IDs only when an
input omitted one:

```json
{
  "source": "bwf-ws-2026",
  "videoKey": "youtube:VIDEO_ID",
  "reviewWindow": { "start": 100, "end": 220 },
  "rallies": [
    { "id": "bwf-ws-2026:rally-001", "start": 110, "end": 114.5 }
  ]
}
```

Import followed by export always passes through `normalizeDocument`; exporting
that result again is byte-stable under `serialize`. **Export draft JSON** is
available while work remains. **Export verified JSON** is disabled until every
interval and supplied control has an action/state plus non-empty comment,
verifier, and date, and until no confirmed empty/inactive control contradicts
an active interval.

The review store and JSON contain timestamps and text evidence only. The widget
never stores or exports video, audio, image data, decoded frames, or model
output.

## Test gates

```sh
node --test tests/rally-labeler.test.mjs
node --test tests/live-onboarding.test.mjs
npm run check
```

`tests/rally-labeler.test.mjs` covers normalization, zoom/scroll, pointer math,
resize invariants, add/remove, controls, completion, and canonical round-trip.
The content behavior path covers playhead updates, pointer/keyboard/numeric edge
edits, persistence/reload, developer opt-in, completion, and JSON import/export.
The dedicated-browser acceptance procedure is in `docs/e2e-smoke.md` under
**Developer rally-boundary review acceptance**.
