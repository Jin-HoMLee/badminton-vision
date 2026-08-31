Says what is missing, why, and the single action that resolves it.

```jsx
<EmptyState compact icon={<Icon name="crosshair" size={20} />} title="Court not seeded"
  body="Click the four outer corners once and the full line set is generated."
  action={<Button variant="primary" size="sm">Seed court</Button>} />
```

One action maximum. Body stays under ~34 characters per line (`maxWidth: 34ch`).
