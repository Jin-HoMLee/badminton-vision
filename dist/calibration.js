/* Dependency-free browser adapter for the shared BWF geometry/homography primitives. */
(function (root) {
  "use strict";

  var primitives = root.BVAnalysisPrimitives;
  var CALIBRATION_VERSION = 1;
  var COORDINATE_SYSTEM = "normalized-video-image";
  var COURT_COORDINATE_SYSTEM = "normalized-court";
  var FIT_OPTIONS = { minimumAreaRatio: 1e-7, duplicateRatio: 1e-7, pivotTolerance: 1e-12 };

  function CalibrationError(message, code, cause) {
    this.name = "CalibrationError";
    this.message = message;
    this.code = code || "invalid-calibration";
    this.recoverable = true;
    if (cause) this.cause = cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, CalibrationError);
  }
  CalibrationError.prototype = Object.create(Error.prototype);
  CalibrationError.prototype.constructor = CalibrationError;

  function fail(message, code, cause) { throw new CalibrationError(message, code, cause); }

  function point(value, name, allowOutside) {
    var x;
    var y;
    if (Array.isArray(value) && value.length === 2) {
      x = value[0]; y = value[1];
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      x = value.x; y = value.y;
    } else {
      fail(name + " must be an {x, y} point", "invalid-point");
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail(name + " must contain finite coordinates", "non-finite-point");
    if (!allowOutside && (x < 0 || x > 1 || y < 0 || y > 1)) {
      fail(name + " must be normalized to [0, 1]", "point-out-of-range");
    }
    return { x: x, y: y };
  }

  function points(value) {
    if (!Array.isArray(value) || value.length !== 4) fail("Four outer-court corners are required", "invalid-seed");
    return value.map(function (entry, index) { return point(entry, "corner " + (index + 1), false); });
  }

  function canonicalCorners() {
    if (!primitives || !primitives.COURT_GEOMETRY) fail("shared BWF court geometry is unavailable", "geometry-unavailable");
    return primitives.COURT_GEOMETRY.outer_corner_order.map(function (corner) {
      return { x: corner.x / primitives.COURT_GEOMETRY.width_m, y: corner.y / primitives.COURT_GEOMETRY.length_m };
    });
  }

  function copyMatrix(matrix, name) {
    if (!Array.isArray(matrix) || matrix.length !== 3 || matrix.some(function (row) { return !Array.isArray(row) || row.length !== 3; })) {
      fail(name + " must be a 3 × 3 matrix", "invalid-homography");
    }
    var copied = matrix.map(function (row) {
      return row.map(function (value) {
        if (!Number.isFinite(value)) fail(name + " must contain finite values", "invalid-homography");
        return value;
      });
    });
    return copied;
  }

  function applyMatrix(matrix, value, operation) {
    var input = point(value, operation || "projection", true);
    var denominator = matrix[2][0] * input.x + matrix[2][1] * input.y + matrix[2][2];
    var scale = Math.max(1, ...matrix.reduce(function (all, row) { return all.concat(row.map(Math.abs)); }, []), Math.abs(input.x), Math.abs(input.y));
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-12 * scale) {
      fail((operation || "projection") + " is projectively singular", "projection-singular");
    }
    var result = {
      x: (matrix[0][0] * input.x + matrix[0][1] * input.y + matrix[0][2]) / denominator,
      y: (matrix[1][0] * input.x + matrix[1][1] * input.y + matrix[1][2]) / denominator
    };
    if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) fail((operation || "projection") + " produced a non-finite point", "projection-singular");
    return result;
  }

  function errorMessage(error) {
    var messages = {
      "duplicate-corner": "Two clicks overlap. Undo and click four distinct outer corners.",
      "collinear-corners": "The clicked corners are nearly in a line. Undo and click the full court rectangle.",
      "invalid-order": "The corners are out of order. Undo and click Near left, Near right, Far right, then Far left.",
      "near-singular": "This court shape is too narrow or unstable. Undo and click clearer outer corners.",
      "non-finite-point": "A corner was not a usable point. Undo and click the visible court corners again.",
      "point-out-of-range": "A corner landed outside the video. Undo and click inside the video.",
      "projection-singular": "The court projection is unstable. Undo and click clearer outer corners."
    };
    return messages[error && error.code] || "Calibration failed. Undo or reset, then click the four outer corners again.";
  }

  function projectLines(inverseMatrix) {
    if (!primitives || !Array.isArray(primitives.COURT_LINES)) fail("shared BWF court lines are unavailable", "geometry-unavailable");
    return primitives.COURT_LINES.map(function (line) {
      var projectedStart = applyMatrix(inverseMatrix, line.normalized_start, "court-line projection");
      var projectedEnd = applyMatrix(inverseMatrix, line.normalized_end, "court-line projection");
      // Keep canonical endpoints and all BWF ownership/format metadata while
      // making start/end the explicit normalized image coordinates consumed by
      // the browser renderer.
      return Object.assign({}, line, {
        court_start: { x: line.start.x, y: line.start.y },
        court_end: { x: line.end.x, y: line.end.y },
        start: projectedStart,
        end: projectedEnd
      });
    });
  }

  function fitCourtCalibration(seedPoints) {
    if (!primitives || typeof primitives.fitHomography !== "function") fail("shared homography primitive is unavailable", "homography-unavailable");
    var source;
    var target;
    var homography;
    try {
      source = points(seedPoints);
      target = canonicalCorners();
      // The shared implementation performs duplicate, collinear, ordering,
      // conditioning, residual, and projective-singularity checks.
      homography = primitives.fitHomography(source, target, FIT_OPTIONS);
    } catch (error) {
      if (error instanceof CalibrationError) {
        error.message = errorMessage(error);
        throw error;
      }
      throw new CalibrationError(errorMessage(error), error && error.code || "invalid-calibration", error);
    }

    var imageToCourt = copyMatrix(homography.matrix, "image-to-court matrix");
    var courtToImage = copyMatrix(homography.inverse_matrix, "court-to-image matrix");
    var result = {
      version: CALIBRATION_VERSION,
      coordinateSystem: COORDINATE_SYSTEM,
      courtCoordinateSystem: COURT_COORDINATE_SYSTEM,
      seedPoints: source.map(function (entry) { return { x: entry.x, y: entry.y }; }),
      normalizedSeedPoints: source.map(function (entry) { return { x: entry.x, y: entry.y }; }),
      canonicalCorners: target.map(function (entry) { return { x: entry.x, y: entry.y }; }),
      homography: {
        imageToCourt: imageToCourt,
        courtToImage: courtToImage,
        // Keep the shared primitive naming available to storage consumers.
        matrix: imageToCourt,
        inverse_matrix: courtToImage
      },
      lines: projectLines(courtToImage)
    };
    return result;
  }

  function matrixFor(calibration, direction) {
    if (!calibration || typeof calibration !== "object") fail("a court calibration is required", "invalid-calibration");
    if (calibration.coordinateSystem !== COORDINATE_SYSTEM || calibration.courtCoordinateSystem !== COURT_COORDINATE_SYSTEM) {
      fail("calibration uses an unsupported coordinate system", "invalid-coordinate-system");
    }
    var matrices = calibration.homography || {};
    return copyMatrix(matrices[direction], direction + " matrix");
  }

  function projectCourtPoint(calibration, normalizedCourtPoint) {
    return applyMatrix(matrixFor(calibration, "courtToImage"), normalizedCourtPoint, "court-to-image projection");
  }

  function projectImagePoint(calibration, normalizedImagePoint) {
    return applyMatrix(matrixFor(calibration, "imageToCourt"), normalizedImagePoint, "image-to-court projection");
  }

  function projectCourtLines(calibration) {
    var inverse = matrixFor(calibration, "courtToImage");
    return projectLines(inverse);
  }

  function restoreCalibration(value) {
    if (value === null || value === undefined) return null;
    try {
      // Refit from persisted normalized seeds instead of trusting mutable
      // storage matrices. This makes old/corrupt state fail recoverably.
      return fitCourtCalibration(value.seedPoints || value.normalizedSeedPoints || value.sourcePoints);
    } catch (error) {
      if (error instanceof CalibrationError) throw error;
      throw new CalibrationError(errorMessage(error), error && error.code || "invalid-calibration", error);
    }
  }

  function tryFitCourtCalibration(seedPoints) {
    try {
      return { ok: true, calibration: fitCourtCalibration(seedPoints), error: null };
    } catch (error) {
      return { ok: false, calibration: null, error: error instanceof CalibrationError ? error : new CalibrationError(errorMessage(error), error && error.code || "invalid-calibration", error) };
    }
  }

  function canonicalCourt() {
    return primitives && primitives.COURT_GEOMETRY ? primitives.COURT_GEOMETRY : null;
  }

  root.BVCalibration = Object.freeze({
    CalibrationError: CalibrationError,
    CALIBRATION_VERSION: CALIBRATION_VERSION,
    COORDINATE_SYSTEM: COORDINATE_SYSTEM,
    COURT_COORDINATE_SYSTEM: COURT_COORDINATE_SYSTEM,
    canonicalCourt: canonicalCourt,
    canonicalCorners: canonicalCorners,
    fitCourtCalibration: fitCourtCalibration,
    fitOuterCourtHomography: fitCourtCalibration,
    fit: fitCourtCalibration,
    restoreCalibration: restoreCalibration,
    tryFitCourtCalibration: tryFitCourtCalibration,
    projectCourtPoint: projectCourtPoint,
    projectImagePoint: projectImagePoint,
    projectNormalizedCourtPoint: projectCourtPoint,
    projectCourtLines: projectCourtLines,
    projectLines: projectCourtLines,
    errorMessage: errorMessage
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
