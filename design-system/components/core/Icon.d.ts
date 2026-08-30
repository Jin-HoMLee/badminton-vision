import * as React from "react";
export interface IconProps extends React.SVGAttributes<SVGElement> {
  /** Lucide icon name, kebab or Pascal ("circle-play" | "CirclePlay"). */
  name: string;
  /** Pixel size. Overlay chrome uses 14–16; popup actions 16; empty states 20. */
  size?: number;
  strokeWidth?: number;
  color?: string;
}
export declare function Icon(props: IconProps): JSX.Element;
