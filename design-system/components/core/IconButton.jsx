import React from "react";

/** Square icon-only control for overlay chrome: collapse, drag, close, undo. */
export function IconButton({ icon, label, size = "md", variant = "ghost", active, disabled, style, ...rest }) {
  const dim = size === "sm" ? "var(--control-height-sm)" : size === "lg" ? "var(--control-height-lg)" : "var(--control-height-md)";
  const tone =
    variant === "solid"
      ? { background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }
      : { background: active ? "var(--surface-active)" : "transparent", border: "1px solid transparent", color: active ? "var(--text-primary)" : "var(--text-muted)" };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.42 : 1,
        transition: "var(--transition-control)",
        ...tone,
        ...style,
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}
