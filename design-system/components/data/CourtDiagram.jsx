import React from "react";

/** Canonical BWF court (Laws of Badminton §4.1, Diagram A) drawn from real dimensions in metres:
 *  13.40 × 6.10 m, 40 mm lines, net at y=6.70, short service lines at 4.72 / 8.68,
 *  singles sidelines at 0.46 / 5.64, centre line at 3.05, doubles long service at 0.76 / 12.64.
 *  Coordinates are in metres; the component scales, never re-measures. */
export function CourtDiagram({
  width = 240,
  players = [],
  trajectory,
  landing,
  landings,
  colorBy = "call",
  call,
  showLabels = false,
  style,
  ...rest
}) {
  const M = 0.55; // outside margin in metres
  const W = 6.1 + M * 2;
  const H = 13.4 + M * 2;
  const s = width / W;
  const lw = 0.04;
  const X = (x) => x + M;
  const Y = (y) => y + M;
  const line = (x1, y1, x2, y2, k, opts = {}) => (
    <line key={k} x1={X(x1)} y1={Y(y1)} x2={X(x2)} y2={Y(y2)} stroke="var(--court-line)" strokeWidth={lw} strokeLinecap="square" {...opts} />
  );
  const callColor = call === "IN" ? "var(--signal-in)" : call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width} height={width * (H / W)} style={{ display: "block", ...style }} {...rest}>
      <rect x="0" y="0" width={W} height={H} rx={0.35} fill="var(--court-fill-alt)" />
      <rect x={X(0)} y={Y(0)} width="6.10" height="13.40" fill="var(--court-fill)" />
      {[
        line(0, 0, 6.1, 0, "back-a"),
        line(0, 13.4, 6.1, 13.4, "back-b"),
        line(0, 0, 0, 13.4, "side-l"),
        line(6.1, 0, 6.1, 13.4, "side-r"),
        line(0.46, 0, 0.46, 13.4, "sgl-l", { opacity: 0.75 }),
        line(5.64, 0, 5.64, 13.4, "sgl-r", { opacity: 0.75 }),
        line(0, 4.72, 6.1, 4.72, "svc-a", { opacity: 0.75 }),
        line(0, 8.68, 6.1, 8.68, "svc-b", { opacity: 0.75 }),
        line(0, 0.76, 6.1, 0.76, "dls-a", { opacity: 0.55 }),
        line(0, 12.64, 6.1, 12.64, "dls-b", { opacity: 0.55 }),
        line(3.05, 0, 3.05, 4.72, "ctr-a", { opacity: 0.75 }),
        line(3.05, 8.68, 3.05, 13.4, "ctr-b", { opacity: 0.75 }),
      ]}
      <line x1={X(-0.28)} y1={Y(6.7)} x2={X(6.38)} y2={Y(6.7)} stroke="var(--court-net)" strokeWidth={0.07} />
      <line x1={X(-0.28)} y1={Y(6.7)} x2={X(6.38)} y2={Y(6.7)} stroke="var(--court-net)" strokeWidth={0.24} strokeDasharray="0.09 0.09" opacity="0.35" />
      {trajectory && trajectory.length > 1 && (
        <polyline
          points={trajectory.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}
          fill="none"
          stroke="var(--lime-500)"
          strokeWidth={0.06}
          strokeLinecap="round"
          strokeDasharray="0.22 0.16"
          opacity="0.9"
        />
      )}
      {landing && (
        <g>
          <circle cx={X(landing.x)} cy={Y(landing.y)} r={0.34} fill="none" stroke={callColor} strokeWidth={0.05} opacity="0.55" />
          <circle cx={X(landing.x)} cy={Y(landing.y)} r={0.14} fill={callColor} />
        </g>
      )}
      {landings && landings.map((p, i) => {
        const c = colorBy === "player" ? (p.side === "b" ? "var(--player-b)" : "var(--player-a)") : p.call === "IN" ? "var(--signal-in)" : p.call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)";
        return p.call === "UNKNOWN"
          ? <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={0.13} fill="none" stroke={c} strokeWidth={0.045} strokeDasharray="0.09 0.07" />
          : <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={0.13} fill={c} fillOpacity={0.72} />;
      })}
      {players.map((p, i) => (
        <g key={i}>
          <circle cx={X(p.x)} cy={Y(p.y)} r={0.36} fill={p.side === "b" ? "var(--player-b)" : "var(--player-a)"} opacity="0.22" />
          <circle cx={X(p.x)} cy={Y(p.y)} r={0.19} fill={p.side === "b" ? "var(--player-b)" : "var(--player-a)"} />
        </g>
      ))}
      {showLabels && (
        <g fill="var(--text-faint)" fontSize="0.34" fontFamily="var(--font-mono)">
          <text x={X(3.05)} y={Y(-0.16)} textAnchor="middle">6.10 m</text>
          <text x={X(6.44)} y={Y(6.7)} textAnchor="start" dominantBaseline="middle">net</text>
        </g>
      )}
    </svg>
  );
}
