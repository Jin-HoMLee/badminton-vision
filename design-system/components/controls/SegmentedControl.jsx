import React from "react";

/** Mutually exclusive choice in one row — density (Minimal / Balanced / Full), summary tabs. */
export function SegmentedControl({ options = [], value, onChange, size = "md", full, style, ...rest }) {
  const h = size === "sm" ? "var(--control-height-sm)" : "var(--control-height-md)";
  return (
    <div
      role="radiogroup"
      style={{
        display: full ? "flex" : "inline-flex",
        width: full ? "100%" : undefined,
        padding: "2px",
        gap: "2px",
        borderRadius: "var(--radius-md)",
        background: "var(--ink-700)",
        border: "1px solid var(--border-hairline)",
        ...style,
      }}
      {...rest}
    >
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={opt.disabled}
            onClick={() => onChange && onChange(opt.value)}
            style={{
              flex: full ? 1 : "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--sp-3)",
              height: h,
              padding: "0 var(--sp-5)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid transparent",
              font: "var(--type-ui-sm)",
              cursor: opt.disabled ? "not-allowed" : "pointer",
              opacity: opt.disabled ? 0.42 : 1,
              transition: "var(--transition-control)",
              background: on ? "var(--ink-500)" : "transparent",
              color: on ? "var(--text-primary)" : "var(--text-faint)",
              borderColor: on ? "var(--border-subtle)" : "transparent",
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
