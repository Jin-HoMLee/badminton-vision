# Manual labeling reliability

## Reproduced interaction

The regression path is the normal playback-neutral flow: open **Manual labeling** from the overlay, mark **Start** and **End**, choose a shot family, optionally choose player identity/dimensions, save, and repeat for sequential shots.

The first interaction could succeed when it happened between UI updates. The captain-reported third/subsequent failure was reproducible when playback/runtime delivered an update while the form was open:

- **Trigger:** a `timeupdate` or `publishRuntimeView` callback landed while the user was interacting with the manual form.
- **Masking condition:** the manual panel was open (`state.labeling`) while the live path was enabled, and the callback called the global `render()`. Individual Start/End, shot-family, player, and dimension handlers also called `render()` after each click.
- **Visible symptom:** `render()` replaced the form DOM between pointer-down and pointer-up, so the browser click targeted a retired control; the selected value or timestamp stayed unchanged. The same replacement made the failure appear intermittent and more common by the third or later shot.

## Reliability contract

While Manual labeling is open, media/runtime updates patch the panel clock in place. Form controls update the current draft and their ARIA state in place, without retaining a panel or control reference. A completed new save persists the normalized record under `manualLabelsByVideo`, clears edit mode, resets a ready-for-next-label draft, and keeps the panel open. The explicit close actions are the normal close path. Existing-label edit, delete, undo, and CSV export retain their prior event-id/provenance and deterministic behavior.

The focused regression path is in `tests/live-onboarding.test.mjs` (`manual labeling survives three sequential saves, rerenders, reload, and CRUD`). It creates three sequential labels, injects the update that previously masked the third interaction, exercises every third-label control, verifies the open/reset state and video-local reload, then verifies edit/delete/undo/export and unchanged playback fields.
