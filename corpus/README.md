# Phase-1 evaluation corpus: hand-marked broadcast timeline metadata

A small, metadata-only evaluation corpus for camera-grammar rally segmentation.
Each entry is a **public source URL plus media-time intervals and provenance** -
no video, no extracted frames, no screenshots, no browser profiles, no
machine-specific paths. The corpus is offline: nothing here needs network
access or playback to read or validate.

> Rights disclaimer: these records are **not a legally usable clip corpus**.
> `rights.status` is `not-cleared` because this change records no license,
> permission, public-domain, or reuse-rights evidence. A public URL is not a
> rights grant. No media is stored or redistributed.

It comes from the Phase-0 court-view probe (E1/E2 entry gates). That
investigation's report is not copied here; this directory is the durable
substrate, and `SCHEMA.md` is the field-level contract.

## Inventory

Five canonical broadcasts, each with a 300 s window. `courtView` is the marked
wide-court interval list; `rallyActive` is the human-marked live-play window
list; `transitions` is the hand-marked `sceneChanges` count; `verified` is the
per-candidate adjudication count. The inventory is extensible: added broadcasts
must add their manifest and timeline records plus their own manifest checksums;
the fixed Phase-0 fixture remains responsible only for the five canonical
records.

| key | discipline | render | window (s) | court-view | transitions | verified |
|---|---|---|---|---|---|---|
| `bwf-ws-2026` | women's singles | 1920x1080 | 1050-1350 | 11 intervals / 149.3 s | 44 | 48 |
| `bwf-md-2026` | men's doubles | 1920x1080 | 1200-1500 | 10 intervals / 94.9 s | 34 | 43 |
| `bwf-md-2018` | men's doubles (2018 era) | 1280x720 | 1200-1500 | 15 intervals / 103.9 s | 59 | 70 |
| `club-fixed-cam` | club match, one static camera | 1920x1080 | 900-1200 | 1 interval / 301.3 s | 0 | - |
| `negative-basketball` | basketball (negative) | 1920x1080 | 200-500 | 0 | 0 | 42 |

Totals: 649.4 s of marked court view, 137 hand-marked transitions, 203 verified
candidates. Axes covered: singles and doubles, 1080p and 720p, modern and
2018-era production, broadcast multi-camera grammar vs a single amateur fixed
camera, a zero-cut control, and a non-badminton negative.

`negative-basketball` is different in kind and the schema says so:
`sceneChangesComplete: false` and `verifiedCandidatesOnly: true`. Its usable
transition list lives only in `verified/negative-basketball.json` and it must be
excluded from any recall/false-rate gate. `club-fixed-cam` has no verification
file because it raises no candidates (it is the zero-true-cut control).

## Adding a broadcast

1. Add one entry to `corpus/broadcasts.json` with a stable `key`, the public
   `url`/`videoId`, `discipline`, `production`, `quality`, and the 300 s
   `window` (`start` + `seconds`). For a noncanonical addition, also add
   `sourceChecksums.timeline` and, when applicable,
   `sourceChecksums.verified` to that manifest entry.
2. Add `corpus/timelines/<key>.json` following `SCHEMA.md`. `broadcast`, the
   filename, and the `url` must all agree with the manifest entry.
3. Mark from contact sheets rendered from the live player at the
   `markResolutionSeconds` quantum (this corpus uses 2 Hz sheets, 0.5 s).
   Record the exact court-view definition in `courtViewDefinition` and add
   `rallyActive` only from a separate live-play adjudication; a missing optional
   field means "not marked", never "false". Do not infer `shuttleTrackable`
   from either label.
4. If you adjudicated detector candidates, add `corpus/verified/<key>.json`.
   Record verdict reversals in `correction`; never overwrite the original.
5. If a broadcast is only partially marked, set `sceneChangesComplete: false`
   and keep it out of gates.

Prefer extending this corpus over creating a parallel one. Imported datasets
(for example ShuttleSet or BadmintonDB) must keep their own `imported:*`
provenance value rather than being merged into a hand-marked array.

## Validating

```sh
node --test tests/timeline-corpus.test.mjs   # focused corpus validation
npm test                                     # full repository behavior suite
```

The focused test is offline and checks that: every file parses against its
`bv-timeline-corpus/*` schema string; the five canonical broadcasts remain
present while additional declared broadcasts are discovered automatically;
every timeline and verification file references a declared broadcast and URL;
`courtView`, `rallyActive`, and `sceneChanges` are ordered, non-overlapping,
finite intervals inside the measured window (within the marking quantum);
`sceneChangesComplete`/`provenance` semantics hold; verification files retain
their threshold, method, per-candidate verdicts, and the recorded correction;
and no committed file contains an absolute filesystem path.

It also pins the provenance chain for the five canonical broadcasts into the
derived evaluation fixture `test/fixtures/scene-change-evidence.json`, which
embeds the canonical URLs/windows plus the sha256 of each canonical
`timelines/<key>.json` and `verified/<key>.json` as produced by the Phase-0 probe. The
corpus JSON is committed byte-identical, so those recorded checksums stay
verifiable. **If you change a canonical corpus file, regenerate that fixture;
for a noncanonical addition or change, update its manifest `sourceChecksums`** -
otherwise the recorded provenance no longer describes the corpus.

## Honest limits (carried with the data)

- Marking resolution is 0.5 s and ground truth is one unreplicated marker;
  near-identical cuts can be under-marked. `verified/<key>.json` recovers the
  ones a 0.15 histogram could see, and records the one verdict that was
  reversed after a dense re-check.
- One 300 s window per broadcast, chosen for play density rather than sampled
  at random. Per-event recall and per-second-of-court-view rates are the
  comparable numbers; the transition rate is not unbiased across a whole match.
- `rallyActive` is a coarse human-marked live-play window, not an assertion that
  every frame contains a trackable shuttle. `shuttleTrackable` remains absent
  because no shuttle-visibility labels were collected in this pass.
- The three BWF broadcast timelines carry the separate live-play adjudication;
  the fixed-camera control remains intentionally unmarked for rally activity
  rather than treating its uninterrupted framing as continuous play.

## Provenance of the files themselves

The corpus JSON and `SCHEMA.md` were preserved from the Phase-0 probe
(`data/badminton-court-view-probe/artifacts/corpus/`). The JSON is byte-identical
to what that probe produced; `SCHEMA.md` was corrected to describe the data it
claims to describe (see its "Corrections" section). The `markedFrom` and
`method` strings refer to the probe's `probe/` scratch workspace, which is
intentionally not committed because it holds debug imagery - they record how
the marks were made, not repository paths.
