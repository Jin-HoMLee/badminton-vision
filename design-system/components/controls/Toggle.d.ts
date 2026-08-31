import * as React from "react";
/**
 * Binary switch.
 * @startingPoint section="Controls" subtitle="Toggles, density segments, the 11-shot picker" viewport="700x340"
 */
export interface ToggleProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label: string;
  /** One quiet clarifying line under the label. */
  description?: string;
  disabled?: boolean;
  id?: string;
  style?: React.CSSProperties;
}
export declare function Toggle(props: ToggleProps): JSX.Element;
