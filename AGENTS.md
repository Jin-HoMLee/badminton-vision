# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- The public MV3 UI build/test commands and playback boundary are documented in `README.md` §11; keep runtime integration behind `src/runtime.js` and do not add playback mutators to content UI.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

- The local MV3 runtime slice, cleared LiteRT Lightweight OpenPose artifact, explicit fixture fallback, multi-person pose contract, and Chrome 148 structured-clone prerequisite are documented in `docs/runtime.md`; the implementation is `src/extension/offscreen/lite-openpose-adapter.js` plus `src/extension/common/player-tracking.js`, and `npm run runtime-smoke` is the focused integration gate.
- The browser calibration adapter and its normalized video-local state contract are documented in `docs/runtime.md`; keep court fitting in `src/calibration.js` and playback access read-only.
- The bounded local shuttle candidate/trajectory adapter is documented in `docs/shuttle-tracking.md`; it is composed in the offscreen production path as candidate/trajectory evidence only, with no TrackNet or uncleared model in the live path.
- Manual labels use the versioned `bvState.manualLabelsByVideo` store keyed by `BVState.videoKeyForUrl`; `manualLabels` is only the active-video compatibility projection, and `labelUndoByVideo` keeps undo scoped. The playback-neutral UI messages and pure storage/CRUD gates are covered by `tests/manual-labels.test.mjs`.
- Live Step 1 must tolerate an already-open YouTube tab and an in-flight content-script storage read: the popup injects the declared content path on a missing receiver, while `src/content.js` replays messages after hydration and removes retired `data-bso-runtime-overlay` nodes; focused coverage is `tests/live-onboarding.test.mjs`.
- The manifest injects one generated `content.bundle.js` entrypoint; `scripts/build.mjs` keeps its guarded singleton boundary so recovery cannot re-evaluate global lexical declarations or mount duplicate UI/listeners. Keep popup request IDs and the content message de-duplication when changing onboarding actions.
- The overlay stylesheet is linked inside a ShadowRoot; keep shipped design-system token sheets on the `:root,:host` contract and keep the no-remote-font policy/package checks in `docs/overlay-ui.md` and `tests/overlay-ui.test.mjs`.
- The manual form's asynchronous rerender failure, in-place control sync contract, and three-label regression path are documented in `docs/manual-labeling.md`; focused UI coverage is in `tests/live-onboarding.test.mjs`.
