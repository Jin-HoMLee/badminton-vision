import React from "react";
import { Icon } from "../core/Icon.jsx";

const TONES = {
  guide: ["var(--lime-tint)", "rgba(200,240,74,.35)", "var(--lime-500)", "lightbulb"],
  info: ["var(--signal-info-tint)", "rgba(98,182,255,.35)", "var(--signal-info)", "info"],
  warn: ["var(--signal-warn-tint)", "rgba(255,176,32,.35)", "var(--signal-warn)", "triangle-alert"],
  quiet: ["rgba(255,255,255,.03)", "var(--border-hairline)", "var(--text-faint)", "info"],
};

/** A one-line explanation of what the user is looking at or what to do next.
 *  Used at the top of any surface a first-time user could misread. */
export function Callout({ tone = "guide", icon, title, children, action, onDismiss, style, ...rest }) {
  const [bg, bd, fg, defaultIcon] = TONES[tone] || TONES.guide;
  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: "var(--sp-4)",
        padding: "var(--sp-4) var(--sp-5)", borderRadius: "var(--radius-md)",
        background: bg, border: `1px solid ${bd}`, ...style,
      }}
      {...rest}
    >
      <span style={{ color: fg, paddingTop: 1 }}>{icon || <Icon name={defaultIcon} size={14} />}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {title && <span style={{ font: "var(--type-ui)", color: "var(--text-primary)" }}>{title}</span>}
        <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", lineHeight: "var(--lh-normal)", color: "var(--text-muted)", textWrap: "pretty" }}>{children}</span>
        {action && <span style={{ marginTop: "var(--sp-3)" }}>{action}</span>}
      </span>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--text-faint)" }}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}
