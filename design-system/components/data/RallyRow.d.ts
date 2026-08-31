import * as React from "react";
export interface RallyRowProps {
  rank: number;
  rallyId: number | string;
  /** Highlights index, 0–100, deterministic. */
  index: number;
  shots: number;
  duration: string;
  outcome?: "winner" | "forced error" | "unforced error" | "unclassified";
  /** Review affordance only — v1 never seeks the player. */
  timestamp: string;
  /** Marks a partial index component (e.g. score OCR unavailable). */
  partial?: boolean;
  onReview?: () => void;
  style?: React.CSSProperties;
}
export declare function RallyRow(props: RallyRowProps): JSX.Element;
