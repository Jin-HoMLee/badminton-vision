import * as React from "react";
export interface ShotPickerProps {
  /** Currently chosen shot family. */
  value?: string;
  onChange?: (shot: string) => void;
  /** Auto-suggested family — rendered dashed/accented and always overridable. */
  suggested?: string;
  columns?: number;
  showKeys?: boolean;
  style?: React.CSSProperties;
}
export declare const SHOT_FAMILIES: string[];
export declare function ShotPicker(props: ShotPickerProps): JSX.Element;
