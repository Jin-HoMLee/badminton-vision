import React from "react";
import { Button } from "../core/Button.jsx";
import { KeyHint } from "../core/KeyHint.jsx";
import { ConfidenceMeter } from "../feedback/ConfidenceMeter.jsx";

/** Inline `suggested shot · confidence · accept / correct` row — labeling is inline-first. */
export function SuggestionRow({ shot, confidence, time, onAccept, onCorrect, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        padding: "var(--sp-4)",
        borderRadius: "var(--radius-sm)",
        background: "var(--lime-tint)",
        border: "1px dashed rgba(200,240,74,.5)",
        ...style,
      }}
      {...rest}
    >
      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)" }}>
          <span style={{ font: "var(--type-label)", letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--lime-600)" }}>looks like</span>
          <span style={{ font: "var(--type-ui)", color: "var(--text-primary)" }}>{shot}</span>
          {time && <span style={{ font: "var(--type-mono)", fontSize: "var(--fs-10)", color: "var(--text-faint)" }}>{time}</span>}
        </span>
        <ConfidenceMeter value={confidence} size="sm" showWord />
      </span>
      <Button size="sm" variant="primary" onClick={onAccept} iconRight={<KeyHint>↵</KeyHint>}>Looks right</Button>
      <Button size="sm" variant="ghost" onClick={onCorrect} iconRight={<KeyHint>O</KeyHint>}>Change it</Button>
    </div>
  );
}
