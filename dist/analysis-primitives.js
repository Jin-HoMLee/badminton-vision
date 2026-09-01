'use strict';

/**
 * UI-independent badminton analysis primitives.
 *
 * This module intentionally contains no frame capture, model, DOM, canvas, or
 * rendering code. It accepts observations from an upstream analyzer and
 * returns deterministic court, record, feature, and highlight values.
 */

const COURT_LENGTH_M = 13.4;
const COURT_WIDTH_M = 6.1;
const LINE_WIDTH_M = 0.04;
const NET_Y_M = 6.7;
const NET_POST_HEIGHT_M = 1.55;
const SINGLES_SIDE_MARGIN_M = 0.46;
const SINGLES_WIDTH_M = 5.18;
const SHORT_SERVICE_OFFSET_M = 1.98;
const DOUBLES_LONG_SERVICE_OFFSET_M = 0.76;
const SHORT_SERVICE_NEAR_Y_M = Number((NET_Y_M - SHORT_SERVICE_OFFSET_M).toFixed(2));
const SHORT_SERVICE_FAR_Y_M = Number((NET_Y_M + SHORT_SERVICE_OFFSET_M).toFixed(2));
const DOUBLES_LONG_SERVICE_NEAR_Y_M = DOUBLES_LONG_SERVICE_OFFSET_M;
const DOUBLES_LONG_SERVICE_FAR_Y_M = COURT_LENGTH_M - DOUBLES_LONG_SERVICE_OFFSET_M;

const COARSE_SHOT_FAMILIES = Object.freeze(['clear', 'drop', 'smash', 'net']);
const SHOT_FAMILY_UNKNOWN = 'unknown';
const MANUAL_SHOT_LABELS = Object.freeze([
  'Serve',
  'Clear',
  'Drop',
  'Smash',
  'Half Smash',
  'Lift',
  'Net Shot',
  'Net Kill',
  'Push',
  'Drive',
  'Block',
]);
const EVENT_SOURCES = Object.freeze(['auto', 'manual', 'corrected', 'unknown']);
const EVENT_STATUSES = Object.freeze(['suggested', 'accepted', 'corrected', 'partial', 'unknown', 'unclassified']);
const OUTCOME_LABELS = Object.freeze(['winner', 'forced_error', 'unforced_error', 'unclassified']);
const LINE_CALL_LABELS = Object.freeze(['in', 'out', 'unknown']);
const EVIDENCE_STATES = Object.freeze(['accepted', 'suggested', 'corrected', 'partial', 'unknown']);
const RALLY_STATUSES = Object.freeze(['in_progress', 'completed', 'incomplete']);
const RALLY_TERMINATIONS = Object.freeze(['rally_end', 'camera_cut', 'implicit', 'unknown']);
const STROKE_EVENT_FIELDS = Object.freeze([
  'event_id', 'rally_id', 'sequence', 'player_id', 'shot_family', 'label', 'hit_media_time',
  'classification_confidence', 'geometry_confidence', 'tracking_confidence', 'status', 'created_at_wall_time',
  'evidence', 'player_evidence', 'shuttle_evidence', 'shot_evidence', 'landing_evidence',
]);
const RALLY_OPTIONAL_FIELDS = Object.freeze([
  'evidence_state', 'partial_reasons', 'termination', 'boundary_media_time', 'camera_cut_id',
  'line_calls', 'evidence',
]);

class AnalysisError extends Error {
  constructor(message, code = 'analysis-error', details = undefined) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

class SchemaValidationError extends AnalysisError {
  constructor(recordName, errors) {
    super(`${recordName} failed schema validation: ${errors.join('; ')}`, 'schema-validation', {
      recordName,
      errors,
    });
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (isRecord(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = deepClone(item);
    return result;
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function finishRecord(value) {
  return deepFreeze(value);
}

function assertObject(value, name) {
  if (!isRecord(value)) throw new SchemaValidationError(name, ['value must be an object']);
}

function assertFiniteNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SchemaValidationError('value', [`${name} must be a finite number`]);
  }
  if (value < min || value > max) {
    throw new SchemaValidationError('value', [`${name} must be between ${min} and ${max}`]);
  }
}

function assertTimestamp(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return;
  assertFiniteNumber(value, name, { min: 0 });
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SchemaValidationError('value', [`${name} must be a non-empty string`]);
  }
}

function validateEnum(value, name, choices, errors) {
  if (!choices.includes(value)) errors.push(`${name} must be one of: ${choices.join(', ')}`);
}

function pointXY(point, name = 'point') {
  let x;
  let y;
  if (Array.isArray(point) && point.length === 2) {
    [x, y] = point;
  } else if (isRecord(point)) {
    ({ x, y } = point);
  } else {
    throw new AnalysisError(`${name} must be a [x, y] pair or {x, y} object`, 'invalid-point');
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AnalysisError(`${name} coordinates must be finite`, 'non-finite-point');
  }
  return { x, y };
}

/** Create a normalized point. By default coordinates are constrained to [0, 1]. */
function createNormalizedPoint(x, y, { allowOutside = false } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AnalysisError('normalized point coordinates must be finite', 'non-finite-point');
  }
  if (!allowOutside && (x < 0 || x > 1 || y < 0 || y > 1)) {
    throw new AnalysisError('normalized point coordinates must be in [0, 1]', 'point-out-of-range');
  }
  return finishRecord({ x, y });
}

function createCourtPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AnalysisError('court point coordinates must be finite', 'non-finite-point');
  }
  return finishRecord({ x, y });
}

function normalizeCourtPoint(point, { allowOutside = false } = {}) {
  const { x, y } = pointXY(point, 'court point');
  return createNormalizedPoint(x / COURT_WIDTH_M, y / COURT_LENGTH_M, { allowOutside });
}

function denormalizeCourtPoint(point) {
  const { x, y } = pointXY(point, 'normalized court point');
  return createCourtPoint(x * COURT_WIDTH_M, y * COURT_LENGTH_M);
}

function normalizeCourtLine(start, end) {
  return {
    start: normalizeCourtPoint(start, { allowOutside: true }),
    end: normalizeCourtPoint(end, { allowOutside: true }),
  };
}

function makeCourtLine(id, role, start, end, formats, includedIn, extra = {}) {
  const normalized = normalizeCourtLine(start, end);
  return {
    id,
    role,
    start: finishRecord({ ...start }),
    end: finishRecord({ ...end }),
    normalized_start: normalized.start,
    normalized_end: normalized.end,
    width_m: LINE_WIDTH_M,
    normalized_width: finishRecord({ x: LINE_WIDTH_M / COURT_WIDTH_M, y: LINE_WIDTH_M / COURT_LENGTH_M }),
    formats: [...formats],
    included_in: [...includedIn],
    line_ownership: 'line-is-part-of-the-area-it-bounds',
    ...extra,
  };
}

/**
 * Generate the fixed BWF court lines from the physical dimensions in the
 * README. Coordinates are line center coordinates in metres; line ownership
 * is explicit because a 40 mm line belongs to the area it bounds.
 */
function generateCourtLines() {
  const xLeft = 0;
  const xRight = COURT_WIDTH_M;
  const xSinglesLeft = SINGLES_SIDE_MARGIN_M;
  const xSinglesRight = COURT_WIDTH_M - SINGLES_SIDE_MARGIN_M;
  const xCenter = COURT_WIDTH_M / 2;
  const full = ['doubles', 'singles'];
  const lines = [
    makeCourtLine(
      'doubles-side-left',
      'doubles-side-boundary',
      { x: xLeft, y: 0 },
      { x: xLeft, y: COURT_LENGTH_M },
      ['doubles'],
      ['doubles-rally-court', 'doubles-service-court'],
      { boundary: true, service_boundary: true },
    ),
    makeCourtLine(
      'doubles-side-right',
      'doubles-side-boundary',
      { x: xRight, y: 0 },
      { x: xRight, y: COURT_LENGTH_M },
      ['doubles'],
      ['doubles-rally-court', 'doubles-service-court'],
      { boundary: true, service_boundary: true },
    ),
    makeCourtLine(
      'singles-side-left',
      'singles-side-boundary',
      { x: xSinglesLeft, y: 0 },
      { x: xSinglesLeft, y: COURT_LENGTH_M },
      ['singles'],
      ['singles-rally-court', 'singles-service-court'],
      { boundary: true, service_boundary: true },
    ),
    makeCourtLine(
      'singles-side-right',
      'singles-side-boundary',
      { x: xSinglesRight, y: 0 },
      { x: xSinglesRight, y: COURT_LENGTH_M },
      ['singles'],
      ['singles-rally-court', 'singles-service-court'],
      { boundary: true, service_boundary: true },
    ),
    makeCourtLine(
      'back-boundary-near',
      'back-boundary',
      { x: xLeft, y: 0 },
      { x: xRight, y: 0 },
      full,
      ['doubles-rally-court', 'singles-rally-court', 'singles-service-court'],
      { boundary: true, service_boundary: true },
    ),
    makeCourtLine(
      'back-boundary-far',
      'back-boundary',
      { x: xLeft, y: COURT_LENGTH_M },
      { x: xRight, y: COURT_LENGTH_M },
      full,
      ['doubles-rally-court', 'singles-rally-court', 'singles-service-court'],
      { boundary: true, service_boundary: true },
    ),
    makeCourtLine(
      'short-service-line-near',
      'short-service-line',
      { x: xLeft, y: SHORT_SERVICE_NEAR_Y_M },
      { x: xRight, y: SHORT_SERVICE_NEAR_Y_M },
      full,
      ['doubles-service-court', 'singles-service-court'],
      { service_line: true },
    ),
    makeCourtLine(
      'short-service-line-far',
      'short-service-line',
      { x: xLeft, y: SHORT_SERVICE_FAR_Y_M },
      { x: xRight, y: SHORT_SERVICE_FAR_Y_M },
      full,
      ['doubles-service-court', 'singles-service-court'],
      { service_line: true },
    ),
    makeCourtLine(
      'doubles-long-service-line-near',
      'doubles-long-service-line',
      { x: xLeft, y: DOUBLES_LONG_SERVICE_NEAR_Y_M },
      { x: xRight, y: DOUBLES_LONG_SERVICE_NEAR_Y_M },
      ['doubles'],
      ['doubles-service-court'],
      { service_line: true, doubles_only: true },
    ),
    makeCourtLine(
      'doubles-long-service-line-far',
      'doubles-long-service-line',
      { x: xLeft, y: DOUBLES_LONG_SERVICE_FAR_Y_M },
      { x: xRight, y: DOUBLES_LONG_SERVICE_FAR_Y_M },
      ['doubles'],
      ['doubles-service-court'],
      { service_line: true, doubles_only: true },
    ),
    makeCourtLine(
      'centre-line-near',
      'centre-line',
      { x: xCenter, y: 0 },
      { x: xCenter, y: SHORT_SERVICE_NEAR_Y_M },
      full,
      ['doubles-service-court', 'singles-service-court'],
      { service_line: true, divides_service_courts: true },
    ),
    makeCourtLine(
      'centre-line-far',
      'centre-line',
      { x: xCenter, y: SHORT_SERVICE_FAR_Y_M },
      { x: xCenter, y: COURT_LENGTH_M },
      full,
      ['doubles-service-court', 'singles-service-court'],
      { service_line: true, divides_service_courts: true },
    ),
    makeCourtLine(
      'net',
      'net',
      { x: xLeft, y: NET_Y_M },
      { x: xRight, y: NET_Y_M },
      full,
      [],
      { boundary: false, physical_net: true, line_ownership: 'physical-net-not-court-area' },
    ),
  ];
  return lines.map((line) => finishRecord(line));
}

const COURT_LINES = finishRecord(generateCourtLines());
const COURT_GEOMETRY = finishRecord({
  coordinate_system: 'court-meters',
  normalized_coordinate_system: 'court-normalized',
  units: 'm',
  length_m: COURT_LENGTH_M,
  width_m: COURT_WIDTH_M,
  line_width_m: LINE_WIDTH_M,
  net_y_m: NET_Y_M,
  net_post_height_m: NET_POST_HEIGHT_M,
  singles_side_margin_m: SINGLES_SIDE_MARGIN_M,
  singles_width_m: SINGLES_WIDTH_M,
  short_service_offset_m: SHORT_SERVICE_OFFSET_M,
  doubles_long_service_offset_m: DOUBLES_LONG_SERVICE_OFFSET_M,
  bounds: { x_min: 0, x_max: COURT_WIDTH_M, y_min: 0, y_max: COURT_LENGTH_M },
  outer_corner_order: [
    { x: 0, y: 0 },
    { x: COURT_WIDTH_M, y: 0 },
    { x: COURT_WIDTH_M, y: COURT_LENGTH_M },
    { x: 0, y: COURT_LENGTH_M },
  ],
  lines: COURT_LINES,
});

function getCourtGeometry() {
  return COURT_GEOMETRY;
}

function getCourtLine(id) {
  return COURT_LINES.find((line) => line.id === id) || null;
}

function projectCourtLines(homography) {
  if (!homography || typeof homography.courtToImage !== 'function') {
    throw new AnalysisError('a fitted homography is required', 'invalid-homography');
  }
  return finishRecord(
    COURT_LINES.map((line) =>
      finishRecord({
        ...line,
        start: homography.courtToImage(line.start),
        end: homography.courtToImage(line.end),
      }),
    ),
  );
}

function matrixMultiply(a, b) {
  const result = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      result[row][col] = a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
    }
  }
  return result;
}

function matrixDeterminant(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function matrixInverse(m, code = 'near-singular') {
  const determinant = matrixDeterminant(m);
  const scale = Math.max(1, ...m.flat().map((value) => Math.abs(value)));
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-14 * scale ** 3) {
    throw new AnalysisError('homography matrix is singular or near-singular', code);
  }
  const inverse = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / determinant,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / determinant,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / determinant,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / determinant,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / determinant,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / determinant,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / determinant,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / determinant,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / determinant,
    ],
  ];
  return inverse;
}

function solveLinearSystem(matrix, vector, pivotTolerance = 1e-12) {
  const n = vector.length;
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);
  let largestPivot = 0;
  let smallestPivot = Infinity;

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    const pivot = Math.abs(augmented[pivotRow][column]);
    largestPivot = Math.max(largestPivot, pivot);
    if (!Number.isFinite(pivot) || pivot <= pivotTolerance) {
      throw new AnalysisError('homography seed produces a near-singular system', 'near-singular');
    }
    smallestPivot = Math.min(smallestPivot, pivot);
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= n; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let item = column; item <= n; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }

  if (smallestPivot / largestPivot <= pivotTolerance ** 2) {
    throw new AnalysisError('homography seed is numerically ill-conditioned', 'near-singular');
  }
  return augmented.map((row) => row[n]);
}

function normalizePointSet(points) {
  const centroid = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  const meanDistance = points.reduce(
    (sum, point) => sum + Math.hypot(point.x - centroid.x, point.y - centroid.y),
    0,
  ) / points.length;
  if (!Number.isFinite(meanDistance) || meanDistance <= 1e-15) {
    throw new AnalysisError('homography points have no measurable extent', 'near-singular');
  }
  const scale = Math.SQRT2 / meanDistance;
  return {
    transform: [
      [scale, 0, -scale * centroid.x],
      [0, scale, -scale * centroid.y],
      [0, 0, 1],
    ],
    points: points.map((point) => ({
      x: scale * (point.x - centroid.x),
      y: scale * (point.y - centroid.y),
    })),
  };
}

function validateQuadrilateral(points, name, { minimumAreaRatio = 1e-8, duplicateRatio = 1e-9 } = {}) {
  if (!Array.isArray(points) || points.length !== 4) {
    throw new AnalysisError(`${name} must contain exactly four points`, 'invalid-seed');
  }
  const parsed = points.map((point, index) => pointXY(point, `${name}[${index}]`));
  const xExtent = Math.max(...parsed.map((point) => point.x)) - Math.min(...parsed.map((point) => point.x));
  const yExtent = Math.max(...parsed.map((point) => point.y)) - Math.min(...parsed.map((point) => point.y));
  const scale = Math.max(xExtent, yExtent, ...parsed.flatMap((point) => parsed.map((other) => Math.hypot(point.x - other.x, point.y - other.y))), 1e-15);

  for (let first = 0; first < parsed.length; first += 1) {
    for (let second = first + 1; second < parsed.length; second += 1) {
      if (Math.hypot(parsed[first].x - parsed[second].x, parsed[first].y - parsed[second].y) <= duplicateRatio * scale) {
        throw new AnalysisError(`${name} contains duplicate or near-duplicate points`, 'duplicate-corner');
      }
    }
  }

  const signedCrosses = [];
  for (let index = 0; index < 4; index += 1) {
    const a = parsed[index];
    const b = parsed[(index + 1) % 4];
    const c = parsed[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= minimumAreaRatio * scale ** 2) {
      throw new AnalysisError(`${name} contains collinear or near-collinear corners`, 'collinear-corners');
    }
    signedCrosses.push(Math.sign(cross));
  }
  if (new Set(signedCrosses).size !== 1) {
    throw new AnalysisError(`${name} must be a convex, consistently ordered quadrilateral`, 'invalid-order');
  }

  const area = Math.abs(parsed.reduce((sum, point, index) => {
    const next = parsed[(index + 1) % parsed.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (area <= minimumAreaRatio * scale ** 2) {
    throw new AnalysisError(`${name} has insufficient area`, 'near-singular');
  }
  return parsed;
}

function fitHomography(sourcePoints, targetPoints, options = {}) {
  const source = validateQuadrilateral(sourcePoints, 'source points', options);
  const target = validateQuadrilateral(targetPoints, 'target points', options);
  const sourceNormalized = normalizePointSet(source);
  const targetNormalized = normalizePointSet(target);
  const matrix = [];
  const vector = [];

  for (let index = 0; index < 4; index += 1) {
    const { x, y } = sourceNormalized.points[index];
    const { x: u, y: v } = targetNormalized.points[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }

  const solved = solveLinearSystem(matrix, vector, options.pivotTolerance || 1e-12);
  const normalizedHomography = [
    [solved[0], solved[1], solved[2]],
    [solved[3], solved[4], solved[5]],
    [solved[6], solved[7], 1],
  ];
  const sourceTransform = sourceNormalized.transform;
  const targetTransformInverse = matrixInverse(targetNormalized.transform);
  let homography = matrixMultiply(matrixMultiply(targetTransformInverse, normalizedHomography), sourceTransform);
  const normalization = Math.abs(homography[2][2]) > 1e-14 ? homography[2][2] : Math.max(...homography.flat().map((value) => Math.abs(value)));
  homography = homography.map((row) => row.map((value) => value / normalization));
  const inverse = matrixInverse(homography);

  const targetExtent = Math.max(
    Math.max(...target.map((point) => point.x)) - Math.min(...target.map((point) => point.x)),
    Math.max(...target.map((point) => point.y)) - Math.min(...target.map((point) => point.y)),
    1,
  );
  for (let index = 0; index < 4; index += 1) {
    const projected = applyMatrix(homography, source[index], 'homography fit');
    if (Math.hypot(projected.x - target[index].x, projected.y - target[index].y) > 1e-7 * targetExtent) {
      throw new AnalysisError('homography fit residual is too large', 'near-singular');
    }
  }

  return new Homography(source, target, homography, inverse);
}

function applyMatrix(matrix, point, operation = 'projection') {
  const { x, y } = pointXY(point, operation);
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  const scale = Math.max(1, ...matrix.flat().map((value) => Math.abs(value)), Math.abs(x), Math.abs(y));
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-12 * scale) {
    throw new AnalysisError(`${operation} is at a projective singularity`, 'projection-singular');
  }
  const projected = {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator,
  };
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
    throw new AnalysisError(`${operation} produced a non-finite point`, 'projection-singular');
  }
  return finishRecord(projected);
}

class Homography {
  constructor(sourcePoints, targetPoints, matrix, inverse) {
    this.source_points = finishRecord(sourcePoints.map((point) => ({ ...point })));
    this.target_points = finishRecord(targetPoints.map((point) => ({ ...point })));
    this.matrix = finishRecord(matrix.map((row) => [...row]));
    this.inverse_matrix = finishRecord(inverse.map((row) => [...row]));
    deepFreeze(this);
  }

  mapSourceToTarget(point) {
    return applyMatrix(this.matrix, point, 'source-to-target projection');
  }

  mapTargetToSource(point) {
    return applyMatrix(this.inverse_matrix, point, 'target-to-source projection');
  }

  imageToCourt(point) {
    return this.mapSourceToTarget(point);
  }

  courtToImage(point) {
    return this.mapTargetToSource(point);
  }

  imageToNormalizedCourt(point, options = {}) {
    return normalizeCourtPoint(this.imageToCourt(point), options);
  }

  normalizedCourtToImage(point) {
    return this.courtToImage(denormalizeCourtPoint(point));
  }
}

function fitOuterCourtHomography(imageCorners, options = {}) {
  return fitHomography(imageCorners, COURT_GEOMETRY.outer_corner_order, options);
}

function confidenceErrors(value, name = 'confidence') {
  const errors = [];
  if (!isRecord(value)) {
    errors.push(`${name} must be a confidence object`);
    return errors;
  }
  validateEnum(value.status, `${name}.status`, ['known', 'unknown'], errors);
  if (value.status === 'known' && (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0 || value.value > 1)) {
    errors.push(`${name}.value must be a finite number in [0, 1] when known`);
  }
  if (value.status === 'unknown' && value.value !== null) errors.push(`${name}.value must be null when unknown`);
  if (value.reason !== null && value.reason !== undefined && typeof value.reason !== 'string') {
    errors.push(`${name}.reason must be a string or null`);
  }
  return errors;
}

function createConfidence(value = null, { reason = 'not-provided' } = {}) {
  if (isRecord(value)) {
    const candidate = {
      value: value.status === 'unknown' ? null : value.value,
      status: value.status,
      reason: value.reason ?? (value.status === 'unknown' ? reason : null),
    };
    const errors = confidenceErrors(candidate);
    if (errors.length) throw new SchemaValidationError('Confidence', errors);
    return finishRecord(candidate);
  }
  if (value === null || value === undefined) return finishRecord({ value: null, status: 'unknown', reason });
  assertFiniteNumber(value, 'confidence', { min: 0, max: 1 });
  return finishRecord({ value, status: 'known', reason: null });
}

function validateConfidence(value) {
  const errors = confidenceErrors(value);
  return { valid: errors.length === 0, errors };
}

function stableNumber(value, digits = 12) {
  return Number(value.toFixed(digits));
}

function provenanceErrors(value, name = 'provenance') {
  const errors = [];
  if (!isRecord(value)) return [`${name} must be an object`];
  validateEnum(value.source, `${name}.source`, EVENT_SOURCES, errors);
  if (typeof value.reason !== 'string' || value.reason.trim() === '') errors.push(`${name}.reason must be a non-empty string`);
  if (value.corrected_at_media_time !== null && value.corrected_at_media_time !== undefined &&
      (typeof value.corrected_at_media_time !== 'number' || !Number.isFinite(value.corrected_at_media_time) || value.corrected_at_media_time < 0)) {
    errors.push(`${name}.corrected_at_media_time must be a non-negative finite number or null`);
  }
  if (!Array.isArray(value.changed_fields) || value.changed_fields.some((field) => typeof field !== 'string')) {
    errors.push(`${name}.changed_fields must be an array of strings`);
  }
  return errors;
}

function createCorrectionProvenance({ source = 'manual', reason, corrected_at_media_time = null, changed_fields = [] } = {}) {
  const value = {
    source,
    reason,
    corrected_at_media_time,
    changed_fields: [...changed_fields],
  };
  const errors = provenanceErrors(value);
  if (errors.length) throw new SchemaValidationError('CorrectionProvenance', errors);
  return finishRecord(value);
}

function validateCorrectionProvenance(value) {
  const errors = provenanceErrors(value);
  return { valid: errors.length === 0, errors };
}

function normalizeProvenanceList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SchemaValidationError('CorrectionProvenance', ['must be an array']);
  return value.map((item) => {
    const candidate = createCorrectionProvenance(item);
    return candidate;
  });
}

function eventErrors(value) {
  const errors = [];
  if (!isRecord(value)) return ['value must be an object'];
  for (const field of ['event_id', 'rally_id']) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push(`${field} must be a non-empty string`);
  }
  if (value.player_id !== null && (typeof value.player_id !== 'string' || value.player_id.trim() === '')) {
    errors.push('player_id must be a non-empty string or null');
  }
  if (value.sequence !== null && (!Number.isInteger(value.sequence) || value.sequence < 0)) {
    errors.push('sequence must be a non-negative integer or null');
  }
  if (value.hit_media_time !== null && (typeof value.hit_media_time !== 'number' || !Number.isFinite(value.hit_media_time) || value.hit_media_time < 0)) {
    errors.push('hit_media_time must be a non-negative finite number or null');
  }
  validateEnum(value.shot_family, `${'shot_family'}`, [...COARSE_SHOT_FAMILIES, SHOT_FAMILY_UNKNOWN], errors);
  validateEnum(value.source, 'source', EVENT_SOURCES, errors);
  validateEnum(value.status, 'status', EVENT_STATUSES, errors);
  errors.push(...confidenceErrors(value.classification_confidence, 'classification_confidence'));
  errors.push(...confidenceErrors(value.geometry_confidence, 'geometry_confidence'));
  if (value.tracking_confidence !== null && value.tracking_confidence !== undefined) {
    errors.push(...confidenceErrors(value.tracking_confidence, 'tracking_confidence'));
  }
  if (value.label !== null && value.label !== undefined && !MANUAL_SHOT_LABELS.includes(value.label)) {
    errors.push(`label must be one of: ${MANUAL_SHOT_LABELS.join(', ')}`);
  }
  if (!Array.isArray(value.correction_provenance)) errors.push('correction_provenance must be an array');
  else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `correction_provenance[${index}]`)));
  if (value.created_at_wall_time !== null && value.created_at_wall_time !== undefined && typeof value.created_at_wall_time !== 'string') {
    errors.push('created_at_wall_time must be a string or null');
  }
  return errors;
}

function validateStrokeEvent(value) {
  const errors = eventErrors(value);
  return { valid: errors.length === 0, errors };
}

function createStrokeEvent(input) {
  assertObject(input, 'StrokeEvent');
  const value = {
    event_id: input.event_id,
    rally_id: input.rally_id,
    sequence: input.sequence ?? null,
    player_id: input.player_id ?? null,
    shot_family: input.shot_family ?? SHOT_FAMILY_UNKNOWN,
    label: input.label ?? null,
    hit_media_time: input.hit_media_time ?? null,
    source: input.source ?? 'unknown',
    classification_confidence: createConfidence(input.classification_confidence),
    geometry_confidence: createConfidence(input.geometry_confidence),
    tracking_confidence: input.tracking_confidence === undefined ? null : createConfidence(input.tracking_confidence),
    status: input.status ?? 'unknown',
    created_at_wall_time: input.created_at_wall_time ?? null,
    correction_provenance: normalizeProvenanceList(input.correction_provenance),
  };
  for (const field of ['evidence', 'player_evidence', 'shuttle_evidence', 'shot_evidence', 'landing_evidence']) {
    if (Object.prototype.hasOwnProperty.call(input, field)) value[field] = deepClone(input[field]);
  }
  const errors = eventErrors(value);
  if (errors.length) throw new SchemaValidationError('StrokeEvent', errors);
  return finishRecord(value);
}

function correctStrokeEvent(event, patch, provenance = {}) {
  const original = createStrokeEvent(event);
  assertObject(patch, 'StrokeEvent correction');
  if (Object.prototype.hasOwnProperty.call(patch, 'event_id') && patch.event_id !== original.event_id) {
    throw new AnalysisError('a correction must preserve event_id', 'correction-id-change');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'correction_provenance')) {
    throw new AnalysisError('correction provenance is appended automatically', 'correction-provenance-overwrite');
  }
  const unknownFields = Object.keys(patch).filter((field) => !STROKE_EVENT_FIELDS.includes(field));
  if (unknownFields.length) throw new AnalysisError(`unknown correction field(s): ${unknownFields.join(', ')}`, 'unknown-correction-field');
  const changedFields = Object.keys(patch).filter((field) => field !== 'source' && field !== 'status');
  const entry = createCorrectionProvenance({
    source: provenance.source ?? 'manual',
    reason: provenance.reason,
    corrected_at_media_time: provenance.corrected_at_media_time ?? null,
    changed_fields: changedFields,
  });
  return createStrokeEvent({
    ...original,
    ...deepClone(patch),
    event_id: original.event_id,
    source: 'corrected',
    status: 'corrected',
    correction_provenance: [...original.correction_provenance, entry],
  });
}

function replaceCorrectedStrokeEvent(events, eventId, patch, provenance = {}) {
  if (!Array.isArray(events)) throw new SchemaValidationError('StrokeEventCollection', ['events must be an array']);
  const normalized = events.map((event) => createStrokeEvent(event));
  const matching = normalized.filter((event) => event.event_id === eventId);
  if (matching.length === 0) throw new AnalysisError(`event ${eventId} was not found`, 'event-not-found');
  if (matching.length > 1) throw new AnalysisError(`event ${eventId} occurs more than once`, 'duplicate-event-id');
  return finishRecord(normalized.map((event) => event.event_id === eventId ? correctStrokeEvent(event, patch, provenance) : event));
}

function inferScoreState(score) {
  if (!isRecord(score)) return 'unknown';
  const left = score.player_a ?? score.a ?? score.home;
  const right = score.player_b ?? score.b ?? score.away;
  if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right < 0) return 'unknown';
  return Math.abs(left - right) <= 2 && Math.max(left, right) >= 18 ? 'tight' : 'ordinary';
}

function inferGamePoint(score) {
  if (!isRecord(score)) return null;
  if (typeof score.game_point === 'boolean') return score.game_point;
  const left = score.player_a ?? score.a ?? score.home;
  const right = score.player_b ?? score.b ?? score.away;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.max(left, right) >= 20 && Math.abs(left - right) <= 1;
}

function normalizeScoreContext(value) {
  if (value === undefined || value === null) {
    return finishRecord({ state: 'unknown', game_point: null, source: 'unknown', score: null });
  }
  assertObject(value, 'ScoreContext');
  const score = value.score === undefined ? null : deepClone(value.score);
  const candidate = {
    state: value.state ?? inferScoreState(score),
    game_point: value.game_point ?? inferGamePoint(score),
    source: value.source ?? 'unknown',
    score,
  };
  const errors = [];
  validateEnum(candidate.state, 'score_context.state', ['tight', 'ordinary', 'unknown'], errors);
  validateEnum(candidate.source, 'score_context.source', ['ocr', 'manual', 'unknown'], errors);
  if (candidate.game_point !== null && typeof candidate.game_point !== 'boolean') errors.push('score_context.game_point must be boolean or null');
  if (errors.length) throw new SchemaValidationError('ScoreContext', errors);
  return finishRecord(candidate);
}

function outcomeErrors(value, name = 'winner_state') {
  const errors = [];
  if (!isRecord(value)) return [`${name} must be an object`];
  validateEnum(value.label, `${name}.label`, OUTCOME_LABELS, errors);
  if (value.label !== 'unclassified' && (typeof value.player_id !== 'string' || value.player_id.trim() === '')) {
    errors.push(`${name}.player_id is required for a classified outcome`);
  }
  if (value.label === 'unclassified' && value.player_id !== null) errors.push(`${name}.player_id must be null when unclassified`);
  errors.push(...confidenceErrors(value.confidence, `${name}.confidence`));
  validateEnum(value.source, `${name}.source`, EVENT_SOURCES, errors);
  validateEnum(value.status, `${name}.status`, EVENT_STATUSES, errors);
  if (!Array.isArray(value.evidence)) errors.push(`${name}.evidence must be an array`);
  if (!Array.isArray(value.correction_provenance)) errors.push(`${name}.correction_provenance must be an array`);
  else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `${name}.correction_provenance[${index}]`)));
  return errors;
}

function validateWinnerState(value) {
  const errors = outcomeErrors(value);
  return { valid: errors.length === 0, errors };
}

function createWinnerState(input = {}) {
  assertObject(input, 'WinnerState');
  const value = {
    label: input.label ?? 'unclassified',
    player_id: input.player_id ?? null,
    confidence: createConfidence(input.confidence),
    source: input.source ?? 'auto',
    status: input.status ?? 'unclassified',
    evidence: input.evidence === undefined ? [] : deepClone(input.evidence),
    correction_provenance: normalizeProvenanceList(input.correction_provenance),
  };
  const errors = outcomeErrors(value);
  if (errors.length) throw new SchemaValidationError('WinnerState', errors);
  return finishRecord(value);
}

function rallyErrors(value) {
  const errors = [];
  if (!isRecord(value)) return ['value must be an object'];
  if (typeof value.rally_id !== 'string' || value.rally_id.trim() === '') errors.push('rally_id must be a non-empty string');
  if (value.start_media_time !== null && (typeof value.start_media_time !== 'number' || !Number.isFinite(value.start_media_time) || value.start_media_time < 0)) {
    errors.push('start_media_time must be a non-negative finite number or null');
  }
  if (value.end_media_time !== null && (typeof value.end_media_time !== 'number' || !Number.isFinite(value.end_media_time) ||
      (value.start_media_time !== null && value.end_media_time < value.start_media_time))) {
    errors.push('end_media_time must be null or a finite number no earlier than start_media_time');
  }
  validateEnum(value.status, 'status', RALLY_STATUSES, errors);
  if (value.status === 'completed' && value.end_media_time === null) errors.push('completed rallies require end_media_time');
  if (!Array.isArray(value.stroke_event_ids) || value.stroke_event_ids.some((id) => typeof id !== 'string')) errors.push('stroke_event_ids must be an array of strings');
  if (new Set(value.stroke_event_ids || []).size !== (value.stroke_event_ids || []).length) errors.push('stroke_event_ids must not contain duplicates');
  if (!Number.isInteger(value.shot_count) || value.shot_count < 0) errors.push('shot_count must be a non-negative integer');
  if (!Array.isArray(value.coarse_shot_families)) errors.push('coarse_shot_families must be an array');
  else value.coarse_shot_families.forEach((family) => validateEnum(family, 'coarse_shot_families item', COARSE_SHOT_FAMILIES, errors));
  errors.push(...outcomeErrors(value.winner_state));
  if (value.winner !== null && (typeof value.winner !== 'string' || value.winner.trim() === '')) errors.push('winner must be a non-empty string or null');
  if (isRecord(value.winner_state) && value.winner !== value.winner_state.player_id) errors.push('winner must mirror winner_state.player_id');
  if (value.lose_reason !== null && !OUTCOME_LABELS.includes(value.lose_reason)) errors.push('lose_reason must be a valid outcome label or null');
  if (!isRecord(value.score_context)) errors.push('score_context must be an object');
  if (value.highlight_index !== null && (typeof value.highlight_index !== 'number' || !Number.isFinite(value.highlight_index) || value.highlight_index < 0 || value.highlight_index > 100)) {
    errors.push('highlight_index must be null or a number in [0, 100]');
  }
  errors.push(...confidenceErrors(value.aggregate_confidence, 'aggregate_confidence'));
  validateEnum(value.source, 'source', EVENT_SOURCES, errors);
  if (!Array.isArray(value.correction_provenance)) errors.push('correction_provenance must be an array');
  else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `correction_provenance[${index}]`)));
  if (value.evidence_state !== undefined) validateEnum(value.evidence_state, 'evidence_state', EVIDENCE_STATES, errors);
  if (value.partial_reasons !== undefined && (!Array.isArray(value.partial_reasons) || value.partial_reasons.some((reason) => typeof reason !== 'string'))) {
    errors.push('partial_reasons must be an array of strings');
  }
  if (value.termination !== undefined) validateEnum(value.termination, 'termination', RALLY_TERMINATIONS, errors);
  if (value.boundary_media_time !== undefined && value.boundary_media_time !== null &&
      (typeof value.boundary_media_time !== 'number' || !Number.isFinite(value.boundary_media_time) || value.boundary_media_time < 0)) {
    errors.push('boundary_media_time must be a non-negative finite number or null');
  }
  if (value.camera_cut_id !== undefined && value.camera_cut_id !== null && typeof value.camera_cut_id !== 'string') {
    errors.push('camera_cut_id must be a string or null');
  }
  if (value.line_calls !== undefined) {
    if (!Array.isArray(value.line_calls)) errors.push('line_calls must be an array of objects');
    else value.line_calls.forEach((call, index) => errors.push(...lineCallErrors(call).map((error) => `line_calls[${index}].${error}`)));
  }
  return errors;
}

function validateRallyRecord(value) {
  const errors = rallyErrors(value);
  return { valid: errors.length === 0, errors };
}

function createRallyRecord(input) {
  assertObject(input, 'RallyRecord');
  const value = {
    rally_id: input.rally_id,
    start_media_time: input.start_media_time ?? null,
    end_media_time: input.end_media_time ?? null,
    status: input.status ?? 'in_progress',
    stroke_event_ids: input.stroke_event_ids === undefined ? [] : [...input.stroke_event_ids],
    shot_count: input.shot_count ?? (input.stroke_event_ids ? input.stroke_event_ids.length : 0),
    coarse_shot_families: input.coarse_shot_families === undefined ? [] : [...new Set(input.coarse_shot_families)],
    winner_state: createWinnerState(input.winner_state ?? {}),
    winner: input.winner ?? (input.winner_state?.player_id ?? null),
    lose_reason: input.lose_reason ?? ((input.winner_state?.label === 'forced_error' || input.winner_state?.label === 'unforced_error') ? input.winner_state.label : null),
    score_context: normalizeScoreContext(input.score_context),
    highlight_index: input.highlight_index ?? null,
    aggregate_confidence: createConfidence(input.aggregate_confidence),
    source: input.source ?? 'auto',
    correction_provenance: normalizeProvenanceList(input.correction_provenance),
  };
  for (const field of RALLY_OPTIONAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    value[field] = field === 'line_calls' && Array.isArray(input[field])
      ? input[field].map((call) => createLineCallState(call))
      : deepClone(input[field]);
  }
  const errors = rallyErrors(value);
  if (errors.length) throw new SchemaValidationError('RallyRecord', errors);
  return finishRecord(value);
}

function lineCallErrors(value) {
  const errors = [];
  if (!isRecord(value)) return ['value must be an object'];
  validateEnum(value.state, 'state', LINE_CALL_LABELS, errors);
  if (value.state !== 'unknown' && value.relevant_line_id !== null && value.relevant_line_id !== undefined && typeof value.relevant_line_id !== 'string') {
    errors.push('relevant_line_id must be a string or null');
  }
  if (value.landing_point !== null && value.landing_point !== undefined) {
    try {
      pointXY(value.landing_point, 'landing_point');
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (value.distance_to_line_m !== null && (typeof value.distance_to_line_m !== 'number' || !Number.isFinite(value.distance_to_line_m) || value.distance_to_line_m < 0)) {
    errors.push('distance_to_line_m must be null or a non-negative finite number');
  }
  if (value.timestamp_media_time !== null && (typeof value.timestamp_media_time !== 'number' || !Number.isFinite(value.timestamp_media_time) || value.timestamp_media_time < 0)) {
    errors.push('timestamp_media_time must be a non-negative finite number or null');
  }
  errors.push(...confidenceErrors(value.confidence, 'confidence'));
  validateEnum(value.source, 'source', EVENT_SOURCES, errors);
  validateEnum(value.status, 'status', EVENT_STATUSES, errors);
  if (!Array.isArray(value.evidence)) errors.push('evidence must be an array');
  if (!Array.isArray(value.correction_provenance)) errors.push('correction_provenance must be an array');
  else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `correction_provenance[${index}]`)));
  return errors;
}

function validateLineCallState(value) {
  const errors = lineCallErrors(value);
  return { valid: errors.length === 0, errors };
}

function createLineCallState(input = {}) {
  assertObject(input, 'LineCallState');
  const value = {
    state: input.state ?? 'unknown',
    relevant_line_id: input.relevant_line_id ?? null,
    landing_point: input.landing_point === undefined || input.landing_point === null
      ? null
      : (() => {
        const point = pointXY(input.landing_point, 'landing_point');
        return createNormalizedPoint(point.x, point.y, { allowOutside: true });
      })(),
    distance_to_line_m: input.distance_to_line_m ?? null,
    timestamp_media_time: input.timestamp_media_time ?? null,
    confidence: createConfidence(input.confidence),
    source: input.source ?? 'unknown',
    status: input.status ?? (input.state === 'unknown' || input.state === undefined ? 'unknown' : 'suggested'),
    evidence: input.evidence === undefined ? [] : deepClone(input.evidence),
    correction_provenance: normalizeProvenanceList(input.correction_provenance),
  };
  const errors = lineCallErrors(value);
  if (errors.length) throw new SchemaValidationError('LineCallState', errors);
  return finishRecord(value);
}

function classifyOutcomeFromWinnerState(winnerState) {
  return winnerState && OUTCOME_LABELS.includes(winnerState.label) ? winnerState.label : 'unclassified';
}

function normalizeFeatureNumber(value, name, { min = 0, max = Infinity } = {}) {
  if (value === undefined || value === null) return null;
  assertFiniteNumber(value, name, { min, max });
  return value;
}

function createCoarseShotFeatures(input = {}) {
  assertObject(input, 'CoarseShotFeatures');
  let flightDistance = input.flight_distance_m;
  let landingDepth = input.landing_depth_m;
  if ((flightDistance === undefined || landingDepth === undefined) && input.impact_point && input.landing_point) {
    const impact = normalizeCourtPoint(input.impact_point, { allowOutside: true });
    const landing = normalizeCourtPoint(input.landing_point, { allowOutside: true });
    flightDistance = Math.hypot(
      (landing.x - impact.x) * COURT_WIDTH_M,
      (landing.y - impact.y) * COURT_LENGTH_M,
    );
    // Depth is measured from the net on the receiver's half, independent of
    // which half is represented by y <= 0.5 or y >= 0.5.
    landingDepth = (landing.y <= 0.5 ? 0.5 - landing.y : landing.y - 0.5) * COURT_LENGTH_M;
  }
  const value = {
    flight_distance_m: normalizeFeatureNumber(flightDistance, 'flight_distance_m'),
    landing_depth_m: normalizeFeatureNumber(landingDepth, 'landing_depth_m', { max: COURT_LENGTH_M / 2 }),
    apex_height_m: normalizeFeatureNumber(input.apex_height_m, 'apex_height_m'),
    impact_height_m: normalizeFeatureNumber(input.impact_height_m, 'impact_height_m'),
    downward_speed_mps: normalizeFeatureNumber(input.downward_speed_mps, 'downward_speed_mps'),
    flight_time_s: normalizeFeatureNumber(input.flight_time_s, 'flight_time_s'),
  };
  value.missing = Object.keys(value).filter((key) => key !== 'missing' && value[key] === null);
  return finishRecord(value);
}

const COARSE_RULE_THRESHOLDS = finishRecord({
  net: { max_landing_depth_m: 1.5, max_flight_distance_m: 3.5 },
  smash: { min_impact_height_m: 1.5, min_downward_speed_mps: 5, min_flight_distance_m: 2 },
  clear: { min_landing_depth_m: 4.8, min_apex_height_m: 2 },
  drop: { min_landing_depth_m: 1.5, max_landing_depth_m: 4.8, max_apex_height_m: 2.5 },
});

/**
 * Classify only from supplied coarse features. This is a rule seam, not a
 * detector or model: insufficient features intentionally produce unknown.
 */
function classifyCoarseShot(input) {
  const features = input && input.missing ? input : createCoarseShotFeatures(input);
  const net = COARSE_RULE_THRESHOLDS.net;
  if (
    features.landing_depth_m !== null && features.flight_distance_m !== null &&
    features.landing_depth_m <= net.max_landing_depth_m && features.flight_distance_m <= net.max_flight_distance_m
  ) {
    return finishRecord({
      shot_family: 'net',
      status: 'classified',
      confidence: createConfidence(0.75),
      rule: 'net: landing depth <= 1.5m and flight distance <= 3.5m',
      features_used: ['landing_depth_m', 'flight_distance_m'],
      explanation: 'Near-net landing and short travel matched the net rule.',
    });
  }
  const smash = COARSE_RULE_THRESHOLDS.smash;
  if (
    features.impact_height_m !== null && features.downward_speed_mps !== null && features.flight_distance_m !== null &&
    features.impact_height_m >= smash.min_impact_height_m &&
    features.downward_speed_mps >= smash.min_downward_speed_mps &&
    features.flight_distance_m >= smash.min_flight_distance_m
  ) {
    return finishRecord({
      shot_family: 'smash',
      status: 'classified',
      confidence: createConfidence(0.8),
      rule: 'smash: impact height >= 1.5m, downward speed >= 5m/s, flight distance >= 2m',
      features_used: ['impact_height_m', 'downward_speed_mps', 'flight_distance_m'],
      explanation: 'High impact, fast downward travel, and sufficient travel matched the smash rule.',
    });
  }
  const clear = COARSE_RULE_THRESHOLDS.clear;
  if (
    features.landing_depth_m !== null && features.apex_height_m !== null &&
    features.landing_depth_m >= clear.min_landing_depth_m && features.apex_height_m >= clear.min_apex_height_m
  ) {
    return finishRecord({
      shot_family: 'clear',
      status: 'classified',
      confidence: createConfidence(0.75),
      rule: 'clear: landing depth >= 4.8m and apex height >= 2m',
      features_used: ['landing_depth_m', 'apex_height_m'],
      explanation: 'Deep landing and high trajectory matched the clear rule.',
    });
  }
  const drop = COARSE_RULE_THRESHOLDS.drop;
  if (
    features.landing_depth_m !== null && features.apex_height_m !== null &&
    features.landing_depth_m > drop.min_landing_depth_m && features.landing_depth_m < drop.max_landing_depth_m &&
    features.apex_height_m <= drop.max_apex_height_m
  ) {
    return finishRecord({
      shot_family: 'drop',
      status: 'classified',
      confidence: createConfidence(0.65),
      rule: 'drop: landing depth in (1.5m, 4.8m) and apex height <= 2.5m',
      features_used: ['landing_depth_m', 'apex_height_m'],
      explanation: 'Intermediate landing depth and low trajectory matched the drop rule.',
    });
  }
  const missing = ['landing_depth_m', 'flight_distance_m', 'apex_height_m', 'impact_height_m', 'downward_speed_mps']
    .filter((field) => features[field] === null);
  return finishRecord({
    shot_family: SHOT_FAMILY_UNKNOWN,
    status: 'unclassified',
    confidence: createConfidence(null, { reason: missing.length ? 'insufficient-features' : 'no-rule-match' }),
    rule: null,
    features_used: Object.keys(features).filter((field) => field !== 'missing' && features[field] !== null),
    explanation: missing.length ? `Unclassified because required features are missing: ${missing.join(', ')}.` : 'No coarse rule matched.',
  });
}

function canonicalOutcomeLabel(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, '_');
  if (normalized === 'forcederror') return 'forced_error';
  if (normalized === 'unforcederror') return 'unforced_error';
  return OUTCOME_LABELS.includes(normalized) ? normalized : null;
}

function canonicalEvidenceStatus(value, fallback = 'unknown') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, '_');
  if (normalized === 'unknown' || normalized === 'unclassified') return 'unknown';
  if (['accepted', 'suggested', 'corrected', 'partial'].includes(normalized)) return normalized;
  return fallback;
}

function canonicalEventStatus(value, fallback = 'unknown') {
  const status = canonicalEvidenceStatus(value, fallback);
  return status === 'unknown' ? (value === 'unclassified' ? 'unclassified' : 'unknown') : status;
}

function mediaTimeOf(value) {
  if (!isRecord(value)) return null;
  const candidate = value.hit_media_time ?? value.media_time ?? value.timestamp_media_time ?? value.start_media_time ?? value.end_media_time ?? value.timestamp ?? value.time;
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
}

function stableIdentifier(value) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function explicitPlayerId(value) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (!isRecord(value)) return null;
  const candidate = value.player_id ?? value.id;
  return stableIdentifier(candidate);
}

function coarseFamilyFromValue(value) {
  if (typeof value !== 'string') return SHOT_FAMILY_UNKNOWN;
  const normalized = value.trim().toLowerCase().replace(/[ _-]+/g, '');
  if (normalized === 'clear') return 'clear';
  if (normalized === 'drop') return 'drop';
  if (normalized === 'smash' || normalized === 'halfsmash') return 'smash';
  if (normalized === 'net' || normalized === 'netshot' || normalized === 'netkill') return 'net';
  return SHOT_FAMILY_UNKNOWN;
}

function evidenceStatusForChannel(channel) {
  if (!isRecord(channel)) return 'unknown';
  return canonicalEvidenceStatus(channel.status ?? channel.state, 'unknown');
}

function knownPlayerId(value) {
  const playerId = explicitPlayerId(value);
  return playerId && playerId.toLowerCase() !== 'unknown' ? playerId : null;
}

function normalizeOutcomeEvidence(input = {}) {
  if (!isRecord(input)) return null;
  const candidate = input.winner_state ?? input.outcome_state ?? input.outcome_evidence;
  if (!isRecord(candidate)) return null;
  const label = canonicalOutcomeLabel(candidate.label ?? candidate.outcome);
  if (!label) return null;
  return candidate;
}

function normalizeLineCallEvidence(input, fallbackTime = null, fallbackStatus = 'unknown') {
  if (input === undefined || input === null) return createLineCallState({ timestamp_media_time: fallbackTime });
  const raw = typeof input === 'string' ? { state: input } : (isRecord(input) ? input : {});
  const landingPoint = raw.landing_point ?? raw.point ?? (
    Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null
  );
  const state = String(raw.state ?? raw.call ?? raw.line_call ?? 'unknown').toLowerCase();
  const allowedState = LINE_CALL_LABELS.includes(state) ? state : 'unknown';
  return createLineCallState({
    state: allowedState,
    relevant_line_id: raw.relevant_line_id ?? raw.line_id ?? null,
    landing_point: landingPoint,
    distance_to_line_m: raw.distance_to_line_m ?? raw.distance_m ?? null,
    timestamp_media_time: raw.timestamp_media_time ?? raw.media_time ?? fallbackTime,
    confidence: raw.confidence,
    source: raw.source ?? 'unknown',
    status: raw.status ?? (EVIDENCE_STATES.includes(state) ? state : (allowedState === 'unknown' ? fallbackStatus : 'suggested')),
    evidence: raw.evidence === undefined ? [deepClone(input)] : deepClone(raw.evidence),
    correction_provenance: raw.correction_provenance,
  });
}

function eventConfidence(event) {
  if (!event) return null;
  return event.tracking_confidence || event.geometry_confidence || event.classification_confidence || null;
}

function attributionInputEvents(input) {
  const values = input?.events ?? input?.stroke_events ?? input?.strokeEvents ?? [];
  if (!Array.isArray(values)) return [];
  return values.map((event) => createStrokeEvent(event));
}

function acceptedEvidenceStatus(status) {
  return status === 'accepted' || status === 'corrected';
}

/**
 * Attribute only what the supplied terminal evidence can establish. In
 * particular, an OUT call identifies a losing hitter, but does not by itself
 * establish forced versus unforced error. A suggested/partial/unknown call is
 * never promoted to an official-looking outcome.
 */
function attributeRallyOutcome(input = {}) {
  assertObject(input, 'RallyOutcomeInput');
  const events = attributionInputEvents(input)
    .filter((event) => acceptedEvidenceStatus(event.status))
    .sort((left, right) => (left.hit_media_time ?? Infinity) - (right.hit_media_time ?? Infinity) ||
      (left.sequence ?? Infinity) - (right.sequence ?? Infinity) || left.event_id.localeCompare(right.event_id));
  const finalEvent = input.final_event ? createStrokeEvent(input.final_event) : events[events.length - 1] || null;
  const finalEventIsAccepted = Boolean(finalEvent && acceptedEvidenceStatus(finalEvent.status));
  const rawLanding = input.landing_call ?? input.line_call ?? input.landing ?? input.final_landing ??
    finalEvent?.landing_evidence ?? null;
  let landing;
  try {
    landing = normalizeLineCallEvidence(rawLanding, mediaTimeOf(finalEvent), input.landing_status ?? input.status ?? finalEvent?.status ?? 'unknown');
  } catch (error) {
    landing = createLineCallState({ timestamp_media_time: mediaTimeOf(finalEvent), evidence: [{ kind: 'invalid-landing-evidence', message: error.message }] });
  }
  const termination = isRecord(input.termination) ? input.termination : { outcome: input.termination };
  const explicit = normalizeOutcomeEvidence(input) || termination;
  const explicitLabel = canonicalOutcomeLabel(
    input.outcome ?? input.label ?? explicit?.label ?? explicit?.outcome ?? explicit?.lose_reason,
  );
  const explicitWinner = knownPlayerId(
    input.winner_player_id ?? input.winner_id ?? explicit?.winner_player_id ?? explicit?.player_id,
  );
  const explicitUnknown = explicitLabel === 'unclassified' && (
    Object.prototype.hasOwnProperty.call(input, 'outcome') ||
    Object.prototype.hasOwnProperty.call(input, 'label') ||
    Object.prototype.hasOwnProperty.call(input, 'winner_state') ||
    Object.prototype.hasOwnProperty.call(input, 'outcome_state') ||
    Object.prototype.hasOwnProperty.call(input, 'outcome_evidence') ||
    (isRecord(input.termination) && Object.prototype.hasOwnProperty.call(input.termination, 'outcome'))
  );
  const finalPlayer = knownPlayerId(finalEvent?.player_id ?? input.final_player_id);
  const participants = [...new Set([
    ...events.map((event) => knownPlayerId(event.player_id)).filter(Boolean),
    ...((Array.isArray(input.players) ? input.players : []).map(knownPlayerId).filter(Boolean)),
    knownPlayerId(input.opponent_player_id),
    finalPlayer,
  ].filter(Boolean))];
  const landingAuthoritative = acceptedEvidenceStatus(landing.status) && (landing.state === 'in' || landing.state === 'out');
  const explicitSource = explicit?.source ?? input.source ?? 'unknown';
  const explicitStatus = canonicalEventStatus(explicit?.status ?? input.status,
    explicitSource === 'manual' || explicitSource === 'corrected' ? 'accepted' : 'unknown');
  const explicitIsTrusted = !['partial', 'unknown', 'unclassified'].includes(explicitStatus) &&
    (explicitSource === 'manual' || explicitSource === 'corrected' || acceptedEvidenceStatus(explicitStatus));
  const landingEvidenceError = Array.isArray(rawLanding?.evidence)
    ? rawLanding.evidence.map((entry) => (isRecord(entry) ? entry.error_type : null)).find(Boolean)
    : null;
  const errorType = canonicalOutcomeLabel(input.error_type ?? input.error ?? termination.error_type ?? rawLanding?.error_type ?? landingEvidenceError ?? finalEvent?.landing_evidence?.error_type) ??
    (explicitLabel === 'forced_error' || explicitLabel === 'unforced_error' ? explicitLabel : null);
  const rallyEnded = input.completed === true || input.rally_ended === true ||
    input.type === 'rally_end' || input.event_type === 'rally_end' || input.termination === 'rally_end' ||
    (isRecord(termination) && (termination.type === 'rally_end' || termination.kind === 'rally_end'));
  const evidence = [];
  if (finalEvent) evidence.push({ kind: 'final-stroke', event_id: finalEvent.event_id, player_id: finalEvent.player_id, status: finalEvent.status });
  evidence.push({ kind: 'landing', state: landing.state, status: landing.status, relevant_line_id: landing.relevant_line_id });
  if (landing.correction_provenance.length) evidence.push({ kind: 'landing-correction-provenance', provenance: deepClone(landing.correction_provenance) });
  if (isRecord(input.termination) || input.termination !== undefined) evidence.push({ kind: 'termination', value: deepClone(input.termination) });
  if (Array.isArray(explicit?.evidence)) evidence.push(...deepClone(explicit.evidence));
  if (Array.isArray(input.evidence)) evidence.push(...deepClone(input.evidence));

  let label = 'unclassified';
  let winnerPlayer = null;
  let reason = 'outcome-uncertain';
  let confidence = input.confidence;
  let source = explicitSource;
  let status = explicitStatus;

  // An explicitly accepted/manual outcome is evidence in its own right. It is
  // still required to identify the winning player; null is never a placeholder.
  const explicitCanClassify = explicitLabel && explicitWinner && explicitIsTrusted &&
    (landingAuthoritative || explicitSource === 'manual' || explicitSource === 'corrected');
  if (explicitCanClassify) {
    label = explicitLabel;
    winnerPlayer = explicitWinner;
    reason = 'explicit-terminal-outcome';
  } else if (!explicitUnknown && landingAuthoritative && landing.state === 'out' && finalPlayer && finalEventIsAccepted) {
    // An OUT call establishes the opponent as winner only when the opponent is
    // unambiguous. The error class remains unknown unless explicitly supplied.
    const opponents = participants.filter((playerId) => playerId !== finalPlayer);
    if (opponents.length === 1) {
      winnerPlayer = opponents[0];
      label = errorType === 'forced_error' || errorType === 'unforced_error' ? errorType : 'unclassified';
      reason = label === 'unclassified' ? 'out-landing-without-error-class' : 'out-landing-and-explicit-error-class';
    } else {
      reason = 'out-landing-opponent-ambiguous';
    }
  } else if (!explicitUnknown && landingAuthoritative && landing.state === 'in' && finalPlayer && finalEventIsAccepted && rallyEnded) {
    label = 'winner';
    winnerPlayer = finalPlayer;
    reason = 'in-landing-and-rally-end';
  } else if (explicitLabel && !explicitIsTrusted) {
    reason = 'terminal-outcome-not-accepted';
  } else if (!landingAuthoritative) {
    reason = 'final-landing-unknown';
  } else if (!finalEventIsAccepted) {
    reason = 'final-stroke-not-accepted';
  } else if (!finalPlayer) {
    reason = 'final-player-unknown';
  }

  // WinnerState intentionally cannot carry a player for an unclassified label;
  // retain the losing/final evidence above instead of making a partial winner.
  if (label === 'unclassified') winnerPlayer = null;
  const knownConfidences = [landing.confidence, eventConfidence(finalEvent)].filter((value) => value && value.status === 'known');
  if (confidence === undefined && knownConfidences.length === 2) confidence = Math.min(...knownConfidences.map((value) => value.value));
  if (!source || !EVENT_SOURCES.includes(source)) source = 'unknown';
  if (label === 'unclassified' && !explicitLabel) status = 'unclassified';
  if (label !== 'unclassified' && (status === 'unknown' || status === 'unclassified')) status = 'suggested';
  if (!EVENT_STATUSES.includes(status)) status = label === 'unclassified' ? 'unclassified' : 'suggested';
  const winnerState = createWinnerState({
    label,
    player_id: winnerPlayer,
    confidence,
    source,
    status,
    evidence: [...evidence, { kind: 'attribution', reason, supported: label !== 'unclassified' }],
    correction_provenance: input.correction_provenance ?? explicit?.correction_provenance,
  });
  return finishRecord({
    winner_state: winnerState,
    winner: winnerState.player_id,
    lose_reason: label === 'forced_error' || label === 'unforced_error' ? label : null,
    landing,
    final_event: finalEvent,
    reason,
    evidence: winnerState.evidence,
  });
}

function normalizeStateMachineEvent(input, rallyId, sequence) {
  assertObject(input, 'Rally event');
  const playerEvidence = input.player_evidence ?? input.player ?? null;
  const shotEvidence = input.shot_evidence ?? input.shot ?? null;
  const shuttleEvidence = input.shuttle_evidence ?? input.shuttle ?? null;
  const landingEvidence = input.landing_evidence ?? input.landing ?? input.line_call ?? null;
  const channelStatuses = [playerEvidence, shuttleEvidence, shotEvidence, landingEvidence].map(evidenceStatusForChannel);
  const hasChannelEvidence = channelStatuses.some((status) => status !== 'unknown') ||
    playerEvidence !== null || shuttleEvidence !== null || shotEvidence !== null || landingEvidence !== null ||
    Object.prototype.hasOwnProperty.call(input, 'player_id') || Object.prototype.hasOwnProperty.call(input, 'shot_family');
  const derivedStatus = channelStatuses.includes('partial') ? 'partial' :
    channelStatuses.includes('corrected') ? 'corrected' :
      channelStatuses.includes('suggested') ? 'suggested' :
        channelStatuses.includes('accepted') ? 'accepted' : (hasChannelEvidence ? 'suggested' : 'unknown');
  const rawShot = isRecord(shotEvidence) ? (shotEvidence.family ?? shotEvidence.shot_family ?? shotEvidence.label) : shotEvidence;
  const shotFamily = input.shot_family === undefined ? coarseFamilyFromValue(rawShot) : coarseFamilyFromValue(input.shot_family);
  const label = input.label ?? (isRecord(shotEvidence) ? shotEvidence.label : (typeof shotEvidence === 'string' && !COARSE_SHOT_FAMILIES.includes(coarseFamilyFromValue(shotEvidence)) ? shotEvidence : null));
  const explicitPlayer = stableIdentifier(input.player_id);
  const playerId = Object.prototype.hasOwnProperty.call(input, 'player_id')
    ? (explicitPlayer && explicitPlayer.toLowerCase() !== 'unknown' ? explicitPlayer : null)
    : knownPlayerId(playerEvidence);
  const eventInput = {
    ...deepClone(input),
    event_id: stableIdentifier(input.event_id ?? input.observation_id) ?? `${rallyId}:event:${sequence + 1}`,
    rally_id: stableIdentifier(rallyId) ?? rallyId,
    sequence: input.sequence ?? sequence,
    player_id: playerId,
    shot_family: COARSE_SHOT_FAMILIES.includes(shotFamily) ? shotFamily : SHOT_FAMILY_UNKNOWN,
    label: label && MANUAL_SHOT_LABELS.includes(label) ? label : null,
    hit_media_time: input.hit_media_time ?? input.media_time ?? input.timestamp_media_time ?? null,
    source: input.source ?? 'unknown',
    status: input.status === undefined ? derivedStatus : canonicalEventStatus(input.status),
    classification_confidence: input.classification_confidence ?? (isRecord(shotEvidence) ? shotEvidence.confidence : null),
    geometry_confidence: input.geometry_confidence ?? (isRecord(landingEvidence) ? landingEvidence.confidence : null),
    tracking_confidence: input.tracking_confidence ?? (isRecord(playerEvidence) ? playerEvidence.confidence : null),
    evidence: input.evidence === undefined ? [] : input.evidence,
    player_evidence: playerEvidence,
    shuttle_evidence: shuttleEvidence,
    shot_evidence: shotEvidence,
    landing_evidence: landingEvidence,
  };
  return createStrokeEvent(eventInput);
}

function orderEvents(events) {
  return [...events].sort((left, right) => (left.hit_media_time === null ? Infinity : left.hit_media_time) -
    (right.hit_media_time === null ? Infinity : right.hit_media_time) ||
    (left.sequence === null ? Infinity : left.sequence) - (right.sequence === null ? Infinity : right.sequence) ||
    left.event_id.localeCompare(right.event_id));
}

function aggregateRallyConfidence(events) {
  const considered = events.filter((event) => acceptedEvidenceStatus(event.status));
  if (!considered.length) return createConfidence(null, { reason: 'no-accepted-stroke-evidence' });
  const values = considered.map(eventConfidence);
  if (values.some((value) => !value || value.status !== 'known')) return createConfidence(null, { reason: 'partial-stroke-confidence' });
  return createConfidence(stableNumber(values.reduce((sum, value) => sum + value.value, 0) / values.length));
}

function stateMachinePartialReasons(context, events, outcome, status) {
  const reasons = [];
  if (context.start_media_time === null) reasons.push('rally-start-time-unknown');
  if (status !== 'completed') reasons.push(context.termination === 'camera_cut' ? 'camera-cut' : 'rally-end-unknown');
  if (events.some((event) => event.player_id === null)) reasons.push('player-identity-unknown');
  if (events.some((event) => event.shot_family === SHOT_FAMILY_UNKNOWN || event.status === 'partial' || event.status === 'unknown' || event.status === 'unclassified')) reasons.push('partial-or-unknown-shot-evidence');
  if (events.some((event) => !acceptedEvidenceStatus(event.status))) reasons.push('unaccepted-stroke-evidence');
  const acceptedEvents = events.filter((event) => acceptedEvidenceStatus(event.status));
  if (!acceptedEvents.length) reasons.push('no-accepted-stroke-evidence');
  if (acceptedEvents.some((event) => {
    const confidence = eventConfidence(event);
    return !confidence || confidence.status !== 'known';
  })) reasons.push('partial-or-unknown-confidence');
  if (outcome.winner_state.label === 'unclassified') reasons.push(outcome.reason);
  return [...new Set(reasons)];
}

function createRallyStateMachine(options = {}) {
  assertObject(options, 'RallyStateMachineOptions');
  let rallyCounter = 0;
  let eventCounter = 0;
  let segmentCounter = 0;
  let active = null;
  let finalized = false;
  const contexts = [];
  const eventRecords = new Map();
  const duplicates = [];
  const cameraCuts = [];
  const unassignedEvidence = [];

  function nextRallyId(prefix = options.rally_id_prefix ?? 'rally') {
    rallyCounter += 1;
    return `${prefix}-${rallyCounter}`;
  }

  function uniqueRallyId(candidate) {
    const normalized = stableIdentifier(candidate);
    if (!normalized || !contexts.some((context) => context.rally_id === normalized)) return normalized || nextRallyId();
    segmentCounter += 1;
    return `${normalized}-segment-${segmentCounter}`;
  }

  function newContext(input = {}, forcedId = null) {
    const requestedId = stableIdentifier(forcedId || input.rally_id || input.id);
    const id = uniqueRallyId(requestedId);
    const start = mediaTimeOf(input);
    const context = {
      rally_id: id,
      source_rally_id: requestedId,
      start_media_time: start,
      end_media_time: null,
      status: 'in_progress',
      termination: 'unknown',
      boundary_media_time: null,
      camera_cut_id: null,
      event_ids: [],
      line_calls: [],
      evidence: [],
      score_context: input.score_context,
      outcome_input: null,
    };
    contexts.push(context);
    return context;
  }

  function eventForId(eventId) {
    return eventRecords.get(eventId) || null;
  }

  function currentEvents(context) {
    return orderEvents(context.event_ids.map(eventForId).filter(Boolean));
  }

  function ensureActive(input = {}, rallyId = null) {
    if (!active) active = newContext(input, rallyId);
    if (rallyId && active.rally_id !== rallyId && active.source_rally_id !== rallyId) {
      closeContext(active, { status: 'incomplete', termination: 'implicit', boundary_media_time: mediaTimeOf(input) });
      active = newContext(input, rallyId);
    }
    if (active.start_media_time === null && mediaTimeOf(input) !== null) active.start_media_time = mediaTimeOf(input);
    return active;
  }

  function addEvent(input) {
    const requestedRallyId = stableIdentifier(input.rally_id ?? input.rallyId);
    const playerEvidence = input.player_evidence ?? input.player ?? null;
    const shotEvidence = input.shot_evidence ?? input.shot ?? null;
    const requestedEventId = input.event_id ?? input.observation_id ?? null;
    const existingRequested = requestedEventId ? eventForId(requestedEventId) : null;
    const existingContext = existingRequested
      ? contexts.find((context) => context.event_ids.includes(existingRequested.event_id))
      : null;
    const context = existingContext || ensureActive(input, requestedRallyId);
    eventCounter += 1;
    const event = normalizeStateMachineEvent(input, context.rally_id, eventCounter - 1);
    const existing = eventForId(event.event_id);
    if (existing) {
      if (event.status === 'corrected' || event.source === 'corrected') {
        let replacement = event;
        const completeCorrection = ['rally_id', 'sequence', 'player_id', 'shot_family', 'hit_media_time',
          'classification_confidence', 'geometry_confidence', 'status'].every((field) => Object.prototype.hasOwnProperty.call(input, field));
        if (event.correction_provenance.length && completeCorrection) {
          const provenance = [...existing.correction_provenance];
          for (const entry of event.correction_provenance) {
            if (!provenance.some((candidate) => JSON.stringify(candidate) === JSON.stringify(entry))) provenance.push(entry);
          }
          replacement = createStrokeEvent({ ...event, correction_provenance: provenance });
        } else {
          const patch = {};
          for (const field of STROKE_EVENT_FIELDS) {
            if (['event_id', 'rally_id', 'source', 'status', 'correction_provenance'].includes(field)) continue;
            if (Object.prototype.hasOwnProperty.call(input, field)) patch[field] = event[field];
          }
          if (Object.prototype.hasOwnProperty.call(input, 'player_id') || playerEvidence !== null) patch.player_id = event.player_id;
          if (Object.prototype.hasOwnProperty.call(input, 'shot_family') || shotEvidence !== null) patch.shot_family = event.shot_family;
          if (Object.prototype.hasOwnProperty.call(input, 'hit_media_time') || Object.prototype.hasOwnProperty.call(input, 'media_time')) patch.hit_media_time = event.hit_media_time;
          if (Object.prototype.hasOwnProperty.call(input, 'landing_evidence') || Object.prototype.hasOwnProperty.call(input, 'landing')) patch.landing_evidence = event.landing_evidence;
          replacement = correctStrokeEvent(existing, patch, {
            reason: input.correction_reason ?? event.correction_provenance.at(-1)?.reason ?? 'rally event correction',
            corrected_at_media_time: mediaTimeOf(input) ?? event.correction_provenance.at(-1)?.corrected_at_media_time ?? null,
          });
          if (event.correction_provenance.length) {
            const provenance = [...replacement.correction_provenance];
            for (const entry of event.correction_provenance) {
              if (!provenance.some((candidate) => JSON.stringify(candidate) === JSON.stringify(entry))) provenance.push(entry);
            }
            replacement = createStrokeEvent({ ...replacement, correction_provenance: provenance });
          }
        }
        eventRecords.set(event.event_id, replacement);
        return replacement;
      }
      duplicates.push({ event_id: event.event_id, rally_id: context.rally_id, reason: 'duplicate-event-ignored' });
      return existing;
    }
    eventRecords.set(event.event_id, event);
    context.event_ids.push(event.event_id);
    context.evidence.push(...(Array.isArray(event.evidence) ? deepClone(event.evidence) : [deepClone(event.evidence)]));
    if (context.start_media_time === null && event.hit_media_time !== null) context.start_media_time = event.hit_media_time;
    if (event.landing_evidence) addLanding(event.landing_evidence, event.hit_media_time, context, event.status);
    return event;
  }

  function addLanding(input, fallbackTime = null, context = active, fallbackStatus = 'unknown') {
    if (!context) {
      unassignedEvidence.push(deepClone(input));
      return null;
    }
    let call;
    try {
      call = normalizeLineCallEvidence(input, fallbackTime, fallbackStatus);
    } catch (error) {
      call = createLineCallState({ timestamp_media_time: fallbackTime, evidence: [{ kind: 'invalid-landing-evidence', message: error.message }, deepClone(input)] });
    }
    context.line_calls.push(call);
    context.evidence.push(...(Array.isArray(call.evidence) ? deepClone(call.evidence) : [deepClone(call.evidence)]));
    return call;
  }

  function startRally(input = {}) {
    if (active) {
      const requestedId = stableIdentifier(input.rally_id ?? input.id);
      const same = requestedId && requestedId === active.rally_id;
      if (same && mediaTimeOf(input) === active.start_media_time) return active;
      closeContext(active, { status: 'incomplete', termination: 'implicit', boundary_media_time: mediaTimeOf(input) });
    }
    active = newContext(input);
    active.score_context = input.score_context;
    active.evidence.push(...(Array.isArray(input.evidence) ? deepClone(input.evidence) : []));
    return active;
  }

  function endRally(input = {}) {
    const context = ensureActive(input, stableIdentifier(input.rally_id ?? input.rallyId));
    context.end_media_time = mediaTimeOf(input);
    context.score_context = input.score_context ?? context.score_context;
    context.outcome_input = deepClone(input);
    context.termination = 'rally_end';
    context.evidence.push(...(Array.isArray(input.evidence) ? deepClone(input.evidence) : []));
    context.status = context.end_media_time === null ? 'incomplete' : 'completed';
    active = null;
    return context;
  }

  function cameraCut(input = {}) {
    const time = mediaTimeOf(input);
    cameraCuts.push(finishRecord({
      camera_cut_id: input.camera_cut_id ?? input.cut_id ?? `camera-cut-${cameraCuts.length + 1}`,
      media_time: time,
      evidence: input.evidence === undefined ? [] : deepClone(input.evidence),
    }));
    if (active) {
      active.termination = 'camera_cut';
      active.status = 'incomplete';
      active.boundary_media_time = time;
      active.camera_cut_id = cameraCuts[cameraCuts.length - 1].camera_cut_id;
      active.evidence.push({ kind: 'camera-cut', camera_cut_id: active.camera_cut_id, media_time: time });
      active = null;
    }
    return cameraCuts[cameraCuts.length - 1];
  }

  function closeContext(context, patch = {}) {
    if (!context) return;
    context.status = patch.status ?? context.status;
    context.termination = patch.termination ?? context.termination;
    if (patch.boundary_media_time !== undefined) context.boundary_media_time = patch.boundary_media_time;
    if (patch.end_media_time !== undefined) context.end_media_time = patch.end_media_time;
    if (context.status === 'completed' && context.end_media_time === null) context.status = 'incomplete';
    if (active === context) active = null;
  }

  function recordForContext(context) {
    const events = currentEvents(context);
    const calls = [...context.line_calls].sort((left, right) => (left.timestamp_media_time ?? Infinity) - (right.timestamp_media_time ?? Infinity));
    const attributed = attributeRallyOutcome({
      events,
      landing_call: calls[calls.length - 1] ?? null,
      ...(context.outcome_input || {}),
      events,
    });
    const acceptedFamilies = [...new Set(events.filter((event) => acceptedEvidenceStatus(event.status)).map((event) => event.shot_family).filter((family) => COARSE_SHOT_FAMILIES.includes(family)))];
    const partialReasons = stateMachinePartialReasons(context, events, attributed, context.status);
    const evidenceState = context.status !== 'completed' || partialReasons.length ? 'partial' : 'accepted';
    return createRallyRecord({
      rally_id: context.rally_id,
      start_media_time: context.start_media_time,
      end_media_time: context.end_media_time,
      status: context.status,
      stroke_event_ids: events.map((event) => event.event_id),
      shot_count: events.length,
      coarse_shot_families: acceptedFamilies,
      winner_state: attributed.winner_state,
      winner: attributed.winner,
      lose_reason: attributed.lose_reason,
      score_context: context.score_context,
      aggregate_confidence: aggregateRallyConfidence(events),
      source: 'auto',
      evidence_state: evidenceState,
      partial_reasons: partialReasons,
      termination: context.termination,
      boundary_media_time: context.boundary_media_time,
      camera_cut_id: context.camera_cut_id,
      line_calls: calls,
      evidence: context.evidence,
    });
  }

  function snapshot() {
    const allContexts = contexts.map(recordForContext);
    return finishRecord({
      state: active ? 'in_progress' : (finalized ? 'finalized' : 'ready'),
      active_rally_id: active?.rally_id ?? null,
      rallies: allContexts,
      stroke_events: orderEvents([...eventRecords.values()]),
      events: orderEvents([...eventRecords.values()]),
      duplicates: deepClone(duplicates),
      camera_cuts: deepClone(cameraCuts),
      unassigned_evidence: deepClone(unassignedEvidence),
    });
  }

  function ingest(input) {
    if (finalized) throw new AnalysisError('rally state machine is finalized', 'state-machine-finalized');
    if (Array.isArray(input)) {
      for (const item of input) ingest(item);
      return snapshot();
    }
    assertObject(input, 'Rally observation');
    const type = String(input.type ?? input.event_type ?? input.kind ?? (input.event_id || input.observation_id ? 'shot' : '')).toLowerCase().replace(/[- ]/g, '_');
    if (['camera_cut', 'cut', 'camera_change'].includes(type)) cameraCut(input);
    else if (['rally_start', 'start', 'rallystart'].includes(type)) startRally(input);
    else if (['rally_end', 'end', 'rallyend'].includes(type)) endRally(input);
    else if (['landing', 'line_call', 'linecall'].includes(type)) addLanding(input.line_call ?? input.landing ?? input, mediaTimeOf(input));
    else addEvent(input);
    return snapshot();
  }

  function finalize() {
    if (!finalized) {
      if (active) {
        active.status = 'incomplete';
        active.termination = active.termination === 'unknown' ? 'unknown' : active.termination;
        active = null;
      }
      finalized = true;
    }
    return snapshot();
  }

  return Object.freeze({
    ingest,
    consume: ingest,
    push: ingest,
    process: ingest,
    processRallyEvent: ingest,
    addEvent: ingest,
    addShot(input) { return ingest({ type: 'shot', ...input }); },
    addLanding(input) { return ingest({ type: 'landing', ...input }); },
    startRally(input) { startRally(input); return snapshot(); },
    endRally(input) { endRally(input); return snapshot(); },
    closeRally(input) { endRally(input); return snapshot(); },
    cameraCut(input) { const cut = cameraCut(input); return finishRecord({ ...cut }); },
    finalize,
    snapshot,
    getState: snapshot,
  });
}

function analyzeRallyEvents(observations, options = {}) {
  const machine = createRallyStateMachine(options);
  const batch = Array.isArray(observations)
    ? observations
    : (observations?.observations ?? observations?.events ?? observations?.stroke_events ?? observations);
  machine.ingest(batch || []);
  return machine.finalize();
}

const analyzeRally = analyzeRallyEvents;
const analyzeRallies = analyzeRallyEvents;
const processRallyEvents = analyzeRallyEvents;
const buildRallyAnalysis = analyzeRallyEvents;
const buildRallyTimeline = analyzeRallyEvents;
const createRallyAnalyzer = createRallyStateMachine;

function normalizeRallyForHighlight(rally) {
  return rally && rally.rally_id ? createRallyRecord(rally) : rally;
}

function groupEvents(strokeEvents) {
  const grouped = new Map();
  const seen = new Set();
  function add(key, event) {
    const normalized = createStrokeEvent(event);
    if (seen.has(normalized.event_id)) throw new AnalysisError(`event ${normalized.event_id} occurs more than once`, 'duplicate-event-id');
    seen.add(normalized.event_id);
    const rallyKey = key ?? normalized.rally_id;
    if (!grouped.has(rallyKey)) grouped.set(rallyKey, []);
    grouped.get(rallyKey).push(normalized);
  }
  if (strokeEvents instanceof Map) {
    for (const [key, value] of strokeEvents.entries()) {
      const list = Array.isArray(value) ? value : [value];
      for (const event of list) add(key, event);
    }
    return grouped;
  }
  if (!strokeEvents) return grouped;
  if (Array.isArray(strokeEvents)) {
    for (const event of strokeEvents) add(null, event);
    return grouped;
  }
  if (isRecord(strokeEvents)) {
    for (const [key, value] of Object.entries(strokeEvents)) {
      const list = Array.isArray(value) ? value : [value];
      for (const event of list) add(key, event);
    }
  }
  return grouped;
}

function highlightEventFeatures(rally, eventIndex) {
  const events = eventIndex.get(rally.rally_id) || [];
  const eventById = new Map(events.map((event) => [event.event_id, event]));
  const referencedEvents = rally.stroke_event_ids.length
    ? rally.stroke_event_ids.map((id) => eventById.get(id) || null)
    : events;
  const acceptedEvents = referencedEvents.filter((event) => event && (event.status === 'accepted' || event.status === 'corrected'));
  const shotCount = rally.shot_count > 0 ? rally.shot_count : Math.max(acceptedEvents.length, rally.stroke_event_ids.length);
  const familiesFromRally = rally.coarse_shot_families.filter((family) => COARSE_SHOT_FAMILIES.includes(family));
  const families = new Set(familiesFromRally);
  for (const event of acceptedEvents) if (COARSE_SHOT_FAMILIES.includes(event.shot_family)) families.add(event.shot_family);

  const expectedConfidenceCount = Math.max(acceptedEvents.length, rally.stroke_event_ids.length, rally.shot_count);
  let confidenceSum = 0;
  let missingConfidenceCount = 0;
  for (let index = 0; index < expectedConfidenceCount; index += 1) {
    const event = acceptedEvents[index];
    if (!event) {
      missingConfidenceCount += 1;
      continue;
    }
    const confidence = event.tracking_confidence || event.geometry_confidence;
    if (!confidence || confidence.status !== 'known') missingConfidenceCount += 1;
    else confidenceSum += confidence.value;
  }
  const meanTrackingConfidence = expectedConfidenceCount ? stableNumber(confidenceSum / expectedConfidenceCount) : 0;
  return {
    shot_count: shotCount,
    unique_families: [...families],
    mean_tracking_confidence: meanTrackingConfidence,
    missing_confidence_count: missingConfidenceCount,
    accepted_event_count: acceptedEvents.length,
  };
}

function outcomePressure(rally) {
  const label = classifyOutcomeFromWinnerState(rally.winner_state);
  const classifiedPressure = label === 'unclassified' ? 0 : 0.4;
  if (label !== 'winner' && label !== 'forced_error') {
    return { value: classifiedPressure, partial: false, reason: label === 'unclassified' ? 'outcome-unclassified' : 'ordinary-classified-outcome' };
  }
  const score = rally.score_context;
  const scoreKnown = score && (score.state !== 'unknown' || score.game_point === true);
  const tight = scoreKnown && (score.state === 'tight' || score.game_point === true);
  return {
    value: tight ? 1 : 0.7,
    partial: !scoreKnown,
    reason: tight ? 'tight-or-game-point' : (scoreKnown ? 'ordinary-score-state' : 'score-unavailable-ordinary-fallback'),
  };
}

function completedRalliesOnly(rallies) {
  return rallies.filter((rally) => rally && rally.status === 'completed' && rally.end_media_time !== null);
}

function percentileRank(value, values) {
  if (!values.length) return 0;
  return values.filter((candidate) => candidate <= value).length / values.length;
}

function calculateHighlightIndex(rallyInput, completedHistoryInput, strokeEvents = []) {
  const rally = normalizeRallyForHighlight(rallyInput);
  const history = completedRalliesOnly((completedHistoryInput || []).map(normalizeRallyForHighlight));
  if (!rally || rally.status !== 'completed' || rally.end_media_time === null) {
    return { rally_id: rally?.rally_id ?? null, eligible: false, index: null, reason: 'rally-not-completed', sample_size: history.length };
  }
  const candidates = [...history];
  if (!candidates.some((candidate) => candidate.rally_id === rally.rally_id)) candidates.push(rally);
  const completed = completedRalliesOnly(candidates);
  const sampleSize = completed.length;
  const base = {
    rally_id: rally.rally_id,
    eligible: false,
    index: null,
    sample_size: sampleSize,
    minimum_sample_size: 10,
    source_timestamp: { start_media_time: rally.start_media_time, end_media_time: rally.end_media_time },
  };
  if (sampleSize < 10) return { ...base, reason: 'insufficient-history' };

  const eventIndex = groupEvents(strokeEvents);
  const currentFeatures = highlightEventFeatures(rally, eventIndex);
  const shotCounts = completed.map((candidate) => highlightEventFeatures(candidate, eventIndex).shot_count);
  const lengthPercentile = percentileRank(currentFeatures.shot_count, shotCounts);
  const variety = Math.min(currentFeatures.unique_families.length / COARSE_SHOT_FAMILIES.length, 1);
  const pressure = outcomePressure(rally);
  const meanTrackingConfidence = currentFeatures.mean_tracking_confidence;
  const weighted = 0.4 * lengthPercentile + 0.25 * variety + 0.2 * pressure.value + 0.15 * meanTrackingConfidence;
  const partialComponents = [];
  if (pressure.partial) partialComponents.push('outcome_pressure');
  if (currentFeatures.missing_confidence_count > 0) partialComponents.push('mean_tracking_confidence');
  return finishRecord({
    rally_id: rally.rally_id,
    eligible: true,
    index: Math.round(100 * weighted),
    sample_size: sampleSize,
    minimum_sample_size: 10,
    components: {
      length_percentile: lengthPercentile,
      variety,
      outcome_pressure: pressure.value,
      mean_tracking_confidence: meanTrackingConfidence,
    },
    weights: { length_percentile: 0.4, variety: 0.25, outcome_pressure: 0.2, mean_tracking_confidence: 0.15 },
    partial_components: partialComponents,
    partial: partialComponents.length > 0,
    component_reasons: {
      outcome_pressure: pressure.reason,
      mean_tracking_confidence: currentFeatures.missing_confidence_count > 0
        ? `${currentFeatures.missing_confidence_count} missing confidence value(s) contributed 0`
        : 'all accepted stroke confidence values known',
    },
    score_context: rally.score_context,
    outcome: rally.winner_state,
    shot_count: currentFeatures.shot_count,
    unique_coarse_shot_families: currentFeatures.unique_families,
    source_timestamp: { start_media_time: rally.start_media_time, end_media_time: rally.end_media_time },
  });
}

function rankRallyHighlights(ralliesInput, strokeEvents = [], { limit = Infinity } = {}) {
  if (!Array.isArray(ralliesInput)) throw new SchemaValidationError('RallyCollection', ['rallies must be an array']);
  const rallies = ralliesInput.map((rally) => createRallyRecord(rally));
  if (new Set(rallies.map((rally) => rally.rally_id)).size !== rallies.length) {
    throw new AnalysisError('rally_id values must be unique for highlight ranking', 'duplicate-rally-id');
  }
  const completed = completedRalliesOnly(rallies);
  if (completed.length < 10) {
    return finishRecord({
      eligible: false,
      reason: 'insufficient-history',
      sample_size: completed.length,
      minimum_sample_size: 10,
      results: [],
    });
  }
  const results = completed
    .map((rally) => calculateHighlightIndex(rally, completed, strokeEvents))
    .sort((left, right) => right.index - left.index || left.source_timestamp.end_media_time - right.source_timestamp.end_media_time || left.rally_id.localeCompare(right.rally_id))
    .slice(0, limit);
  return finishRecord({ eligible: true, sample_size: completed.length, minimum_sample_size: 10, results });
}

const rankHighlights = rankRallyHighlights;
const scoreRallyHighlights = rankRallyHighlights;

function isPointInsideCourt(point, format = 'doubles') {
  const { x, y } = pointXY(point);
  if (format !== 'doubles' && format !== 'singles') throw new AnalysisError('format must be doubles or singles', 'invalid-format');
  const minX = format === 'singles' ? SINGLES_SIDE_MARGIN_M : 0;
  const maxX = format === 'singles' ? COURT_WIDTH_M - SINGLES_SIDE_MARGIN_M : COURT_WIDTH_M;
  return x >= minX && x <= maxX && y >= 0 && y <= COURT_LENGTH_M;
}

const ANALYSIS_PRIMITIVES = {
  AnalysisError,
  SchemaValidationError,
  COURT_LENGTH_M,
  COURT_WIDTH_M,
  COURT_GEOMETRY,
  COURT_LINES,
  LINE_WIDTH_M,
  NET_Y_M,
  NET_POST_HEIGHT_M,
  SINGLES_SIDE_MARGIN_M,
  SINGLES_WIDTH_M,
  SHORT_SERVICE_OFFSET_M,
  SHORT_SERVICE_NEAR_Y_M,
  SHORT_SERVICE_FAR_Y_M,
  DOUBLES_LONG_SERVICE_OFFSET_M,
  DOUBLES_LONG_SERVICE_NEAR_Y_M,
  DOUBLES_LONG_SERVICE_FAR_Y_M,
  COARSE_SHOT_FAMILIES,
  SHOT_FAMILY_UNKNOWN,
  MANUAL_SHOT_LABELS,
  EVENT_SOURCES,
  EVENT_STATUSES,
  OUTCOME_LABELS,
  LINE_CALL_LABELS,
  EVIDENCE_STATES,
  RALLY_STATUSES,
  RALLY_TERMINATIONS,
  createNormalizedPoint,
  createCourtPoint,
  normalizeCourtPoint,
  denormalizeCourtPoint,
  getCourtGeometry,
  generateCourtLines,
  getCourtLine,
  projectCourtLines,
  fitHomography,
  fitOuterCourtHomography,
  Homography,
  createConfidence,
  validateConfidence,
  createCorrectionProvenance,
  validateCorrectionProvenance,
  createStrokeEvent,
  validateStrokeEvent,
  correctStrokeEvent,
  replaceCorrectedStrokeEvent,
  createWinnerState,
  validateWinnerState,
  createRallyRecord,
  validateRallyRecord,
  createLineCallState,
  createLineCallRecord: createLineCallState,
  validateLineCallState,
  attributeRallyOutcome,
  createRallyStateMachine,
  createRallyEventStateMachine: createRallyStateMachine,
  createRallyAnalyzer,
  analyzeRallyEvents,
  analyzeRally: analyzeRallyEvents,
  analyzeRallies,
  processRallyEvents,
  buildRallyAnalysis: analyzeRallyEvents,
  buildRallyTimeline: analyzeRallyEvents,
  createCoarseShotFeatures,
  COARSE_RULE_THRESHOLDS,
  classifyCoarseShot,
  calculateHighlightIndex,
  rankRallyHighlights,
  rankHighlights,
  scoreRallyHighlights,
  isPointInsideCourt,
};

// The analysis package remains CommonJS for Node consumers. The same
// dependency-free primitives are also exposed as a browser global for the MV3
// calibration adapter; there is no second geometry implementation to drift.
if (typeof module === 'object' && module.exports) module.exports = ANALYSIS_PRIMITIVES;
if (typeof globalThis === 'object') globalThis.BVAnalysisPrimitives = ANALYSIS_PRIMITIVES;
