import * as React from "react";
export interface ConfidenceMeterProps {
  /** 0–1, or null/undefined for the explicit unknown state. */
  value?: number | null;
  label?: string;
  showValue?: boolean;
  /** Say it in words — "sure" / "fairly sure" / "not sure" / "unknown" — instead of a bare number. */
  showWord?: boolean;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}
export declare function ConfidenceMeter(props: ConfidenceMeterProps): JSX.Element;
