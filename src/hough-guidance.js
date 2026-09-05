/* One-shot Hough guidance burst policy + line consensus.
 *
 * Court calibration is a burst-then-stop flow: seeding start (or a
 * recalibration event that invalidates the current fit/scene) runs ONE burst
 * of a few temporally spaced Hough detection passes, the per-pass line votes
 * are aggregated into a consensus set, and then nothing keeps running - zero
 * steady-state CPU between bursts. The court is static per camera scene, so
 * the aggregated guidance stays valid until the scene or the fit changes.
 *
 * The content script owns the burst lifecycle (it owns the video capture and
 * the seeding state machine) and reads the cadence below at burst time; this
 * module owns the pure policy + consensus math so both stay unit-testable
 * without a DOM. CONFIG is intentionally a mutable plain object so tests can
 * shrink the cadence; production uses the defaults.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BVHoughGuidance = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  var CONFIG = {
    // Detection passes per one-shot burst (research recommendation: 3-5).
    passes: 4,
    // Temporal gap between successive captures. Each pass is chained on the
    // previous pass's response, so consecutive frames are spaced by at least
    // this much plus the detection time (~60-160ms at the 640px capture).
    spacingMs: 300,
    // A dispatched pass that answers nothing within this window (wedged
    // offscreen document) ends the burst; the next recalibration event
    // re-triggers it. Generous: a slow machine only stretches pass spacing.
    stallMs: 2500,
    // Max long edge for guidance captures. Court lines survive a 0.5x
    // downscale too (~4x cheaper), but a 640px capture is already ~1/3 of a
    // 1080p edge and keeps the JSON message bounded.
    captureEdge: 640,
    // Consensus defaults (see mergeBurstLines).
    angleToleranceDeg: 6,
    // Perpendicular distance, in normalized frame units, that two near-
    // parallel segments may sit apart and still be one physical court line.
    // ~8px at the 640px capture; genuinely distinct parallel court lines are
    // tens of pixels apart and stay separate.
    gapTolerance: 0.012,
    // A merged line must have been seen on at least this many distinct burst
    // passes to survive (transient player occlusion/compression noise lands
    // on one pass, real court lines on most).
    minPasses: 2,
    maxLines: 12
  };

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  /** Undirected line direction in degrees over [0, 180). */
  function geometryOf(line) {
    var x1 = finite(line && line.x1, NaN), y1 = finite(line && line.y1, NaN);
    var x2 = finite(line && line.x2, NaN), y2 = finite(line && line.y2, NaN);
    if (!(x1 >= 0 && x1 <= 1 && y1 >= 0 && y1 <= 1 && x2 >= 0 && x2 <= 1 && y2 >= 0 && y2 <= 1)) return null;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (len < 1e-4) return null;
    // The adapter already reports its own angle, but grouping must be
    // consistent across passes, so derive the direction from the endpoints.
    var raw = (Math.atan2(-dy, dx) * 180) / Math.PI;
    var angle = ((raw % 180) + 180) % 180;
    return {
      line: line,
      x1: x1, y1: y1, x2: x2, y2: y2,
      mx: (x1 + x2) / 2, my: (y1 + y2) / 2,
      ux: dx / len, uy: dy / len,
      len: len,
      angle: angle,
      votes: Math.max(0, finite(line.votes, 0))
    };
  }

  function angleDelta(a, b) {
    var delta = Math.abs(a - b);
    return Math.min(delta, 180 - delta);
  }

  /**
   * Merge one burst's per-pass line sets into a consensus guidance set.
   *
   * passSets: array (one entry per pass, in dispatch order) of normalized
   * line arrays [{ x1, y1, x2, y2, angle?, votes? }]. Empty/missing entries
   * are passes that returned nothing.
   *
   * Two segments from different passes describe one physical line when their
   * undirected directions agree within angleToleranceDeg AND the midpoint of
   * the weaker one lies within gapTolerance (normalized units) of the
   * stronger one's infinite line. Each merged group keeps the geometry of its
   * longest member, sums the member votes, and must have been observed on at
   * least minPasses distinct passes to be emitted - a transient occluder or
   * compression artifact rarely repeats across temporally spaced frames.
   */
  function mergeBurstLines(passSets, options) {
    var opts = Object.assign({}, CONFIG, options || {});
    var groups = [];
    if (!Array.isArray(passSets)) return [];
    // Strongest-first so the first member of a group anchors the comparison.
    var items = [];
    passSets.forEach(function (passLines, passIndex) {
      if (!Array.isArray(passLines)) return;
      passLines.forEach(function (line) {
        var item = geometryOf(line);
        if (!item) return;
        item.passIndex = passIndex;
        items.push(item);
      });
    });
    items.sort(function (a, b) { return b.votes - a.votes || b.len - a.len; });
    items.forEach(function (item) {
      for (var i = 0; i < groups.length; i++) {
        var ref = groups[i];
        if (angleDelta(item.angle, ref.angle) > opts.angleToleranceDeg) continue;
        // Perpendicular distance from this midpoint to the reference line
        // (cross product of the reference direction and the offset vector).
        var perp = Math.abs(ref.ux * (item.my - ref.my) - ref.uy * (item.mx - ref.mx));
        if (perp > opts.gapTolerance) continue;
        ref.members.push(item);
        return;
      }
      groups.push({ members: [item], angle: item.angle, mx: item.mx, my: item.my, ux: item.ux, uy: item.uy });
    });
    var out = [];
    groups.forEach(function (group) {
      var passSeen = {};
      var votes = 0;
      var anchor = group.members[0];
      group.members.forEach(function (member) {
        passSeen[member.passIndex] = true;
        votes += member.votes;
        if (member.len > anchor.len) anchor = member;
      });
      var passes = Object.keys(passSeen).length;
      if (passes < opts.minPasses) return;
      out.push({
        x1: anchor.x1, y1: anchor.y1, x2: anchor.x2, y2: anchor.y2,
        angle: anchor.angle, votes: votes, passes: passes
      });
    });
    out.sort(function (a, b) { return b.votes - a.votes; });
    return out.slice(0, Math.max(1, Number(opts.maxLines) || 1));
  }

  return {
    CONFIG: CONFIG,
    mergeBurstLines: mergeBurstLines,
    geometryOf: geometryOf,
    angleDelta: angleDelta
  };
});
