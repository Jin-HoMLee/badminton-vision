# Design-system provenance

Copied from `/Users/jin-holee/Downloads/Badminton Vision Design System.zip` for the public Badminton Vision extension implementation.

The source system is an authored proposal aligned with the public repository README, not a third-party library. `readme.md`, `tokens/`, `components/`, `assets/`, `guidelines/`, and `ui_kits/extension/` are retained so the UI can be maintained against its source material. `_ds_manifest.json`, `_adherence.oxlintrc.json`, and `github.md` are retained as provenance and maintenance metadata.

Only `.thumbnail` and `thumbnail.html` (preview cache artifacts) and `_ds_bundle.js` (generated preview bundle) were excluded. The extension does not depend on the generated bundle, remote scripts, model binaries, or private endpoints. Production DOM components in `src/ui.js` consume the copied token files and the supplied assets while keeping the MV3 build dependency-free.
