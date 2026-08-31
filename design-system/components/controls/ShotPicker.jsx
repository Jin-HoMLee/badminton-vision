import React from "react";
import { KeyHint } from "../core/KeyHint.jsx";

export const SHOT_FAMILIES = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push", "Drive", "Block"];

/** The 11-shot taxonomy grid carried over from shuttle-insights. Keys 1–9 map to the first nine. */
export function ShotPicker({ value, onChange, suggested, columns = 4, showKeys = true, style, ...rest }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns},1fr)`, gap: "var(--sp-3)", ...style }} {...rest}>
      {SHOT_FAMILIES.map((shot, i) => {
        const on = value === shot;
        const isSuggested = !on && suggested === shot;
        return (
          <button
            key={shot}
            type="button"
            aria-pressed={on}
            onClick={() => onChange && onChange(shot)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--sp-3)",
              height: "var(--control-height-lg)",
              padding: "0 var(--sp-4)",
              borderRadius: "var(--radius-sm)",
              font: "var(--type-ui-sm)",
              cursor: "pointer",
              textAlign: "left",
              transition: "var(--transition-control)",
              background: on ? "var(--lime-500)" : "var(--surface-raised)",
              color: on ? "var(--text-on-accent)" : isSuggested ? "var(--lime-400)" : "var(--text-body)",
              border: `1px ${isSuggested ? "dashed" : "solid"} ${on ? "var(--lime-500)" : isSuggested ? "rgba(200,240,74,.55)" : "var(--border-hairline)"}`,
            }}
          >
            {shot}
            {showKeys && i < 9 && <KeyHint tone={on ? "accent" : "neutral"}>{i + 1}</KeyHint>}
          </button>
        );
      })}
    </div>
  );
}
