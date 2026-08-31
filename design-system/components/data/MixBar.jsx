import React from "react";

/** Horizontal proportion bar for shot mix / winner-error mix. Unknown share is always drawn. */
export function MixBar({ segments = [], height = 8, showLegend = true, style, ...rest }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", ...style }} {...rest}>
      <div style={{ display: "flex", gap: "2px", height: `${height}px`, borderRadius: "var(--radius-xs)", overflow: "hidden" }}>
        {segments.map((s, i) => (
          <span key={i} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color || "var(--signal-unknown)" }} />
        ))}
      </div>
      {showLegend && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3) var(--sp-5)" }}>
          {segments.map((s, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "2px", background: s.color || "var(--signal-unknown)" }} />
              {s.label}
              <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>{Math.round((s.value / total) * 100)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
