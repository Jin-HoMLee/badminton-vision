import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);

// Deterministic content-level coverage for the one-shot Hough guidance burst:
// calibration runs a short burst of temporally spaced detection passes when a
// recalibration event fires, aggregates the votes into a consensus set, and
// then stops - no interval keeps polling while the user thinks between corner
// clicks. The adapter's pure pipeline is covered in tests/hough-court-lines
// .test.mjs; this file exercises the src/content.js burst lifecycle against a
// canvas-capable fake DOM, observing chrome messages + the guidance canvas.

const sources = [
  "src/state.js",
  "analysis/index.js",
  "src/calibration.js",
  "src/panel-layout.js",
  "src/seed-card.js",
  "src/fixtures.js",
  "src/review.js",
  "src/analysis.js",
  "src/ui.js",
  "src/hough-guidance.js",
  "src/content.js"
];

// A stable near-boundary court line the offscreen is "detecting" on every pass.
function courtLine() {
  return [{ x1: 0.08, y1: 0.93, x2: 0.92, y2: 0.93, angle: 0, votes: 60 }];
}

class FakeNode {
  constructor(tagName = "div", nodeType = 1) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = nodeType;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.className = "";
    this.textContent = "";
    this.isConnected = true;
  }

  appendChild(child) {
    if (child == null) return child;
    if (child.parentNode && child.parentNode.children) {
      const index = child.parentNode.children.indexOf(child);
      if (index >= 0) child.parentNode.children.splice(index, 1);
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  contains(node) {
    return this === node || this.children.some((child) => child === node || child.contains?.(node));
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
  }

  getAttribute(name) { return this.attributes[name] ?? null; }

  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }

  dispatchEvent(event) {
    event = Object.assign({
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}
    }, event);
    for (const listener of this.listeners[event.type] || []) listener.call(this, event);
  }

  click() { this.dispatchEvent({ type: "click", target: this }); }

  getBoundingClientRect() {
    return this.rect || { left: 0, top: 0, width: 640, height: 360 };
  }

  attachShadow() {
    this.shadowRoot = new FakeNode("shadow-root");
    return this.shadowRoot;
  }

  focus() { this.focused = true; }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  matches(selector) {
    if (selector === "video") return this.tagName === "VIDEO";
    if (selector === "button") return this.tagName === "BUTTON";
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = selector.match(/^\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]$/);
    if (attribute) return Object.hasOwn(this.attributes, attribute[1]) && (attribute[2] == null || this.attributes[attribute[1]] === attribute[2]);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches?.(selector)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.matches?.(selector)) result.push(child);
      if (child.querySelectorAll) result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}

class FakeCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.clears = 0;
    this.strokes = 0;
    this.segments = [];
    this.path = null;
    this.strokeStyle = "";
    this.lineWidth = 0;
  }
  setTransform() {}
  clearRect() { this.clears += 1; this.segments = []; }
  beginPath() { this.path = []; }
  moveTo(x, y) { if (this.path) this.path.push(["move", x, y]); }
  lineTo(x, y) { if (this.path) this.path.push(["line", x, y]); }
  stroke() { if (this.path && this.path.length) { this.strokes += 1; this.segments.push(this.path); } this.path = null; }
  arc() {}
  fillRect() {}
  fill() {}
  drawImage() {}
  getImageData(x, y, width, height) {
    const w = this.canvas.width || width;
    const h = this.canvas.height || height;
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
}

class FakeCanvas extends FakeNode {
  constructor(tagName = "canvas") {
    super(tagName);
    this.contexts = Object.create(null);
  }
  getContext(type) {
    if (type !== "2d") return null;
    if (!this.contexts["2d"]) this.contexts["2d"] = new FakeCanvasContext(this);
    return this.contexts["2d"];
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super("document");
    this.created = [];
    this.documentElement = new FakeNode("html");
    this.body = new FakeNode("body");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName) {
    const node = tagName && String(tagName).toLowerCase() === "canvas" ? new FakeCanvas("canvas") : new FakeNode(tagName);
    this.created.push(node);
    return node;
  }
  createElementNS(_namespace, tagName) { return new FakeNode(tagName); }
  createTextNode(text) { const node = new FakeNode("#text", 3); node.textContent = String(text); return node; }
  getElementById(id) {
    return this.querySelector(`[id="${id}"]`);
  }
}

function textOf(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.textContent;
  return (node.children || []).map(textOf).join("") || node.textContent || "";
}

function buttonWithText(root, label) {
  return root.querySelectorAll("button").find((button) => textOf(button).trim().includes(label));
}

function resultView(result) {
  return {
    phase: "result", message: "Local analyzer result received", reason: "", analyzer: "test-analyzer",
    inference: true, fallbacks: [], capabilities: { inference: true },
    result, currentMediaTime: (result && result.mediaTime) || 12, ageSeconds: 0, stale: false
  };
}

function resultEnvelope(cameraCut = false) {
  return {
    kind: "test-result", state: "tracked", mediaTime: 12.1,
    players: [], tracking: { state: "tracked", accepted: true, players: [] },
    shuttle: { state: "unknown", confidence: null, accepted: false, trajectory: [], candidate: null },
    rally: { state: "unknown" }, rallyEnd: { state: "unknown" }, winner: { state: "unknown" }, strokeEvents: [],
    racket: { state: "unknown", confidence: null }, cameraCut
  };
}

async function until(condition, { timeout = 3000, step = 4, what = "condition" } = {}) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

async function createSession({ storedState = null } = {}) {
  const documentRef = new FakeDocument();
  const video = new FakeNode("video");
  Object.assign(video, { currentTime: 12, paused: false, muted: false, playbackRate: 1, readyState: 4, videoWidth: 640, videoHeight: 360 });
  const videoContainer = new FakeNode("div");
  documentRef.body.appendChild(videoContainer);
  videoContainer.appendChild(video);
  const retiredOverlay = new FakeNode("div");
  retiredOverlay.setAttribute("data-bso-runtime-overlay", "true");
  documentRef.body.appendChild(retiredOverlay);

  const storageReads = [];
  const storageWrites = [];
  const windowListeners = Object.create(null);
  const sent = [];
  let onMessage;
  let runtimeOnChange = null;
  let runtimeStarts = 0;

  // By default every detection pass "finds" one stable court line, so
  // guidance is drawn and the burst consensus has something to aggregate.
  let respond = () => ({ ok: true, lines: courtLine() });
  const chromeApi = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      getManifest: () => ({ name: "Badminton Vision", version: "0.1.0" }),
      sendMessage: (message, callback) => {
        if (message && message.action === "detectHoughLines") sent.push(message);
        const reply = respond && respond(message);
        callback?.(reply);
      },
      onMessage: { addListener: (listener) => { onMessage = listener; } }
    },
    storage: {
      local: {
        get: (_keys, callback) => storageReads.push(callback),
        set: (value, callback) => { storageWrites.push(value); callback?.(); }
      }
    }
  };

  const context = vm.createContext({
    console: { log() {}, debug() {}, warn() {}, error(...args) { console.error(...args); } },
    document: documentRef,
    window: null,
    chrome: chromeApi,
    location: { href: "https://www.youtube.com/watch?v=real-match" },
    URL,
    Blob,
    setTimeout,
    clearTimeout,
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    crypto: { randomUUID: () => "test-session" }
  });
  context.window = context;
  context.addEventListener = (name, listener) => { (windowListeners[name] ||= []).push(listener); };
  context.removeEventListener = (name, listener) => { windowListeners[name] = (windowListeners[name] || []).filter((item) => item !== listener); };
  context.BVRuntime = {
    startIntegratedRuntime: (options = {}) => {
      runtimeStarts += 1;
      runtimeOnChange = options.onChange || null;
      return { controller: { sessionId: "test-session", stop() {} } };
    }
  };

  for (const file of sources) {
    vm.runInContext(await readFile(file, "utf8"), context, { filename: file });
  }
  // Fast, deterministic burst cadence for this session (cadence is read from
  // BVHoughGuidance.CONFIG at burst time, not baked in at load time).
  context.BVHoughGuidance.CONFIG.spacingMs = 8;
  context.BVHoughGuidance.CONFIG.stallMs = 400;

  return {
    documentRef,
    video,
    storageReads,
    storageWrites,
    context,
    sent,
    get onMessage() { return onMessage; },
    get runtimeStarts() { return runtimeStarts; },
    setRespond(fn) { respond = fn; },
    flushStorage(value = storedState || { videoKey: "youtube:real-match", enabled: false, seeded: false }) {
      assert.equal(storageReads.length, 1);
      storageReads.shift()({ bvState: value });
    },
    onMessageSafe(message) { assert.ok(onMessage, "content message listener registered"); onMessage(message); },
    host() { return documentRef.querySelector("[data-badminton-vision]"); },
    overlayRoot() { return this.host().shadowRoot.querySelector(".bv-overlay-root"); },
    seedLayer() { return this.overlayRoot().querySelector("[data-bso-court-seeding]"); },
    houghCanvasNode() { return this.host().shadowRoot.querySelector("[data-bso-hough-canvas]"); },
    houghCtx() { const node = this.houghCanvasNode(); return node && node.getContext ? node.getContext("2d") : null; },
    publishRuntimeView(view) { assert.ok(runtimeOnChange, "runtime change listener registered"); runtimeOnChange(view); },
    cornerClick(x, y) {
      const layer = this.seedLayer();
      assert.ok(layer, "a seed layer is mounted");
      layer.dispatchEvent({ type: "click", target: layer, clientX: x, clientY: y, defaultPrevented: false });
    },
    lockCourt() {
      const lock = buttonWithText(this.overlayRoot(), "Lock court");
      assert.ok(lock, "the fitted seed exposes a lock action");
      lock.dispatchEvent({ type: "click", target: lock });
    }
  };
}

// One recalibration action = one fresh burst (4 passes) that then stops. The
// action runs between the count snapshot and the wait so all four of its own
// passes count; a superseded in-flight burst may have counted partial sends
// before the snapshot, but the delta from it is still a full burst. The quiet
// window proves the burst stopped (no interval was left running).
async function expectFreshBurst(session, action, what) {
  const before = session.sent.length;
  action();
  await until(() => session.sent.length >= before + 4, { what: `${what}: one fresh burst of passes` });
  await new Promise((resolve) => setTimeout(resolve, 160));
  const settled = session.sent.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(session.sent.length, settled, `${what}: burst stopped, no steady-state detection`);
}

async function setupSeededSession() {
  // Four-corner click flow, then lock (mirrors the other content tests).
  const session = await createSession();
  session.flushStorage();
  session.onMessageSafe({ type: "START_SEED", requestId: "burst-seed-1" });
  const corners = [[64, 324], [576, 324], [576, 36], [64, 36]];
  for (const [x, y] of corners) session.cornerClick(x, y);
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "4", "all four corners placed");
  session.lockCourt();
  return session;
}

test("seeding start runs one bounded burst of detection passes then stops", async () => {
  const session = await createSession();
  session.flushStorage();
  session.onMessageSafe({ type: "START_SEED", requestId: "burst-start-1" });
  assert.ok(session.seedLayer(), "court seeding is active");

  // One burst of 4 temporally spaced passes fires after seeding starts.
  await until(() => session.sent.length === 4, { what: "burst to dispatch all 4 passes" });
  assert.ok(session.sent.every((m) => m && m.action === "detectHoughLines"), "every burst request is a Hough detection message");
  assert.ok(session.sent.every((m) => m.width > 0 && m.height > 0 && m.frameData && m.frameData.data), "passes carry a bounded captured frame");

  // Guidance appears while seeding is active: pass responses drew strokes on
  // the guidance canvas (the consensus keeps the scene line).
  await until(() => (session.houghCtx()?.strokes || 0) > 0, { what: "guidance strokes on the hough canvas" });

  // Zero steady-state CPU: no interval was left running, so no further
  // detection message arrives across a quiet window well past the burst.
  await new Promise((resolve) => setTimeout(resolve, 160));
  const settled = session.sent.length;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(session.sent.length, settled, "no interval keeps requesting detection after the burst completes");
  assert.equal(session.sent.length, 4, "exactly one burst ran");
});

test("a corner mutation during seeding re-triggers exactly one more burst", async () => {
  const session = await createSession();
  session.flushStorage();
  session.onMessageSafe({ type: "START_SEED", requestId: "burst-corner-1" });
  await until(() => session.sent.length === 4, { what: "initial burst to complete" });

  // Placing a corner mutates the in-progress fit: the one-shot burst re-runs.
  await expectFreshBurst(session, () => session.cornerClick(80, 280), "corner-mutation recalibration");
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "1", "the corner click registered");
});

test("undo and reset court each re-run the one-shot burst while seeding stays active", async () => {
  const session = await createSession();
  session.flushStorage();
  await expectFreshBurst(session, () => session.onMessageSafe({ type: "START_SEED", requestId: "burst-undo-1" }), "seeding-start burst");

  await expectFreshBurst(session, () => session.cornerClick(80, 280), "first corner burst");
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "1");

  await expectFreshBurst(session, () => session.cornerClick(560, 280), "second corner burst");
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "2");

  // Undo pops a corner -> another one-shot burst.
  await expectFreshBurst(session, () => {
    const undo = buttonWithText(session.overlayRoot(), "Undo");
    assert.ok(undo, "undo action is available while seeding");
    undo.dispatchEvent({ type: "click", target: undo });
  }, "undo burst");
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "1", "undo popped the last corner");

  // Reset court clears the draft corners -> one more one-shot burst.
  await expectFreshBurst(session, () => {
    const reset = buttonWithText(session.overlayRoot(), "Reset court");
    assert.ok(reset, "reset court action is available while seeding");
    reset.dispatchEvent({ type: "click", target: reset });
  }, "reset burst");
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "0", "reset cleared the draft corners");
});

test("locking the court stops guidance and a later explicit re-setup restarts it", async () => {
  const session = await createSession();
  session.flushStorage();
  session.onMessageSafe({ type: "START_SEED", requestId: "burst-lock-1" });
  const corners = [[64, 324], [576, 324], [576, 36], [64, 36]];
  for (const [x, y] of corners) session.cornerClick(x, y);
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "4", "all four corners placed");
  await until(() => (session.houghCtx()?.strokes || 0) > 0, { what: "guidance strokes before lock" });

  const clearedBefore = session.houghCtx().clears;
  session.lockCourt();
  assert.equal(session.seedLayer(), null, "seeding ended after lock");
  assert.ok(session.houghCtx().clears > clearedBefore, "locking clears the guidance canvas");
  await new Promise((resolve) => setTimeout(resolve, 200));

  // The same "Set up court" action on the calibrated court (recalibration /
  // explicit re-detect) starts a fresh one-shot burst.
  await expectFreshBurst(session, () => session.onMessageSafe({ type: "START_SEED", requestId: "burst-reseed-1" }), "recalibration re-setup burst");
  assert.ok(session.seedLayer(), "recalibration re-enters the seeding flow");
});

test("a camera cut invalidates the guidance and starts a fresh burst for the new scene", async () => {
  const session = await setupSeededSession();
  const houghCtx = session.houghCtx();
  assert.ok(houghCtx, "guidance canvas exists");
  const clearsBefore = houghCtx.clears;

  await expectFreshBurst(session, () => session.publishRuntimeView(resultView(resultEnvelope(true))), "camera-cut re-seed burst");
  assert.ok(session.seedLayer(), "a camera cut enters the re-seed flow");
  assert.equal(session.host().getAttribute("data-bso-court-state"), "seeding");
  assert.ok(houghCtx.clears >= clearsBefore + 1, "the camera cut cleared stale guidance strokes");
});

test("a player geometry change mid-seeding re-scales the guidance strokes to the new box", async () => {
  // The burst has already stopped when the user changes player geometry
  // (fullscreen/theater toggle, window resize), so no pass response will
  // arrive to re-measure the guidance canvas. The strokes are normalized to
  // the frame, so re-rendering them at the live video rect keeps guidance
  // aligned with the content without running a new burst.
  const session = await createSession();
  session.flushStorage();
  session.onMessageSafe({ type: "START_SEED", requestId: "burst-geometry-1" });
  await until(() => session.sent.length === 4, { what: "burst to complete" });
  const ctx = session.houghCtx();
  await until(() => (ctx?.strokes || 0) > 0, { what: "guidance strokes at the initial geometry" });
  const node = session.houghCanvasNode();
  assert.equal(node.style.width, "640px", "guidance canvas matches the initial 640x360 player box");
  assert.equal(node.width, 640, "guidance backing store matches the initial player box");

  // Grow the player (e.g. entering fullscreen) after the burst finished.
  session.video.rect = { left: 0, top: 0, width: 1280, height: 720 };
  session.documentRef.dispatchEvent({ type: "fullscreenchange" });

  assert.equal(session.sent.length, 4, "a geometry change re-renders guidance, it does not re-run the burst");
  assert.equal(node.style.width, "1280px", "guidance canvas follows the new player width");
  assert.equal(node.style.height, "720px", "guidance canvas follows the new player height");
  assert.equal(node.width, 1280, "guidance backing store follows the new player box");
  const scaled = ctx.segments.at(-1);
  assert.ok(scaled, "the guidance was re-stroked at the new geometry");
  const move = scaled.find(([op]) => op === "move");
  const line = scaled.find(([op]) => op === "line");
  assert.ok(Math.abs(move[1] - 0.08 * 1280) < 1e-6 && Math.abs(move[2] - 0.93 * 720) < 1e-6,
    "strokes scale to the new box width/height");
  assert.ok(Math.abs(line[1] - 0.92 * 1280) < 1e-6 && Math.abs(line[2] - 0.93 * 720) < 1e-6,
    "stroke endpoints re-project onto the new box");
});

test("a reloaded in-progress seeding session restores with one guidance burst", async () => {
  // Persisted state captured mid-seeding (two corners already placed) after a
  // page reload: content restores the flow and runs the one-shot burst once.
  const session = await createSession({
    storedState: {
      videoKey: "youtube:real-match",
      enabled: true,
      seeded: false,
      seeding: true,
      cameraCut: false,
      seedDraftPoints: [{ x: 0.12, y: 0.9 }, { x: 0.88, y: 0.9 }],
      calibration: null
    }
  });
  session.flushStorage();
  assert.ok(session.seedLayer(), "the restored mid-seeding session shows the seed layer");
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "2", "the restored draft corners are live again");
  await until(() => session.sent.length === 4, { what: "restored session burst to dispatch" });
  await until(() => (session.houghCtx()?.strokes || 0) > 0, { what: "restored guidance strokes" });
  await new Promise((resolve) => setTimeout(resolve, 160));
  const settled = session.sent.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(session.sent.length, settled, "the restored burst stopped (no interval)");
  assert.equal(session.sent.length, 4, "the restored session ran exactly one burst");
});

// Pure consensus coverage: the module that aggregates a burst's per-pass
// line votes into the guidance set displayed during calibration.
const guidance = require("../src/hough-guidance.js");

function seg(x1, y1, x2, y2, votes) {
  return { x1, y1, x2, y2, votes };
}

test("burst consensus keeps lines seen on most passes and drops single-pass noise", () => {
  // The same near-boundary line appears on every pass with slight jitter;
  // two noise lines appear on exactly one pass each.
  const passSets = [
    [seg(0.08, 0.93, 0.92, 0.93, 60), seg(0.5, 0.2, 0.6, 0.2, 9)],
    [seg(0.082, 0.931, 0.92, 0.93, 58)],
    [seg(0.08, 0.929, 0.9, 0.93, 62), seg(0.7, 0.8, 0.75, 0.8, 8)],
    [seg(0.081, 0.93, 0.92, 0.932, 55)]
  ];
  const merged = guidance.mergeBurstLines(passSets);
  assert.equal(merged.length, 1, "only the consensus line survives");
  assert.equal(merged[0].passes, 4, "the line was seen on all four passes");
  assert.equal(merged[0].votes, 60 + 58 + 62 + 55, "member votes are aggregated");
  assert.ok(Math.abs(merged[0].y1 - 0.93) < 0.002, "merged line keeps the stable geometry");
});

test("burst consensus merges near-vertical wrap folds and reversed orientations", () => {
  const merged = guidance.mergeBurstLines([
    [seg(0.5, 0.1, 0.5, 0.9, 40)],
    [seg(0.502, 0.9, 0.5, 0.12, 38)],
    [seg(0.501, 0.1, 0.503, 0.88, 41)]
  ]);
  assert.equal(merged.length, 1, "one physical vertical line across passes");
  assert.equal(merged[0].passes, 3);
  assert.equal(merged[0].votes, 119);
});

test("burst consensus keeps genuinely distinct parallel court lines separate", () => {
  // Near boundary (y .93) and service line (y .78) are both horizontal but
  // farther apart than the gap tolerance; each is seen on two passes.
  const merged = guidance.mergeBurstLines([
    [seg(0.1, 0.93, 0.9, 0.93, 50)],
    [seg(0.2, 0.78, 0.8, 0.78, 40)],
    [seg(0.11, 0.93, 0.89, 0.93, 48)],
    [seg(0.21, 0.78, 0.79, 0.78, 42)]
  ]);
  assert.equal(merged.length, 2, "two distinct court lines stay distinct");
  const rows = merged.map((line) => Math.round(line.y1 * 100)).sort((a, b) => a - b);
  assert.deepEqual(rows, [78, 93]);
});

test("burst consensus honors minPasses, empty passes, and maxLines options", () => {
  const passSets = [[seg(0.1, 0.9, 0.9, 0.9, 40)], [], [seg(0.1, 0.9, 0.9, 0.9, 39)], []];
  assert.equal(guidance.mergeBurstLines(passSets, { minPasses: 2 }).length, 1, "seen on two of four passes");
  assert.equal(guidance.mergeBurstLines(passSets, { minPasses: 3 }).length, 0, "below a three-pass quorum");
  assert.equal(guidance.mergeBurstLines(passSets, { minPasses: 1, maxLines: 1 }).length, 1);
  assert.equal(guidance.mergeBurstLines(null).length, 0, "no pass sets yields no lines");
  assert.equal(guidance.mergeBurstLines([[seg(0.1, 0.9, 0.9, 0.9, 40)]], { minPasses: 2 }).length, 0, "a lone pass cannot confirm a line");
});
