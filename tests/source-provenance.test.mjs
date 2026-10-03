import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function modules() {
  const [provSource, reviewSource, stateSource] = await Promise.all([
    readFile(new URL("../src/provenance.js", import.meta.url), "utf8"),
    readFile(new URL("../src/review.js", import.meta.url), "utf8"),
    readFile(new URL("../src/state.js", import.meta.url), "utf8")
  ]);
  const context = { globalThis: {} };
  vm.runInNewContext(provSource, context, { filename: "provenance.js" });
  vm.runInNewContext(reviewSource, context, { filename: "review.js" });
  vm.runInNewContext(stateSource, context, { filename: "state.js" });
  return {
    provenance: context.globalThis.BVProvenance,
    review: context.globalThis.BVReview,
    state: context.globalThis.BVState
  };
}

function validOwnerSource(provenance, videoKey = "youtube:real-match") {
  return {
    schema: provenance.SOURCE_SCHEMA,
    videoKey,
    media: {
      owner: "Captain",
      rightsBasis: "owner-recorded",
      rightsStatus: "cleared",
      license: null,
      licenseUrl: null,
      mediaIncluded: true,
      captureMethod: "self-recorded",
      recordedAt: "2026-10-03"
    },
    contributor: "Captain",
    consent: { status: "obtained", evidenceReference: "release-123" },
    annotationLicense: "CC-BY-4.0",
    intendedShareability: "shareable",
    split: {
      strategy: provenance.SPLIT_STRATEGY,
      unitKey: videoKey,
      assignment: provenance.splitForMatch(videoKey)
    },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z"
  };
}

test("splitForMatch is deterministic and covers the three-way split", async () => {
  const { provenance } = await modules();
  assert.equal(provenance.splitForMatch("youtube:real-match"), "train", "pins the fnv1a-match-key-v1 algorithm");
  for (let index = 0; index < 3; index += 1) {
    assert.equal(provenance.splitForMatch("match:stable-key"), provenance.splitForMatch("match:stable-key"), "same key always yields the same split");
  }
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) seen.add(provenance.splitForMatch("match:" + index));
  assert.deepEqual([...seen].sort(), ["test", "train", "validation"], "all three splits are reachable across stable keys");
  assert.equal(provenance.splitForMatch(""), null, "an empty match key yields no assignment");
});

test("normalizeSourceRecord defaults a blank record to conservative values", async () => {
  const { provenance } = await modules();
  const record = provenance.normalizeSourceRecord({}, { videoKey: "youtube:abc123" });
  assert.equal(record.schema, "bv-source-provenance/v1");
  assert.equal(record.videoKey, "youtube:abc123");
  assert.equal(record.media.owner, "");
  assert.equal(record.media.rightsBasis, "unknown");
  assert.equal(record.media.rightsStatus, "not-cleared");
  assert.equal(record.media.captureMethod, "unknown");
  assert.equal(record.media.mediaIncluded, false);
  assert.equal(record.consent.status, "unknown");
  assert.equal(record.annotationLicense, "");
  assert.equal(record.intendedShareability, "not-determined");
  assert.equal(record.split.unitKey, "youtube:abc123");
  assert.equal(record.split.assignment, provenance.splitForMatch("youtube:abc123"));
});

test("normalizeSourceRecord downgrades public URL references and never upgrades them", async () => {
  const { provenance } = await modules();
  const viaCapture = provenance.normalizeSourceRecord({
    media: { owner: "Someone", rightsBasis: "owner-recorded", rightsStatus: "cleared", captureMethod: "public-url-reference", mediaIncluded: true },
    intendedShareability: "shareable"
  }, { videoKey: "youtube:abc123" });
  assert.equal(viaCapture.media.rightsBasis, "public-url-reference");
  assert.equal(viaCapture.media.captureMethod, "public-url-reference");
  assert.equal(viaCapture.media.rightsStatus, "not-cleared");
  assert.equal(viaCapture.media.mediaIncluded, false);
  assert.equal(viaCapture.intendedShareability, "reference-only");

  const viaBasis = provenance.normalizeSourceRecord({
    media: { owner: "Someone", rightsBasis: "public-url-reference", rightsStatus: "cleared", captureMethod: "self-recorded", mediaIncluded: true },
    intendedShareability: "shareable"
  }, { videoKey: "youtube:abc123" });
  assert.equal(viaBasis.media.rightsBasis, "public-url-reference");
  assert.equal(viaBasis.media.captureMethod, "public-url-reference");
  assert.equal(viaBasis.media.rightsStatus, "not-cleared");
  assert.equal(viaBasis.media.mediaIncluded, false);

  // An affirmative basis with a real capture method is not downgraded.
  const explicit = provenance.normalizeSourceRecord({
    media: { owner: "Captain", rightsBasis: "explicit-license", rightsStatus: "cleared", captureMethod: "self-recorded", license: "CC-BY-4.0", licenseUrl: "https://example.com/license", mediaIncluded: true },
    intendedShareability: "shareable"
  }, { videoKey: "youtube:abc123" });
  assert.equal(explicit.media.rightsBasis, "explicit-license");
  assert.equal(explicit.media.rightsStatus, "cleared");
});

test("validateSourceRecord accepts a complete owner-recorded record", async () => {
  const { provenance } = await modules();
  const source = validOwnerSource(provenance);
  const result = provenance.validateSourceRecord(source, { videoKey: source.videoKey });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.record.media.rightsStatus, "cleared");
  assert.equal(result.record.split.assignment, provenance.splitForMatch(source.videoKey));
});

test("validateSourceRecord rejects missing and malformed records", async () => {
  const { provenance } = await modules();
  const blank = provenance.validateSourceRecord({}, { videoKey: "youtube:abc123" });
  assert.equal(blank.valid, false);
  assert.ok(blank.errors.some((error) => error.includes("schema must be")), "missing schema is reported");
  assert.ok(blank.errors.some((error) => error === "media.owner is required"));
  assert.ok(blank.errors.some((error) => error === "contributor is required"));
  assert.ok(blank.errors.some((error) => error === "annotationLicense is required"));

  const source = validOwnerSource(provenance);
  const missingOwner = JSON.parse(JSON.stringify(source));
  missingOwner.media.owner = "";
  assert.equal(provenance.validateSourceRecord(missingOwner, { videoKey: source.videoKey }).valid, false);

  const missingConsentKey = JSON.parse(JSON.stringify(source));
  delete missingConsentKey.consent.evidenceReference;
  assert.ok(provenance.validateSourceRecord(missingConsentKey, { videoKey: source.videoKey }).errors.includes("consent.evidenceReference is required"));

  const badSplit = JSON.parse(JSON.stringify(source));
  badSplit.split.assignment = "validation";
  assert.ok(provenance.validateSourceRecord(badSplit, { videoKey: source.videoKey }).errors.includes("split assignment is not deterministic"));
});

test("validateSourceRecord enforces ISO timestamps and https license URLs", async () => {
  const { provenance } = await modules();
  const badDate = validOwnerSource(provenance);
  badDate.media.recordedAt = "October 3rd";
  assert.ok(provenance.validateSourceRecord(badDate, { videoKey: badDate.videoKey }).errors.some((error) => error.includes("recordedAt")));

  const httpUrl = validOwnerSource(provenance);
  httpUrl.media.rightsBasis = "explicit-license";
  httpUrl.media.license = "CC-BY-4.0";
  httpUrl.media.licenseUrl = "http://example.com/license";
  assert.ok(provenance.validateSourceRecord(httpUrl, { videoKey: httpUrl.videoKey }).errors.some((error) => error.includes("licenseUrl")));

  const explicit = validOwnerSource(provenance);
  explicit.media.rightsBasis = "explicit-license";
  explicit.media.license = "CC-BY-4.0";
  explicit.media.licenseUrl = "https://example.com/license";
  assert.equal(provenance.validateSourceRecord(explicit, { videoKey: explicit.videoKey }).valid, true);
});

test("validateSourceRecord enforces consent and rights-basis rules", async () => {
  const { provenance } = await modules();
  const noConsentEvidence = validOwnerSource(provenance);
  noConsentEvidence.consent.status = "obtained";
  noConsentEvidence.consent.evidenceReference = null;
  assert.ok(provenance.validateSourceRecord(noConsentEvidence, { videoKey: noConsentEvidence.videoKey }).errors.includes("obtained consent needs an evidence reference"));

  const notRequiredRealMedia = validOwnerSource(provenance);
  notRequiredRealMedia.consent.status = "not-required";
  assert.ok(provenance.validateSourceRecord(notRequiredRealMedia, { videoKey: notRequiredRealMedia.videoKey }).errors.includes("consent may be not-required only for synthetic media"));

  const unclearBasis = validOwnerSource(provenance);
  unclearBasis.media.rightsBasis = "unknown";
  assert.ok(provenance.validateSourceRecord(unclearBasis, { videoKey: unclearBasis.videoKey }).errors.includes("cleared media needs an affirmative rights basis"));

  const selfRecordedNoDate = validOwnerSource(provenance);
  selfRecordedNoDate.media.recordedAt = null;
  assert.ok(provenance.validateSourceRecord(selfRecordedNoDate, { videoKey: selfRecordedNoDate.videoKey }).errors.includes("self-recorded media needs recordedAt"));

  const explicitNoLicense = validOwnerSource(provenance);
  explicitNoLicense.media.rightsBasis = "explicit-license";
  explicitNoLicense.media.license = null;
  explicitNoLicense.media.licenseUrl = null;
  assert.ok(provenance.validateSourceRecord(explicitNoLicense, { videoKey: explicitNoLicense.videoKey }).errors.includes("explicit-license media needs license and licenseUrl"));
});

test("sourceGate blocks missing, uncleared, and consent-gapped sources", async () => {
  const { provenance } = await modules();
  const blank = provenance.sourceGate({}, { videoKey: "youtube:abc123" });
  assert.equal(blank.shareable, false);
  assert.equal(blank.trainingAuthorized, false);
  assert.ok(blank.reasons.includes("media rights are not cleared"));

  const unclearedSource = validOwnerSource(provenance, "youtube:uncleared");
  unclearedSource.media.rightsStatus = "not-cleared";
  const uncleared = provenance.sourceGate(unclearedSource, { videoKey: "youtube:uncleared" });
  assert.equal(uncleared.shareable, false);
  assert.ok(uncleared.reasons.includes("media rights are not cleared"));

  const syntheticPrivate = provenance.sourceGate({
    schema: provenance.SOURCE_SCHEMA,
    videoKey: "synthetic:gate",
    media: { owner: "Project", rightsBasis: "owner-recorded", rightsStatus: "cleared", license: null, licenseUrl: null, mediaIncluded: false, captureMethod: "synthetic", recordedAt: null },
    contributor: "Project",
    consent: { status: "not-required", evidenceReference: null },
    annotationLicense: "CC-BY-4.0",
    intendedShareability: "private",
    split: { strategy: provenance.SPLIT_STRATEGY, unitKey: "synthetic:gate", assignment: provenance.splitForMatch("synthetic:gate") },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z"
  }, { videoKey: "synthetic:gate" });
  assert.equal(syntheticPrivate.shareable, false);
  assert.ok(syntheticPrivate.reasons.includes("media is not included"));
  assert.ok(syntheticPrivate.reasons.includes("source is not intended to be shareable"));
  assert.equal(syntheticPrivate.trainingAuthorized, false);

  const publicUrl = provenance.sourceGate({
    schema: provenance.SOURCE_SCHEMA,
    videoKey: "youtube:bwf",
    media: { owner: "", rightsBasis: "public-url-reference", rightsStatus: "not-cleared", license: null, licenseUrl: null, mediaIncluded: false, captureMethod: "public-url-reference", recordedAt: null },
    contributor: "reference",
    consent: { status: "unknown", evidenceReference: null },
    annotationLicense: "CC-BY-4.0",
    intendedShareability: "reference-only",
    split: { strategy: provenance.SPLIT_STRATEGY, unitKey: "youtube:bwf", assignment: provenance.splitForMatch("youtube:bwf") },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z"
  }, { videoKey: "youtube:bwf" });
  assert.equal(publicUrl.shareable, false);
  assert.ok(publicUrl.reasons.includes("public URL references are evaluation-only"));
});

test("sourceGate passes a cleared shareable source but never authorizes training", async () => {
  const { provenance } = await modules();
  const source = validOwnerSource(provenance);
  const gate = provenance.sourceGate(source, { videoKey: source.videoKey });
  assert.equal(gate.shareable, true, gate.reasons.join("; "));
  assert.equal(gate.trainingSourceEligible, true);
  assert.equal(gate.trainingAuthorized, false, "shareability never implies training authorization");
});

test("createLabelPackage and parseLabelPackage round-trip labels and provenance", async () => {
  const { provenance } = await modules();
  const source = validOwnerSource(provenance);
  const labels = [{ eventId: "e-1", shot: "Clear", startSec: 1, endSec: 1.4, source: "manual", provenance: "manual", status: "accepted" }];
  const pkg = provenance.createLabelPackage(source, labels, { now: "2026-10-03T00:00:00.000Z" });
  assert.equal(pkg.schema, "bv-manual-label-package/v1");
  assert.equal(pkg.exportedAt, "2026-10-03T00:00:00.000Z");
  assert.equal(pkg.source.media.owner, "Captain");
  assert.equal(JSON.stringify(pkg.labels), JSON.stringify(labels));

  const parsed = provenance.parseLabelPackage(JSON.stringify(pkg), { videoKey: source.videoKey });
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.source.media.owner, "Captain");
  assert.equal(JSON.stringify(parsed.labels), JSON.stringify(labels));

  assert.equal(provenance.parseLabelPackage("not json", { videoKey: source.videoKey }).ok, false);
  assert.ok(provenance.parseLabelPackage(JSON.stringify({ schema: "other", labels: [] }), { videoKey: source.videoKey }).error.includes("Unrecognized"));

  const invalidSource = JSON.parse(JSON.stringify(pkg));
  invalidSource.source.contributor = "";
  const rejected = provenance.parseLabelPackage(JSON.stringify(invalidSource), { videoKey: source.videoKey });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.error.includes("contributor is required"));

  // A package for a different video is rejected rather than silently imported.
  assert.equal(provenance.parseLabelPackage(JSON.stringify(pkg), { videoKey: "youtube:other" }).ok, false);
});

test("parseLabelPackage preserves an uncleared source without upgrading it", async () => {
  const { provenance } = await modules();
  const uncleared = validOwnerSource(provenance, "youtube:bwf");
  uncleared.media.rightsBasis = "public-url-reference";
  uncleared.media.captureMethod = "public-url-reference";
  uncleared.media.rightsStatus = "not-cleared";
  uncleared.media.mediaIncluded = false;
  uncleared.intendedShareability = "reference-only";
  const pkg = provenance.createLabelPackage(uncleared, [], { now: "2026-10-03T00:00:00.000Z" });
  const parsed = provenance.parseLabelPackage(JSON.stringify(pkg), { videoKey: "youtube:bwf" });
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.source.media.rightsStatus, "not-cleared", "import never upgrades an uncleared source");
  assert.equal(parsed.source.media.mediaIncluded, false);
  assert.equal(parsed.source.intendedShareability, "reference-only");
  assert.equal(provenance.sourceGate(parsed.source, { videoKey: "youtube:bwf" }).shareable, false);
});

test("state persistence stores, restores, and deletes per-video source records", async () => {
  const { provenance, state } = await modules();
  const key = "youtube:real-match";
  let current = state.initialExtensionState();
  current = state.reduceExtensionState(current, { type: "SET_SOURCE_PROVENANCE", videoKey: key, record: validOwnerSource(provenance, key) });
  const stored = state.sourceProvenanceForVideo(current, key);
  assert.equal(stored.media.owner, "Captain");
  assert.equal(stored.media.rightsStatus, "cleared");
  assert.equal(stored.split.assignment, provenance.splitForMatch(key));

  const restored = state.initialExtensionState(JSON.parse(JSON.stringify(current)));
  assert.equal(state.sourceProvenanceForVideo(restored, key).media.owner, "Captain");
  assert.equal(restored.sourceProvenanceByVideo[key].schema, "bv-source-provenance/v1");

  current = state.reduceExtensionState(current, { type: "SET_SOURCE_PROVENANCE", videoKey: key, record: null });
  assert.equal(state.sourceProvenanceForVideo(current, key), null, "null record deletes the source");
});

test("synthetic dry-run fixture is schema-valid, deterministic, and gate-blocked", async () => {
  const { provenance } = await modules();
  const fixture = JSON.parse(await readFile(new URL("../test/fixtures/synthetic-provenance-package.json", import.meta.url), "utf8"));
  const parsed = provenance.parseLabelPackage(fixture, { videoKey: "synthetic:phase0-dry-run" });
  assert.equal(parsed.ok, true, parsed.error);

  const source = parsed.source;
  assert.equal(source.schema, "bv-source-provenance/v1");
  assert.equal(source.media.captureMethod, "synthetic", "the fixture is synthetic, not a real recording");
  assert.equal(source.split.assignment, provenance.splitForMatch(source.split.unitKey), "the split is deterministic");
  assert.equal(source.split.assignment, "train");

  const validated = provenance.validateSourceRecord(source, { videoKey: source.videoKey });
  assert.equal(validated.valid, true, validated.errors.join("; "));

  const gate = provenance.sourceGate(source, { videoKey: source.videoKey });
  assert.equal(gate.shareable, false, "synthetic private metadata stays below the shareable gate");
  assert.equal(gate.trainingAuthorized, false);
  assert.ok(gate.reasons.includes("media is not included"));
  assert.ok(gate.reasons.includes("source is not intended to be shareable"));

  const relabeled = provenance.parseLabelPackage(JSON.stringify(provenance.createLabelPackage(source, parsed.labels, { now: parsed.exportedAt })), { videoKey: source.videoKey });
  assert.equal(relabeled.ok, true);
  assert.equal(JSON.stringify(relabeled.labels.map((label) => label.eventId)), JSON.stringify(["synthetic-label-1"]));
  assert.equal(relabeled.labels[0].shot, "Clear");
});
