import React from "react";

const STATES = {
  ready: ["var(--signal-in)", "Ready"],
  live: ["var(--lime-500)", "Live"],
  waiting: ["var(--signal-warn)", "Waiting"],
  stale: ["var(--signal-warn)", "Stale"],
  error: ["var(--signal-out)", "Error"],
  off: ["var(--signal-unknown)", "Off"],
};

/** The always-present quiet status chip — Minimal density's entire visible footprint. */
export function StatusChip({ state = "off", label, detail, pulse, onClick, style, ...rest }) {
  const [color, fallback] = STATES[state] || STATES.off;
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        height: "26px",
        padding: "0 var(--sp-5)",
        borderRadius: "var(--radius-pill)",
        background: "var(--surface-panel)",
        backdropFilter: "var(--blur-chip)",
        WebkitBackdropFilter: "var(--blur-chip)",
        border: "1px solid var(--border-hairline)",
        boxShadow: "var(--shadow-chip)",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
      {...rest}
    >
      <span style={{ position: "relative", display: "inline-flex", width: "7px", height: "7px" }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "999px", background: color }} />
        {(pulse || state === "live") && (
          <span style={{ position: "absolute", inset: "-3px", borderRadius: "999px", border: `1px solid ${color}`, opacity: 0.45 }} />
        )}
      </span>
      <span style={{ font: "var(--type-ui-sm)", color: "var(--text-primary)" }}>{label || fallback}</span>
      {detail && <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-11)", color: "var(--text-faint)" }}>{detail}</span>}
    </div>
  );
}
