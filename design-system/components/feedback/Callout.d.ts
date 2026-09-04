import * as React from "react";
export interface CalloutProps {
  /** guide = what this is / what to do next · info = context · warn = degraded state · quiet = footnote. */
  tone?: "guide" | "info" | "warn" | "quiet";
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  /** Collapses a multi-sentence string body to its first sentence, opening the full body
   *  in a tooltip on hover/keyboard focus. No effect on single-sentence or non-string bodies. */
  tooltip?: boolean;
  style?: React.CSSProperties;
}
export declare function Callout(props: CalloutProps): JSX.Element;
