# TensorFlow.js runtime vendor

The MV3 offscreen document loads `tf.min.js` as a classic script so pose
adapters that run TensorFlow.js graph models (MoveNet MultiPose Lightning,
MediaPipe BlazePose landmark) share one local runtime. The runtime itself is
local and nothing about loading or running it needs network access; MV3
extension-page CSP keeps `script-src 'self'`. The graph model checkpoints
these adapters load are a separate concern - see "Model artifacts" below.

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
here. The default, preferred path for a checkpoint the repository is allowed
to redistribute is vendoring it under `vendor/<model-id>/model.json` plus its
weight shards, matching the adapter's `modelUrl`, with a recorded source and
checksum (see `vendor/lite-openpose/MODEL-NOTICE.md`); without those files the
adapter reports the model as unavailable rather than silently falling back to
something misattributed.

MoveNet and BlazePose are the two exceptions: `movenet-adapter.js` and
`blazepose-adapter.js` set `MODEL.modelUrl` to an `https://tfhub.dev/...` URL
and call `tf.loadGraphModel(url, { fromTFHub: true })`, loading the graph
model over the network on first use instead of vendoring it. MoveNet's
license is not cleared for redistribution, so vendoring it is not an option;
BlazePose is Apache-2.0 and could be vendored, but hasn't been, mainly to
avoid bundling its multi-megabyte weight shards into the extension package.
`pose-model-selector.js`'s availability probe treats any `https://`
`modelUrl` as available without a reachability check, so both show as
selectable regardless of whether the network fetch will actually succeed.

Two non-obvious things about that remote path, found by testing against the
real hosted models rather than trusting the URLs or a mock:

- `tfhub.dev` no longer hosts the files directly - Google moved TF Hub's
  model hosting to Kaggle Models. Every `tfhub.dev/.../model.json` URL (and
  every weight-shard URL under it, since `fromTFHub: true` resolves those
  relative to the same base) 302-redirects through `kaggle.com` to a signed,
  time-limited `storage.googleapis.com` URL. A bare `HEAD` request to the
  `tfhub.dev` URL 404s - which reads exactly like the model is gone - but
  `GET` (what `fetch`/`tf.loadGraphModel` actually send) follows the redirect
  chain to a real 200. Don't diagnose these URLs with `curl -I`.
- BlazePose's graph declares five named outputs
  (`output_poseflag`, `activation_heatmap`, `world_3d`, `ld_3d`,
  `activation_segmentation`); a bare `model.execute(input)` returns them in
  that declared order, not `[landmarks, presence]`. `infer()` must call
  `model.execute(input, [MODEL.landmarkOutputName, MODEL.presenceOutputName])`
  to get `[ld_3d, output_poseflag]` in the order the decode step assumes.
