One shuttle-insights annotation axis as a labelled option row; stack them inside the labeling panel.

```jsx
<DimensionAxis label="Timing" options={["early","normal","late"]} value={v} onChange={set} />
```

Axis names match the CSV columns exactly (`longitudinal_position`, `lateral_position`, `timing`, `intention`, `impact`, `direction`) so labels never drift from the export schema.
