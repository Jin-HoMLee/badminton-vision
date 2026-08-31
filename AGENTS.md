# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- The public MV3 UI build/test commands and playback boundary are documented in `README.md` §11; keep runtime integration behind `src/runtime.js` and do not add playback mutators to content UI.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

- The local MV3 runtime slice, fixture analyzer boundary, and Chrome 148 structured-clone prerequisite are documented in `docs/runtime.md`; use `npm run runtime-smoke` for its focused integration gate.
- The browser calibration adapter and its normalized video-local state contract are documented in `docs/runtime.md`; keep court fitting in `src/calibration.js` and playback access read-only.
