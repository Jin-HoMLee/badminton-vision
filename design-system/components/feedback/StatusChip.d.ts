import * as React from "react";
/**
 * Quiet live status chip.
 * @startingPoint section="Feedback" subtitle="Status chip, confidence meter, empty states, seed steps" viewport="700x300"
 */
export interface StatusChipProps {
  state?: "ready" | "live" | "waiting" | "stale" | "error" | "off";
  label?: string;
  /** Mono detail, usually a media time or an analysis age like "+0.4s". */
  detail?: string;
  pulse?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function StatusChip(props: StatusChipProps): JSX.Element;
