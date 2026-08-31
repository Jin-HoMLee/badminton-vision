Says what each colour means. **Every coloured mark in the product needs one** — court dots, mix segments, player rules.

```jsx
<Legend items={[
  {color:"var(--signal-in)",label:"Landed in",value:131},
  {color:"var(--signal-unknown)",label:"Not located",value:32,dashed:true},
]} />
```

Dashed = unknown/not measured. Use `shape="bar"` when the legend describes MixBar segments rather than dots.
