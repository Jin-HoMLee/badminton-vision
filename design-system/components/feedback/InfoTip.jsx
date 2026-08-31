import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Explain-on-demand. A quiet (?) next to any term the product invented; hover or focus
 *  reveals one plain-English sentence. Never used to hide something the user must read. */
export function InfoTip({ term, children, side = "top", size = 13, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", ...style }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      {...rest}
    >
      <button
        type="button"
        aria-label={term ? `What is ${term}?` : "More information"}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: size + 3, height: size + 3, padding: 0, borderRadius: "var(--radius-pill)",
          background: "transparent", border: "1px solid var(--border-subtle)",
          color: open ? "var(--lime-500)" : "var(--text-faint)", cursor: "help",
          transition: "var(--transition-control)", borderColor: open ? "rgba(200,240,74,.45)" : "var(--border-subtle)",
        }}
      >
        <Icon name="help-circle" size={size - 3} />
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute", zIndex: 40, width: 244,
            left: "50%", transform: "translateX(-50%)",
            [side === "bottom" ? "top" : "bottom"]: "calc(100% + 8px)",
            padding: "9px 11px", borderRadius: "var(--radius-md)",
            background: "var(--ink-800)", border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-raised)", textAlign: "left", textWrap: "pretty",
          }}
        >
          {term && <span style={{ display: "block", font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--lime-500)", marginBottom: 4 }}>{term}</span>}
          <span style={{ display: "block", font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", lineHeight: "var(--lh-normal)", color: "var(--text-body)" }}>{children}</span>
        </span>
      )}
    </span>
  );
}
