import * as React from "react";
/**
 * Text action button.
 * @startingPoint section="Core" subtitle="Buttons, badges, chips and the glass panel shell" viewport="700x300"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the single committing action on a surface. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Stretch to the container width (popup footers). */
  full?: boolean;
  /** Ghost buttons only: persistent on-state for toggled toolbar actions. */
  active?: boolean;
}
export declare function Button(props: ButtonProps): JSX.Element;
