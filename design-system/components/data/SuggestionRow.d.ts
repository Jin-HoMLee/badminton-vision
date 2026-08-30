import * as React from "react";
export interface SuggestionRowProps {
  shot: string;
  confidence?: number | null;
  time?: string;
  onAccept?: () => void;
  onCorrect?: () => void;
  style?: React.CSSProperties;
}
export declare function SuggestionRow(props: SuggestionRowProps): JSX.Element;
