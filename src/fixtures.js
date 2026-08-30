/* Deterministic fixtures stand in for runtime inference until the private adapter exists. */
(function (root) {
  root.BVFixtures = {
    video: {
      title: "Men's Singles Final — full match",
      channel: "Court Side Archive",
      views: "412K views",
      posted: "3 weeks ago",
      duration: "1:12:40",
      url: "https://www.youtube.com/watch?v=badminton-vision-fixture"
    },
    strokes: [
      { eventId: "r14-s01", rallyId: 14, sequence: 1, player: "A", shot: "Serve", time: "12:01.020", status: "accepted", source: "auto", confidence: 0.94 },
      { eventId: "r14-s02", rallyId: 14, sequence: 2, player: "B", shot: "Lift", time: "12:01.760", status: "accepted", source: "auto", confidence: 0.81 },
      { eventId: "r14-s03", rallyId: 14, sequence: 3, player: "A", shot: "Clear", time: "12:02.140", status: "accepted", source: "auto", confidence: 0.91 },
      { eventId: "r14-s04", rallyId: 14, sequence: 4, player: "B", shot: "Drop", time: "12:03.020", status: "corrected", source: "manual", confidence: null },
      { eventId: "r14-s05", rallyId: 14, sequence: 5, player: "A", shot: "Net Shot", time: "12:03.560", status: "accepted", source: "auto", confidence: 0.72 },
      { eventId: "r14-s06", rallyId: 14, sequence: 6, player: "B", shot: null, time: "12:03.980", status: "unclassified", source: "auto", confidence: null }
    ],
    suggestion: { eventId: "r14-s07", rallyId: 14, shot: "Smash", confidence: 0.61, time: "12:04.120" },
    rallies: [
      { rallyId: 1, shots: 8, duration: "11.2s", outcome: "winner", startSec: 61, endSec: 72.2, shotFamilies: ["Serve", "Clear", "Drop"], meanTrackingConfidence: 0.83, tightScore: false },
      { rallyId: 2, shots: 14, duration: "18.6s", outcome: "forced error", startSec: 75, endSec: 93.6, shotFamilies: ["Serve", "Clear", "Smash", "Net Shot"], meanTrackingConfidence: 0.79, tightScore: true },
      { rallyId: 3, shots: 6, duration: "8.4s", outcome: "unforced error", startSec: 98, endSec: 106.4, shotFamilies: ["Serve", "Drop"], meanTrackingConfidence: 0.76, tightScore: false },
      { rallyId: 4, shots: 11, duration: "15.8s", outcome: "winner", startSec: 110, endSec: 125.8, shotFamilies: ["Serve", "Clear", "Lift", "Smash"], meanTrackingConfidence: 0.88, tightScore: false },
      { rallyId: 5, shots: 16, duration: "21.0s", outcome: "unclassified", startSec: 130, endSec: 151, shotFamilies: ["Serve", "Clear", "Drop", "Net Shot"], meanTrackingConfidence: 0.61, tightScore: false, scoreOcrUnavailable: true },
      { rallyId: 6, shots: 9, duration: "12.4s", outcome: "forced error", startSec: 154, endSec: 166.4, shotFamilies: ["Serve", "Drive", "Drop"], meanTrackingConfidence: 0.8, tightScore: false },
      { rallyId: 7, shots: 22, duration: "29.5s", outcome: "winner", startSec: 171, endSec: 200.5, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Shot"], meanTrackingConfidence: 0.9, tightScore: true },
      { rallyId: 8, shots: 13, duration: "17.2s", outcome: "unforced error", startSec: 204, endSec: 221.2, shotFamilies: ["Serve", "Lift", "Drive"], meanTrackingConfidence: 0.74, tightScore: false },
      { rallyId: 9, shots: 27, duration: "36.1s", outcome: "forced error", startSec: 435, endSec: 471.1, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Shot"], meanTrackingConfidence: 0.86, tightScore: false },
      { rallyId: 10, shots: 10, duration: "14.0s", outcome: "winner", startSec: 480, endSec: 494, shotFamilies: ["Serve", "Clear", "Net Kill"], meanTrackingConfidence: 0.82, tightScore: false },
      { rallyId: 14, shots: 24, duration: "31.9s", outcome: "winner", startSec: 721, endSec: 752.9, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Kill"], meanTrackingConfidence: 0.84, tightScore: false },
      { rallyId: 23, shots: 31, duration: "42.6s", outcome: "winner", startSec: 1122, endSec: 1164.6, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Shot", "Drive"], meanTrackingConfidence: 0.78, tightScore: true, scoreOcrUnavailable: true }
    ],
    shotMix: [
      { label: "Clear", value: 84, color: "var(--player-a)" },
      { label: "Drop", value: 61, color: "#2f8f77" },
      { label: "Smash", value: 47, color: "var(--lime-500)" },
      { label: "Net", value: 39, color: "var(--player-b)" },
      { label: "Unclassified", value: 18, color: "var(--signal-unknown)" }
    ],
    outcomeMix: [
      { label: "Winner", value: 31, color: "var(--signal-in)" },
      { label: "Forced error", value: 22, color: "var(--signal-warn)" },
      { label: "Unforced error", value: 27, color: "var(--signal-out)" },
      { label: "Unclassified", value: 12, color: "var(--signal-unknown)" }
    ],
    landings: [
      { x: 0.94, y: 10, side: "a", call: "IN" }, { x: 1.55, y: 2.04, side: "b", call: "IN" },
      { x: 0.73, y: 11.83, side: "a", call: "IN" }, { x: 1.95, y: -0.59, side: "b", call: "OUT" },
      { x: 3.52, y: 9.76, side: "a", call: "IN" }, { x: 2.77, y: 6.06, side: "b", call: "IN" },
      { x: 2.49, y: 11.59, side: "a", call: "IN" }, { x: 3.39, y: 3.67, side: "b", call: "IN" },
      { x: 5.48, y: 13.96, side: "a", call: "UNKNOWN" }, { x: 6.64, y: 1.15, side: "b", call: "UNKNOWN" },
      { x: 6.61, y: 11.56, side: "a", call: "OUT" }, { x: 1.9, y: -0.6, side: "b", call: "OUT" },
      { x: 2.99, y: 11.8, side: "a", call: "UNKNOWN" }, { x: 4.29, y: 4.38, side: "b", call: "UNKNOWN" },
      { x: 0.52, y: 10.34, side: "a", call: "IN" }, { x: 2.83, y: 2.55, side: "b", call: "IN" },
      { x: 2.72, y: 9.37, side: "a", call: "IN" }, { x: 2.4, y: 2.1, side: "b", call: "IN" },
      { x: 3.42, y: 10.26, side: "a", call: "IN" }, { x: 0.94, y: 4.26, side: "b", call: "IN" },
      { x: -0.28, y: 10.86, side: "a", call: "UNKNOWN" }, { x: 6.52, y: 0.59, side: "b", call: "OUT" },
      { x: 2.78, y: 12.74, side: "a", call: "UNKNOWN" }, { x: 5.21, y: 2.5, side: "b", call: "IN" },
      { x: 2.93, y: 10.12, side: "a", call: "IN" }, { x: 2.85, y: -0.52, side: "b", call: "OUT" },
      { x: 3.51, y: 13.81, side: "a", call: "OUT" }, { x: 5.81, y: 5.03, side: "b", call: "IN" }
    ],
    axes: [
      { label: "Longitudinal", options: ["rear", "mid", "front"], value: "rear" },
      { label: "Lateral", options: ["forehand", "centre", "backhand"], value: "forehand" },
      { label: "Timing", options: ["early", "normal", "late"], value: "normal" },
      { label: "Intention", options: ["offensive", "neutral", "defensive"], value: "offensive" },
      { label: "Impact", options: ["above", "shoulder", "below"], value: "above" },
      { label: "Direction", options: ["straight", "cross", "centre"], value: "cross" }
    ]
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
