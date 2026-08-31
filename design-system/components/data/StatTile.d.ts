import * as React from "react";
export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** Sample size or partial-data caveat, e.g. "12 rallies · score OCR partial". */
  note?: string;
  tone?: "default" | "accent" | "muted";
  align?: "left" | "center";
  style?: React.CSSProperties;
}
export declare function StatTile(props: StatTileProps): JSX.Element;
