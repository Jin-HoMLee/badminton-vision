import React from "react";
import { Icon } from "../core/Icon.jsx";

const TONES = {
  guide: ["var(--lime-tint)", "rgba(200,240,74,.35)", "var(--lime-500)", "lightbulb"],
  info: ["var(--signal-info-tint)", "rgba(98,182,255,.35)", "var(--signal-info)", "info"],
  warn: ["var(--signal-warn-tint)", "rgba(255,176,32,.35)", "var(--signal-warn)", "triangle-alert"],
  quiet: ["rgba(255,255,255,.03)", "var(--border-hairline)", "var(--text-faint)", "info"],
};

let tooltipSeq = 0;
function firstSentence(text) {
  const match = /^([\s\S]*?\.)\s+[\s\S]+$/.exec(String(text == null ? "" : text));
  return match ? match[1] : null;
}

/** A one-line explanation of what the user is looking at or what to do next.
 *  Used at the top of any surface a first-time user could misread.
 *  `tooltip` collapses multi-sentence body copy to its first sentence with an
 *  ellipsis, opening the full body in a tooltip on hover or keyboard focus — so a
 *  callout never grows into standing paragraph text. Nothing is lost for keyboard
 *  or screen-reader users: the summary is focusable and `aria-describedby` points
 *  at the tooltip node, which always holds the whole body. Single-sentence bodies
 *  have nothing to collapse and render plainly regardless of this prop. */
export function Callout({ tone = "guide", icon, title, children, action, onDismiss, tooltip, style, ...rest }) {
  const [bg, bd, fg, defaultIcon] = TONES[tone] || TONES.guide;
  const fullText = typeof children === "string" ? children : null;
  const summary = tooltip && fullText ? firstSentence(fullText) : null;
  const compact = summary !== null && summary.length < (fullText || "").length;
  const tooltipId = React.useMemo(() => compact ? `bv-callout-tooltip-${++tooltipSeq}` : null, [compact]);
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
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, position: compact ? "relative" : undefined }}>
        {title && <span style={{ font: "var(--type-ui)", color: "var(--text-primary)" }}>{title}</span>}
        {compact ? (
          <React.Fragment>
            <span tabIndex={0} aria-describedby={tooltipId} style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", cursor: "help", font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>{summary}</span>
            <span role="tooltip" id={tooltipId} style={{ display: "none", position: "absolute", zIndex: 40, left: 0, top: "calc(100% + 6px)", width: 244, maxWidth: "70vw", boxSizing: "border-box", padding: "9px 11px", borderRadius: "var(--radius-md)", background: "var(--ink-800)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-raised)", textAlign: "left", whiteSpace: "normal", font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", lineHeight: "var(--lh-normal)", color: "var(--text-body)" }} className="bv-ds-callout-tooltip">{fullText}</span>
          </React.Fragment>
        ) : (
          <span style={{ font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", lineHeight: "var(--lh-normal)", color: "var(--text-muted)", textWrap: "pretty" }}>{children}</span>
        )}
        {action && <span style={{ marginTop: "var(--sp-3)" }}>{action}</span>}
      </span>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--text-faint)" }}>
          <Icon name="x" size={13} />
        </button>
      )}
      {compact && (
        <style>{`.bv-ds-callout-tooltip{}
span:focus-within > .bv-ds-callout-tooltip, span:hover > .bv-ds-callout-tooltip{display:block !important}`}</style>
      )}
    </div>
  );
}
