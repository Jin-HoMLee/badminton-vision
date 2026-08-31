The overlay's whole footprint at Minimal density: a dot, a word, and a media time.

```jsx
<StatusChip state="live" label="Rally 14" detail="12:04.320" />
<StatusChip state="stale" label="Analysis behind" detail="+1.2s" />
```

States: ready · live · waiting · stale · error · off. Never hide a degraded state — `stale` and `error` are honest and expected.
