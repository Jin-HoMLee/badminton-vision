import * as React from "react";
export interface CalloutProps {
  /** guide = what this is / what to do next · info = context · warn = degraded state · quiet = footnote. */
  tone?: "guide" | "info" | "warn" | "quiet";
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}
export declare function Callout(props: CalloutProps): JSX.Element;
