import * as React from "react";
export interface DimensionAxisProps {
  /** One of: longitudinal position, lateral position, timing, intention, impact, direction. */
  label: string;
  options: string[];
  value?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}
export declare function DimensionAxis(props: DimensionAxisProps): JSX.Element;
