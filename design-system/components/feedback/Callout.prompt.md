One line telling the user what they are looking at, or what to do next. Every surface a first-timer could misread opens with one.

```jsx
<Callout tone="guide" title="This is your rally, shot by shot" onDismiss={hide}>
  Green means the system is sure. Amber means it is guessing — click any row to fix it.
</Callout>
```

Make guide callouts dismissible; make warn callouts persistent (they describe a real state). Never stack two callouts on one surface.
