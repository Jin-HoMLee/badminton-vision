import * as React from "react";
export interface LegendItem {
  color: string;
  label: string;
  /** Optional count or percentage, rendered in mono. */
  value?: React.ReactNode;
  /** Dashed ring instead of a filled dot — the system's "unknown / not measured" mark. */
  dashed?: boolean;
  shape?: "dot" | "bar";
}
export interface LegendProps {
  items: LegendItem[];
  size?: number;
  direction?: "row" | "column";
  style?: React.CSSProperties;
}
export declare function Legend(props: LegendProps): JSX.Element;
