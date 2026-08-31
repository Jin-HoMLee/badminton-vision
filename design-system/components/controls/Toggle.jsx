import React from "react";

/** Binary panel switch: "Stats panel", "Court minimap", "Show confidence". */
export function Toggle({ checked, onChange, label, description, disabled, id, style, ...rest }) {
  return (
    <label
      htmlFor={id}
      style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.42 : 1, ...style }}
      {...rest}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", font: "var(--type-ui)", color: "var(--text-primary)" }}>{label}</span>
        {description && <span style={{ display: "block", marginTop: "var(--sp-1)", font: "var(--type-ui-sm)", color: "var(--text-faint)" }}>{description}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={!!checked}
        disabled={disabled}
        onClick={() => onChange && onChange(!checked)}
        style={{
          position: "relative",
          width: "34px",
          height: "20px",
          flex: "0 0 auto",
          borderRadius: "var(--radius-pill)",
          border: `1px solid ${checked ? "var(--lime-600)" : "var(--border-subtle)"}`,
          background: checked ? "var(--lime-500)" : "var(--ink-600)",
          cursor: "inherit",
          transition: "var(--transition-control)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: checked ? "16px" : "2px",
            width: "14px",
            height: "14px",
            borderRadius: "var(--radius-pill)",
            background: checked ? "var(--text-on-accent)" : "var(--slate-200)",
            transition: "left var(--dur-fast) var(--ease-standard)",
          }}
        />
      </button>
    </label>
  );
}
