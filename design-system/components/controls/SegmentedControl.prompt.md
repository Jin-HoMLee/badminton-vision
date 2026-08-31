Mutually exclusive choice in one row — overlay density (Minimal / Balanced / Full), summary tabs.

```jsx
<SegmentedControl full value={density} onChange={setDensity}
  options={[{value:"minimal",label:"Minimal"},{value:"balanced",label:"Balanced"},{value:"full",label:"Full"}]} />
```

Minimal is the first-run default everywhere. Options may be `disabled` for late-phase capabilities.
