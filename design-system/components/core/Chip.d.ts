import * as React from "react";
export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: React.ReactNode;
  /** Optional trailing count, rendered in mono. */
  count?: number;
}
export declare function Chip(props: ChipProps): JSX.Element;
