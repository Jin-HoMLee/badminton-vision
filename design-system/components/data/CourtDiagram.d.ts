import * as React from "react";
export interface CourtPoint { x: number; y: number; side?: "a" | "b" }
/**
 * Canonical BWF court, drawn from real metres.
 * @startingPoint section="Data" subtitle="Court minimap, stroke feed, stat tiles, rally rows" viewport="700x400"
 */
export interface CourtDiagramProps {
  /** Rendered width in px; height follows the 13.40 × 6.10 m ratio. */
  width?: number;
  /** Player positions in court metres (x 0–6.10, y 0–13.40). */
  players?: CourtPoint[];
  /** Shuttle path in court metres. */
  trajectory?: CourtPoint[];
  landing?: CourtPoint;
  /** Every located landing of a match/selection — the summary's landing map. */
  landings?: Array<CourtPoint & { call?: "IN" | "OUT" | "UNKNOWN" }>;
  /** How `landings` are coloured: by line call, or by which player hit the shot. */
  colorBy?: "call" | "player";
  /** Line-call state for the landing marker. */
  call?: "IN" | "OUT" | "UNKNOWN";
  showLabels?: boolean;
  style?: React.CSSProperties;
}
export declare function CourtDiagram(props: CourtDiagramProps): JSX.Element;
