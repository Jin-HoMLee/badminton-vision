import React from "react";

const SIZES = {
  sm: { height: "var(--control-height-sm)", padding: "0 var(--sp-4)", font: "var(--type-ui-sm)", gap: "var(--sp-3)" },
  md: { height: "var(--control-height-md)", padding: "0 var(--sp-5)", font: "var(--type-ui)", gap: "var(--sp-3)" },
  lg: { height: "var(--control-height-lg)", padding: "0 var(--sp-6)", font: "var(--type-ui)", gap: "var(--sp-4)" },
};

const VARIANTS = {
  primary: { background: "var(--accent)", color: "var(--text-on-accent)", border: "1px solid var(--accent)" },
  secondary: { background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" },
  ghost: { background: "transparent", color: "var(--text-muted)", border: "1px solid transparent" },
  danger: { background: "var(--signal-out-tint)", color: "var(--signal-out)", border: "1px solid rgba(255,107,90,.4)" },
};

/** The system's one text-action control. Exactly one `primary` per surface. */
export function Button({ variant = "secondary", size = "md", icon, iconRight, full, disabled, active, children, style, ...rest }) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  return (
    <button
      type="button"
      disabled={disabled}
      data-variant={variant}
      style={{
        display: full ? "flex" : "inline-flex",
        width: full ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        font: s.font,
        letterSpacing: "var(--ls-wide)",
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.42 : 1,
        transition: "var(--transition-control)",
        whiteSpace: "nowrap",
        ...v,
        ...(active && variant === "ghost" ? { background: "var(--surface-active)", color: "var(--text-primary)" } : null),
        ...style,
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "translateY(1px)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "none")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}
