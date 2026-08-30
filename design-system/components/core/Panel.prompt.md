The floating glass container every overlay surface is built from (stroke feed, stats, minimap, labeling panel).

```jsx
<Panel title="Stroke feed" mediaTime="12:04.320" actions={<IconButton label="Collapse" icon={<Icon name="chevron-up" />} size="sm" />}>
  …
</Panel>
```

Every live panel must carry `mediaTime`; set `stale` when inference lags. Use `tone="solid"` inside the popup where there is no video behind the surface.
