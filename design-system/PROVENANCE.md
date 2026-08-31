# Design-system provenance

Copied from the portable archive `Badminton Vision Design System.zip` for the public Badminton Vision extension implementation.

The source system is an authored proposal aligned with the public repository README, not a third-party library. `readme.md`, `tokens/`, `components/`, `assets/`, `guidelines/`, and `ui_kits/extension/` are retained so the UI can be maintained against its source material. `_ds_manifest.json`, `_adherence.oxlintrc.json`, and `github.md` are retained as provenance and maintenance metadata.

The complete `design-system/` tree is repository source and preview material; it is not the production package. `scripts/build.mjs` explicitly copies only the local token CSS files and SVG assets referenced by the runtime. Preview HTML/cards, JSX source, documentation, generated manifests, and the source-only remote font import are consequently excluded from `dist/`. The extension does not depend on remote scripts, model binaries, or private endpoints. Production DOM components in `src/ui.js` consume the copied token files and supplied assets while keeping the MV3 build dependency-free.
