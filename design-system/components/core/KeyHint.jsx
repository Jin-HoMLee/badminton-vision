import React from "react";

/** Keyboard shortcut glyph. The labeling flow is keyboard-first, so shortcuts are shown, never hidden. */
export function KeyHint({ children, tone = "neutral", style, ...rest }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "18px",
        height: "18px",
        padding: "0 var(--sp-2)",
        borderRadius: "var(--radius-xs)",
        background: tone === "accent" ? "var(--lime-tint)" : "var(--ink-600)",
        color: tone === "accent" ? "var(--lime-500)" : "var(--text-faint)",
        border: `1px solid ${tone === "accent" ? "rgba(200,240,74,.35)" : "var(--border-subtle)"}`,
        boxShadow: "0 1px 0 rgba(0,0,0,.5)",
        font: "var(--type-mono)",
        fontSize: "var(--fs-10)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </kbd>
  );
}
