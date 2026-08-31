import * as React from "react";
export interface StrokeFeedItemProps {
  sequence: number;
  player?: "A" | "B";
  shot?: string;
  /** Media time of the hit, e.g. "12:03.980". */
  time?: string;
  status?: "suggested" | "accepted" | "corrected" | "unclassified";
  source?: "auto" | "manual" | "corrected";
  /** 0–1 or null for unknown. */
  confidence?: number | null;
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function StrokeFeedItem(props: StrokeFeedItemProps): JSX.Element;
