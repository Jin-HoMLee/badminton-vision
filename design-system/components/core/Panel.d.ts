import * as React from "react";
export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  title?: string;
  icon?: React.ReactNode;
  /** Media time this panel's content represents, e.g. "12:04.320". Required on live panels. */
  mediaTime?: string;
  /** Marks the media time as lagging playback (analysis-age indicator). */
  stale?: boolean;
  /** Caller-supplied actions (e.g. a close/hide button). These unmount the panel — distinct
   *  from the built-in collapse chevron, which keeps the header mounted. */
  actions?: React.ReactNode;
  /** Controlled collapsed state. Omit to let the panel manage its own collapse toggle. */
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
  /** Shows the built-in header collapse/expand chevron on a draggable panel. Default true. */
  collapsible?: boolean;
  /** Shows a bottom-right resize grip (drag, or focus + arrow keys; Home resets). Defaults to
   *  the value of `draggable`. */
  resizable?: boolean;
  footer?: React.ReactNode;
  /** glass = over video; solid = inside the popup. */
  tone?: "glass" | "solid";
  bodyStyle?: React.CSSProperties;
  /** Makes the header a grab handle: pointer-drag, or focus it and use the arrow keys
   *  (Home returns the panel home). The panel keeps its layout slot and moves by
   *  transform, so dragging one never reflows its siblings. Use on every panel that
   *  floats over video — it may be covering something the viewer wants to see. */
  draggable?: boolean;
}
export declare function Panel(props: PanelProps): JSX.Element;
