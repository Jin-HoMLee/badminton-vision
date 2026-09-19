# Timeline-corpus schema (v1)

A broadcast manifest, one timeline file per broadcast, and optional candidate
verification files make up the corpus. Nothing but public URLs, media-time
offsets, and hand-marked classes is stored; no video frames or derived imagery
are part of the corpus. The metadata is not a rights grant: the committed
manifest records `rights.status: "not-cleared"`, with no license, permission,
public-domain, or reuse-rights evidence.

The Phase-0 court-view probe produced the inherited court-view, scene-change,
and verification records. `rallyActive` remains optional and is absent from
the unreviewed canonical timelines in this pass. See `README.md` in this
directory for how to add and validate marked intervals.

## `broadcasts.json` - `bv-timeline-corpus/broadcasts.v1`

```jsonc
{
  "schema": "bv-timeline-corpus/broadcasts.v1",
  "note": "Metadata-only corpus; no rights evidence or media is included.",
  "rights": {
    "status": "not-cleared",
    "basis": "public source URLs only; no license, permission, public-domain, or reuse-rights evidence recorded",
    "mediaIncluded": false
  },
  "broadcasts": [{
    "key":        "bwf-ws-2026",           // stable slug, used as the timeline filename
    "url":        "https://www.youtube.com/watch?v=...",
    "videoId":    "99riPBazzfk",
    "title":      "...",
    "channel":    "BWF TV",
    "discipline": "women's singles",       // singles | doubles | club match | <non-badminton> (negative)
    "production": "BWF TV 2026 world feed",
    "quality":    "hd1080",                // quality requested from the player when marking
    "window":     { "start": 1050, "seconds": 300 },   // media seconds
    "why":        "what axis of variation this broadcast covers",
    "sourceChecksums": {                         // required for noncanonical additions
      "timeline": "<sha256>",
      "verified": "<sha256, when present>"
    }
  }]
}
```

`key` is the join key for every other file. `broadcasts.json` is the
single source of truth for the inventory: a timeline or verification file that
names a broadcast not listed here is invalid.

## `timelines/<key>.json` - `bv-timeline-corpus/timeline.v1`

```jsonc
{
  "schema":    "bv-timeline-corpus/timeline.v1",
  "broadcast": "bwf-ws-2026",              // must match a broadcasts.json key and the filename
  "url":       "https://www.youtube.com/watch?v=...",
  "window":    { "start": 1050.5, "end": 1351.7 },   // measured playback span, not the requested one
  "provenance": "hand-marked",             // hand-marked | imported:shuttleset | imported:badmintondb
  "markedFrom": "2 Hz contact sheets rendered from the live player",
  "markResolutionSeconds": 0.5,            // the quantum these marks are trustworthy to
  "renderedResolution": "1920x1080",
  "courtViewDefinition": "<the exact rule the marker applied, in prose>",
  "rallyActiveDefinition": "<separate human live-play adjudication, if marked>",

  // The world feed is showing the wide playing-court view. Complement = non-court.
  "courtView":    [{ "start": 1055.25, "end": 1105.05 }],

  // Human live-play windows, independently adjudicated from court framing;
  // camera inserts inside a continuing rally stay inside the same interval.
  "rallyActive":  [{ "start": 1055.25, "end": 1105.05 }],

  // Hard visual discontinuities (shot changes), as intervals at the marking
  // resolution. `kind` is cut | wipe | dissolve; `from`/`to` are free-text
  // shot labels, not a closed vocabulary.
  "sceneChanges": [{ "start": 1104.8, "end": 1105.3, "kind": "cut",
                     "from": "court", "to": "crowd", "note": "optional" }],

  // REQUIRED. false = partially marked; exclude the broadcast from any gate.
  "sceneChangesComplete": true,

  // OPTIONAL. true when sceneChanges is empty/false by construction and the
  // usable transition list exists only in verified/<key>.json.
  "verifiedCandidatesOnly": false,

  // OPTIONAL, additive, filled by later scouts - unset means "not yet marked",
  // never "false". `shuttleTrackable` is intentionally absent from this pass.

  "notes": "free text, including known under-marking"
}
```

## `verified/<key>.json` - `bv-timeline-corpus/verified-candidates.v1`

The per-candidate adjudication record, kept separate so the hand-marked
timeline stays independent of any detector. Present for every broadcast that
contributes detector candidates; a broadcaster with no candidates (for example
a zero-cut fixed camera) has no verification file.

```jsonc
{
  "schema": "bv-timeline-corpus/verified-candidates.v1",
  "broadcast": "bwf-md-2018",              // must match a broadcasts.json key
  "candidateThreshold": 0.15,              // the score that made a sample a candidate
  "method": "each candidate was seeked to at t-0.6 / t / t+0.6 and judged by eye",
  "verdicts": [{ "i": 59, "t": 1451.93, "hd": 0.23256,
                 "verdict": "real",          // real | false | uncertain
                 "note": "cut wide court -> low-angle action insert" }],
  "correction": "free text when an earlier verdict was later reversed"
}
```

## Rules the schema encodes

1. **Intervals, not per-frame labels.** Frame-level truth is derived by
   interval lookup, so the corpus never has to be re-marked when the sampling
   rate changes.
2. **`provenance` is mandatory.** Imported ShuttleSet/BadmintonDB intervals
   must keep their own value and must not be merged into a hand-marked array.
3. **Absent means unmarked.** A missing `rallyActive` key means "nobody marked
   this yet"; an empty array means "marked, and there is none". This corpus
   does not define `shuttleTrackable`; shuttle visibility must be labeled in a
   later pass rather than inferred from `rallyActive`.
4. **`markResolutionSeconds` governs the evaluation tolerance.** Any matcher
   must use a tolerance at least this large and say so. It is also the bound
   on how far a marked interval edge may sit outside the measured `window`:
   the window holds per-sample media times, while a mark rounds to the
   `markResolutionSeconds` grid.
5. **A frame within `markResolutionSeconds` of an interval edge is a
   transition case** and must be reported separately, never dropped.
6. **Verdict reversals are recorded, not overwritten** in `correction`.
7. **`sceneChangesComplete: false` excludes a broadcast from any gate.** The
   intervals may still be present for context; do not score them.

## Corrections from the Phase-0 schema candidate

The court-view, scene-change, and verification records were inherited from the
Phase-0 probe. This pass does not add `rallyActive` labels because the source
playback was not reviewable; this schema documents the optional field without
claiming unverified ground truth.

1. **`sceneChanges` were documented as points (`{ "t": 1063.5, ... }`) but are
   stored as intervals (`{ "start", "end", ... }`).** The interval form is what
   the data uses, what the probe report's schema candidate specified, and what
   rule 1 requires, so the example now uses `start`/`end` and the `note` field
   that the data actually carries.
2. **`sceneChangesComplete`, `verifiedCandidatesOnly`, the `verified/<key>.json`
   file, and the `correction`/`note` fields were used by the data but absent
   from this document.** They are now documented, and the two rules the probe
   report carried (transition cases reported separately; verdict reversals
   recorded) are restored as rules 5 and 6.

The `markedFrom` and `method` strings name `probe/debug/...` and
`probe/corpus/...` paths from the Phase-0 measurement workspace. That workspace
is deliberately not committed - it contains debug imagery - so those strings
record marking method and provenance, not resolvable repository paths.
