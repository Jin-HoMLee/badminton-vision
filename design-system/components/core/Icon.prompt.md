Renders a Lucide glyph as an inline SVG that inherits `currentColor` — the only icon primitive in the system.

```jsx
<Icon name="circle-play" size={16} />
```

- Lucide must be on the page: `<script src="https://unpkg.com/lucide@0.446.0/dist/umd/lucide.js"></script>`.
- Default stroke width is 1.75 (lighter than Lucide's 2) so glyphs sit quietly over video.
- Never colour an icon directly; colour the container and let `currentColor` do the work.
