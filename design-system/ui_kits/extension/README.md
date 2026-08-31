# UI kit — Chrome extension (Badminton Vision)

A click-through recreation of the extension described in the source PRD. The host video page is a **generic stand-in**, not a recreation of YouTube's interface.

| File | Surface | PRD section |
| --- | --- | --- |
| `index.html` | Full click-through: badge → popup → court seed → live overlay → labeling → summary | §3 journey |
| `popup.html` | Popup / control center on its own | §4.1 |
| `summary.html` | Match summary & export on its own | §4.5 |
| `VideoStage.jsx` | Generic watch-page shell + fake player chrome | §5 |
| `Popup.jsx` | Detection, court state, backend status, density, panel toggles, actions | §4.1 |
| `SeedFlow.jsx` | Four numbered corner clicks, generated line preview, undo / skip / lock | §4.2 |
| `LiveOverlay.jsx` | Status chip, stroke feed, stats panel, court minimap | §4.3 |
| `LabelingPanel.jsx` | Start/end marks, 11-shot picker, six dimension axes, CSV export | §4.4 |
| `Summary.jsx` | Overview stats, shot & outcome mix, ranked rallies, landing map | §4.5, §7 |
| `data.js` | Sample rally/stroke fixtures | — |

## Try it
1. The popup opens over the page. **Enable overlay** starts the court seed.
2. Click four corners anywhere on the video; the generated line set previews. **Lock court**.
3. The overlay appears at Balanced density. Use the bottom-right buttons to cycle density and to simulate analysis lag.
4. **Accept** or **Correct** the inline suggestion; Correct opens the full labeling panel.
5. **Summary** opens the export view.

## Deliberately not built
Pro comparison is rendered as a disabled, late-phase affordance only — the PRD gates it behind licensing and sample-size prerequisites.
