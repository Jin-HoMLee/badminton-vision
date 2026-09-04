// Predeclares the global `regeneratorRuntime` binding that `tf.min.js` needs
// before it runs, so its bundled regenerator-runtime dependency never falls
// back to a CSP-blocked `Function(...)` call. Load this script before
// `tf.min.js` (see offscreen.html).
//
// `tf.min.js` is a strict-mode UMD bundle. Its bundled regenerator-runtime
// (a Babel/async-generator helper pulled in transitively) initializes with:
//   try { regeneratorRuntime = t } catch (e) { Function("r", "regeneratorRuntime = r")(t) }
// In strict mode, assigning to a name that was never declared with
// `var`/`let`/`const` anywhere in scope throws a `ReferenceError` instead of
// creating an implicit global, so the `try` always fails and control falls
// into the `catch`. That branch uses `Function(...)` specifically to escape
// strict mode and create the global the old-fashioned way - which is exactly
// the dynamic-code-from-string pattern Chrome MV3's extension-page CSP
// (`script-src 'self' 'wasm-unsafe-eval'`, no `unsafe-eval`) refuses to run,
// throwing `EvalError: Refused to evaluate a string as JavaScript...` at
// `tf.min.js` load time - before any model, adapter, or backend code runs.
// Newer regenerator-runtime releases guard this fallback with a `globalThis`
// check and never hit `Function(...)`, but the copy bundled inside this
// pinned `@tensorflow/tfjs` 4.22.0 build predates that fix.
//
// Declaring `regeneratorRuntime` here (as a real `var`, so it is visible to
// every later classic `<script>` in this document) makes the bundle's first
// branch, `regeneratorRuntime = t`, a plain assignment to an existing
// variable instead of an assignment to an undeclared one - no
// `ReferenceError`, so the `catch`/`Function(...)` fallback never runs.
// Verified empirically: without this shim, loading `tf.min.js` under this
// exact CSP throws the EvalError above and leaves the `tf` global with zero
// properties (the whole module's top-level execution aborts); with it, the
// same script loads cleanly and a real graph model loads and runs inference
// end to end with zero CSP violations, on both the `cpu` and `webgl`
// backends.
var regeneratorRuntime;
