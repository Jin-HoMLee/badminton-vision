Binary panel/preference switch used throughout the popup ("Stats panel", "Court minimap", "Show confidence badges").

```jsx
<Toggle label="Court minimap" description="Positions, trajectory and line calls" checked={on} onChange={setOn} />
```

Label left, switch right, full-row click target. Use `description` to say what the toggle affects rather than restating the label.
