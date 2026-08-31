import * as React from "react";
export interface StepDotsProps {
  total?: number;
  /** Number of completed steps; the dot at this index is the active one. */
  current?: number;
  /** Per-step tooltips, e.g. ["Near left","Near right","Far right","Far left"]. */
  labels?: string[];
  style?: React.CSSProperties;
}
export declare function StepDots(props: StepDotsProps): JSX.Element;
