/* global globalThis */
(function installPlayerTracking(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOPlayerTracking = api;
}(typeof globalThis === 'object' ? globalThis : self, function playerTrackingFactory() {
  'use strict';

  // This file is deliberately model-neutral. It consumes detector output and
  // never loads a model, chooses a detector, or uses court half as identity.
  const OBSERVATION_SCHEMA = 'bso.pose.observation.v1';
  const TRACKING_SCHEMA = 'bso.player-tracking.result.v1';
  const VERSION = 1;
  const STATES = Object.freeze({ TRACKED: 'tracked', PARTIAL: 'partial', UNKNOWN: 'unknown' });
  const DEFAULT_GATES = Object.freeze({
    maxTracks: 4,
    maxCenterDistance: 0.24,
    maxCost: 0.82,
    unmatchedCost: 0.9,
    ambiguityMargin: 0.08,
    minNewTrackConfidence: 0.25,
    minTrackedConfidence: 0.5,
    maxMissedFrames: 2,
    retireAfterMissedFrames: 8,
    duplicateIoU: 0.97,
    crossoverDistance: 0.12,
    crossoverIoU: 0.2,
    keypointGate: 0.45
  });

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function copy(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(copy);
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = copy(value[key]); });
    return result;
  }

  function identity(value, fallbackId, fallbackKind) {
    if (typeof value === 'string' && value.length) return { id: value, version: 1, kind: fallbackKind };
    if (!isObject(value)) return { id: fallbackId, version: 0, kind: fallbackKind };
    const id = value.id || value.detectorId || value.sourceId || value.name || fallbackId;
    const result = { id: String(id), version: Number.isInteger(value.version) ? value.version : 0 };
    if (value.kind || fallbackKind) result.kind = value.kind || fallbackKind;
    if (value.label) result.label = String(value.label);
    return result;
  }

  function dimensionsFrom(raw, options) {
    const frame = (raw && (raw.frame || raw.dimensions)) || {};
    const opts = options || {};
    return {
      width: frame.width || raw?.frameWidth || opts.width || opts.frameWidth,
      height: frame.height || raw?.frameHeight || opts.height || opts.frameHeight
    };
  }

  function coordinateSpace(raw, options) {
    const explicit = raw?.coordinateSpace || raw?.bboxSpace || options?.coordinateSpace || options?.bboxSpace;
    if (explicit) return explicit;
    const rawBox = raw?.bbox || raw?.boundingBox || raw?.box;
    const hasDimensions = dimensionsFrom(raw, options).width > 0 && dimensionsFrom(raw, options).height > 0;
    // Most browser pose adapters report pixels. Infer that form only when a
    // coordinate is necessarily outside normalized space; otherwise default to
    // normalized so a 0..1 detector remains unambiguous.
    if (hasDimensions && rawBox && [rawBox.x, rawBox.y, rawBox.width, rawBox.height, rawBox.xMin, rawBox.yMin, rawBox.xMax, rawBox.yMax]
      .some((value) => finite(value) && value > 1)) return 'pixel';
    return 'normalized';
  }

  function coordinate(value, dimension, space) {
    if (!finite(value)) return null;
    if (space === 'pixel' || space === 'pixels') {
      if (!finite(dimension) || dimension <= 0) return null;
      return value / dimension;
    }
    return value;
  }

  function normalizedNumber(value) {
    return Number(value.toFixed(6));
  }

  function normalizeBox(rawBox, dimensions, space) {
    if (!isObject(rawBox)) return null;
    let x;
    let y;
    let width;
    let height;
    if (finite(rawBox.xMin) && finite(rawBox.yMin) && finite(rawBox.xMax) && finite(rawBox.yMax)) {
      x = rawBox.xMin;
      y = rawBox.yMin;
      width = rawBox.xMax - rawBox.xMin;
      height = rawBox.yMax - rawBox.yMin;
    } else {
      x = rawBox.x;
      y = rawBox.y;
      width = rawBox.width;
      height = rawBox.height;
    }
    const nx = coordinate(x, dimensions.width, space);
    const ny = coordinate(y, dimensions.height, space);
    const nw = coordinate(width, dimensions.width, space);
    const nh = coordinate(height, dimensions.height, space);
    if (![nx, ny, nw, nh].every(finite) || nw <= 0 || nh <= 0) return null;
    // Detectors occasionally return a box a few pixels beyond the image. Clip
    // it here; a fully outside box is invalid and is represented as missing.
    const left = Math.max(0, nx);
    const top = Math.max(0, ny);
    const right = Math.min(1, nx + nw);
    const bottom = Math.min(1, ny + nh);
    if (right <= left || bottom <= top) return null;
    return { x: normalizedNumber(left), y: normalizedNumber(top), width: normalizedNumber(right - left), height: normalizedNumber(bottom - top) };
  }

  function normalizeKeypoints(rawKeypoints, dimensions, space, issues) {
    if (!Array.isArray(rawKeypoints)) return [];
    const names = new Set();
    const result = [];
    rawKeypoints.forEach((raw, index) => {
      if (!isObject(raw)) {
        issues.push(`keypoint[${index}] is not an object`);
        return;
      }
      const name = raw.name || raw.id || raw.part || `keypoint-${index}`;
      const x = coordinate(raw.x, dimensions.width, space);
      const y = coordinate(raw.y, dimensions.height, space);
      if (!finite(x) || !finite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        issues.push(`keypoint[${index}] is outside normalized frame`);
        return;
      }
      const confidence = raw.confidence == null ? (raw.score == null ? null : raw.score) : raw.confidence;
      if (confidence !== null && (!finite(confidence) || confidence < 0 || confidence > 1)) {
        issues.push(`keypoint[${index}] confidence is outside [0,1]`);
        return;
      }
      if (names.has(String(name))) {
        issues.push(`duplicate keypoint name: ${name}`);
        return;
      }
      names.add(String(name));
      result.push({ name: String(name), x: normalizedNumber(x), y: normalizedNumber(y), confidence });
    });
    return result;
  }

  function normalizedConfidence(raw) {
    const value = raw?.confidence == null ? raw?.score : raw.confidence;
    return value == null ? null : (finite(value) && value >= 0 && value <= 1 ? value : null);
  }

  function stateFor(raw, bbox, keypoints, confidence, issues) {
    if (raw?.state === STATES.UNKNOWN) return STATES.UNKNOWN;
    if (raw?.state === STATES.PARTIAL) return STATES.PARTIAL;
    if (raw?.state === STATES.TRACKED && bbox && confidence !== null && confidence >= 0.5 && !issues.length) return STATES.TRACKED;
    if (bbox || keypoints.length) return STATES.PARTIAL;
    return STATES.UNKNOWN;
  }

  /**
   * Normalize one detector pose into the wire contract. Pixel coordinates are
   * accepted with frame dimensions and are inferred when a coordinate exceeds
   * normalized space; coordinateSpace can be supplied explicitly. Invalid
   * keypoints are omitted and listed   * in issues so a partial pose is never promoted to a full pose silently.
   */
  function normalizePoseObservation(raw = {}, options = {}) {
    const issues = [];
    if (!isObject(raw)) {
      issues.push('observation is not an object');
      raw = {};
    }
    const dimensions = dimensionsFrom(raw, options);
    const space = coordinateSpace(raw, options);
    const rawBox = raw.bbox || raw.boundingBox || raw.box;
    const bbox = normalizeBox(rawBox, dimensions, space);
    if (rawBox && !bbox) issues.push('bounding box is invalid or outside frame');
    const keypoints = normalizeKeypoints(raw.keypoints || raw.pose || [], dimensions, space, issues);
    const confidence = normalizedConfidence(raw);
    if ((raw.confidence != null || raw.score != null) && confidence === null) issues.push('confidence is outside [0,1]');
    const requestId = raw.requestId || options.requestId || 'unknown-request';
    const mediaTime = raw.mediaTime == null ? options.mediaTime : raw.mediaTime;
    const result = {
      schema: OBSERVATION_SCHEMA,
      version: VERSION,
      observationId: String(raw.observationId || raw.id || options.observationId || `${requestId}:pose-0`),
      sessionId: String(raw.sessionId || options.sessionId || 'unknown-session'),
      requestId: String(requestId),
      mediaTime: finite(mediaTime) && mediaTime >= 0 ? mediaTime : null,
      detector: identity(raw.detector || options.detector, 'unknown-detector', 'pose-detector'),
      source: identity(raw.source || options.source, 'unknown-source', 'frame-source'),
      state: stateFor(raw, bbox, keypoints, confidence, issues),
      confidence,
      bbox,
      keypoints
    };
    if (raw.label != null) result.label = String(raw.label);
    if (issues.length) result.issues = issues;
    return result;
  }

  function validateBox(box) {
    return box === null || (isObject(box) && finite(box.x) && finite(box.y) && finite(box.width) && finite(box.height) &&
      box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= 1);
  }

  function validateIdentity(value) {
    return isObject(value) && nonEmptyString(value.id) && Number.isInteger(value.version) && value.version >= 0;
  }

  /** Validate the normalized, versioned pose shape at an adapter boundary. */
  function isPoseObservation(value) {
    if (!isObject(value) || value.schema !== OBSERVATION_SCHEMA || value.version !== VERSION ||
        !nonEmptyString(value.observationId) || !nonEmptyString(value.sessionId) || !nonEmptyString(value.requestId) ||
        !finite(value.mediaTime) || value.mediaTime < 0 || !validateIdentity(value.detector) || !validateIdentity(value.source) ||
        !Object.values(STATES).includes(value.state) || !validateBox(value.bbox) || !Array.isArray(value.keypoints)) return false;
    if (value.confidence !== null && (!finite(value.confidence) || value.confidence < 0 || value.confidence > 1)) return false;
    const names = new Set();
    return value.keypoints.every((point) => {
      if (!isObject(point) || !nonEmptyString(point.name) || names.has(point.name) ||
          !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
      if (point.confidence !== null && (!finite(point.confidence) || point.confidence < 0 || point.confidence > 1)) return false;
      names.add(point.name);
      return true;
    }) && (value.state !== STATES.TRACKED || (value.bbox !== null && value.confidence !== null));
  }

  function boxArea(box) {
    return box ? box.width * box.height : 0;
  }

  function boxCenter(box) {
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  }

  function boxIoU(a, b) {
    if (!a || !b) return 0;
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    return intersection / Math.max(1e-9, boxArea(a) + boxArea(b) - intersection);
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function keypointEvidence(trackKeypoints, observationKeypoints) {
    if (!Array.isArray(trackKeypoints) || !Array.isArray(observationKeypoints)) return null;
    const observed = new Map(observationKeypoints.map((point) => [point.name, point]));
    const common = trackKeypoints.filter((point) => observed.has(point.name));
    if (!common.length) return null;
    const mean = common.reduce((sum, point) => sum + distance(point, observed.get(point.name)), 0) / common.length;
    return { distance: mean, count: common.length };
  }

  function predictedBox(track, mediaTime) {
    const dt = Math.max(0, Math.min(1.5, mediaTime - track.lastMediaTime));
    const box = track.bbox;
    const predicted = {
      x: box.x + track.velocity.x * dt,
      y: box.y + track.velocity.y * dt,
      width: box.width + track.velocity.width * dt,
      height: box.height + track.velocity.height * dt
    };
    const width = Math.max(0.001, Math.min(1, predicted.width));
    const height = Math.max(0.001, Math.min(1, predicted.height));
    return {
      x: clamp(predicted.x, 0, 1 - width),
      y: clamp(predicted.y, 0, 1 - height),
      width,
      height
    };
  }

  function sameObservationGeometry(a, b, threshold) {
    if (!a.bbox || !b.bbox) return !a.bbox && !b.bbox;
    return boxIoU(a.bbox, b.bbox) >= threshold &&
      (keypointEvidence(a.keypoints, b.keypoints)?.distance || 0) <= 0.025;
  }

  function deduplicateObservations(observations, threshold) {
    const unique = [];
    const duplicates = [];
    observations.forEach((observation) => {
      const existingById = unique.find((item) => item.observationId === observation.observationId);
      const existingByGeometry = unique.find((item) => sameObservationGeometry(item, observation, threshold));
      const existing = existingById || existingByGeometry;
      if (!existing) {
        unique.push(observation);
        return;
      }
      const incumbentConfidence = existing.confidence == null ? -1 : existing.confidence;
      const candidateConfidence = observation.confidence == null ? -1 : observation.confidence;
      const replace = candidateConfidence > incumbentConfidence ||
        (candidateConfidence === incumbentConfidence && observation.observationId < existing.observationId);
      if (replace) {
        const index = unique.indexOf(existing);
        unique[index] = observation;
      }
      duplicates.push({
        duplicateObservationId: replace ? existing.observationId : observation.observationId,
        keptObservationId: replace ? observation.observationId : existing.observationId
      });
    });
    return {
      observations: unique.sort((a, b) => a.observationId.localeCompare(b.observationId)),
      duplicates: duplicates.sort((a, b) => a.duplicateObservationId.localeCompare(b.duplicateObservationId) || a.keptObservationId.localeCompare(b.keptObservationId))
    };
  }

  function orientation(a, b, c) {
    const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return Math.abs(value) < 1e-9 ? 0 : value > 0 ? 1 : -1;
  }

  function segmentsIntersect(a, b, c, d) {
    const ab1 = orientation(a, b, c);
    const ab2 = orientation(a, b, d);
    const cd1 = orientation(c, d, a);
    const cd2 = orientation(c, d, b);
    return ab1 !== ab2 && cd1 !== cd2;
  }

  function pathCrosses(first, second, firstObservation, secondObservation) {
    const a = boxCenter(first.predicted);
    const b = boxCenter(firstObservation.bbox);
    const c = boxCenter(second.predicted);
    const d = boxCenter(secondObservation.bbox);
    return Boolean(a && b && c && d && segmentsIntersect(a, b, c, d));
  }

  function validTrackState(state) {
    return state === STATES.TRACKED || state === STATES.PARTIAL || state === STATES.UNKNOWN;
  }

  function trackingState(players, observationCount) {
    if (!players.length && !observationCount) return STATES.UNKNOWN;
    if (players.length && players.every((player) => player.state === STATES.UNKNOWN) && !observationCount) return STATES.UNKNOWN;
    if (players.length && players.every((player) => player.state === STATES.TRACKED)) return STATES.TRACKED;
    return STATES.PARTIAL;
  }

  function resultShape({ sessionId, requestId, mediaTime, state, players, observations, duplicates, invalidObservations = [], association, accepted = true, reason = '' }) {
    return {
      schema: TRACKING_SCHEMA,
      version: VERSION,
      sessionId,
      requestId,
      mediaTime,
      state,
      players,
      observations,
      duplicateObservations: duplicates,
      invalidObservations,
      association: {
        method: 'gated-motion-box-keypoint-v1',
        maxTracks: DEFAULT_GATES.maxTracks,
        gates: copy(DEFAULT_GATES),
        ...(association || {})
      },
      accepted,
      reason
    };
  }

  class SessionPlayerTracker {
    constructor({ sessionId, maxTracks = DEFAULT_GATES.maxTracks, gates = {} } = {}) {
      if (!nonEmptyString(sessionId)) throw new TypeError('sessionId must be a non-empty string');
      if (!Number.isInteger(maxTracks) || maxTracks < 2 || maxTracks > 4) throw new RangeError('maxTracks must be an integer from 2 through 4');
      this.sessionId = sessionId;
      this.gates = Object.assign({}, DEFAULT_GATES, gates, { maxTracks });
      this.tracks = new Map();
      this.nextTrackNumber = 1;
      this.generation = 0;
      this.lastMediaTime = -Infinity;
      this.seenRequests = new Set();
    }

    reset(reason = 'session-reset') {
      if (isObject(reason)) reason = reason.reason || 'session-reset';
      this.tracks.clear();
      this.nextTrackNumber = 1;
      this.generation += 1;
      this.lastMediaTime = -Infinity;
      this.seenRequests.clear();
      return { reason, generation: this.generation };
    }

    newTrackId() {
      const id = `${this.sessionId}:s${this.generation}:player-${this.nextTrackNumber}`;
      this.nextTrackNumber += 1;
      return id;
    }

    normalize(input) {
      const values = Array.isArray(input) ? input : (Array.isArray(input?.observations) ? input.observations : []);
      const context = Array.isArray(input) ? {} : input || {};
      const normalized = values.map((raw, index) => normalizePoseObservation(raw, Object.assign({}, context, {
        sessionId: this.sessionId,
        requestId: context.requestId || 'unknown-request',
        observationId: raw?.observationId || raw?.id || `${context.requestId || 'unknown-request'}:pose-${index}`,
        mediaTime: context.mediaTime,
        detector: context.detector,
        source: context.source
      })));
      const valid = normalized.filter((observation) => isPoseObservation(observation));
      return Object.assign(deduplicateObservations(valid, this.gates.duplicateIoU), {
        invalid: normalized.filter((observation) => !isPoseObservation(observation))
      });
    }

    candidate(track, observation, mediaTime) {
      if (!observation.bbox || observation.state === STATES.UNKNOWN) return null;
      const predicted = predictedBox(track, mediaTime);
      const predictedCenter = boxCenter(predicted);
      const observedCenter = boxCenter(observation.bbox);
      const motionDistance = distance(predictedCenter, observedCenter);
      const iou = boxIoU(predicted, observation.bbox);
      const widthRatio = observation.bbox.width / predicted.width;
      const heightRatio = observation.bbox.height / predicted.height;
      const keypoints = keypointEvidence(track.keypoints, observation.keypoints);
      const keypointDistance = keypoints ? keypoints.distance : 0.2;
      const hasBoxGate = iou >= 0.01 || motionDistance <= this.gates.maxCenterDistance;
      const sizeGate = widthRatio >= 0.25 && widthRatio <= 4 && heightRatio >= 0.25 && heightRatio <= 4;
      if (!hasBoxGate || !sizeGate || (keypoints && keypoints.count >= 2 && keypointDistance > this.gates.keypointGate)) return null;
      const motionCost = Math.min(1, motionDistance / this.gates.maxCenterDistance);
      const boxCost = 1 - iou;
      const keypointCost = Math.min(1, keypointDistance / this.gates.keypointGate);
      const confidencePenalty = observation.confidence == null ? 0.08 : (1 - observation.confidence) * 0.12;
      const cost = 0.45 * motionCost + 0.3 * boxCost + 0.25 * keypointCost + confidencePenalty;
      if (cost > this.gates.maxCost) return null;
      return { trackId: track.trackId, observationId: observation.observationId, cost, predicted, iou, motionDistance, keypoints };
    }

    assignments(tracks, observations, mediaTime) {
      const candidates = tracks.map((track) => observations.map((observation) => this.candidate(track, observation, mediaTime)));
      const all = [];
      function visit(trackIndex, used, matches, cost) {
        if (trackIndex >= tracks.length) {
          const signature = tracks.map((track) => matches.find((match) => match.trackId === track.trackId)?.observationId || '~').join('|');
          all.push({ matches: matches.slice(), cost, signature });
          return;
        }
        visit(trackIndex + 1, used, matches, cost + this.gates.unmatchedCost);
        observations.forEach((observation, observationIndex) => {
          if (used.has(observationIndex)) return;
          const candidate = candidates[trackIndex][observationIndex];
          if (!candidate) return;
          used.add(observationIndex);
          matches.push(candidate);
          visit(trackIndex + 1, used, matches, cost + candidate.cost);
          matches.pop();
          used.delete(observationIndex);
        });
      }
      visit = visit.bind(this);
      visit(0, new Set(), [], 0);
      all.sort((a, b) => a.cost - b.cost || a.signature.localeCompare(b.signature));
      const best = all[0] || { matches: [], cost: 0, signature: '' };
      const second = all.find((candidate) => candidate.signature !== best.signature) || null;
      const ambiguousTrackIds = new Set();
      const ambiguousObservationIds = new Set();
      if (second && second.cost - best.cost <= this.gates.ambiguityMargin) {
        const bestByTrack = new Map(best.matches.map((match) => [match.trackId, match.observationId]));
        const secondByTrack = new Map(second.matches.map((match) => [match.trackId, match.observationId]));
        tracks.forEach((track) => {
          if ((bestByTrack.get(track.trackId) || '~') !== (secondByTrack.get(track.trackId) || '~')) ambiguousTrackIds.add(track.trackId);
        });
        best.matches.forEach((match) => {
          if (ambiguousTrackIds.has(match.trackId)) ambiguousObservationIds.add(match.observationId);
        });
        second.matches.forEach((match) => {
          if (ambiguousTrackIds.has(match.trackId)) ambiguousObservationIds.add(match.observationId);
        });
      }
      const bestByTrack = new Map(best.matches.map((match) => [match.trackId, match]));
      const matched = Array.from(bestByTrack.values());
      for (let i = 0; i < matched.length; i += 1) {
        for (let j = i + 1; j < matched.length; j += 1) {
          const first = matched[i];
          const secondMatch = matched[j];
          const firstObservation = observations.find((observation) => observation.observationId === first.observationId);
          const secondObservation = observations.find((observation) => observation.observationId === secondMatch.observationId);
          if (!firstObservation || !secondObservation) continue;
          const observationsOverlap = boxIoU(firstObservation.bbox, secondObservation.bbox) >= this.gates.crossoverIoU ||
            distance(boxCenter(firstObservation.bbox), boxCenter(secondObservation.bbox)) <= this.gates.crossoverDistance;
          const crossedPaths = pathCrosses(first, secondMatch, firstObservation, secondObservation);
          const weakIdentityEvidence = !first.keypoints || !secondMatch.keypoints || first.keypoints.count < 2 || secondMatch.keypoints.count < 2;
          if (weakIdentityEvidence && (crossedPaths || observationsOverlap)) {
            ambiguousTrackIds.add(first.trackId);
            ambiguousTrackIds.add(secondMatch.trackId);
            ambiguousObservationIds.add(first.observationId);
            ambiguousObservationIds.add(secondMatch.observationId);
          }
        }
      }
      return { best, second, candidates, ambiguousTrackIds, ambiguousObservationIds };
    }

    createTrack(observation, mediaTime) {
      const track = {
        trackId: this.newTrackId(),
        bbox: copy(observation.bbox),
        keypoints: copy(observation.keypoints),
        confidence: observation.confidence,
        state: observation.state === STATES.TRACKED && observation.confidence >= this.gates.minTrackedConfidence ? STATES.TRACKED : STATES.PARTIAL,
        lastMediaTime: mediaTime,
        lastObservationId: observation.observationId,
        missedFrames: 0,
        velocity: { x: 0, y: 0, width: 0, height: 0 },
        detector: copy(observation.detector),
        source: copy(observation.source),
        uncertaintyFrames: 0
      };
      this.tracks.set(track.trackId, track);
      return track;
    }

    updateMotionHint(track, observation, mediaTime) {
      // During a crossover the candidate is useful as a velocity hint, but its
      // identity is not committed. Keeping the old last-observed box plus this
      // hint lets separated players recover their prior IDs on a later frame.
      const dt = Math.max(1e-6, mediaTime - track.lastMediaTime);
      track.velocity = {
        x: (observation.bbox.x - track.bbox.x) / dt,
        y: (observation.bbox.y - track.bbox.y) / dt,
        width: (observation.bbox.width - track.bbox.width) / dt,
        height: (observation.bbox.height - track.bbox.height) / dt
      };
    }

    updateTrack(track, observation, mediaTime) {
      const dt = Math.max(1e-6, mediaTime - track.lastMediaTime);
      const old = track.bbox;
      track.velocity = {
        x: (observation.bbox.x - old.x) / dt,
        y: (observation.bbox.y - old.y) / dt,
        width: (observation.bbox.width - old.width) / dt,
        height: (observation.bbox.height - old.height) / dt
      };
      track.bbox = copy(observation.bbox);
      track.keypoints = copy(observation.keypoints);
      track.confidence = observation.confidence;
      track.state = observation.state === STATES.TRACKED && observation.confidence !== null && observation.confidence >= this.gates.minTrackedConfidence ? STATES.TRACKED : STATES.PARTIAL;
      track.lastMediaTime = mediaTime;
      track.lastObservationId = observation.observationId;
      track.missedFrames = 0;
      track.detector = copy(observation.detector);
      track.source = copy(observation.source);
      track.uncertaintyFrames = 0;
    }

    playerView(track, mediaTime, forceUnknown = false) {
      const bbox = predictedBox(track, mediaTime);
      const state = forceUnknown ? STATES.UNKNOWN : track.missedFrames > 0 ? (track.missedFrames <= this.gates.maxMissedFrames ? STATES.PARTIAL : STATES.UNKNOWN) : track.state;
      return {
        trackId: track.trackId,
        state: validTrackState(state) ? state : STATES.UNKNOWN,
        confidence: state === STATES.TRACKED ? track.confidence : null,
        bbox: state === STATES.UNKNOWN ? null : bbox,
        keypoints: state === STATES.UNKNOWN ? [] : copy(track.keypoints),
        observationId: track.missedFrames ? null : track.lastObservationId,
        lastSeenMediaTime: track.lastMediaTime,
        missedFrames: track.missedFrames,
        detector: copy(track.detector),
        source: copy(track.source)
      };
    }

    processFrame(input = {}) {
      const requestId = String(input.requestId || 'unknown-request');
      const mediaTime = input.mediaTime;
      if (!finite(mediaTime) || mediaTime < 0) throw new TypeError('mediaTime must be a non-negative number');
      if (input.sessionId && input.sessionId !== this.sessionId) {
        return { accepted: false, reason: 'session-mismatch', result: resultShape({ sessionId: this.sessionId, requestId, mediaTime, state: STATES.UNKNOWN, players: [], observations: [], duplicates: [], accepted: false, reason: 'session-mismatch' }) };
      }
      if (input.stale) {
        return { accepted: false, reason: 'stale-frame', result: this.snapshot(requestId, mediaTime, [], [], { reason: 'stale-frame' }, false) };
      }
      if (input.cameraCut) this.reset('camera-cut');
      if (this.seenRequests.has(requestId)) {
        return { accepted: false, reason: 'duplicate-request', result: this.snapshot(requestId, mediaTime, [], [], { reason: 'duplicate-request' }, false) };
      }
      if (mediaTime <= this.lastMediaTime) {
        return { accepted: false, reason: 'stale-frame', result: this.snapshot(requestId, mediaTime, [], [], { reason: 'stale-frame' }, false) };
      }
      this.seenRequests.add(requestId);
      if (this.seenRequests.size > 128) this.seenRequests.delete(this.seenRequests.values().next().value);
      const deduped = this.normalize(input);
      const observations = deduped.observations;
      const eligible = observations.filter((observation) => observation.bbox && observation.state !== STATES.UNKNOWN);
      const priorTracks = Array.from(this.tracks.values()).sort((a, b) => a.trackId.localeCompare(b.trackId));
      const association = this.assignments(priorTracks, eligible, mediaTime);
      const matchedObservationIds = new Set();
      const ambiguousTrackIds = association.ambiguousTrackIds;
      const events = [];
      association.best.matches.forEach((match) => {
        const track = this.tracks.get(match.trackId);
        const observation = eligible.find((item) => item.observationId === match.observationId);
        if (!track || !observation) return;
        matchedObservationIds.add(observation.observationId);
        if (ambiguousTrackIds.has(track.trackId)) {
          this.updateMotionHint(track, observation, mediaTime);
          track.missedFrames += 1;
          track.uncertaintyFrames += 1;
          events.push({ type: 'identity-uncertain', trackId: track.trackId, observationIds: Array.from(association.ambiguousObservationIds).sort() });
        } else {
          this.updateTrack(track, observation, mediaTime);
        }
      });
      priorTracks.forEach((track) => {
        if (!association.best.matches.some((match) => match.trackId === track.trackId)) {
          track.missedFrames += 1;
          track.uncertaintyFrames += 1;
        }
        if (track.missedFrames >= this.gates.retireAfterMissedFrames) this.tracks.delete(track.trackId);
      });
      const blockedByUncertainty = new Set(association.ambiguousObservationIds);
      eligible.filter((observation) => !matchedObservationIds.has(observation.observationId) && !blockedByUncertainty.has(observation.observationId))
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || a.observationId.localeCompare(b.observationId))
        .forEach((observation) => {
          if (this.tracks.size >= this.gates.maxTracks) return;
          if (observation.confidence !== null && observation.confidence < this.gates.minNewTrackConfidence) return;
          if (observation.confidence === null && observation.state !== STATES.TRACKED) return;
          this.createTrack(observation, mediaTime);
        });
      this.lastMediaTime = mediaTime;
      const players = Array.from(this.tracks.values()).sort((a, b) => a.trackId.localeCompare(b.trackId)).map((track) => this.playerView(track, mediaTime, ambiguousTrackIds.has(track.trackId)));
      const associationView = {
        maxTracks: this.gates.maxTracks,
        gates: copy(this.gates),
        matched: association.best.matches.filter((match) => !ambiguousTrackIds.has(match.trackId)).map((match) => ({ trackId: match.trackId, observationId: match.observationId })),
        ambiguousTrackIds: Array.from(ambiguousTrackIds).sort(),
        ambiguousObservationIds: Array.from(association.ambiguousObservationIds).sort(),
        identityRisk: ambiguousTrackIds.size ? 'likely-id-switch-or-crossover' : 'none',
        events
      };
      const result = resultShape({
        sessionId: this.sessionId,
        requestId,
        mediaTime,
        state: trackingState(players, observations.length),
        players,
        observations,
        duplicates: deduped.duplicates,
        invalidObservations: deduped.invalid || [],
        association: associationView
      });
      return { accepted: true, reason: 'processed', result };
    }

    snapshot(requestId, mediaTime, observations = [], duplicates = [], association = {}, accepted = false, invalidObservations = []) {
      const players = Array.from(this.tracks.values()).sort((a, b) => a.trackId.localeCompare(b.trackId)).map((track) => this.playerView(track, this.lastMediaTime === -Infinity ? mediaTime : this.lastMediaTime, true));
      return resultShape({ sessionId: this.sessionId, requestId, mediaTime, state: trackingState(players, observations.length), players, observations, duplicates, invalidObservations, association, accepted, reason: association.reason || 'not-processed' });
    }

    update(input) { return this.processFrame(input); }
    associate(input) { return this.processFrame(input); }
  }

  function unknownTrackingResult({ sessionId = 'unknown-session', requestId = 'unknown-request', mediaTime = 0, detector, source, reason = 'no-detections' } = {}) {
    return {
      schema: TRACKING_SCHEMA,
      version: VERSION,
      sessionId,
      requestId,
      mediaTime,
      state: STATES.UNKNOWN,
      players: [],
      observations: [],
      duplicateObservations: [],
      invalidObservations: [],
      detector: identity(detector, 'unknown-detector', 'pose-detector'),
      source: identity(source, 'unknown-source', 'frame-source'),
      association: { method: 'gated-motion-box-keypoint-v1', maxTracks: DEFAULT_GATES.maxTracks, gates: copy(DEFAULT_GATES), identityRisk: 'none' },
      accepted: true,
      reason
    };
  }

  function validKeypointArray(keypoints) {
    if (!Array.isArray(keypoints)) return false;
    const names = new Set();
    return keypoints.every((point) => {
      if (!isObject(point) || !nonEmptyString(point.name) || names.has(point.name) ||
          !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
      names.add(point.name);
      return point.confidence === null || (finite(point.confidence) && point.confidence >= 0 && point.confidence <= 1);
    });
  }

  function isTrackingResult(value) {
    return isObject(value) && value.schema === TRACKING_SCHEMA && value.version === VERSION &&
      nonEmptyString(value.sessionId) && nonEmptyString(value.requestId) && finite(value.mediaTime) && value.mediaTime >= 0 &&
      Object.values(STATES).includes(value.state) && Array.isArray(value.players) && Array.isArray(value.observations) &&
      value.observations.every(isPoseObservation) && value.players.every((player) => isObject(player) && nonEmptyString(player.trackId) &&
        Object.values(STATES).includes(player.state) && (player.confidence === null || (finite(player.confidence) && player.confidence >= 0 && player.confidence <= 1)) &&
        validateBox(player.bbox) && validKeypointArray(player.keypoints) && validateIdentity(player.detector) && validateIdentity(player.source) &&
        (player.state !== STATES.TRACKED || (player.bbox !== null && player.confidence !== null)));
  }

  return Object.freeze({
    OBSERVATION_SCHEMA,
    TRACKING_SCHEMA,
    VERSION,
    STATES,
    DEFAULT_GATES,
    normalizePoseObservation,
    normalizeObservation: normalizePoseObservation,
    normalizeObservations: (values, options = {}) => {
      const normalized = (Array.isArray(values) ? values : []).map((value, index) => normalizePoseObservation(value, Object.assign({}, options, { observationId: value?.observationId || value?.id || `${options.requestId || 'unknown-request'}:pose-${index}` })));
      const valid = normalized.filter(isPoseObservation);
      return Object.assign(deduplicateObservations(valid, options.duplicateIoU || DEFAULT_GATES.duplicateIoU), { invalid: normalized.filter((value) => !isPoseObservation(value)) });
    },
    isPoseObservation,
    isObservation: isPoseObservation,
    validatePoseObservation: isPoseObservation,
    unknownTrackingResult,
    isTrackingResult,
    SessionPlayerTracker,
    SessionLocalTracker: SessionPlayerTracker,
    PlayerTracker: SessionPlayerTracker,
    createSessionTracker: (options) => new SessionPlayerTracker(options),
    boxIoU,
    keypointEvidence
  });
}));
