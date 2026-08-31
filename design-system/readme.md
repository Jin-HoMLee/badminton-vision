# Badminton Vision — Design System

A design system for **Badminton Vision** (working title; the source repo calls the product *Badminton Stats Overlay / BSO*): a Chrome MV3 extension that turns any badminton match on YouTube into an analysable, labellable match — locally, without touching playback.

## Source material

- **GitHub:** <https://github.com/Jin-HoMLee/badminton-vision> — branch `main`. At the time of writing the repository contains **one file**, `README.md`, a concept/UX PRD ("Badminton Stats Overlay — MVP PRD"). There is **no source code, no design file, no logo, no fonts, no icons, no screenshots**. Read it for the full product contract; everything visual in this system was authored here and is a proposal, not a recreation.
- Referenced but not present in the repo (worth chasing before the next design pass): `.lavish/board.html` (the reviewed wireframe prototype), `data/badminton-statistics-research/report.md`, `data/badminton-reuse-audit/report.md`, `data/badminton-statistics-technical-research/report.md`, and the prior **shuttle-insights** extension, which owns the manual labeling panel, shortcut set and CSV schema this system inherits.
- External spec used verbatim: **BWF Laws of Badminton §4.1, Diagram A** — the court component is drawn from those real dimensions.

## What the product is

One product, one surface family: a browser extension layered over a video page.

| Surface | What it does |
| --- | --- |
| **Popup / control center** | Detection state, court state, backend honesty, density preset, panel toggles, all actions. 360px. |
| **Court seed** | The only modal step. Four numbered clicks on the outer doubles corners; every other line is generated from canonical geometry via a homography. |
| **Live overlay** | Non-blocking sibling panels over the player: status chip, stroke feed, stats, court minimap. Minimal density on first run. |
| **Manual labeling** | Keyboard-first hybrid panel: `S`/`E` marks, 11 shot families, `1–9` quick keys, `O` open, `Esc` close, `Enter` accept. |
| **Match summary & export** | Duration, rally/shot counts, shot mix, winner/error attribution, ranked top rallies, CSV download. |

Three product rules shape every design decision here:

1. **Never touch playback.** No pause, seek, mute, resize or player restyle — ever. Timestamps are review affordances, not seek buttons.
2. **Automatic analysis is a suggestion, never a fact.** Every machine output is accept/correctable and carries a confidence.
3. **Unknown stays visibly unknown.** `unclassified`, `unknown`, `partial` and `stale` are designed states with their own colour, not error paths to hide.

---

## Content fundamentals

**Voice: an honest instrument.** The product speaks like a well-built measuring device — plain, exact, and never overclaiming. It is a review tool for enthusiasts, not a coach and not an umpire.

- **Person.** Mostly impersonal, describing what the system did: "Analysis behind", "Court not seeded", "Score OCR unavailable". Second person only when asking for an action: "Click the four outer corners". Never first person, never "we".
- **Casing.** Sentence case everywhere. The single exception is the 10px micro-label (`STROKE FEED`, `AVG RALLY`) and status badges (`IN`, `OUT`, `UNCLASSIFIED`), which are uppercase with 0.09em tracking.
- **Length.** Labels are 1–3 words. Helper lines are one sentence and explain a consequence, not a feature: "Presentation only — density never changes what is analysed."
- **Numbers are typed, not narrated.** `12:04.320`, `+1.2s`, `0.11 m inside`, `index 87`, `42 rallies`. Always mono, always with unit or sample size.
- **Hedging is mandatory where the data hedges.** "Analysis behind", "score OCR partial", "review suggestion, not an official line call". Never "detected 87% smash" without the confidence UI attached.
- **Vocabulary is fixed** and matches the CSV schema exactly: rally, stroke, shot family, seed, homography, suggestion, correction, provenance, winner / forced error / unforced error / unclassified, highlights index. Never "AI", "smart", "powered by", "insights".
- **Errors name the cause and the fix.** "Camera cut — re-seed the court" beats "Something went wrong."
- **No emoji, ever.** No exclamation marks. No celebratory copy ("Nice rally!"). The tone is respectful of the viewer's attention: they are watching a match.

Sample microcopy:

> Rally 14 · 17 shots · 12:04.320
> Suggested **Smash** · 61% · Accept ↵ / Correct O
> Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court.
> Attribution needs a known final landing and player identity. Where either is missing the rally stays unclassified rather than being guessed.

---

## Visual foundations

**The premise:** every pixel sits on top of moving video the user came to watch. The system is therefore dark, dense, quiet and instrument-like — closer to a broadcast tool than to a consumer app.

**Colour.** A cool blue-black ink ramp (`--ink-900` `#0a0e11` → `--ink-400`) for surfaces; a slate ramp for text. Exactly **one** brand accent, *shuttle lime* `--lime-500 #c8f04a` — the feather-tip highlight — used for the single primary action, the highlights index, and suggestion affordances. Semantics carry meaning that lime never does: green `#3fd48b` IN/winner, coral `#ff6b5a` OUT/error, amber `#ffb020` stale/suggested/partial, blue `#62b6ff` corrected, slate `#7a8b96` unknown. Players are blue `#62b6ff` / orange `#ff9d5c` — never the accent, so identity never reads as emphasis. Backgrounds are flat; **no decorative gradients** anywhere except the two functional scrims.

**Type.** Space Grotesk for display and headings (bold, `-0.02em`), IBM Plex Sans for UI and prose (13–14px), IBM Plex Mono for **every number** — media times, confidences, indexes, CSV field names. The mono/sans split is the system's most recognisable signal: if it is measured, it is monospaced.

**Spacing & layout.** A tight 2/4/6/8/12/16/20/24/32/40/56 scale. Panels pad 12px, feed rows 6–8px. Two fixed widths anchor the product: the 360px popup and the 288px overlay panel. Overlay panels are positioned from the video element's client rect at a 16px gutter, top-left (status/stats), top-right (feed), bottom-left (minimap) — and are independently movable and collapsible.

**Backgrounds & imagery.** No photography, no illustration, no pattern, no texture in the chrome — the video *is* the image. The only image-like surfaces are the court minimap (flat teal court fill with grey lines) and the two protection gradients.

**Transparency & blur.** Panels over video are `rgba(16,22,26,.92)` with `backdrop-filter: blur(14px) saturate(1.15)`. Blur is used only where video is behind; inside the popup, surfaces are solid ink. Text that sits directly on video always gets `--scrim-bottom` (88% → 0% ink over the lower 45%) — never a capsule/pill background, which would fight the player's own controls.

**Elevation.** Dark spread plus a 1px inset white top highlight (`0 8px 28px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)`). Four steps: chip, panel, raised, modal. **No grey drop shadows** — they turn milky over bright court footage.

**Borders & corners.** 1px hairlines at 8% / 13% / 22% white. Radii 3 / 5 / 8 / 12 / 16 / pill: small radii on controls (5px), 12px on panels, pills only for status chips and filter chips. Cards = panel surface + hairline border + 12px radius + panel shadow; never a coloured left border.

**States.** Hover lightens by a 5% white overlay (never a colour change); press adds `translateY(1px)` and the darker `--accent-press`; disabled is 42% opacity and **stays visible** — the PRD requires late-phase features to be shown as disabled rather than hidden. Focus is a 2px lime ring offset by a 2px ink ring. Selected = tinted background + matching text colour, never a solid fill (solid lime is reserved for the one primary button).

**Motion.** 80–260ms, `cubic-bezier(.2,0,0,1)`, opacity plus a 2px translate — nothing else. No bounce, no scale-in, no shimmer, no pulsing except the single 1px ring on the live status dot. Motion must never pull the eye off the rally; `prefers-reduced-motion` zeroes every duration.

---

## Iconography

- **Library: [Lucide](https://lucide.dev) 0.446.0 via CDN**, loaded as `<script src="https://unpkg.com/lucide@0.446.0/dist/umd/lucide.js">` and wrapped by the `Icon` component. **This is a substitution** — the source repo ships no icons at all. Lucide was chosen for its 24×24 outline grid and even stroke, which stays legible over video.
- **Stroke weight is 1.75, not Lucide's default 2** — lighter glyphs sit more quietly on top of footage.
- **Sizes:** 12–13px inside dense overlay rows, 14–16px in popup and panel chrome, 20px in empty states. Icons always inherit `currentColor`; never colour a glyph directly.
- **Working set:** `play`, `pause`, `crosshair`, `list`, `activity`, `pencil-line`, `chevron-up/down/right`, `x`, `settings`, `download`, `table`, `external-link`, `grip-horizontal`, `info`, `clock`, `sliders-horizontal`, `layout-dashboard`, `mouse-pointer-click`, `arrow-left`, `filter`, `lock`, `maximize`, `volume-2`.
- **No emoji, no unicode glyphs as icons.** The only non-Lucide marks are the keyboard glyph `↵` inside `KeyHint` and the `*` partial-data footnote marker.
- **Icons never carry meaning alone** in a status context — a state always has a colour and a word as well.

## Logo

The source repository contains no mark, so one was **designed here** at the user's request: four corner brackets — the product's four court-seed clicks, read as a viewfinder reticle — framing a shuttlecock. Reticle = seeing, shuttle = subject. Lime on ink, no gradients, no type inside the mark.

| Asset | Use |
| --- | --- |
| `assets/logo-mark.svg` | Transparent mark for lockups, docs, the popup header |
| `assets/icon.svg` | Full extension tile (14px-radius ink square) at 128 / 48 |
| `assets/icon-16.svg` | Simplified tile — solid shuttle, heavier brackets — for 32 / 16 |

Lockup: mark at cap-height × 1.35, 14px gap, name in Space Grotesk Bold `-0.03em` in `--lime-500`. The in-product toolbar badge stays the two letters **BV** in a pill where a 16px mark would be too dense.

---

## Index

| Path | What's there |
| --- | --- |
| `styles.css` | The one file consumers link — `@import`s only |
| `tokens/` | `fonts.css` · `colors.css` · `typography.css` · `spacing.css` · `elevation.css` · `motion.css` · `base.css` |
| `assets/` | `logo-mark.svg` · `icon.svg` · `icon-16.svg` |
| `guidelines/` | 17 specimen cards: colour ramps, type, spacing, radii, elevation, scrims, motion, wordmark |
| `components/` | Reusable primitives, grouped below |
| `ui_kits/extension/` | The Chrome-extension UI kit: full click-through plus popup and summary screens |
| `SKILL.md` | Agent-skill entry point |
| `github.md` | Source-repo association for upstream sync |

### Components

**`components/core/`** — `Button`, `IconButton`, `Badge`, `Chip`, `KeyHint`, `Panel`, `Icon`
**`components/controls/`** — `Toggle`, `SegmentedControl`, `ShotPicker`, `DimensionAxis`
**`components/feedback/`** — `StatusChip`, `ConfidenceMeter`, `EmptyState`, `StepDots`, `InfoTip`, `Callout`
**`components/data/`** — `CourtDiagram`, `StrokeFeedItem`, `SuggestionRow`, `StatTile`, `RallyRow`, `MixBar`, `Legend`

Each directory holds `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md` and one `@dsCard` HTML sheet.

**Intentional additions.** The source defines no component library, so the inventory was derived from the PRD's screens. Beyond a standard set (Button, IconButton, Badge, Chip, Toggle, SegmentedControl, Panel, EmptyState), these domain primitives exist because the product cannot be built without them: `Icon` (wrapper for the substituted Lucide set), `KeyHint` (labeling is keyboard-first), `ConfidenceMeter` (every machine output is hedged), `StatusChip` (the entire Minimal-density UI), `StepDots` (the four seed clicks), `CourtDiagram` (canonical BWF geometry), `StrokeFeedItem` / `SuggestionRow` (§6 feed semantics), `ShotPicker` / `DimensionAxis` (the 11-class taxonomy and CSV axes), `StatTile` / `MixBar` / `RallyRow` (§4.5 summary). Three more exist to make the product self-explaining: `InfoTip` (plain-English definition of any term the product invented), `Callout` ("what you're looking at / what to do next" on every surface), and `Legend` (every coloured mark must say what it means).

### Open questions for the next pass

1. The logo was designed in this system, not supplied — it is a proposal, and the palette and type pairing are too.
2. The `.lavish/board.html` wireframe is referenced by the PRD but absent from the repo; it is the one artefact that would most change these designs.
3. The PRD's Minimal first-run default is honoured, but this kit proposes auto-promoting to Balanced immediately **after a successful court seed** — the user has just declared intent, and an empty screen after a setup step reads as failure.
