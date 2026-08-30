import React from "react";

/** The overlay's glass container. Every floating surface in the product is a Panel:
 *  header row (drag handle + title + actions), optional media-time stamp, body. */
export function Panel({ title, icon, mediaTime, stale, actions, collapsed, footer, tone = "glass", children, style, bodyStyle, ...rest }) {
  return (
    <section
      style={{
        width: "100%",
        borderRadius: "var(--radius-lg)",
        background: tone === "solid" ? "var(--surface-panel-solid)" : "var(--surface-panel)",
        backdropFilter: tone === "solid" ? undefined : "var(--blur-panel)",
        WebkitBackdropFilter: tone === "solid" ? undefined : "var(--blur-panel)",
        border: "1px solid var(--border-hairline)",
        boxShadow: "var(--shadow-panel)",
        overflow: "hidden",
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-4)",
            height: "32px",
            padding: "0 var(--sp-3) 0 var(--sp-5)",
            borderBottom: collapsed ? "none" : "1px solid var(--border-hairline)",
            background: "rgba(255,255,255,.02)",
          }}
        >
          {icon}
          <h3 style={{ margin: 0, font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-muted)" }}>{title}</h3>
          {mediaTime && (
            <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: stale ? "var(--signal-warn)" : "var(--text-faint)" }}>
              {mediaTime}
              {stale ? " · stale" : ""}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>{actions}</div>
        </header>
      )}
      {!collapsed && <div style={{ padding: "var(--sp-5)", ...bodyStyle }}>{children}</div>}
      {!collapsed && footer && (
        <footer style={{ padding: "var(--sp-4) var(--sp-5)", borderTop: "1px solid var(--border-hairline)", background: "rgba(0,0,0,.18)" }}>{footer}</footer>
      )}
    </section>
  );
}
