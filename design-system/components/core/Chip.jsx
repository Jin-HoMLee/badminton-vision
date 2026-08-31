import React from "react";

/** Selectable pill: shot-family filters, density presets, rally chips. */
export function Chip({ selected, disabled, icon, count, children, style, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={!!selected}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: "var(--control-height-sm)",
        padding: "0 var(--sp-4)",
        borderRadius: "var(--radius-pill)",
        font: "var(--type-ui-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.42 : 1,
        transition: "var(--transition-control)",
        background: selected ? "var(--lime-tint)" : "var(--surface-raised)",
        color: selected ? "var(--lime-500)" : "var(--text-muted)",
        border: `1px solid ${selected ? "rgba(200,240,74,.45)" : "var(--border-hairline)"}`,
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
      {count != null && (
        <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-11)", color: selected ? "var(--lime-400)" : "var(--text-faint)" }}>{count}</span>
      )}
    </button>
  );
}
