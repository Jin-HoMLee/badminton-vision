import * as React from "react";
export interface KeyHintProps extends React.HTMLAttributes<HTMLElement> {
  tone?: "neutral" | "accent";
}
export declare function KeyHint(props: KeyHintProps): JSX.Element;
