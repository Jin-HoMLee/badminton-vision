import * as React from "react";
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone. `unknown` is a first-class state, never omit it. */
  tone?: "neutral" | "accent" | "in" | "out" | "warn" | "info" | "unknown";
  uppercase?: boolean;
  icon?: React.ReactNode;
}
export declare function Badge(props: BadgeProps): JSX.Element;
