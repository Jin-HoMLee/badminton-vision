import React from "react";

/** A single statistic. Mono numerals, uppercase micro-label, optional unit and partial-data note. */
export function StatTile({ label, value, unit, note, tone = "default", align = "left", style, ...rest }) {
  const color = tone === "accent" ? "var(--lime-500)" : tone === "muted" ? "var(--text-faint)" : "var(--text-primary)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", alignItems: align === "center" ? "center" : "flex-start", ...style }} {...rest}>
      <span style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)" }}>
        <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-22)", fontWeight: "var(--fw-semibold)", color, letterSpacing: "var(--ls-tight)" }}>{value}</span>
        {unit && <span style={{ font: "var(--type-ui-sm)", color: "var(--text-faint)" }}>{unit}</span>}
      </span>
      {note && <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-faint)" }}>{note}</span>}
    </div>
  );
}
