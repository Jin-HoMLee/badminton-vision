# TensorFlow.js runtime vendor

The MV3 offscreen document loads `tf.min.js` as a classic script so pose
adapters that run TensorFlow.js graph models (MoveNet MultiPose Lightning,
MediaPipe BlazePose landmark) share one local runtime. Nothing is fetched at
runtime; MV3 extension-page CSP keeps `script-src 'self'`.

`offscreen.html` loads `regenerator-shim.js` immediately before `tf.min.js`.
This pinned bundle carries a transitive, pre-`globalThis`-guard copy of
regenerator-runtime whose global-assignment fallback
(`try { regeneratorRuntime = t } catch (e) { Function("r", "regeneratorRuntime = r")(t) }`)
throws a strict-mode `ReferenceError` on the `try` (nothing has declared
`regeneratorRuntime` yet) and falls into the `catch`, whose `Function(...)`
call Chrome's MV3 `script-src` CSP (no `unsafe-eval`) refuses to run - this is
the `EvalError` model switching used to fail with, thrown at `tf.min.js` load
time itself rather than from any particular backend or model. The shim's
`var regeneratorRuntime;` predeclares that binding so the bundle's own
assignment succeeds on the first branch instead. See
`regenerator-shim.js` for the full call-site trace and empirical
verification notes.

- Artifact: `@tensorflow/tfjs` 4.22.0 `dist/tf.min.js` (includes tfjs-core,
  converter, layers, and the CPU and WebGL backends).
- Source: https://www.npmjs.com/package/@tensorflow/tfjs
- License: Apache-2.0 (`LICENSE` in this directory; the bundle header carries
  the same grant). The WebGL/CPU backends need no `wasm-unsafe-eval`; a
  separately provided `tfjs-backend-wasm` would use the existing manifest CSP
  allowance.
- SHA-256: `300dfae273d20b4046f46a06d735688f03675a807561e9bcb5f664eb2f3d2831`

## Model artifacts

This directory contains only the runtime. Pose checkpoints are not bundled
here: the repository ships only cleared, licensed artifacts with a recorded
source and checksum (see `vendor/lite-openpose/MODEL-NOTICE.md`). A cleared
graph model may be vendored by an operator under
`vendor/<model-id>/model.json` plus its weight shards, matching the adapter's
`modelUrl`; without those files the adapter reports the model as unavailable
instead of loading a remote or misattributed checkpoint.
