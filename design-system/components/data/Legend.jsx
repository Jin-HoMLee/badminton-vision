import React from "react";

/** Says what each colour means. Any coloured mark in this product — dots on the court,
 *  segments in a bar, player rules in the feed — must be explained by one of these. */
export function Legend({ items = [], size = 9, direction = "row", style, ...rest }) {
  return (
    <div style={{ display: "flex", flexDirection: direction, flexWrap: "wrap", gap: direction === "row" ? "8px 18px" : "6px", ...style }} {...rest}>
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", font: "var(--type-ui-sm)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          <span
            style={{
              width: size, height: it.shape === "bar" ? 3 : size, flex: "0 0 auto",
              borderRadius: it.shape === "bar" ? 1 : "var(--radius-pill)",
              background: it.dashed ? "transparent" : it.color,
              border: it.dashed ? `1px dashed ${it.color}` : "none",
            }}
          />
          {it.label}
          {it.value != null && <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>{it.value}</span>}
        </span>
      ))}
    </div>
  );
}
