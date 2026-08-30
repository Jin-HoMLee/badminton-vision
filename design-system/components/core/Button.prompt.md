The system's text action; use it for anything the user commits to (Enable, Seed court, Export CSV).

```jsx
<Button variant="primary" icon={<Icon name="play" />}>Enable overlay</Button>
<Button variant="ghost" size="sm">Manual only</Button>
```

Variants: `primary` (shuttle lime, exactly one per surface), `secondary` (raised ink), `ghost` (overlay chrome), `danger` (destructive/reject, tinted not filled). Sizes `sm` 24px · `md` 30px · `lg` 36px. Disabled renders at 42% opacity and stays visible — the PRD requires late-phase features to be shown as disabled, not hidden.
