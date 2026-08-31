import React from "react";

const band = (v) => (v == null ? "unknown" : v >= 0.75 ? "high" : v >= 0.45 ? "medium" : "low");
const COLORS = { high: "var(--conf-high)", medium: "var(--conf-medium)", low: "var(--conf-low)", unknown: "var(--conf-unknown)" };
const WORDS = { high: "sure", medium: "fairly sure", low: "not sure", unknown: "unknown" };

/** Confidence is shown as a 4-segment bar, never as a bare percentage that reads like certainty.
 *  `value == null` renders the honest "unknown" state required by the PRD. */
export function ConfidenceMeter({ value, label, showValue = true, showWord = false, size = "md", style, ...rest }) {
  const b = band(value);
  const color = COLORS[b];
  const filled = value == null ? 0 : Math.max(1, Math.round(value * 4));
  const w = size === "sm" ? 6 : 9;
  const h = size === "sm" ? 3 : 4;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", ...style }} title={value == null ? "confidence unknown" : `confidence ${Math.round(value * 100)}%`} {...rest}>
      {label && <span style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</span>}
      <span style={{ display: "inline-flex", gap: "2px" }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ width: `${w}px`, height: `${h}px`, borderRadius: "1px", background: i < filled ? color : "var(--ink-500)" }} />
        ))}
      </span>
      {(showValue || showWord) && (
        <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: value == null ? "var(--conf-unknown)" : color }}>
          {value == null ? "unknown" : `${showWord ? WORDS[b] + " " : ""}${showValue ? Math.round(value * 100) + "%" : ""}`.trim()}
        </span>
      )}
    </span>
  );
}
