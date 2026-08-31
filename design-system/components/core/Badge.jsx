import React from "react";

const TONES = {
  neutral: ["var(--surface-active)", "var(--text-muted)", "var(--border-subtle)"],
  accent: ["var(--lime-tint)", "var(--lime-500)", "rgba(200,240,74,.4)"],
  in: ["var(--signal-in-tint)", "var(--signal-in)", "rgba(63,212,139,.4)"],
  out: ["var(--signal-out-tint)", "var(--signal-out)", "rgba(255,107,90,.4)"],
  warn: ["var(--signal-warn-tint)", "var(--signal-warn)", "rgba(255,176,32,.4)"],
  info: ["var(--signal-info-tint)", "var(--signal-info)", "rgba(98,182,255,.4)"],
  unknown: ["var(--signal-unknown-tint)", "var(--signal-unknown)", "rgba(122,139,150,.4)"],
};

/** Small non-interactive status label: shot status, IN/OUT, `auto`/`manual` provenance. */
export function Badge({ tone = "neutral", uppercase = true, icon, children, style, ...rest }) {
  const [bg, fg, bd] = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        height: "18px",
        padding: "0 var(--sp-3)",
        borderRadius: "var(--radius-xs)",
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        font: "var(--type-label)",
        letterSpacing: "var(--ls-caps)",
        textTransform: uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
