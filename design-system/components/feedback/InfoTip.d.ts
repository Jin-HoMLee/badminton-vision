import * as React from "react";
export interface InfoTipProps {
  /** The term being explained; shown as the tooltip's uppercase title and in the aria-label. */
  term?: string;
  /** One plain-English sentence. No jargon, no second tooltip inside it. */
  children: React.ReactNode;
  side?: "top" | "bottom";
  size?: number;
  style?: React.CSSProperties;
}
export declare function InfoTip(props: InfoTipProps): JSX.Element;
