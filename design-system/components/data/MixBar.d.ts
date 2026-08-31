import * as React from "react";
export interface MixSegment { label: string; value: number; color?: string }
export interface MixBarProps {
  segments: MixSegment[];
  height?: number;
  showLegend?: boolean;
  style?: React.CSSProperties;
}
export declare function MixBar(props: MixBarProps): JSX.Element;
