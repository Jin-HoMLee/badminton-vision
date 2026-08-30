The canonical court from BWF Laws §4.1 Diagram A — 13.40 × 6.10 m, 40 mm lines, net at y = 6.70 m. Physical dimensions are hard-coded and must never be edited to fit an image; only the homography changes.

```jsx
<CourtDiagram width={220} players={[{x:3.0,y:9.4},{x:2.4,y:4.1,side:"b"}]}
  trajectory={[{x:2.4,y:4.3},{x:3.4,y:8.2},{x:4.6,y:12.9}]} landing={{x:4.6,y:12.9}} call="IN" />
```

The landing marker takes the line-call colour (green IN, coral OUT, slate unknown). Always pair an on-court call with a ConfidenceMeter nearby.

Pass `landings` (plus `colorBy="call" | "player"`) to plot every located landing of a match. Unknown calls draw as dashed rings, never as solid dots — an unlocated shot must not look like a measurement.

```jsx
<CourtDiagram width={230} landings={shots} colorBy="call" />
```
