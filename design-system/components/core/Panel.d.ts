import * as React from "react";
export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  title?: string;
  icon?: React.ReactNode;
  /** Media time this panel's content represents, e.g. "12:04.320". Required on live panels. */
  mediaTime?: string;
  /** Marks the media time as lagging playback (analysis-age indicator). */
  stale?: boolean;
  actions?: React.ReactNode;
  collapsed?: boolean;
  footer?: React.ReactNode;
  /** glass = over video; solid = inside the popup. */
  tone?: "glass" | "solid";
  bodyStyle?: React.CSSProperties;
}
export declare function Panel(props: PanelProps): JSX.Element;
