import React from "react";

/** Progress rail for the four numbered court-seed clicks. */
export function StepDots({ total = 4, current = 0, labels, style, ...rest }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", ...style }} {...rest}>
      {Array.from({ length: total }, (_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span
            key={i}
            title={labels && labels[i]}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "20px",
              height: "20px",
              borderRadius: "var(--radius-pill)",
              font: "var(--type-mono)",
              fontSize: "var(--fs-10)",
              background: done ? "var(--lime-500)" : active ? "var(--lime-tint)" : "var(--ink-600)",
              color: done ? "var(--text-on-accent)" : active ? "var(--lime-500)" : "var(--text-faint)",
              border: `1px solid ${done ? "var(--lime-500)" : active ? "rgba(200,240,74,.5)" : "var(--border-hairline)"}`,
            }}
          >
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}
