import React from "react";

/** One of the five shuttle-insights dimension axes rendered as a compact labelled option row. */
export function DimensionAxis({ label, options = [], value, onChange, style, ...rest }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", ...style }} {...rest}>
      <span style={{ width: "84px", flex: "0 0 auto", font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
        {options.map((o) => {
          const on = o === value;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange && onChange(o)}
              style={{
                height: "22px",
                padding: "0 var(--sp-4)",
                borderRadius: "var(--radius-xs)",
                font: "var(--type-ui-sm)",
                fontSize: "var(--fs-11)",
                cursor: "pointer",
                transition: "var(--transition-control)",
                background: on ? "var(--surface-active)" : "transparent",
                color: on ? "var(--text-primary)" : "var(--text-faint)",
                border: `1px solid ${on ? "var(--border-strong)" : "var(--border-hairline)"}`,
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
