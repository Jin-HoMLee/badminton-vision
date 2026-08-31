Square icon-only control for panel chrome — collapse, close, undo, drag handle affordances.

```jsx
<IconButton label="Collapse panel" icon={<Icon name="chevron-up" />} size="sm" />
```

Ghost by default so it disappears into the glass; `solid` only when it floats directly on video with no panel behind it. `label` is mandatory — overlay chrome has no visible text.
