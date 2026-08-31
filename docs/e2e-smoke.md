# Live Chrome smoke check

This is the repeatable local E2E path for the unpacked MV3 package. It must use
only a separate dedicated Chrome instance through `chrome-devtools-axi`; never
attach to the operator's ordinary browser, reuse its profile, or copy account
data. Run the commands from the repository root. The dedicated instance must
have a clean temporary profile and be launched outside this checklist by the
browser-test supervisor.

## 1. Build and install/reload

```sh
npm run build
export CHROME_DEVTOOLS_AXI_AUTO_CONNECT=0
export AXI=/Users/jin-holee/.pi/agent/bin/chrome-devtools-axi
# Point chrome-devtools-axi at the separately launched dedicated instance.
$AXI pages
```

Select the existing `chrome://extensions/` page with its reported page id:

```sh
$AXI selectpage <extensions-page-id>
$AXI snapshot --full
```

The expected Badminton Vision card is an **Unpacked extension**, version
`0.1.0`, with no `Errors` button. If it is not installed, the one native UI
step is manual: click **Load unpacked** on `chrome://extensions`, choose this
worktree's `dist/` directory in Chrome's file picker, and confirm **Open**.
Do not use a second browser or a filesystem/automation workaround. For a
package already loaded from this worktree, click its **Reload** button instead.

After either action, take another full snapshot. A warning mentioning
`message_serialization` or `structured_clone` is a failure: the stable build
must not declare that Canary-only manifest key. A stale `Extension context
invalidated` entry is cleared by reloading the YouTube tab in step 2, not by
reloading another browser.

## 2. Detect and enable on a real YouTube match

Use `pages` and select the already-open YouTube watch page. If the selected
watch page is not a badminton match, navigate that same tab to a match URL
already approved by the captain (for example, the existing open match URL),
without opening a new page. Verify detection without reading account content:

```sh
$AXI selectpage <youtube-page-id>
$AXI eval '() => ({ url: location.href, watch: /^https?:\\/\\/(www\\.)?youtube\\.com\\/watch/.test(location.href), videoCount: document.querySelectorAll("video").length })'
```

Use the normal Chrome toolbar action to open **Badminton Vision**, then click
**Turn on — step 1 of 3**. The toolbar popup is native Chrome UI and is the
manual step when it is not exposed as an accessibility reference by
`chrome-devtools-axi`; do not invoke extension internals from the console.
The popup's `<main>` exposes these sanitized markers for repeatable checks:
`data-bso-youtube-detected`, `data-bso-enabled`, `data-bso-court-state`,
`data-bso-runtime-phase`, `data-bso-runtime-analyzer`,
`data-bso-frame-transport`, and `data-bso-fallback`.

## 3. Seed, observe runtime, and verify no playback mutation

The content overlay has a stable host marker. Capture playback invariants, seed
the four outer full-court corners in order (near-left, near-right, far-right,
far-left), and locks the court before capturing them again. This evaluation dispatches
clicks only to the extension's court-seed layer and its Lock court button; it
does not touch YouTube controls or video properties.

```sh
$AXI eval '() => { const v = document.querySelector("video"); const h = document.querySelector("[data-badminton-vision]"); const before = v && { paused: v.paused, muted: v.muted, playbackRate: v.playbackRate, src: v.currentSrc || v.src }; const points = [[.22,.82],[.78,.82],[.63,.33],[.37,.33]]; for (const [x,y] of points) { const s = h && h.shadowRoot && h.shadowRoot.querySelector("[data-bso-court-seeding]"); const r = s && s.getBoundingClientRect(); if (!s || !r.width || !r.height) return { ok: false, reason: "seed layer/video unavailable", before, seedCount: h && h.getAttribute("data-bso-seed-count") }; s.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + r.width*x, clientY: r.top + r.height*y })); } const lock = [...h.shadowRoot.querySelectorAll("button")].find(button => button.textContent.includes("Lock court")); if (!lock || lock.disabled) return { ok: false, reason: "court fit did not become lockable", before, seedCount: h.getAttribute("data-bso-seed-count") }; lock.click(); return { ok: true, before, seedCount: h.getAttribute("data-bso-seed-count"), courtState: h.getAttribute("data-bso-court-state") }; }'
$AXI wait 1500
$AXI eval '() => { const v = document.querySelector("video"); const h = document.querySelector("[data-badminton-vision]"); const s = h && h.shadowRoot; const after = v && { paused: v.paused, muted: v.muted, playbackRate: v.playbackRate, src: v.currentSrc || v.src }; return { host: Boolean(h), enabled: h && h.getAttribute("data-bso-enabled"), court: h && h.getAttribute("data-bso-court-state"), seedCount: h && h.getAttribute("data-bso-seed-count"), overlay: s && s.querySelector("[data-bso-overlay-state]")?.getAttribute("data-bso-overlay-state"), lines: s ? s.querySelectorAll("[data-court-line-id]").length : 0, runtimePhase: h && h.getAttribute("data-bso-runtime-phase"), analyzer: h && h.getAttribute("data-bso-runtime-analyzer"), frameTransport: h && h.getAttribute("data-bso-frame-transport"), analysisState: h && h.getAttribute("data-bso-analysis-state"), playerState: h && h.getAttribute("data-bso-player-state"), playerCount: h && h.getAttribute("data-bso-player-count"), shuttleState: h && h.getAttribute("data-bso-shuttle-state"), shuttleConfidence: h && h.getAttribute("data-bso-shuttle-confidence"), backend: h && h.getAttribute("data-bso-backend"), fallback: h && h.getAttribute("data-bso-fallback"), after }; }'
```

Expected ready-path markers are `court=seeded`, `seedCount=4`, at least one
court line, analyzer `lightweight-openpose-lite-256-v1`, frame transport
`rgba-array-v1`, and a visible backend (`webgpu` or `wasm`). The production
pose state may be `tracked`, `partial`, or `unknown` based on the match frame;
the shuttle state may likewise be `tracked` or `unknown`. A tracked shuttle
value is only a bounded candidate/trajectory, never a stroke, landing, line
call, rally-end, or winner claim. If local model startup/inference fails, the
markers must show `inference=false`, `analyzer=none` in capability/status, an
explicit fallback reason, and unknown pose state — never `fixture-probe-v1`.
`fallback=none` is healthy only when offscreen, canvas, model, and backend
support are available; any non-`none` value must be visible and playback must
remain untouched. The explicit fixture branch is a diagnostic-only Node path
and is covered deterministically by:

```sh
npm run runtime-smoke
```

Finally compare the `before` and `after` playback fields. `paused`, `muted`,
`playbackRate`, and `src` must be unchanged; `currentTime` may advance
naturally. The extension must not pause, seek, mute, alter rate/source, or
modify YouTube controls.

## 4. Worker/offscreen lifecycle evidence

In `chrome://inspect/#extensions`, the Badminton Vision service worker should
have an inspect view while the session is active. A successful ready-path
status has `data-bso-runtime-phase` `result` (or `ready` between messages),
`data-bso-runtime-analyzer` `lightweight-openpose-lite-256-v1`, a backend
status, and the offscreen view remains local. On tab reload/navigation, the old
video-local session ends and a new session gets a new sanitized status; no
account URL or frame data is stored. If the real match cannot initialize the
cleared local artifact or backend, record the exact browser/runtime error as an
unresolved blocker rather than calling the MVP complete.
