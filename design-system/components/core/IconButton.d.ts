import * as React from "react";
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  /** Required: becomes aria-label and title. */
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "solid";
  active?: boolean;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
