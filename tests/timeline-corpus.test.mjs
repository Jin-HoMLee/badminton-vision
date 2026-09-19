import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Offline validation of the committed Phase-1 evaluation corpus. Nothing here
// reads the network or plays a video: it proves the committed files parse,
// reference declared broadcasts, carry ordered time ranges and the expected
// inventory, and keep their provenance checksums in step with the derived
// scene-change evidence fixture.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const corpusDir = join(projectRoot, "corpus");
const fixturePath = join(projectRoot, "test", "fixtures", "scene-change-evidence.json");

const BROADCASTS_SCHEMA = "bv-timeline-corpus/broadcasts.v1";
const TIMELINE_SCHEMA = "bv-timeline-corpus/timeline.v1";
const VERIFIED_SCHEMA = "bv-timeline-corpus/verified-candidates.v1";
const CANDIDATE_THRESHOLD = 0.15;
const VERDICTS = new Set(["real", "false", "uncertain"]);
const SCENE_CHANGE_KINDS = new Set(["cut", "wipe", "dissolve"]);
const REQUIRED_KEYS = [
  "bwf-ws-2026",
  "bwf-md-2026",
  "bwf-md-2018",
  "club-fixed-cam",
  "negative-basketball"
];
const RALLY_LABEL_KEYS = ["bwf-ws-2026", "bwf-md-2026", "bwf-md-2018"];
// Verification files exist only where the probe adjudicated detector candidates.
const REQUIRED_VERIFIED_KEYS = ["bwf-ws-2026", "bwf-md-2026", "bwf-md-2018", "negative-basketball"];
const CLUB_DIR = "club-fixed-cam";
// The measured playback window starts at or after the requested window and can
// run a few sampling ticks past its nominal end.
const WINDOW_SLOP_SECONDS = 5;
const EPSILON = 1e-9;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function corpusFiles() {
  const timelines = await readdir(join(corpusDir, "timelines"));
  const verified = await readdir(join(corpusDir, "verified"));
  return { timelines: timelines.sort(), verified: verified.sort() };
}

function intervalError(label, interval, window, tolerance) {
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) {
    return `${label} has a non-finite edge`;
  }
  if (interval.start >= interval.end) {
    return `${label} is not ordered (${interval.start} >= ${interval.end})`;
  }
  if (interval.start < window.start - tolerance - EPSILON) {
    return `${label} starts before the window (${interval.start} < ${window.start})`;
  }
  if (interval.end > window.end + tolerance + EPSILON) {
    return `${label} ends after the window (${interval.end} > ${window.end})`;
  }
  return null;
}

function assertOrderedIntervals(label, intervals, window, toleranceSeconds) {
  let previousEnd = -Infinity;
  intervals.forEach((interval, index) => {
    const error = intervalError(`${label}[${index}]`, interval, window, toleranceSeconds);
    assert.equal(error, null, error);
    assert.ok(
      interval.start >= previousEnd - EPSILON,
      `${label}[${index}] overlaps or is out of order (${interval.start} < ${previousEnd})`
    );
    previousEnd = interval.end;
  });
}

test("broadcast manifest keeps the canonical inventory and rights boundary", async () => {
  const manifest = await readJson(join(corpusDir, "broadcasts.json"));
  assert.equal(manifest.schema, BROADCASTS_SCHEMA);
  assert.equal(typeof manifest.note, "string");
  assert.ok(Array.isArray(manifest.broadcasts));
  assert.deepEqual(manifest.rights, {
    status: "not-cleared",
    basis: "public source URLs only; no license, permission, public-domain, or reuse-rights evidence recorded",
    mediaIncluded: false
  });

  const keys = manifest.broadcasts.map((broadcast) => broadcast.key);
  for (const key of REQUIRED_KEYS) assert.ok(keys.includes(key), `${key} is a required canonical broadcast`);
  assert.equal(new Set(keys).size, keys.length, "broadcast keys must be unique");

  for (const broadcast of manifest.broadcasts) {
    assert.match(broadcast.url, /^https:\/\/www\.youtube\.com\/watch\?v=/, `${broadcast.key} url`);
    assert.equal(broadcast.url, `https://www.youtube.com/watch?v=${broadcast.videoId}`, `${broadcast.key} videoId`);
    assert.equal(typeof broadcast.title, "string");
    assert.equal(typeof broadcast.channel, "string");
    assert.equal(typeof broadcast.discipline, "string");
    assert.equal(typeof broadcast.production, "string");
    assert.match(broadcast.quality, /^hd\d+$/);
    assert.ok(Number.isFinite(broadcast.window.start) && broadcast.window.start >= 0);
    assert.ok(Number.isFinite(broadcast.window.seconds) && broadcast.window.seconds > 0);
    assert.equal(typeof broadcast.why, "string");
  }
});

test("every timeline references a declared broadcast with a consistent url, window and resolution", async () => {
  const manifest = await readJson(join(corpusDir, "broadcasts.json"));
  const byKey = new Map(manifest.broadcasts.map((broadcast) => [broadcast.key, broadcast]));
  const files = await corpusFiles();
  assert.deepEqual(
    files.timelines.map((file) => file.replace(/\.json$/, "")).sort(),
    [...byKey.keys()].sort(),
    "each declared broadcast needs one timeline"
  );

  for (const file of files.timelines) {
    const key = file.replace(/\.json$/, "");
    const broadcast = byKey.get(key);
    assert.ok(broadcast, `${file} references an undeclared broadcast`);
    const timeline = await readJson(join(corpusDir, "timelines", file));

    assert.equal(timeline.schema, TIMELINE_SCHEMA, `${file} schema`);
    assert.equal(timeline.broadcast, key, `${file} broadcast key`);
    assert.equal(timeline.url, broadcast.url, `${file} url`);
    assert.match(timeline.provenance, /^(hand-marked|imported:)/, `${file} provenance`);
    assert.equal(typeof timeline.markedFrom, "string");
    assert.equal(typeof timeline.courtViewDefinition, "string");
    assert.ok(Number.isFinite(timeline.markResolutionSeconds) && timeline.markResolutionSeconds > 0, `${file} markResolutionSeconds`);
    assert.match(timeline.renderedResolution, /^\d+x\d+$/, `${file} renderedResolution`);
    assert.equal(
      timeline.renderedResolution,
      broadcast.quality === "hd720" ? "1280x720" : "1920x1080",
      `${file} renderedResolution must match its declared quality`
    );
    assert.equal(typeof timeline.sceneChangesComplete, "boolean", `${file} sceneChangesComplete`);
    if ("rallyActive" in timeline) assert.ok(Array.isArray(timeline.rallyActive), `${file} rallyActive`);
    if (RALLY_LABEL_KEYS.includes(key)) {
      assert.ok(Array.isArray(timeline.rallyActive), `${file} canonical rallyActive labels`);
      assert.equal(typeof timeline.rallyActiveDefinition, "string", `${file} rallyActiveDefinition`);
      assert.equal(Object.hasOwn(timeline, "shuttleTrackable"), false, `${file} must not fabricate shuttleTrackable labels`);
    }

    const { start, end } = timeline.window;
    assert.ok(Number.isFinite(start) && Number.isFinite(end) && start < end, `${file} window must be ordered`);
    const requestedStart = broadcast.window.start;
    const requestedEnd = requestedStart + broadcast.window.seconds;
    assert.ok(
      start >= requestedStart - EPSILON && start <= requestedStart + WINDOW_SLOP_SECONDS,
      `${file} measured window start ${start} must track the requested ${requestedStart}`
    );
    assert.ok(
      end >= requestedEnd - WINDOW_SLOP_SECONDS && end <= requestedEnd + WINDOW_SLOP_SECONDS,
      `${file} measured window end ${end} must track the requested ${requestedEnd}`
    );
    assert.ok(Array.isArray(timeline.courtView), `${file} courtView`);
    assert.ok(Array.isArray(timeline.sceneChanges), `${file} sceneChanges`);
  }
});

test("rally labels remain independent from camera framing", async () => {
  for (const key of RALLY_LABEL_KEYS) {
    const timeline = await readJson(join(corpusDir, "timelines", `${key}.json`));
    assert.notDeepEqual(timeline.rallyActive, timeline.courtView, `${key} rally labels must not copy court framing`);
  }

  const olderDoubles = await readJson(join(corpusDir, "timelines/bwf-md-2018.json"));
  assert.ok(
    olderDoubles.rallyActive.some((interval) => interval.start <= 1451.9 && interval.end >= 1457.1),
    "the known mid-rally camera inserts must remain inside one active-rally interval"
  );
  const fixedCamera = await readJson(join(corpusDir, "timelines/club-fixed-cam.json"));
  assert.equal(Object.hasOwn(fixedCamera, "rallyActive"), false, "the fixed-camera control must not infer live play from framing");
});

test("court-view and scene-change marks are ordered intervals inside the measured window", async () => {
  const files = await corpusFiles();
  for (const file of files.timelines) {
    const timeline = await readJson(join(corpusDir, "timelines", file));
    const tolerance = timeline.markResolutionSeconds;
    assertOrderedIntervals(`${file} courtView`, timeline.courtView, timeline.window, tolerance);
    if (Array.isArray(timeline.rallyActive)) {
      assertOrderedIntervals(`${file} rallyActive`, timeline.rallyActive, timeline.window, tolerance);
    }
    assertOrderedIntervals(`${file} sceneChanges`, timeline.sceneChanges, timeline.window, tolerance);

    for (const [index, change] of timeline.sceneChanges.entries()) {
      assert.ok(SCENE_CHANGE_KINDS.has(change.kind), `${file} sceneChanges[${index}] kind ${change.kind}`);
      assert.equal(typeof change.from, "string", `${file} sceneChanges[${index}] from`);
      assert.equal(typeof change.to, "string", `${file} sceneChanges[${index}] to`);
      if ("note" in change) assert.equal(typeof change.note, "string");
    }
  }
});

test("the canonical broadcasts retain their probe evidence and control semantics", async () => {
  const manifest = await readJson(join(corpusDir, "broadcasts.json"));
  const byKey = new Map(manifest.broadcasts.map((broadcast) => [broadcast.key, broadcast]));
  const fixture = await readJson(fixturePath);
  const fixtureByKey = new Map(fixture.broadcasts.map((broadcast) => [broadcast.id, broadcast]));

  let courtViewSeconds = 0;
  let transitions = 0;
  for (const key of REQUIRED_KEYS) {
    const file = `${key}.json`;
    const timeline = await readJson(join(corpusDir, "timelines", file));
    courtViewSeconds += timeline.courtView.reduce((sum, interval) => sum + interval.end - interval.start, 0);
    transitions += timeline.sceneChanges.length;
  }
  const expectedCourtViewSeconds = REQUIRED_KEYS.reduce((sum, key) => sum + fixtureByKey.get(key).courtViewSeconds, 0);
  const expectedTransitions = REQUIRED_KEYS.reduce((sum, key) => sum + fixtureByKey.get(key).handMarkedTransitions.length, 0);
  assert.equal(Number(courtViewSeconds.toFixed(1)), Number(expectedCourtViewSeconds.toFixed(1)), "marked court-view seconds");
  assert.equal(transitions, expectedTransitions, "hand-marked transitions");

  for (const key of REQUIRED_KEYS) {
    const file = `${key}.json`;
    const timeline = await readJson(join(corpusDir, "timelines", file));
    assert.equal(timeline.courtView.length, fixtureByKey.get(key).courtView.length, `${key} court-view interval count`);
  }

  // The negative is marked and deliberately incomplete; the fixed camera has no
  // cuts by construction. Both stay honest rather than being silently dropped.
  const negative = await readJson(join(corpusDir, "timelines/negative-basketball.json"));
  assert.equal(negative.sceneChangesComplete, false, "negative broadcast must be marked incomplete");
  assert.equal(negative.verifiedCandidatesOnly, true, "negative broadcast transitions come only from verification");
  assert.equal(negative.courtView.length, 0);
  assert.deepEqual(negative.rallyActive, []);
  assert.equal(negative.sceneChanges.length, 0);
  const club = await readJson(join(corpusDir, "timelines", `${CLUB_DIR}.json`));
  assert.equal(club.sceneChangesComplete, true);
  assert.equal(club.sceneChanges.length, 0);
  assert.equal(byKey.get(CLUB_DIR).discipline, "club match");
});

test("verification files retain the threshold, method, ordered verdicts and recorded correction", async () => {
  const manifest = await readJson(join(corpusDir, "broadcasts.json"));
  const declared = new Set(manifest.broadcasts.map((broadcast) => broadcast.key));
  const files = await corpusFiles();
  const verifiedKeys = files.verified.map((file) => file.replace(/\.json$/, ""));
  for (const key of REQUIRED_VERIFIED_KEYS) assert.ok(verifiedKeys.includes(key), `${key} needs its canonical verification file`);

  let candidates = 0;
  for (const file of files.verified) {
    const key = file.replace(/\.json$/, "");
    assert.ok(declared.has(key), `${file} references an undeclared broadcast`);
    const verified = await readJson(join(corpusDir, "verified", file));
    const timeline = await readJson(join(corpusDir, "timelines", file));

    assert.equal(verified.schema, VERIFIED_SCHEMA, `${file} schema`);
    assert.equal(verified.broadcast, key, `${file} broadcast key`);
    assert.equal(verified.candidateThreshold, CANDIDATE_THRESHOLD, `${file} candidateThreshold`);
    assert.equal(typeof verified.method, "string");
    assert.ok(verified.method.length > 0, `${file} method`);
    assert.ok(Array.isArray(verified.verdicts) && verified.verdicts.length > 0, `${file} verdicts`);

    let previousIndex = -1;
    let previousTime = -Infinity;
    for (const [position, verdict] of verified.verdicts.entries()) {
      const label = `${file} verdicts[${position}]`;
      assert.ok(Number.isInteger(verdict.i) && verdict.i > previousIndex, `${label} index must increase strictly`);
      assert.ok(Number.isFinite(verdict.t) && verdict.t >= previousTime - EPSILON, `${label} time must be ordered`);
      assert.ok(
        verdict.t >= timeline.window.start - timeline.markResolutionSeconds - EPSILON &&
          verdict.t <= timeline.window.end + timeline.markResolutionSeconds + EPSILON,
        `${label} time ${verdict.t} is outside the measured window`
      );
      assert.ok(Number.isFinite(verdict.hd), `${label} hd must be finite`);
      assert.ok(verdict.hd >= verified.candidateThreshold - EPSILON, `${label} hd ${verdict.hd} is below the candidate threshold`);
      assert.ok(verdict.hd <= 1 + EPSILON, `${label} hd ${verdict.hd} exceeds 1`);
      assert.ok(VERDICTS.has(verdict.verdict), `${label} verdict ${verdict.verdict}`);
      assert.equal(typeof verdict.note, "string", `${label} note`);
      previousIndex = verdict.i;
      previousTime = verdict.t;
    }
    candidates += verified.verdicts.length;

    if (key === "bwf-md-2018") {
      assert.equal(typeof verified.correction, "string", `${file} must retain its verdict reversal`);
      assert.ok(verified.correction.length > 0, `${file} correction`);
    }
  }
  const fixture = await readJson(fixturePath);
  const expectedCandidates = fixture.broadcasts.reduce(
    (sum, broadcast) => sum + (Array.isArray(broadcast.verifiedTransitions) ? broadcast.verifiedTransitions.length : 0),
    0
  );
  assert.equal(candidates, expectedCandidates, "verified candidate count");
});

test("committed corpus is text-only with no absolute filesystem paths", async () => {
  const files = await corpusFiles();
  const paths = [
    join(corpusDir, "broadcasts.json"),
    join(corpusDir, "SCHEMA.md"),
    join(corpusDir, "README.md"),
    ...files.timelines.map((file) => join(corpusDir, "timelines", file)),
    ...files.verified.map((file) => join(corpusDir, "verified", file))
  ];
  const absolutePath = /(^|[\s"'(=`])(?:\/(?:Users|home|private|tmp|var|opt|Volumes|mnt)\/|[A-Za-z]:\\|file:\/\/)/;

  assert.equal(paths.length, 3 + files.timelines.length + files.verified.length, "corpus file inventory must match discovered entries");
  for (const path of paths) {
    const label = relative(projectRoot, path);
    assert.match(label, /\.(json|md)$/, `${label} must be JSON or Markdown`);
    const contents = await readFile(path, "utf8");
    const match = contents.match(absolutePath);
    assert.equal(match, null, `${label} must not embed an absolute filesystem path (${match?.[0]?.trim()})`);
  }
});

test("committed corpus checksums still match the derived scene-change evidence fixture", async () => {
  const fixture = await readJson(fixturePath);
  assert.equal(fixture.schema, "bv-scene-change-evidence.v1");
  assert.equal(fixture.candidateThreshold, CANDIDATE_THRESHOLD);

  const files = await corpusFiles();
  const manifest = await readJson(join(corpusDir, "broadcasts.json"));
  const manifestByKey = new Map(manifest.broadcasts.map((broadcast) => [broadcast.key, broadcast]));
  const canonicalKeys = new Set(REQUIRED_KEYS);
  const canonicalManifest = {
    ...manifest,
    broadcasts: manifest.broadcasts.filter((broadcast) => canonicalKeys.has(broadcast.key))
  };
  assert.equal(
    createHash("sha256").update(`${JSON.stringify(canonicalManifest, null, 2)}\n`).digest("hex"),
    fixture.broadcastManifestChecksum,
    "canonical broadcast manifest provenance drifted from the fixture"
  );
  assert.deepEqual(
    fixture.broadcasts.map((broadcast) => broadcast.id).sort(),
    REQUIRED_KEYS.slice().sort(),
    "the Phase-0 fixture must cover the canonical subset"
  );

  for (const broadcast of fixture.broadcasts) {
    const manifestBroadcast = manifestByKey.get(broadcast.id);
    assert.ok(manifestBroadcast, `${broadcast.id} must remain declared in the manifest`);
    assert.equal(manifestBroadcast.url, broadcast.url, `${broadcast.id} manifest URL drifted from the fixture`);
    assert.deepEqual(manifestBroadcast.window, broadcast.window, `${broadcast.id} manifest window drifted from the fixture`);
    const timelinePath = join(corpusDir, "timelines", `${broadcast.id}.json`);
    const timeline = await readJson(timelinePath);
    assert.equal(
      timeline.sceneChangesComplete,
      broadcast.sceneChangesComplete,
      `${broadcast.id} scene-change completeness drifted from the fixture`
    );
    assert.equal(
      await sha256(timelinePath),
      broadcast.sourceChecksums.timeline,
      `${broadcast.id} timeline no longer matches its recorded checksum; regenerate the derived fixture if the corpus changed`
    );

    assert.deepEqual(broadcast.courtView, timeline.courtView, `${broadcast.id} court-view intervals drifted from the fixture`);
    assert.equal(
      broadcast.handMarkedTransitions.length,
      timeline.sceneChanges.length,
      `${broadcast.id} hand-marked transition count drifted from the fixture`
    );
    assert.equal(
      Number(broadcast.courtViewSeconds),
      Number(broadcast.courtView.reduce((sum, interval) => sum + interval.end - interval.start, 0).toFixed(1)),
      `${broadcast.id} court-view duration must match its intervals`
    );

    if (broadcast.sourceChecksums.verified) {
      const verifiedPath = join(corpusDir, "verified", `${broadcast.id}.json`);
      assert.equal(
        await sha256(verifiedPath),
        broadcast.sourceChecksums.verified,
        `${broadcast.id} verification file no longer matches its recorded checksum; regenerate the derived fixture if the corpus changed`
      );
      const verified = await readJson(verifiedPath);
      assert.equal(
        broadcast.verifiedTransitions.length,
        verified.verdicts.length,
        `${broadcast.id} verdict count drifted from the fixture`
      );
    } else {
      assert.equal(
        files.verified.includes(`${broadcast.id}.json`),
        false,
        `${broadcast.id} has no recorded verification checksum but a verification file is committed`
      );
    }
  }

  for (const file of files.timelines) {
    const key = file.replace(/\.json$/, "");
    if (canonicalKeys.has(key)) continue;
    const broadcast = manifestByKey.get(key);
    assert.ok(broadcast?.sourceChecksums?.timeline, `${key} needs a manifest timeline checksum`);
    assert.equal(
      await sha256(join(corpusDir, "timelines", file)),
      broadcast.sourceChecksums.timeline,
      `${key} timeline checksum must match its manifest provenance`
    );
    const verifiedFile = `${key}.json`;
    if (files.verified.includes(verifiedFile)) {
      assert.ok(broadcast.sourceChecksums.verified, `${key} needs a manifest verification checksum`);
      assert.equal(
        await sha256(join(corpusDir, "verified", verifiedFile)),
        broadcast.sourceChecksums.verified,
        `${key} verification checksum must match its manifest provenance`
      );
    }
  }
});
