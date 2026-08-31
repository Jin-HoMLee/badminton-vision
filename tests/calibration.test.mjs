import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function calibrationModule() {
  const context = {};
  const primitiveSource = await readFile(new URL("../analysis/index.js", import.meta.url), "utf8");
  const browserSource = await readFile(new URL("../src/calibration.js", import.meta.url), "utf8");
  vm.runInNewContext(primitiveSource, context, { filename: "analysis-primitives.js" });
  vm.runInNewContext(browserSource, context, { filename: "calibration.js" });
  return { calibration: context.BVCalibration, primitives: context.BVAnalysisPrimitives };
}

test("browser calibration maps every seeded corner exactly and projects all BWF lines", async () => {
  const { calibration, primitives } = await calibrationModule();
  const seeds = [
    { x: 0.12, y: 0.79 },
    { x: 0.91, y: 0.73 },
    { x: 0.84, y: 0.16 },
    { x: 0.17, y: 0.21 }
  ];
  const fitted = calibration.fitCourtCalibration(seeds);
  assert.equal(fitted.coordinateSystem, "normalized-video-image");
  assert.equal(fitted.courtCoordinateSystem, "normalized-court");
  assert.deepEqual(JSON.parse(JSON.stringify(fitted.seedPoints)), seeds);
  assert.equal(fitted.lines.length, primitives.COURT_LINES.length);
  assert.deepEqual(fitted.lines.map((line) => line.id), primitives.COURT_LINES.map((line) => line.id));
  fitted.canonicalCorners.forEach((corner, index) => {
    assert.ok(Math.hypot(calibration.projectCourtPoint(fitted, corner).x - seeds[index].x, calibration.projectCourtPoint(fitted, corner).y - seeds[index].y) < 1e-9);
  });
  const serviceLine = fitted.lines.find((line) => line.id === "short-service-line-near");
  assert.equal(serviceLine.line_ownership, "line-is-part-of-the-area-it-bounds");
  assert.equal(serviceLine.court_start.x, 0);
  assert.equal(serviceLine.court_start.y, 4.72);
  assert.equal(serviceLine.court_end.x, 6.1);
  assert.equal(serviceLine.court_end.y, 4.72);
});

test("browser calibration projects a representative interior line and round-trips points", async () => {
  const { calibration } = await calibrationModule();
  const fitted = calibration.fit([
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 }
  ]);
  const expectedY = 0.2 + 0.7 * (4.72 / 13.4);
  const line = fitted.lines.find((entry) => entry.id === "short-service-line-near");
  assert.ok(Math.abs(line.start.x - 0.1) < 1e-10);
  assert.ok(Math.abs(line.start.y - expectedY) < 1e-10);
  const courtPoint = { x: 0.37, y: 0.68 };
  const imagePoint = calibration.projectCourtPoint(fitted, courtPoint);
  const roundTrip = calibration.projectImagePoint(fitted, imagePoint);
  assert.ok(Math.hypot(roundTrip.x - courtPoint.x, roundTrip.y - courtPoint.y) < 1e-9);
});

test("browser calibration rejects unsafe seeds with recoverable errors", async () => {
  const { calibration } = await calibrationModule();
  const invalidSeeds = [
    [[0, 0], [1, 0], [1, 1], [0, 0]],
    [[0, 0], [1, 0], [2, 0], [0, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [Infinity, 0], [1, 1], [0, 1]],
    [[0, 0], [1, 0], [1, 1e-10], [0, 1e-10]]
  ];
  invalidSeeds.forEach((seeds) => {
    const result = calibration.tryFitCourtCalibration(seeds);
    assert.equal(result.ok, false);
    assert.equal(result.error.recoverable, true);
    assert.match(result.error.message, /Undo|click|Calibration/);
    assert.throws(() => calibration.fit(seeds), (error) => error.recoverable === true);
  });
});

test("persisted calibration is refit from normalized seeds rather than trusting matrices", async () => {
  const { calibration } = await calibrationModule();
  const fitted = calibration.fit([
    { x: 0.08, y: 0.82 },
    { x: 0.92, y: 0.78 },
    { x: 0.81, y: 0.12 },
    { x: 0.18, y: 0.17 }
  ]);
  const restored = calibration.restoreCalibration(JSON.parse(JSON.stringify(fitted)));
  assert.deepEqual(restored.seedPoints, fitted.seedPoints);
  assert.deepEqual(restored.lines, fitted.lines);
  const corrupted = JSON.parse(JSON.stringify(fitted));
  corrupted.seedPoints[2] = corrupted.seedPoints[1];
  assert.throws(() => calibration.restoreCalibration(corrupted), (error) => error.code === "duplicate-corner");
});
