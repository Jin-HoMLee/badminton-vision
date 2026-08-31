import React from "react";
import { Badge } from "../core/Badge.jsx";

/** A ranked rally row on the match summary: index score, shots, duration, outcome, review timestamp.
 *  The timestamp is a review affordance only — v1 never seeks the player. */
export function RallyRow({ rank, rallyId, index, shots, duration, outcome = "unclassified", timestamp, partial, onReview, style, ...rest }) {
  const tone = outcome === "winner" ? "in" : outcome === "forced error" ? "warn" : outcome === "unforced error" ? "out" : "unknown";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "22px 44px 1fr auto auto",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-hairline)",
        background: "rgba(255,255,255,.02)",
        ...style,
      }}
      {...rest}
    >
      <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-11)", color: "var(--text-faint)" }}>{rank}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
        <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-18)", fontWeight: "var(--fw-semibold)", color: "var(--lime-500)" }}>{index}</span>
        {partial && <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--signal-warn)" }}>*</span>}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
        <span style={{ font: "var(--type-ui)", color: "var(--text-primary)" }}>Rally {rallyId}</span>
        <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>
          {shots} shots · {duration}
        </span>
      </span>
      <Badge tone={tone}>{outcome}</Badge>
      <button
        type="button"
        onClick={onReview}
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: "var(--control-height-sm)",
          padding: "0 var(--sp-4)",
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-muted)",
          font: "var(--type-mono)",
          fontSize: "var(--fs-11)",
          cursor: "pointer",
          transition: "var(--transition-control)",
        }}
      >
        {timestamp}
      </button>
    </div>
  );
}
