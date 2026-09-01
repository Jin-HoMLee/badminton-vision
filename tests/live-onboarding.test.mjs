import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const contentBundleSources = [
  "src/extension/common/protocol.js",
  "src/extension/common/player-tracking.js",
  "src/extension/common/frame-transport.js",
  "src/extension/common/capabilities.js",
  "src/extension/common/synchronization.js",
  "src/extension/content/capture.js",
  "src/extension/content/video-discovery.js",
  "src/extension/content/runtime.js",
  "src/runtime.js",
  "src/analysis.js",
  "analysis/index.js",
  "src/calibration.js",
  "src/seed-card.js",
  "src/fixtures.js",
  "src/review.js",
  "src/state.js",
  "src/ui.js",
  "src/content.js"
];

async function loadContentBundle() {
  try { return await readFile("dist/content.bundle.js", "utf8"); } catch (_) {
    const sources = await Promise.all(contentBundleSources.map((file) => readFile(file, "utf8")));
    return [
      "(function (root) {",
      "  if (root.__BV_CONTENT_BUNDLE_LOADED__) return;",
      "  root.__BV_CONTENT_BUNDLE_LOADED__ = true;",
      ...sources,
      "})(typeof globalThis === \"object\" ? globalThis : self);"
    ].join("\n");
  }
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
    this.children.push(child);
    child.parentNode = this;
    return child;
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

  addEventListener(name, listener) {
    (this.listeners[name] ||= []).push(listener);
  }

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
    const node = new FakeNode(tagName);
    this.created.push(node);
    return node;
  }
  createElementNS(_namespace, tagName) { return new FakeNode(tagName); }
  createTextNode(text) { const node = new FakeNode("#text", 3); node.textContent = String(text); return node; }
  getElementById(id) {
    return this.querySelector(`[id="${id}"]`);
  }
}

async function createSession({ bundle = false, storedState = { videoKey: "youtube:real-match", enabled: false, seeded: false }, runtimeError = null } = {}) {
  const documentRef = new FakeDocument();
  const video = new FakeNode("video");
  Object.assign(video, { currentTime: 12, paused: false, muted: false, playbackRate: 1, readyState: 4, videoWidth: 640, videoHeight: 360 });
  documentRef.body.appendChild(video);
  const retiredOverlay = new FakeNode("div");
  retiredOverlay.setAttribute("data-bso-runtime-overlay", "true");
  documentRef.body.appendChild(retiredOverlay);
  if (bundle) {
    const staleContentHost = new FakeNode("div");
    staleContentHost.setAttribute("data-badminton-vision", "overlay");
    documentRef.body.appendChild(staleContentHost);
  }
  const storageReads = [];
  const storageWrites = [];
  const windowListeners = Object.create(null);
  let onMessage;
  const messageListeners = [];
  let runtimeStarts = 0;
  let runtimeStops = 0;
  let runtimeOnChange = null;
  const chromeApi = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: (_message, callback) => callback?.(),
      onMessage: { addListener: (listener) => { onMessage = listener; messageListeners.push(listener); } }
    },
    storage: {
      local: {
        get: (_keys, callback) => storageReads.push(callback),
        set: (value, callback) => { storageWrites.push(value); callback?.(); }
      }
    }
  };
  const context = vm.createContext({
    console,
    document: documentRef,
    window: null,
    chrome: chromeApi,
    location: { href: "https://www.youtube.com/watch?v=real-match" },
    URL,
    Blob,
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    crypto: { randomUUID: () => "test-session" }
  });
  context.window = context;
  context.addEventListener = (name, listener) => { (windowListeners[name] ||= []).push(listener); };
  context.removeEventListener = (name, listener) => { windowListeners[name] = (windowListeners[name] || []).filter((item) => item !== listener); };
  const files = bundle
    ? []
    : ["src/state.js", "analysis/index.js", "src/calibration.js", "src/seed-card.js", "src/fixtures.js", "src/review.js", "src/analysis.js", "src/ui.js", "src/content.js"];
  if (!bundle) {
    context.BVRuntime = {
      startIntegratedRuntime: (options) => {
        runtimeStarts += 1;
        runtimeOnChange = options && options.onChange;
        return { controller: { sessionId: "test-session", stop: () => { runtimeStops += 1; } } };
      }
    };
  }
  for (const file of files) {
    vm.runInContext(await readFile(file, "utf8"), context, { filename: file });
  }
  if (bundle) {
    vm.runInContext(await loadContentBundle(), context, { filename: "dist/content.bundle.js" });
  }
  if (bundle) {
    context.BVRuntime.startIntegratedRuntime = (options) => {
      runtimeStarts += 1;
      runtimeOnChange = options && options.onChange;
      if (runtimeError) throw new Error(runtimeError);
      return { controller: { sessionId: "test-session", stop: () => { runtimeStops += 1; } } };
    };
  }

  return {
    documentRef,
    video,
    storageReads,
    storageWrites,
    context,
    messageListeners,
    get onMessage() { return onMessage; },
    get runtimeStarts() { return runtimeStarts; },
    get runtimeStops() { return runtimeStops; },
    publishRuntimeView(view) { assert.equal(typeof runtimeOnChange, "function"); runtimeOnChange(view); },
    emitWindow(name) { (windowListeners[name] || []).slice().forEach((listener) => listener({ type: name })); },
    flushStorage(value = storedState) {
      assert.equal(storageReads.length, 1);
      storageReads.shift()({ bvState: value });
    },
    host() { return documentRef.querySelector("[data-badminton-vision]"); },
    overlayRoot() { return this.host().shadowRoot.querySelector(".bv-overlay-root"); }
  };
}

async function createPopupSession({ deferStorage = false, failInjection = false } = {}) {
  const documentRef = new FakeDocument();
  const app = new FakeNode("main");
  app.setAttribute("id", "app");
  documentRef.body.appendChild(app);
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const sent = [];
  let injection = null;
  let closed = false;
  const storageReads = [];
  const runtime = {
    lastError: null,
    getURL: (path) => `chrome-extension://test/${path}`,
    getManifest: () => manifest
  };
  const chromeApi = {
    runtime,
    tabs: {
      query: (_query, callback) => callback([{ id: 7, url: "https://www.youtube.com/watch?v=real-match" }]),
      sendMessage: (tabId, message, callback) => {
        sent.push({ tabId, message });
        if (sent.length === 1) runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        else runtime.lastError = null;
        callback?.();
        runtime.lastError = null;
      }
    },
    scripting: {
      executeScript: (details, callback) => {
        injection = details;
        runtime.lastError = failInjection ? { message: "Chrome rejected content bundle injection." } : null;
        callback?.();
        runtime.lastError = null;
      }
    },
    storage: { local: {
      get: (_keys, callback) => {
        if (deferStorage) storageReads.push(callback);
        else callback({ bvState: { videoKey: "youtube:real-match", enabled: false, seeded: false } });
      },
      set: (_value, callback) => callback?.()
    } }
  };
  const context = vm.createContext({
    console,
    document: documentRef,
    window: null,
    chrome: chromeApi,
    location: { href: "chrome-extension://test/popup.html" },
    URL,
    Blob,
    setTimeout,
    clearTimeout,
    close: () => { closed = true; }
  });
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  for (const file of ["src/fixtures.js", "src/review.js", "src/state.js", "src/ui.js", "src/popup.js"]) {
    vm.runInContext(await readFile(file, "utf8"), context, { filename: file });
  }
  return {
    app, context, sent, storageReads,
    flushStorage() { storageReads.shift()({ bvState: { videoKey: "youtube:real-match", enabled: false, seeded: false } }); },
    get injection() { return injection; }, get closed() { return closed; }
  };
}

test("Live Step 1 replays an early ENABLE after storage hydration instead of losing the overlay", async () => {
  const session = await createSession();
  const host = session.host();
  assert.equal(session.documentRef.querySelector("[data-bso-runtime-overlay]"), null, "the retired text overlay is removed during content startup");
  assert.equal(host.getAttribute("data-bso-enabled"), "false");

  // Counterfactual for the report: the toolbar action arrives before the
  // content script's initial storage callback, which is the masking condition.
  session.onMessage({ type: "ENABLE" });
  assert.equal(host.getAttribute("data-bso-enabled"), "false", "the action waits for initial state hydration");

  session.flushStorage();
  assert.equal(host.getAttribute("data-bso-enabled"), "true");
  assert.equal(host.getAttribute("data-bso-court-state"), "seeding");
  assert.ok(session.overlayRoot().querySelector("[data-bso-court-seeding]"), "Step 1 renders the court setup surface");
  assert.equal(session.runtimeStarts, 1);

  // Disconfirming check: when storage is already hydrated (the normal manual
  // path), OPEN_LABELING still responds directly and remains playback-neutral.
  const manual = await createSession();
  manual.flushStorage();
  manual.onMessage({ type: "OPEN_LABELING" });
  assert.ok(manual.overlayRoot().querySelector(".bv-label-panel"), "manual labeling remains a working comparison path");
  assert.equal(manual.runtimeStarts, 0, "manual labeling does not start the live runtime");
  assert.equal(manual.video.paused, false);
  assert.equal(manual.video.muted, false);
  assert.equal(manual.video.playbackRate, 1);
});

test("content anchor follows YouTube geometry changes without moving playback", async () => {
  const session = await createSession();
  session.flushStorage();
  session.video.rect = { left: 24, top: 30, width: 640, height: 360 };
  session.emitWindow("resize");
  assert.equal(session.host().style.left, "24px");
  assert.equal(session.host().style.top, "30px");
  assert.equal(session.host().style.width, "640px");
  assert.equal(session.host().style.height, "360px");

  session.video.rect = { left: 0, top: 0, width: 1920, height: 1080 };
  session.documentRef.dispatchEvent({ type: "fullscreenchange" });
  assert.equal(session.host().style.width, "1920px");
  assert.equal(session.host().style.height, "1080px");
  assert.equal(session.video.paused, false);
  assert.equal(session.video.currentTime, 12);
});

test("Live Step 1 injects the declared content path when the tab predates extension installation", async () => {
  const popup = await createPopupSession();
  const primary = popup.app.querySelector('[data-bso-action="enable"]');
  assert.ok(primary, "the detected watch page exposes the onboarding action");

  primary.dispatchEvent({ type: "click" });

  assert.ok(popup.injection, "a missing content-script receiver triggers recovery injection");
  assert.deepEqual(popup.injection.files, ["content.bundle.js"], "recovery injects one guarded content entrypoint");
  assert.equal(popup.sent.length, 2);
  assert.equal(popup.sent[1].message.type, "ENABLE");
  assert.equal(popup.closed, true);
});

function textOf(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.textContent;
  return (node.children || []).map(textOf).join("") || node.textContent || "";
}

function buttonWithText(root, label) {
  return root.querySelectorAll("button").find((button) => textOf(button).trim().includes(label));
}

test("popup keeps a failed recovery injection visible instead of closing silently", async () => {
  const popup = await createPopupSession({ failInjection: true });
  const primary = popup.app.querySelector('[data-bso-action="enable"]');
  primary.dispatchEvent({ type: "click" });
  assert.equal(popup.closed, false);
  assert.ok(textOf(popup.app).includes("Could not reach the YouTube tab"));
  assert.ok(textOf(popup.app).includes("Chrome rejected content bundle injection."));
});

test("popup mode and panel controls are single-activation and visibly stateful", async () => {
  const popup = await createPopupSession();
  const radioButtons = () => popup.app.querySelectorAll("button").filter((button) => button.getAttribute("role") === "radio");
  assert.equal(radioButtons().find((button) => button.getAttribute("aria-checked") === "true").children.at(-1).textContent, "Minimal");

  buttonWithText(popup.app, "Balanced").dispatchEvent({ type: "click" });
  assert.equal(radioButtons().find((button) => button.getAttribute("aria-checked") === "true").children.at(-1).textContent, "Balanced");
  buttonWithText(popup.app, "Full").dispatchEvent({ type: "click" });
  assert.equal(radioButtons().find((button) => button.getAttribute("aria-checked") === "true").children.at(-1).textContent, "Full");

  let switchButton = popup.app.querySelector('[aria-label="Toggle Shots this rally"]');
  assert.equal(switchButton.getAttribute("aria-checked"), "true");
  switchButton.dispatchEvent({ type: "click" });
  switchButton = popup.app.querySelector('[aria-label="Toggle Shots this rally"]');
  assert.equal(switchButton.getAttribute("aria-checked"), "false", "one switch click is not cancelled by label activation");
  for (const label of ["Rally stats", "Court map"]) {
    switchButton = popup.app.querySelector(`[aria-label="Toggle ${label}"]`);
    const before = switchButton.getAttribute("aria-checked");
    switchButton.dispatchEvent({ type: "click" });
    switchButton = popup.app.querySelector(`[aria-label="Toggle ${label}"]`);
    assert.notEqual(switchButton.getAttribute("aria-checked"), before, `${label} switch changes state`);
  }
});

test("popup actions survive an in-flight storage read", async () => {
  const popup = await createPopupSession({ deferStorage: true });
  const primary = popup.app.querySelector('[data-bso-action="enable"]');
  assert.ok(primary, "page detection renders actions before hydration");
  primary.dispatchEvent({ type: "click" });
  assert.equal(popup.sent.length, 0, "the action waits for the stored state");
  popup.flushStorage();
  assert.equal(popup.sent.length, 2, "the queued action uses the normal recovery path once");
  assert.equal(popup.app.querySelector('[data-bso-action="open-overlay"]') != null, true);
  assert.equal(popup.closed, true);
});

test("the bundled content entrypoint is parse-safe and mounts one host, listener, court layer, and runtime", async () => {
  const session = await createSession({ bundle: true });
  const firstHost = session.host();
  assert.equal(session.documentRef.querySelectorAll("[data-badminton-vision]").length, 1);
  assert.equal(session.messageListeners.length, 1);

  const bundleSource = await loadContentBundle();
  assert.doesNotThrow(() => vm.runInContext(bundleSource, session.context, { filename: "dist/content.bundle.js#second-evaluation" }));
  assert.equal(session.host(), firstHost, "a second bundle evaluation is a no-op");
  assert.equal(session.documentRef.querySelectorAll("[data-badminton-vision]").length, 1);
  assert.equal(session.messageListeners.length, 1);

  session.flushStorage();
  const request = { type: "START_SEED", requestId: "popup-seed-1" };
  session.onMessage(request);
  session.onMessage(request);
  assert.equal(session.overlayRoot().querySelectorAll("[data-bso-court-seeding]").length, 1);
  assert.equal(session.runtimeStarts, 1);
});

test("content runtime initialization failures remain visible and keep manual UI available", async () => {
  const live = await createSession({
    bundle: true,
    storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false },
    runtimeError: "runtime-start-failed"
  });
  live.flushStorage();
  const host = live.host();
  assert.equal(host.getAttribute("data-bso-runtime-phase"), "fallback");
  assert.equal(host.getAttribute("data-bso-runtime-analyzer"), "none");
  assert.match(host.getAttribute("data-bso-fallback"), /^content-runtime-initialization-failed,runtime-start-failed$/);
  assert.equal(live.overlayRoot().querySelector('[data-bso-overlay-state="fallback"]') != null, true);
  live.onMessage({ type: "OPEN_LABELING", requestId: "runtime-failure-label" });
  assert.ok(live.overlayRoot().querySelector(".bv-label-panel"), "manual labeling remains available after runtime failure");
});

test("popup and content controls visibly change density, panels, and manual labels", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  let root = live.overlayRoot();
  assert.ok(root, "live overlay root exists");
  assert.equal(root.querySelectorAll("[data-bso-density]").length, 1);
  assert.equal(root.querySelector("[data-bso-density]").getAttribute("data-bso-density"), "minimal");
  assert.equal(root.querySelector(".bv-runtime-note"), null);

  buttonWithText(root, "Density: minimal").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.equal(root.querySelector("[data-bso-density]").getAttribute("data-bso-density"), "balanced");
  assert.ok(root.querySelector(".bv-runtime-note"));
  assert.ok(root.querySelector(".bv-overlay-feed"));
  assert.ok(root.querySelector(".bv-stat-grid"));
  assert.equal(root.querySelector(".bv-overlay-map"), null);

  buttonWithText(root, "Density: balanced").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.equal(root.querySelector("[data-bso-density]").getAttribute("data-bso-density"), "full");
  assert.ok(root.querySelector(".bv-overlay-map"));
  assert.ok(root.querySelector(".bv-runtime-signal"));
  const hideMap = root.querySelector('[aria-label="Hide court map"]');
  hideMap.dispatchEvent({ type: "click" });
  assert.equal(live.overlayRoot().querySelector(".bv-overlay-map"), null, "an overlay panel switch changes the visible panel");

  live.onMessage({ type: "OPEN_LABELING", requestId: "label-open-1" });
  root = live.overlayRoot();
  assert.ok(root.querySelector(".bv-label-panel"));
  live.video.currentTime = 20;
  live.video.dispatchEvent({ type: "timeupdate", target: live.video });
  buttonWithText(root, "Start").dispatchEvent({ type: "click" });
  live.video.currentTime = 21;
  live.video.dispatchEvent({ type: "timeupdate", target: live.video });
  buttonWithText(root, "End").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  buttonWithText(root, "Smash").dispatchEvent({ type: "click" });
  buttonWithText(root, "late").dispatchEvent({ type: "click" });
  buttonWithText(root, "Save label").dispatchEvent({ type: "click" });
  const saved = live.storageWrites.at(-1).bvState;
  assert.equal(saved.manualLabels.length, 1);
  assert.equal(saved.manualLabels[0].shot, "Smash");
  assert.equal(saved.manualLabels[0].axes.Timing, "late");
  assert.equal(saved.manualLabels[0].startSec, 20);
  assert.equal(saved.manualLabels[0].endSec, 21);

  live.onMessage({ type: "OPEN_LABELING", requestId: "label-edit-1" });
  root = live.overlayRoot();
  root.querySelector('[data-bso-label-source="manual"]').dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  buttonWithText(root, "Clear").dispatchEvent({ type: "click" });
  buttonWithText(root, "Save correction").dispatchEvent({ type: "click" });
  const edited = live.storageWrites.at(-1).bvState.manualLabels;
  assert.equal(edited.length, 1, "editing replaces one manual record");
  assert.equal(edited[0].eventId, saved.manualLabels[0].eventId);
  assert.equal(edited[0].shot, "Clear");

  live.onMessage({ type: "OPEN_LABELING", requestId: "label-export-1" });
  root = live.overlayRoot();
  assert.doesNotThrow(() => buttonWithText(root, "Export CSV").dispatchEvent({ type: "click" }));
  assert.ok(live.documentRef.created.some((node) => node.tagName === "A" && node.download === "badminton-vision-shots.csv"));
});

function evidenceResult({ mediaTime = 12, keypointOffset = 0, includeRacket = true, includeBox = true, unknown = false } = {}) {
  const names = ["nose", "neck", "left_shoulder", "left_elbow", "left_wrist", "right_shoulder", "right_elbow", "right_wrist", "left_hip", "left_knee", "left_ankle", "right_hip", "right_knee", "right_ankle", "left_eye", "right_eye", "left_ear", "right_ear"];
  const keypoints = unknown ? [] : names.map((name, index) => ({
    name,
    x: 0.18 + (index % 4) * 0.035 + keypointOffset,
    y: 0.18 + Math.floor(index / 4) * 0.045,
    confidence: 0.9
  }));
  const player = {
    trackId: "live-session:player-1",
    state: unknown ? "unknown" : "tracked",
    confidence: unknown ? null : 0.9,
    bbox: unknown || !includeBox ? null : { x: 0.15 + keypointOffset, y: 0.14, width: 0.2, height: 0.55 },
    keypoints
  };
  const result = {
    kind: "lightweight-openpose-pose-shuttle",
    state: unknown ? "unknown" : "tracked",
    players: [player],
    tracking: { state: unknown ? "unknown" : "tracked", accepted: true, players: [player] },
    shuttle: unknown
      ? { state: "unknown", confidence: null, accepted: false, trajectory: [], candidate: null }
      : { state: "tracked", confidence: 0.75, accepted: true, trajectory: [{ x: 0.4, y: 0.5 }, { x: 0.5, y: 0.4 }], candidate: { x: 0.5, y: 0.4, accepted: true } },
    rally: { state: "unknown" }, rallyEnd: { state: "unknown" }, winner: { state: "unknown" }, strokeEvents: []
  };
  if (includeRacket) result.racket = unknown
    ? { state: "unknown", confidence: null }
    : { state: "tracked", confidence: 0.8, segment: { start: { x: 0.31, y: 0.33 }, end: { x: 0.39, y: 0.28 } } };
  return result;
}

function resultView(result) {
  return {
    phase: "result", message: "Local analyzer result received", reason: "", analyzer: "lightweight-openpose-lite-256-v1",
    inference: true, fallbacks: [], capabilities: { inference: true, analyzer: "lightweight-openpose-lite-256-v1", backend: "wasm" },
    result, currentMediaTime: result.mediaTime || 12, ageSeconds: 0, stale: false
  };
}

async function createLiveEvidenceSession() {
  const session = await createSession();
  session.flushStorage();
  session.onMessage({ type: "ENABLE", requestId: "live-evidence-enable" });
  const corners = [[64, 324], [576, 324], [576, 36], [64, 36]];
  for (const [clientX, clientY] of corners) {
    const layer = session.overlayRoot().querySelector("[data-bso-court-seeding]");
    layer.dispatchEvent({ type: "click", target: layer, clientX, clientY, defaultPrevented: false });
  }
  const lock = buttonWithText(session.overlayRoot(), "Lock court");
  assert.ok(lock, "the fitted seed exposes a lock action");
  lock.dispatchEvent({ type: "click", target: lock });
  assert.equal(session.overlayRoot().querySelector("[data-bso-court-seeding]"), null);
  return session;
}

test("live result updates redraw accepted pose, shuttle, and supplied racket evidence without blocking input", async () => {
  const session = await createLiveEvidenceSession();
  const first = evidenceResult({ mediaTime: 12 });
  session.publishRuntimeView(resultView(first));
  let root = session.overlayRoot();
  let drawing = root.querySelector(".bv-runtime-evidence");
  assert.ok(drawing);
  assert.equal(drawing.getAttribute("pointer-events"), "none");
  assert.equal(drawing.style.pointerEvents, "none");
  assert.equal(drawing.querySelectorAll(".bv-pose-keypoint").length, 18);
  assert.ok(drawing.querySelectorAll(".bv-pose-bone").length >= 10, "named body points are connected");
  assert.equal(drawing.querySelectorAll(".bv-player-box").length, 1);
  assert.equal(drawing.querySelectorAll(".bv-shuttle-trajectory").length, 1);
  assert.equal(drawing.querySelectorAll(".bv-shuttle-point").length, 1);
  assert.equal(drawing.querySelectorAll(".bv-racket-signal").length, 1);

  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.05, includeBox: false })));
  drawing = session.overlayRoot().querySelector(".bv-runtime-evidence");
  assert.equal(drawing.querySelectorAll(".bv-pose-keypoint").length, 18, "pose points remain available without a box");
  assert.equal(drawing.querySelectorAll(".bv-player-box").length, 0, "the renderer never synthesizes a box from keypoints");

  const second = evidenceResult({ mediaTime: 12.1, keypointOffset: 0.02 });
  session.publishRuntimeView(resultView(second));
  root = session.overlayRoot();
  drawing = root.querySelector(".bv-runtime-evidence");
  const nose = drawing.querySelectorAll(".bv-pose-keypoint").find((point) => point.getAttribute("data-keypoint") === "nose");
  assert.ok(Math.abs(Number(nose.getAttribute("cx")) - 0.2) < 1e-9, "a newer accepted result replaces the rendered pose");
  const box = drawing.querySelectorAll(".bv-player-box").find((node) => node.getAttribute("data-box-source") === "runtime");
  assert.equal(box.getAttribute("data-player-state"), "tracked");
});

test("live evidence visibility switches are independent, persistent across result rerenders, and honest about missing signals", async () => {
  const session = await createLiveEvidenceSession();
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12 })));
  const toggle = (name) => session.overlayRoot().querySelector(`[data-bso-evidence-control="${name}"]`).querySelector("button");
  const has = (selector) => Boolean(session.overlayRoot().querySelector(".bv-runtime-evidence").querySelector(selector));

  toggle("body").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-pose-keypoint"), false);
  assert.equal(has(".bv-player-box"), true);
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.1, keypointOffset: 0.01 })));
  assert.equal(has(".bv-pose-keypoint"), false, "pose visibility survives a result rerender");

  toggle("players").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-player-box"), false);
  assert.equal(has(".bv-pose-keypoint"), false);
  toggle("shuttle").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-shuttle-trajectory"), false);
  assert.equal(has(".bv-shuttle-point"), false);
  toggle("racket").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-racket-signal"), false);
  toggle("court").dispatchEvent({ type: "click" });
  assert.equal(session.overlayRoot().querySelector(".bv-calibration-court"), null);

  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.2, includeRacket: false, unknown: true })));
  assert.equal(toggle("racket").getAttribute("aria-checked"), "false", "explicit racket visibility remains off");
  const racketControl = session.overlayRoot().querySelector('[data-bso-evidence-control="racket"]');
  assert.equal(racketControl.getAttribute("data-bso-evidence-state"), "unavailable", "missing racket output is unavailable, not guessed");
  assert.equal(toggle("racket").disabled, true);
  assert.equal(session.overlayRoot().querySelector('[data-bso-evidence-control="shuttle"]').getAttribute("data-bso-evidence-state"), "unknown");
  assert.equal(has(".bv-racket-signal"), false);
  assert.equal(has(".bv-shuttle-point"), false);
  assert.equal(has(".bv-player-box"), false);

  session.onMessage({ type: "DISABLE", requestId: "live-evidence-disable" });
  assert.equal(session.runtimeStops, 1, "disabling the overlay stops the runtime session");
  assert.equal(session.overlayRoot().children.length, 0, "disable removes all live evidence and controls");
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.3 })));
  assert.equal(session.overlayRoot().children.length, 0, "a late result cannot resurrect disabled evidence");
});
