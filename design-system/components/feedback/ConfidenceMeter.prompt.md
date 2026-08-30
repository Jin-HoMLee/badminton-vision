Four-segment confidence bar. Bands: ≥0.75 high (green), ≥0.45 medium (amber), <0.45 low (coral), null unknown (slate).

```jsx
<ConfidenceMeter value={0.82} label="cls" />
<ConfidenceMeter value={null} />
```

Pass `null` rather than 0 when a value is missing — the product's rule is that unknown stays visibly unknown.

Prefer `showWord` in user-facing surfaces: "fairly sure 56%" reads better than "56%" to someone who has never seen a confidence score.

```jsx
<ConfidenceMeter value={0.56} showWord />
```
