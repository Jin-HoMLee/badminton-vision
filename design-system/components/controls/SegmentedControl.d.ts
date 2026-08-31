import * as React from "react";
export interface SegmentedOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}
export interface SegmentedControlProps {
  options: Array<SegmentedOption | string>;
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  full?: boolean;
  style?: React.CSSProperties;
}
export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
