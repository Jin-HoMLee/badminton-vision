import React from "react";

/** Honest empty/blocked state: what is missing, why, and the one action that fixes it. */
export function EmptyState({ icon, title, body, action, compact, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--sp-4)",
        padding: compact ? "var(--sp-6) var(--sp-5)" : "var(--sp-9) var(--sp-6)",
        ...style,
      }}
      {...rest}
    >
      {icon && <span style={{ color: "var(--slate-400)" }}>{icon}</span>}
      <span style={{ font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</span>
      {body && <span style={{ font: "var(--type-body-sm)", color: "var(--text-faint)", maxWidth: "34ch", textWrap: "pretty" }}>{body}</span>}
      {action && <span style={{ marginTop: "var(--sp-2)" }}>{action}</span>}
    </div>
  );
}
