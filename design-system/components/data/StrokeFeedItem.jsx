import React from "react";
import { Badge } from "../core/Badge.jsx";
import { ConfidenceMeter } from "../feedback/ConfidenceMeter.jsx";

const STATUS_TONE = { suggested: "warn", accepted: "in", corrected: "info", unclassified: "unknown" };

/** One observed (never predicted) event in the stroke feed. */
export function StrokeFeedItem({ sequence, player = "A", shot, time, status = "accepted", source = "auto", confidence, selected, onClick, style, ...rest }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "18px 3px 1fr auto",
        alignItems: "center",
        gap: "var(--sp-4)",
        padding: "var(--sp-3) var(--sp-4)",
        borderRadius: "var(--radius-sm)",
        background: selected ? "var(--surface-active)" : "transparent",
        cursor: onClick ? "pointer" : "default",
        transition: "var(--transition-control)",
        ...style,
      }}
      {...rest}
    >
      <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)", textAlign: "right" }}>{sequence}</span>
      <span style={{ width: "3px", height: "18px", borderRadius: "2px", background: player === "B" ? "var(--player-b)" : "var(--player-a)" }} />
      <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: "var(--sp-4)" }}>
        <span style={{ font: "var(--type-ui)", color: status === "unclassified" ? "var(--text-faint)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {status === "unclassified" ? "unclassified" : shot}
        </span>
        <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>{time}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        {confidence !== undefined && <ConfidenceMeter value={confidence} size="sm" showValue={false} />}
        <Badge tone={STATUS_TONE[status] || "neutral"}>{source === "manual" ? "manual" : status}</Badge>
      </span>
    </div>
  );
}
