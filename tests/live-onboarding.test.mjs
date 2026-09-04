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
  "src/panel-layout.js",
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
    this.capturedPointerId = null;
    this.releasedPointerId = null;
  }

  setPointerCapture(pointerId) { this.capturedPointerId = pointerId; }
  hasPointerCapture(pointerId) { return this.capturedPointerId === pointerId; }
  releasePointerCapture(pointerId) { this.releasedPointerId = pointerId; this.capturedPointerId = null; }

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

async function createSession({ bundle = false, storedState = { videoKey: "youtube:real-match", enabled: false, seeded: false }, runtimeError = null, videoPresent = true } = {}) {
  const documentRef = new FakeDocument();
  const video = videoPresent ? new FakeNode("video") : null;
  if (video) {
    Object.assign(video, { currentTime: 12, paused: false, muted: false, playbackRate: 1, readyState: 4, videoWidth: 640, videoHeight: 360 });
    const videoContainer = new FakeNode("div");
    documentRef.body.appendChild(videoContainer);
    videoContainer.appendChild(video);
  }
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
  let runtimeChange = null;
  let runtimeStops = 0;
  let mutationObserverCallback = null;
  let runtimeOnChange = null;
  const chromeApi = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      getManifest: () => ({ name: "Badminton Vision", version: "0.1.0" }),
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
    MutationObserver: class {
      constructor(callback) { mutationObserverCallback = callback; }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    crypto: { randomUUID: () => "test-session" }
  });
  context.window = context;
  context.addEventListener = (name, listener) => { (windowListeners[name] ||= []).push(listener); };
  context.removeEventListener = (name, listener) => { windowListeners[name] = (windowListeners[name] || []).filter((item) => item !== listener); };
  const files = bundle
    ? []
    : ["src/state.js", "analysis/index.js", "src/calibration.js", "src/panel-layout.js", "src/seed-card.js", "src/fixtures.js", "src/review.js", "src/analysis.js", "src/ui.js", "src/content.js"];
  if (!bundle) {
    context.BVRuntime = {
      startIntegratedRuntime: (options = {}) => {
        runtimeChange = options.onChange || null;
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
    context.BVRuntime.startIntegratedRuntime = (options = {}) => {
      runtimeChange = options.onChange || null;
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
    runtimeUpdate(view) { runtimeChange?.(view); },
    publishRuntimeView(view) { assert.equal(typeof runtimeOnChange, "function"); runtimeOnChange(view); },
    emitWindow(name) { (windowListeners[name] || []).slice().forEach((listener) => listener({ type: name })); },
    emitMutations(records) { mutationObserverCallback?.(records); },
    emitKey(key, { target = null } = {}) {
      let prevented = false;
      const event = { type: "keydown", key, target, preventDefault() { prevented = true; } };
      (windowListeners.keydown || []).slice().forEach((listener) => listener(event));
      return prevented;
    },
    flushStorage(value = storedState) {
      assert.equal(storageReads.length, 1);
      storageReads.shift()({ bvState: value });
    },
    host() { return documentRef.querySelector("[data-badminton-vision]"); },
    overlayRoot() { return this.host().shadowRoot.querySelector(".bv-overlay-root"); }
  };
}

async function createPopupSession({ deferStorage = false, failInjection = false, tabUrl = "https://www.youtube.com/watch?v=real-match", tabTitle = "Real Match Title - YouTube", videoInfo = null, initialVideoKey = "youtube:real-match", runtimeStatus = null, storedState = null } = {}) {
  const documentRef = new FakeDocument();
  const app = new FakeNode("main");
  app.setAttribute("id", "app");
  documentRef.body.appendChild(app);
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const sent = [];
  let injection = null;
  let closed = false;
  const storageReads = [];
  const stored = Object.assign({ bvState: storedState || { videoKey: initialVideoKey, enabled: false, seeded: false }, bvVideoInfo: videoInfo }, runtimeStatus ? { bvRuntimeStatus: runtimeStatus } : {});
  const runtime = {
    lastError: null,
    getURL: (path) => `chrome-extension://test/${path}`,
    getManifest: () => manifest
  };
  const chromeApi = {
    runtime,
    tabs: {
      query: (_query, callback) => callback([{ id: 7, url: tabUrl, title: tabTitle }]),
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
        else callback(stored);
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
    flushStorage() { storageReads.shift()(stored); },
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
  assert.equal(host.getAttribute("data-bso-court-state"), "not-seeded");
  assert.equal(host.getAttribute("data-bso-court-map-state"), "uncalibrated");
  assert.equal(session.overlayRoot().querySelector("[data-bso-court-seeding]"), null, "enabling inference does not force court setup");
  assert.ok(session.overlayRoot().querySelector(".bv-runtime-evidence"), "the raw evidence layer is available before calibration");
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12, includeRacketHands: true })));
  const uncalibratedDrawing = session.overlayRoot().querySelector(".bv-runtime-evidence");
  assert.equal(uncalibratedDrawing.querySelectorAll(".bv-pose-keypoint").length, 18, "uncalibrated raw pose evidence is rendered");
  assert.equal(uncalibratedDrawing.querySelectorAll(".bv-shuttle-trajectory").length, 1, "uncalibrated shuttle evidence is rendered");
  assert.equal(uncalibratedDrawing.querySelectorAll(".bv-racket-signal").length, 1, "uncalibrated racket evidence is rendered");
  assert.equal(session.runtimeStarts, 1);

  // Court setup remains an explicit optional action and is layered over the
  // running inference surface rather than replacing it.
  session.onMessage({ type: "START_SEED", requestId: "optional-court-setup" });
  assert.ok(session.overlayRoot().querySelector("[data-bso-court-seeding]"));
  assert.ok(session.overlayRoot().querySelector(".bv-runtime-evidence"), "raw evidence remains mounted during setup");
  assert.equal(session.runtimeStarts, 1, "starting court setup does not restart inference");

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

test("content geometry ignores unrelated DOM churn while retaining video ancestor updates", async () => {
  const session = await createSession();
  session.flushStorage();
  let positionCalls = 0;
  const originalGeometry = session.video.getBoundingClientRect.bind(session.video);
  session.video.getBoundingClientRect = () => { positionCalls += 1; return originalGeometry(); };
  session.emitMutations([{ type: "childList", target: session.documentRef.body, addedNodes: [new FakeNode("span")], removedNodes: [] }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(positionCalls, 0, "an unrelated YouTube DOM mutation does not remeasure the overlay");
  session.video.rect = { left: 91, top: 30, width: 640, height: 360 };
  session.emitMutations([{ type: "childList", target: session.video.parentNode, addedNodes: [new FakeNode("span")], removedNodes: [] }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(positionCalls, 1, "a video ancestor mutation reanchors after a same-size shift");
  assert.equal(session.host().style.left, "91px");
  session.emitMutations([{ type: "attributes", target: session.video, attributeName: "class" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(positionCalls, 2, "a video geometry mutation still reanchors the overlay");
});

test("a direct video insertion after startup attaches the overlay and media listeners", async () => {
  const session = await createSession({ videoPresent: false });
  session.flushStorage();
  const video = new FakeNode("video");
  Object.assign(video, { currentTime: 19, paused: false, muted: false, playbackRate: 1, readyState: 4, videoWidth: 640, videoHeight: 360 });
  session.documentRef.body.appendChild(video);
  session.emitMutations([{ type: "childList", target: session.documentRef.body, addedNodes: [video], removedNodes: [] }]);
  assert.equal(session.host().style.display, "block");
  assert.equal(session.host().style.width, "640px");
  video.currentTime = 23;
  video.dispatchEvent({ type: "timeupdate", target: video });
  session.onMessage({ type: "OPEN_LABELING", requestId: "late-video-label" });
  assert.equal(session.overlayRoot().querySelector(".bv-label-panel").getAttribute("data-bso-media-time"), "00:23.000");
  assert.equal(session.host().getAttribute("data-bso-enabled"), "false");
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

  // Expand Panel Controls disclosure to access panel toggles
  let panelControlsToggle = popup.app.querySelector("[data-bso-panel-controls-toggle]");
  assert.equal(panelControlsToggle.getAttribute("aria-expanded"), "false", "panel controls start collapsed");
  panelControlsToggle.dispatchEvent({ type: "click" });
  panelControlsToggle = popup.app.querySelector("[data-bso-panel-controls-toggle]");
  assert.equal(panelControlsToggle.getAttribute("aria-expanded"), "true", "panel controls expand on toggle");

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

  // Evidence visibility is one compact, keyboard-operable disclosure in the
  // popup rather than a fourth on-video panel.
  let disclosureToggle = popup.app.querySelector("[data-bso-evidence-disclosure-toggle]");
  const disclosureId = disclosureToggle.getAttribute("aria-controls");
  assert.equal(disclosureToggle.getAttribute("aria-expanded"), "false");
  assert.equal(disclosureToggle.getAttribute("aria-label"), "Expand Evidence visibility controls");
  assert.equal(popup.app.querySelector(`[id="${disclosureId}"]`).getAttribute("hidden") !== null, true);
  disclosureToggle.dispatchEvent({ type: "click" });
  disclosureToggle = popup.app.querySelector("[data-bso-evidence-disclosure-toggle]");
  assert.equal(disclosureToggle.getAttribute("aria-expanded"), "true");
  assert.equal(popup.app.querySelector(`[id="${disclosureId}"]`).getAttribute("hidden"), null);
  assert.equal(popup.app.querySelector(`[data-bso-evidence-control="body"]`).querySelector("button").getAttribute("aria-label"), "Toggle Pose keypoints + skeleton");
  assert.ok(popup.app.querySelector(`[data-bso-evidence-control="players"]`));
  assert.ok(popup.app.querySelector(`[data-bso-evidence-control="racket"]`));
  assert.ok(popup.app.querySelector(`[data-bso-evidence-control="shuttle"]`));
  assert.ok(popup.app.querySelector("[data-bso-court-projection-toggle]"));
  const firstEvidenceControl = popup.app.querySelector(`[data-bso-evidence-control="body"]`).querySelector("button");
  assert.equal(firstEvidenceControl.focused, true, "opening the disclosure moves focus to its first available control");
  const bodyBefore = firstEvidenceControl.getAttribute("aria-checked");
  firstEvidenceControl.dispatchEvent({ type: "click" });
  assert.notEqual(popup.app.querySelector(`[data-bso-evidence-control="body"]`).querySelector("button").getAttribute("aria-checked"), bodyBefore);
  assert.equal(popup.app.querySelector("[data-bso-evidence-disclosure-toggle]").getAttribute("aria-expanded"), "true", "normal evidence setting rerenders keep the disclosure expanded");
  disclosureToggle = popup.app.querySelector("[data-bso-evidence-disclosure-toggle]");
  disclosureToggle.dispatchEvent({ type: "click" });
  assert.equal(popup.app.querySelector("[data-bso-evidence-disclosure-toggle]").getAttribute("aria-expanded"), "false");
  assert.equal(popup.app.querySelector("[data-bso-evidence-disclosure-toggle]").focused, true, "closing the disclosure returns focus to its trigger");
});

test("popup quick wins: Panel Controls lead, live labels stay honest, Close stays explicit", async () => {
  const popup = await createPopupSession({
    storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false },
    runtimeStatus: {
      phase: "live", inference: true, analyzer: "lightweight-openpose-lite-256-v1",
      backend: "wasm", stale: false, frameTransport: "request-video-frame-callback",
      result: { kind: "tracking", state: "tracked", rally: { state: "unknown", reason: "rally-segmentation-not-available" } }
    }
  });
  // Section flow follows containers-before-content: Panel Controls renders
  // above Evidence visibility, with density and pose model below both.
  const sectionOf = (selector) => popup.app.children.findIndex((child) => child.querySelector(selector));
  assert.ok(sectionOf("[data-bso-panel-controls-toggle]") >= 0, "Panel Controls renders its section");
  assert.ok(
    sectionOf("[data-bso-panel-controls-toggle]") < sectionOf("[data-bso-evidence-disclosure-toggle]"),
    "Panel Controls renders above Evidence visibility"
  );
  assert.ok(sectionOf("[data-bso-evidence-disclosure-toggle]") < sectionOf("[data-bso-model-selector]"), "Evidence visibility renders above the pose model section");
  // The fixture-era default rally count never passes as live match state: a
  // production session without rally segmentation reads as live analysis and
  // the accelerator token is spelled out as a capability.
  const chip = popup.app.querySelector(".bv-status-chip");
  assert.equal(textOf(chip.querySelector(".bv-status-label")).trim(), "Live analysis", "a live session without a runtime rally id does not fake a count");
  assert.equal(textOf(chip.querySelector(".bv-status-detail")).trim(), "WASM (software)", "backend tokens are shown as user-facing capabilities");
  assert.doesNotMatch(textOf(chip), /Rally\s*\d+/, "the fixture-era count is absent from the live chip");
  assert.ok(textOf(popup.app).includes("local pose + bounded shuttle candidate · WASM (software)"), "tracker summary uses the same capability label");
  // Panel Controls help text names its role next to the overlay quick surface.
  popup.app.querySelector("[data-bso-panel-controls-toggle]").dispatchEvent({ type: "click" });
  const panelCopy = textOf(popup.app);
  assert.ok(panelCopy.includes("saved for this video"), "panel choices stay per-video");
  assert.ok(panelCopy.includes("the Panels button over the video offers the same panels as quick shortcuts"), "help text distinguishes the popup setup role from the overlay quick shortcuts");
  // The header keeps its explicit, accessible Close affordance (audit: keep).
  const closeButton = popup.app.querySelectorAll("button").find((button) => button.getAttribute("aria-label") === "Close");
  assert.ok(closeButton, "the header keeps a labeled Close button");
  assert.equal(closeButton.getAttribute("title"), "Close");
  closeButton.dispatchEvent({ type: "click" });
  assert.equal(popup.closed, true, "Close still closes the popup");
  // A runtime-reported rally id is the one case the count label appears.
  const tracked = await createPopupSession({
    storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false },
    runtimeStatus: {
      phase: "live", inference: true, analyzer: "lightweight-openpose-lite-256-v1",
      backend: "webgpu", stale: false,
      result: { kind: "tracking", state: "tracked", rally: { state: "tracked", id: 7 } }
    }
  });
  assert.equal(textOf(tracked.app.querySelector(".bv-status-label")).trim(), "Rally #7", "a runtime-reported rally id is shown as the count");
  assert.equal(textOf(tracked.app.querySelector(".bv-status-detail")).trim(), "WebGPU acceleration");
});

test("popup chip never renders the fixture-era count or timestamp as state", async () => {
  // A fixture-probe analyzer session renders no static count: the fixture-era
  // state.rally default (14) must not pass as a live value, so the chip names
  // the fixture analyzer instead.
  const fixture = await createPopupSession({
    storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false },
    runtimeStatus: {
      phase: "live", inference: true, analyzer: "fixture-probe-v1",
      backend: null, stale: false, frameTransport: "request-video-frame-callback",
      result: { kind: "runtime-integration-probe", state: "partial", rally: { state: "unknown", reason: "rally-segmentation-not-available" } }
    }
  });
  assert.equal(textOf(fixture.app.querySelector(".bv-status-label")).trim(), "Fixture analysis", "the fixture-probe chip names the analyzer without a static count");
  assert.doesNotMatch(textOf(fixture.app.querySelector(".bv-status-chip")), /Rally\s*14/, "the fixture-era rally default never renders as a count");
  assert.equal(textOf(fixture.app.querySelector(".bv-status-detail")).trim(), "fixture probe · not production CV", "the fixture detail stays explicit");
  // Runtime still starting with no status published and an unwritten media
  // clock: the fixture-era timestamp default is suppressed, not shown.
  const starting = await createPopupSession({
    storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false }
  });
  assert.equal(textOf(starting.app.querySelector(".bv-status-label")).trim(), "Analysis starting", "a session without runtime status reads as starting");
  assert.equal(starting.app.querySelector(".bv-status-detail"), null, "the fixture-era timestamp default is not shown before the media clock writes state.time");
  // The same starting state keeps a genuinely written media clock value.
  const clocked = await createPopupSession({
    storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false, time: "05:12.480" }
  });
  assert.equal(textOf(clocked.app.querySelector(".bv-status-detail")).trim(), "05:12.480", "a media clock value written into state stays visible while starting");
});

test("minimal live overlay keeps only detection evidence and one on-demand access point", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  let root = live.overlayRoot();
  assert.equal(root.querySelector("[data-bso-density]").getAttribute("data-bso-density"), "minimal");
  assert.equal(root.querySelectorAll("[data-bso-overlay-access]").length, 1, "minimal mode has one compact access point");
  assert.equal(root.querySelector("[data-bso-overlay-access]").getAttribute("aria-expanded"), "false");
  assert.equal(root.querySelector("[data-bso-overlay-menu]").getAttribute("hidden") !== null, true, "the shortcut menu is on demand");
  for (const panel of ["stats", "map", "feed", "evidence", "controls", "settings"]) {
    assert.equal(root.querySelector(`[data-bso-panel="${panel}"]`), null, `${panel} stays off the video by default`);
  }
  assert.equal(root.querySelector(".bv-runtime-note"), null);
  assert.equal(root.querySelector(".bv-runtime-signal"), null);

  live.publishRuntimeView(resultView(evidenceResult({ includeBox: true })));
  root = live.overlayRoot();
  const drawing = root.querySelector(".bv-runtime-evidence");
  assert.equal(drawing.querySelectorAll(".bv-pose-keypoint").length, 18, "pose keypoints remain visible");
  assert.ok(drawing.querySelectorAll(".bv-pose-bone").length >= 10, "the pose skeleton remains visible");
  assert.equal(drawing.querySelectorAll(".bv-shuttle-trajectory").length, 1, "the shuttle path remains visible");
  assert.equal(drawing.querySelectorAll(".bv-shuttle-point").length, 1, "the shuttle candidate remains visible");
  assert.equal(drawing.querySelectorAll(".bv-racket-signal").length, 1, "available racket evidence remains visible");
  assert.equal(drawing.querySelectorAll(".bv-player-box").length, 0, "player boxes require an explicit opt-in");

  root.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.equal(root.querySelector("[data-bso-overlay-access]").getAttribute("aria-expanded"), "true");
  assert.equal(root.querySelector("[data-bso-overlay-menu]").getAttribute("hidden"), null);
  assert.ok(root.querySelector('[data-bso-overlay-shortcut="stats"]'));
  assert.ok(root.querySelector('[data-bso-overlay-shortcut="feed"]'));
  assert.ok(root.querySelector('[data-bso-overlay-shortcut="map"]'));
  assert.equal(root.querySelector('[data-bso-overlay-shortcut="evidence"]'), null, "the retired standalone evidence panel is not an overlay shortcut");
  assert.ok(root.querySelector('[data-bso-overlay-shortcut="manual"]'), "manual labeling is available from the same access point");
  root.querySelector('[data-bso-overlay-shortcut="stats"]').dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.ok(root.querySelector('[data-bso-panel="stats"]'), "the access point opens a panel on demand");
  assert.equal(root.querySelector("[data-bso-overlay-access]").getAttribute("aria-expanded"), "false", "opening a panel closes the shortcut menu");
  assert.equal(live.storageWrites.at(-1).bvState.panelsByVideo["youtube:real-match"].stats, true, "the opened panel preference is saved for this video");
});

test("court map exposes optional first-use setup, calibrated mapping, and recalibration without stopping inference", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_PANELS", panels: { map: true }, requestId: "court-map-open" });
  let root = live.overlayRoot();
  let map = root.querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "uncalibrated");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "0");
  assert.ok(buttonWithText(map, "Set up court"), "first use has a clear court setup action");
  assert.match(textOf(map), /Set up the court to project live coordinates/);

  // Setup is an explicit map action and is layered over the still-running raw
  // evidence surface rather than gating or restarting inference.
  buttonWithText(map, "Set up court").dispatchEvent({ type: "click", target: buttonWithText(map, "Set up court") });
  root = live.overlayRoot();
  assert.ok(root.querySelector("[data-bso-court-seeding]"));
  assert.ok(root.querySelector(".bv-runtime-evidence"));
  assert.equal(live.host().getAttribute("data-bso-court-map-state"), "setup");
  assert.equal(live.runtimeStarts, 1);

  const corners = [[64, 324], [576, 324], [576, 36], [64, 36]];
  for (const [clientX, clientY] of corners) {
    const layer = live.overlayRoot().querySelector("[data-bso-court-seeding]");
    layer.dispatchEvent({ type: "click", target: layer, clientX, clientY, defaultPrevented: false });
  }
  root = live.overlayRoot();
  buttonWithText(root, "Lock court").dispatchEvent({ type: "click", target: buttonWithText(root, "Lock court") });
  root = live.overlayRoot();
  map = root.querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "calibrated");
  assert.ok(buttonWithText(map, "Recalibrate court"), "an existing configuration exposes recalibration");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "0", "no detections means no mapped players");

  live.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12 })));
  map = live.overlayRoot().querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "calibrated");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "1", "calibration enables map projection without changing inference");

  // Starting recalibration immediately withdraws mapped output; the previous
  // fit is not reused while the new draft is incomplete.
  buttonWithText(map, "Recalibrate court").dispatchEvent({ type: "click", target: buttonWithText(map, "Recalibrate court") });
  root = live.overlayRoot();
  map = root.querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "recalibrating");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "0");
  assert.equal(root.querySelector(".bv-calibration-court"), null, "old projected lines are cleared during recalibration");
  assert.ok(root.querySelector(".bv-runtime-evidence"), "raw detections remain visible during recalibration");

  buttonWithText(root, "Skip to manual").dispatchEvent({ type: "click", target: buttonWithText(root, "Skip to manual") });
  assert.ok(root.querySelector(".bv-label-panel"), "recalibration can hand off to manual labeling");
  root.querySelector('[aria-label="Close manual labeling"]').dispatchEvent({ type: "click", target: root.querySelector('[aria-label="Close manual labeling"]') });
  root = live.overlayRoot();
  map = root.querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "calibrated", "manual handoff restores the prior court mapping");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "1", "restored mapping remains available after manual labeling");

  buttonWithText(map, "Recalibrate court").dispatchEvent({ type: "click", target: buttonWithText(map, "Recalibrate court") });
  live.onMessage({ type: "OPEN_LABELING", requestId: "recalibration-popup-manual" });
  root = live.overlayRoot();
  assert.ok(root.querySelector(".bv-label-panel"), "popup labeling also leaves recalibration safely");
  root.querySelector('[aria-label="Close manual labeling"]').dispatchEvent({ type: "click", target: root.querySelector('[aria-label="Close manual labeling"]') });
  root = live.overlayRoot();
  map = root.querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "calibrated", "all manual entry points restore the prior court mapping");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "1");

  buttonWithText(map, "Recalibrate court").dispatchEvent({ type: "click", target: buttonWithText(map, "Recalibrate court") });
  root = live.overlayRoot();
  buttonWithText(root, "Reset court").dispatchEvent({ type: "click", target: buttonWithText(root, "Reset court") });
  root = live.overlayRoot();
  map = root.querySelector('[data-bso-panel="map"]');
  assert.equal(map.getAttribute("data-bso-court-map-state"), "setup");
  assert.equal(map.getAttribute("data-bso-mapped-player-count"), "0");
  assert.equal(root.querySelector(".bv-calibration-court"), null);
  buttonWithText(root, "Cancel").dispatchEvent({ type: "click", target: buttonWithText(root, "Cancel") });
  assert.equal(live.host().getAttribute("data-bso-enabled"), "true", "cancelling optional setup leaves inference enabled");
  assert.equal(live.host().getAttribute("data-bso-court-map-state"), "uncalibrated");
  assert.ok(live.overlayRoot().querySelector(".bv-runtime-evidence"));
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

test("all overlay panels expose independent move and resize semantics", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "layout-full-1" });
  let root = live.overlayRoot();
  const panelIds = root.querySelectorAll("[data-bso-panel-layout]").map((panel) => panel.getAttribute("data-bso-panel"));
  assert.deepEqual(panelIds.sort(), ["controls", "feed", "map", "stats"]);
  for (const panelId of panelIds) {
    const panel = root.querySelector(`[data-bso-panel="${panelId}"]`);
    assert.ok(panel.querySelector("[data-bso-panel-drag-handle]"), `${panelId} has a natural header drag surface`);
    assert.ok(panel.querySelector("[data-bso-panel-resize-handle]"), `${panelId} has a resize affordance`);
  }
  live.onMessage({ type: "OPEN_LABELING", requestId: "layout-manual-1" });
  root = live.overlayRoot();
  const manual = root.querySelector('[data-bso-panel="manual"]');
  assert.ok(manual, "manual labeling is a movable panel");
  assert.ok(manual.querySelector("[data-bso-panel-drag-handle]"));
  assert.ok(manual.querySelector("[data-bso-panel-resize-handle]"));
});

test("panel movement and controls remain separate, with layout retained across rerender", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "balanced", requestId: "layout-balanced-1" });
  let root = live.overlayRoot();
  const feed = root.querySelector('[data-bso-panel="feed"]');
  const header = feed.querySelector("[data-bso-panel-drag-handle]");
  const pointer = (node, type, x, y, id = 7, target = node) => node.dispatchEvent({
    type, target, pointerId: id, button: 0, clientX: x, clientY: y,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }
  });
  pointer(header, "pointerdown", 10, 10);
  pointer(header, "pointermove", 110, 70);
  pointer(header, "pointerup", 110, 70);
  const savedAfterMove = live.storageWrites.at(-1).bvState;
  assert.ok(savedAfterMove.panelLayoutsByVideo["youtube:real-match"].feed.x > 0, "header drag stores a video-local position");

  const beforeControl = JSON.stringify(savedAfterMove.panelLayouts.feed);
  const densityButton = buttonWithText(root, "Density: balanced");
  pointer(header, "pointerdown", 10, 10, 8, densityButton);
  pointer(header, "pointermove", 300, 200, 8, densityButton);
  pointer(header, "pointerup", 300, 200, 8, densityButton);
  assert.equal(JSON.stringify(live.storageWrites.at(-1).bvState.panelLayouts.feed), beforeControl, "a control click does not start a panel drag");

  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "layout-rerender-1" });
  root = live.overlayRoot();
  const rerenderedFeed = root.querySelector('[data-bso-panel="feed"]');
  assert.equal(rerenderedFeed.style.left, "68px", "saved feed placement is applied after rerender and clamped");

  const resize = rerenderedFeed.querySelector("[data-bso-panel-resize-handle]");
  pointer(resize, "pointerdown", 10, 10, 9);
  pointer(resize, "pointermove", 2000, 2000, 9);
  pointer(resize, "pointerup", 2000, 2000, 9);
  const resized = live.storageWrites.at(-1).bvState.panelLayouts.feed;
  assert.ok(resized.width <= 0.875 && resized.height <= 1, "resize is capped to the video bounds");

  assert.equal(root.querySelector('[data-bso-panel="evidence"]'), null, "evidence visibility is not movable on-video furniture");
});

test("court setup keeps corners clickable without a visible drag instruction", async () => {
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "layout-seed-1" });
  const root = live.overlayRoot();
  const layer = root.querySelector("[data-bso-court-seeding]");
  const card = layer.querySelector("[data-bso-seed-card]");
  const header = card.querySelector("[data-bso-panel-drag-handle]");
  assert.equal(card.querySelector(".bv-seed-card-handle-text"), null);
  assert.equal(card.querySelectorAll("button").some((button) => button.getAttribute("data-bso-seed-card-handle") === "true"), false);
  assert.doesNotMatch(textOf(card), /Drag to move/);
  const pointer = (node, type, x, y, id = 11) => node.dispatchEvent({
    type, target: node, pointerId: id, button: 0, clientX: x, clientY: y,
    preventDefault() {}, stopPropagation() {}
  });
  pointer(header, "pointerdown", 20, 20);
  pointer(header, "pointermove", 250, 120);
  pointer(header, "pointerup", 250, 120);
  assert.equal(live.host().getAttribute("data-bso-seed-count"), "0", "moving the setup header does not seed a point");
  layer.dispatchEvent({ type: "click", target: layer, clientX: 80, clientY: 280 });
  assert.equal(live.host().getAttribute("data-bso-seed-count"), "1", "a click on the layer remains a court-corner action");
});

test("runtime results do not replace the active court setup while seeding", async () => {
  const session = await createSession();
  session.flushStorage();
  session.onMessage({ type: "START_SEED", requestId: "seed-runtime-1" });
  const root = session.overlayRoot();
  const layer = root.querySelector("[data-bso-court-seeding]");
  let structuralRenders = 0;
  const replaceChildren = root.replaceChildren.bind(root);
  root.replaceChildren = (...children) => { structuralRenders += 1; return replaceChildren(...children); };
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.1 })));
  assert.equal(structuralRenders, 0, "a playing runtime result leaves the court setup DOM intact");
  assert.equal(session.overlayRoot().querySelector("[data-bso-court-seeding]"), layer);
  layer.dispatchEvent({ type: "click", target: layer, clientX: 80, clientY: 280 });
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "1", "corner input remains available after a runtime result");
});

test("a runtime camera cut during playback swaps the overlay into court setup once", async () => {
  const session = await createLiveEvidenceSession();
  const root = session.overlayRoot();
  assert.ok(root.querySelector(".bv-calibration-court"), "the seeded session projects the fitted court before the cut");
  let structuralRenders = 0;
  const replaceChildren = root.replaceChildren.bind(root);
  root.replaceChildren = (...children) => { structuralRenders += 1; return replaceChildren(...children); };
  session.publishRuntimeView(resultView(Object.assign(evidenceResult({ mediaTime: 12.1 }), { cameraCut: true })));
  assert.equal(structuralRenders, 1, "the camera-cut view renders the reseed flow once");
  const layer = session.overlayRoot().querySelector("[data-bso-court-seeding]");
  assert.ok(layer, "a playing camera cut enters the court-setup flow");
  assert.equal(session.overlayRoot().querySelector(".bv-calibration-court"), null, "the pre-cut court projection is not carried onto the new camera angle");
  assert.equal(session.overlayRoot().querySelector(".bv-runtime-evidence"), null, "the pre-cut evidence layer is not left frozen over the new angle");
  assert.equal(session.host().getAttribute("data-bso-court-state"), "seeding");
  const saved = session.storageWrites.slice().reverse().find((write) => write.bvState).bvState;
  assert.equal(saved.cameraCut, true, "the cut is persisted as a camera-cut state");
  assert.equal(saved.seeding, true, "the cut pauses analysis until the court is reseeded");
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.2, keypointOffset: 0.005 })));
  assert.equal(structuralRenders, 1, "later playing results leave the reseed layer intact");
  assert.equal(session.overlayRoot().querySelector("[data-bso-court-seeding]"), layer);
  layer.dispatchEvent({ type: "click", target: layer, clientX: 80, clientY: 280 });
  assert.equal(session.host().getAttribute("data-bso-seed-count"), "1", "corner input resumes while later results keep arriving");
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

test("manual labeling survives three sequential saves, rerenders, reload, and CRUD", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "OPEN_LABELING", requestId: "manual-three-open" });
  let root = live.overlayRoot();
  let panel = root.querySelector(".bv-label-panel");
  assert.ok(panel, "the real manual-label entry path opens the panel");
  const playbackBefore = { paused: live.video.paused, muted: live.video.muted, playbackRate: live.video.playbackRate, src: live.video.currentSrc || live.video.src };

  function setTime(seconds) {
    live.video.currentTime = seconds;
    live.video.dispatchEvent({ type: "timeupdate", target: live.video });
  }
  function clickData(node, attribute, value) {
    const button = node.querySelectorAll(`[${attribute}]`).find((item) => value == null || item.getAttribute(attribute) === value);
    assert.ok(button, `control ${attribute}=${value || ""} exists`);
    button.dispatchEvent({ type: "click", target: button });
    return button;
  }
  function savedRows(node) {
    const saved = node.querySelector(".bv-manual-saved");
    return saved ? saved.querySelectorAll('[data-bso-label-source="manual"]') : [];
  }
  function saveCurrent(node) {
    clickData(node, "data-bso-label-save", "true");
    return live.overlayRoot();
  }
  function markSegment(start, end, shot) {
    setTime(start);
    assert.ok(root.querySelector("[data-bso-label-window]"), "the segment display survives the clock update");
    const startButton = buttonWithText(root, "Start");
    assert.ok(startButton);
    startButton.dispatchEvent({ type: "click", target: startButton });
    setTime(end);
    const endButton = buttonWithText(root, "End");
    assert.ok(endButton);
    endButton.dispatchEvent({ type: "click", target: endButton });
    clickData(root, "data-bso-shot", shot);
    root = live.overlayRoot();
  }

  // First successful interaction: no runtime result is allowed to replace the
  // panel while the user marks the first segment.
  markSegment(20, 20.5, "Serve");
  assert.equal(root.querySelector(".bv-label-panel"), panel, "the first control keeps the live panel node");
  root = saveCurrent(root);
  assert.ok(root.querySelector(".bv-label-panel"), "saving the first label keeps Manual labeling open");
  assert.equal(savedRows(root).length, 1);

  markSegment(22, 22.5, "Clear");
  root = saveCurrent(root);
  assert.equal(savedRows(root).length, 2, "the second save appends a per-video record");

  // Captain-reported failure reproduction: the third interaction is masked by
  // an asynchronous media/runtime update. Before this fix, publishRuntimeView
  // and timeupdate called render(), replacing the form between pointerdown and
  // pointerup; the visible symptom was that Start/End or a picker click did
  // nothing, usually from the third shot onward. The first click could pass
  // when it happened between render ticks.
  panel = root.querySelector(".bv-label-panel");
  live.runtimeUpdate({ phase: "result", message: "new runtime frame", reason: "", analyzer: "test", inference: false, fallbacks: [], capabilities: {}, stale: false, ageSeconds: null, result: { kind: "test", state: "unknown", players: [], tracking: null, shuttle: null, strokeEvents: [], rally: { state: "unknown" }, rallyEnd: { state: "unknown" }, winner: { state: "unknown" } } });
  assert.equal(root.querySelector(".bv-label-panel"), panel, "a runtime result does not replace an in-flight manual form");
  markSegment(24, 24.75, "Drive");
  panel = root.querySelector(".bv-label-panel");
  assert.equal(panel.getAttribute("data-bso-draft-state"), "dirty");

  // Exercise every third-label control without allowing one control's handler
  // to invalidate the next control's DOM reference.
  const shotButtons = root.querySelectorAll("[data-bso-shot]");
  assert.equal(shotButtons.length, 11);
  shotButtons.forEach((button) => {
    button.dispatchEvent({ type: "click", target: button });
    assert.equal(root.querySelector(".bv-label-panel"), panel);
  });
  clickData(root, "data-bso-shot", "Drive");
  assert.equal(root.querySelector('[data-bso-shot="Drive"]').getAttribute("aria-pressed"), "true");
  const playerButtons = root.querySelectorAll("[data-bso-player-id]");
  assert.equal(playerButtons.length, 3);
  playerButtons.forEach((button) => {
    button.dispatchEvent({ type: "click", target: button });
    assert.equal(root.querySelector(".bv-label-panel"), panel);
  });
  assert.equal(root.querySelector('[data-bso-player-id="B"]').getAttribute("aria-checked"), "true");
  const axisNodes = root.querySelectorAll("[data-bso-axis]");
  assert.equal(axisNodes.length, 6);
  axisNodes.forEach((axis) => {
    const options = axis.querySelectorAll("[data-bso-axis-option]");
    assert.equal(options.length, 3);
    options.forEach((button) => {
      button.dispatchEvent({ type: "click", target: button });
      assert.equal(root.querySelector(".bv-label-panel"), panel);
    });
    assert.equal(axis.querySelectorAll(".selected").length, 1);
  });
  root = saveCurrent(root);
  assert.ok(root.querySelector(".bv-label-panel"), "the third save leaves the panel open");
  assert.equal(root.querySelector("[data-bso-label-mode]").getAttribute("data-bso-label-mode"), "create", "a new save exits edit mode");
  assert.equal(root.querySelector("[data-bso-draft-state]").getAttribute("data-bso-draft-state"), "ready", "the next-label draft is clean");
  assert.equal(root.querySelectorAll("[data-bso-shot]").filter((button) => button.className.split(/\s+/).includes("selected")).length, 0, "the next draft has no selected shot");
  assert.equal(root.querySelector("[data-bso-label-save]").disabled, true, "the next draft cannot save until a shot is chosen");
  assert.equal(savedRows(root).length, 3);
  const persisted = live.storageWrites.at(-1).bvState;
  const videoKey = "youtube:real-match";
  assert.equal(persisted.manualLabelsByVideo[videoKey].length, 3, "all three labels are stored under the active video");
  assert.deepEqual(JSON.parse(JSON.stringify(persisted.manualLabelsByVideo[videoKey].map((label) => label.shot))), ["Serve", "Clear", "Drive"]);
  assert.equal(persisted.manualLabelsByVideo[videoKey][2].playerId, "B");
  assert.equal(Object.keys(persisted.manualLabelsByVideo[videoKey][2].axes).length, 6);

  // A fresh content instance must reload the same per-video records and a
  // clean draft at the current media time, rather than leaking another video.
  const reloaded = await createSession({ storedState: JSON.parse(JSON.stringify(persisted)) });
  reloaded.flushStorage();
  root = reloaded.overlayRoot();
  assert.ok(root.querySelector(".bv-label-panel"), "the persisted labeling panel remains available after reload");
  assert.equal(savedRows(root).length, 3);
  assert.equal(root.querySelector("[data-bso-draft-state]").getAttribute("data-bso-draft-state"), "ready");
  assert.match(textOf(root.querySelector("[data-bso-label-window]")), /^00:12\.000 → —$/);

  // Existing-label edit preserves the event id and remains an intentional edit
  // mode; deleting then undoing restores the deterministic saved record.
  let rows = savedRows(root);
  const editedId = rows[0].getAttribute("data-bso-event-id");
  rows[0].dispatchEvent({ type: "click", target: rows[0] });
  root = reloaded.overlayRoot();
  assert.equal(root.querySelector("[data-bso-label-mode]").getAttribute("data-bso-label-mode"), "edit");
  clickData(root, "data-bso-shot", "Drop");
  clickData(root, "data-bso-label-save", "true");
  root = reloaded.overlayRoot();
  assert.equal(savedRows(root).length, 3);
  assert.equal(savedRows(root)[0].getAttribute("data-bso-event-id"), editedId);
  assert.equal(root.querySelector("[data-bso-draft-state]").getAttribute("data-bso-draft-state"), "ready");

  rows = savedRows(root);
  rows[1].dispatchEvent({ type: "click", target: rows[1] });
  root = reloaded.overlayRoot();
  const deleteButton = buttonWithText(root, "Delete label");
  assert.ok(deleteButton);
  deleteButton.dispatchEvent({ type: "click", target: deleteButton });
  root = reloaded.overlayRoot();
  assert.equal(savedRows(root).length, 2, "delete removes only the selected manual record");
  const undoButton = buttonWithText(root, "Undo");
  assert.ok(undoButton);
  undoButton.dispatchEvent({ type: "click", target: undoButton });
  root = reloaded.overlayRoot();
  assert.equal(savedRows(root).length, 3, "undo restores the deleted record");
  assert.doesNotThrow(() => buttonWithText(root, "Export CSV").dispatchEvent({ type: "click", target: buttonWithText(root, "Export CSV") }));
  assert.ok(reloaded.documentRef.created.some((node) => node.tagName === "A" && node.download === "badminton-vision-shots.csv"));

  const closeButton = buttonWithText(root, "Close");
  assert.ok(closeButton);
  closeButton.dispatchEvent({ type: "click", target: closeButton });
  assert.equal(reloaded.overlayRoot().querySelector(".bv-label-panel"), null, "only explicit Close closes the normal labeling session");
  const playbackAfter = { paused: reloaded.video.paused, muted: reloaded.video.muted, playbackRate: reloaded.video.playbackRate, src: reloaded.video.currentSrc || reloaded.video.src };
  assert.deepEqual(playbackAfter, playbackBefore, "manual labeling never mutates playback");
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

test("manual labels drive the live feed and stats panels in real time with an honest source", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_PANELS", panels: { feed: true }, requestId: "live-manual-stats-feed" });
  live.onMessage({ type: "OPEN_LABELING", requestId: "live-manual-stats-open" });
  let root = live.overlayRoot();
  function setTime(seconds) { live.video.currentTime = seconds; live.video.dispatchEvent({ type: "timeupdate", target: live.video }); }
  function markSegment(start, end, shot) {
    setTime(start);
    buttonWithText(root, "Start").dispatchEvent({ type: "click" });
    setTime(end);
    buttonWithText(root, "End").dispatchEvent({ type: "click" });
    root.querySelector(`[data-bso-shot="${shot}"]`).dispatchEvent({ type: "click" });
    root = live.overlayRoot();
    root.querySelector("[data-bso-label-save]").dispatchEvent({ type: "click" });
    root = live.overlayRoot();
  }
  markSegment(20, 20.5, "Serve");
  markSegment(22, 22.75, "Clear");
  const saved = live.storageWrites.at(-1).bvState;
  assert.equal(saved.manualLabelsByVideo["youtube:real-match"].length, 2);

  // The live stroke feed shows each labeled shot as it is saved, while the
  // labeling panel stays open for the next label.
  const feed = root.querySelector('[data-bso-panel="feed"]');
  const feedRows = feed.querySelectorAll('[data-bso-label-source="manual"]');
  assert.equal(feedRows.length, 2, "the feed reflects both saved manual labels");
  assert.equal(feedRows[0].getAttribute("data-bso-event-id"), saved.manualLabels[0].eventId);
  assert.match(textOf(feed), /Serve/);
  assert.match(textOf(feed), /Clear/);
  assert.ok(root.querySelector(".bv-label-panel"), "manual labeling stays open after each save");

  // The rally stats panel derives honest statistics from the labeled shots
  // through the same analysis core used by the summary/CSV path.
  live.onMessage({ type: "SET_DENSITY", value: "balanced", requestId: "live-manual-stats-density" });
  root = live.overlayRoot();
  const stats = root.querySelector('[data-bso-panel="stats"]');
  assert.ok(stats, "the stats panel opens in balanced density");
  assert.equal(stats.querySelector("[data-bso-stats-source]").getAttribute("data-bso-stats-source"), "manual", "no CV evidence means the source is manual");
  assert.match(textOf(stats), /manual labels/);
  assert.match(textOf(stats), /Length/);
  const manualStats = stats.querySelector("[data-bso-manual-stats]");
  assert.equal(manualStats.getAttribute("data-bso-manual-stats"), "2");
  assert.match(textOf(manualStats), /Serves/);
  assert.match(textOf(manualStats), /1/);
  assert.ok(manualStats.querySelector(".bv-mix-bar"), "the shot mix comes from the saved labels");
  assert.match(textOf(manualStats), /Serve/);
  assert.match(textOf(manualStats), /Clear/);

  // A CV backend result is preferred when it arrives; manual labels remain in
  // the feed and stats as seed/fallback, never as invented evidence.
  buttonWithText(root, "Close").dispatchEvent({ type: "click" });
  live.publishRuntimeView(resultView({
    kind: "lightweight-openpose-pose-shuttle",
    state: "tracked",
    players: [], tracking: { state: "tracked", accepted: true, players: [] },
    shuttle: { state: "unknown", confidence: null, accepted: false, trajectory: [], candidate: null },
    rally: { state: "known", id: "rally-9", start_media_time: 18, end_media_time: 25 },
    rallyEnd: { state: "unknown" }, winner: { state: "unknown" },
    strokeEvents: [{ eventId: "auto-9", sequence: 1, shot: "Smash", time: "00:19.000", startSec: 19, endSec: 19.4, status: "accepted", source: "auto", confidence: 0.8 }]
  }));
  root = live.overlayRoot();
  const statsAfter = root.querySelector('[data-bso-panel="stats"]');
  assert.equal(statsAfter.querySelector("[data-bso-stats-source]").getAttribute("data-bso-stats-source"), "cv", "real evidence is preferred once a CV backend supplies it");
  assert.match(textOf(statsAfter), /rally-9/);
  assert.match(textOf(statsAfter), /live evidence/);
  assert.ok(statsAfter.querySelector("[data-bso-manual-stats]"), "manual labels stay available as seed");
  const feedAfter = root.querySelector('[data-bso-panel="feed"]');
  assert.equal(feedAfter.querySelectorAll('[data-bso-label-source="manual"]').length, 2, "manual labels remain in the feed");
  assert.equal(feedAfter.querySelectorAll('[data-bso-event-id="auto-9"]').length, 1, "the CV stroke joins the feed");
});

test("CSV import restores exported labels with an identical round trip and de-duplicates", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "OPEN_LABELING", requestId: "csv-import-open" });
  let root = live.overlayRoot();
  function setTime(seconds) { live.video.currentTime = seconds; live.video.dispatchEvent({ type: "timeupdate", target: live.video }); }
  function markSegment(start, end, shot, player) {
    setTime(start);
    buttonWithText(root, "Start").dispatchEvent({ type: "click" });
    setTime(end);
    buttonWithText(root, "End").dispatchEvent({ type: "click" });
    root.querySelector(`[data-bso-shot="${shot}"]`).dispatchEvent({ type: "click" });
    if (player) root.querySelector(`[data-bso-player-id="${player}"]`).dispatchEvent({ type: "click" });
    root.querySelectorAll("[data-bso-axis-option]").find((button) => button.getAttribute("data-bso-axis-option") === "late").dispatchEvent({ type: "click" });
    root = live.overlayRoot();
    root.querySelector("[data-bso-label-save]").dispatchEvent({ type: "click" });
    root = live.overlayRoot();
  }
  markSegment(20, 20.5, "Serve", "A");
  markSegment(22, 22.75, "Clear");
  const persisted = JSON.parse(JSON.stringify(live.storageWrites.at(-1).bvState.manualLabelsByVideo["youtube:real-match"]));
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].playerId, "A");
  assert.deepEqual(persisted[1].axes, { Timing: "late" });

  // Export writes the CSV; the singleton seam keeps the exact text for the
  // round trip without reading a blob URL.
  buttonWithText(root, "Export CSV").dispatchEvent({ type: "click" });
  const exportedCsv = live.context.__BV_CONTENT_SINGLETON_V1__.lastExportCsv;
  assert.ok(typeof exportedCsv === "string" && exportedCsv.length > 0, "export produced CSV text");
  assert.match(exportedCsv.split("\n")[0], /shot_id,start_sec,end_sec,label/);
  assert.match(exportedCsv, /,player,provenance$/m);

  // Import into a fresh session restores identical records for the current
  // video and surfaces them in the panel immediately.
  const restored = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  restored.flushStorage();
  restored.onMessage({ type: "OPEN_LABELING", requestId: "csv-import-restore-open" });
  root = restored.overlayRoot();
  const importButton = buttonWithText(root, "Import CSV");
  assert.ok(importButton, "Import CSV sits next to Export CSV in the manual panel");
  importButton.dispatchEvent({ type: "click" });
  let input = restored.documentRef.querySelector("[data-bso-import-csv-input]");
  assert.ok(input, "import opens a file picker input");
  input.files = [{ name: "badminton-vision-shots.csv", text: async () => exportedCsv }];
  input.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  root = restored.overlayRoot();
  assert.match(textOf(root), /Imported 2 labels/);
  const restoredRows = root.querySelector(".bv-manual-saved").querySelectorAll('[data-bso-label-source="manual"]');
  assert.equal(restoredRows.length, 2, "imported rows appear in the panel immediately");
  const stored = restored.storageWrites.at(-1).bvState.manualLabelsByVideo["youtube:real-match"];
  assert.equal(stored.length, 2);
  stored.forEach((record, index) => {
    assert.equal(record.eventId, persisted[index].eventId);
    assert.equal(record.startSec, persisted[index].startSec);
    assert.equal(record.endSec, persisted[index].endSec);
    assert.equal(record.shot, persisted[index].shot);
    assert.equal(record.source, "manual");
    assert.equal(record.playerId, persisted[index].playerId);
    assert.deepEqual(JSON.parse(JSON.stringify(record.axes)), persisted[index].axes);
  });

  // Re-importing the same CSV is a no-op: event ids de-duplicate.
  buttonWithText(root, "Import CSV").dispatchEvent({ type: "click" });
  input = restored.documentRef.querySelector("[data-bso-import-csv-input]");
  input.files = [{ name: "badminton-vision-shots.csv", text: async () => exportedCsv }];
  input.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  root = restored.overlayRoot();
  assert.match(textOf(root), /Imported 0 labels · skipped 2 duplicates/);
  assert.equal(restored.storageWrites.at(-1).bvState.manualLabelsByVideo["youtube:real-match"].length, 2);

  // A foreign CSV is rejected without touching the store.
  buttonWithText(root, "Import CSV").dispatchEvent({ type: "click" });
  input = restored.documentRef.querySelector("[data-bso-import-csv-input]");
  input.files = [{ name: "points.csv", text: async () => "player,score\nA,1" }];
  input.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  root = restored.overlayRoot();
  assert.match(textOf(root), /Import failed/);
  assert.equal(restored.storageWrites.at(-1).bvState.manualLabelsByVideo["youtube:real-match"].length, 2, "a rejected import leaves the store untouched");
});

function evidenceResult({ mediaTime = 12, keypointOffset = 0, includeRacket = true, includeRacketHands = false, includeRacketDetections = false, includeBox = true, unknown = false } = {}) {
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
    : includeRacketDetections
      ? { state: "tracked", confidence: 0.71, detections: [
        { bbox: { x: 0.31, y: 0.28, width: 0.2, height: 0.3 }, confidence: 0.71, class: "tennis racket", classIndex: 42, state: "tracked" },
        { bbox: { x: 0.6, y: 0.1, width: 0.12, height: 0.18 }, confidence: 0.58, class: "tennis racket", classIndex: 42, state: "tracked" }
      ], detectionMethod: "efficientdet-lite0-tennis-racket", reason: "coco-tennis-racket-detections" }
      : includeRacketHands
        ? { state: "partial", confidence: 0.8, hands: [{ side: "right", wrist: { x: 0.39, y: 0.28 }, elbow: { x: 0.31, y: 0.33 }, confidence: 0.8 }] }
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
  session.onMessage({ type: "START_SEED", requestId: "live-evidence-seed" });
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

test("structural panel updates release pointer capture before replacing the surface", async () => {
  const session = await createSession({ storedState: {
    videoKey: "youtube:real-match",
    enabled: true,
    seeded: false,
    panels: { feed: true, stats: false, map: false, evidence: false, controls: false }
  } });
  session.flushStorage();
  session.onMessage({ type: "SET_PANELS", panels: { feed: true, stats: false, map: false, evidence: false, controls: false }, requestId: "capture-release-panels" });
  const feedPanel = session.overlayRoot().querySelector('[data-bso-panel="feed"]');
  const header = feedPanel.querySelector('[data-bso-panel-drag-handle]');
  header.dispatchEvent({ type: "pointerdown", target: header, pointerId: 41, button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
  assert.equal(header.capturedPointerId, 41);
  session.onMessage({ type: "SET_DENSITY", value: "full", requestId: "capture-release-1" });
  assert.equal(header.releasedPointerId, 41, "retired drag surfaces release capture");
  assert.equal(header.getAttribute("aria-grabbed"), "false");
});

test("resetting court setup releases pointer capture before replacing its card", async () => {
  const session = await createSession();
  session.flushStorage();
  session.onMessage({ type: "START_SEED", requestId: "seed-capture-1" });
  let layer = session.overlayRoot().querySelector("[data-bso-court-seeding]");
  layer.dispatchEvent({ type: "click", target: layer, clientX: 80, clientY: 280 });
  const card = session.overlayRoot().querySelector("[data-bso-seed-card]");
  const header = card.querySelector("[data-bso-panel-drag-handle]");
  header.dispatchEvent({ type: "pointerdown", target: header, pointerId: 43, button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
  assert.equal(header.capturedPointerId, 43);
  buttonWithText(session.overlayRoot(), "Reset court").dispatchEvent({ type: "click", target: buttonWithText(session.overlayRoot(), "Reset court") });
  assert.equal(header.releasedPointerId, 43, "resetting setup releases the retired header capture");
  assert.equal(header.getAttribute("aria-grabbed"), "false");
});

test("playing runtime updates preserve panel surfaces, focus, and scroll state", async () => {
  const session = await createSession({ storedState: {
    videoKey: "youtube:real-match",
    enabled: true,
    seeded: false,
    panels: { feed: true, stats: true, map: false, evidence: true, controls: false }
  } });
  session.flushStorage();
  session.onMessage({ type: "SET_PANELS", panels: { feed: true, stats: true, map: false, evidence: true, controls: false }, requestId: "playing-panels-1" });
  const root = session.overlayRoot();
  const feedPanel = root.querySelector('[data-bso-panel="feed"]');
  const header = feedPanel.querySelector('[data-bso-panel-drag-handle]');
  const feed = feedPanel.querySelector(".bv-feed");
  feed.scrollTop = 37;
  let structuralRenders = 0;
  const replaceChildren = root.replaceChildren.bind(root);
  root.replaceChildren = (...children) => { structuralRenders += 1; return replaceChildren(...children); };
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12 })));
  assert.equal(session.video.paused, false, "the regression exercises the playing path");
  assert.equal(structuralRenders, 0, "a playing result does not trigger a structural overlay render");
  assert.equal(session.overlayRoot(), root, "a runtime result does not replace the overlay root");
  assert.equal(feedPanel.querySelector('[data-bso-panel-drag-handle]'), header, "drag ownership survives a frame result");
  assert.equal(feedPanel.querySelector(".bv-feed"), feed, "the scroll surface survives a frame result");
  assert.equal(feed.scrollTop, 37, "a playing frame cannot reset feed scroll position");
  const pointer = (node, type, clientX, clientY) => node.dispatchEvent({
    type, target: node, pointerId: 42, button: 0, clientX, clientY,
    preventDefault() {}, stopPropagation() {}
  });
  pointer(header, "pointerdown", 10, 10);
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.05, keypointOffset: 0.005 })));
  pointer(header, "pointermove", 110, 70);
  pointer(header, "pointerup", 110, 70);
  assert.ok(session.storageWrites.at(-1).bvState.panelLayoutsByVideo["youtube:real-match"].feed.x > 0, "a drag remains active while a playing result arrives");
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.1, keypointOffset: 0.01 })));
  assert.equal(session.overlayRoot(), root, "subsequent playing results remain non-destructive");
  assert.equal(feedPanel.querySelector('[data-bso-panel-drag-handle]'), header, "panel controls remain attached across results");
  assert.equal(feed.scrollTop, 37, "scroll remains stable across subsequent results");
});

test("runtime results refresh open stats, court map, and full-density signals without replacing chrome", async () => {
  const session = await createLiveEvidenceSession();
  session.onMessage({ type: "SET_DENSITY", value: "full", requestId: "runtime-panels-full" });
  const root = session.overlayRoot();
  const stats = root.querySelector('[data-bso-panel="stats"]');
  const statsHeader = stats.querySelector("[data-bso-panel-drag-handle]");
  const map = root.querySelector('[data-bso-panel="map"]');
  const mapHeader = map.querySelector("[data-bso-panel-drag-handle]");
  const initialMapCircles = map.querySelector(".bv-court").querySelectorAll("circle").length;
  const signal = root.querySelector(".bv-runtime-signal");
  assert.ok(textOf(signal).includes("players 0"));
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.2 })));
  assert.equal(session.overlayRoot(), root);
  assert.equal(stats.querySelector("[data-bso-panel-drag-handle]"), statsHeader, "stats chrome remains attached");
  assert.equal(map.querySelector("[data-bso-panel-drag-handle]"), mapHeader, "court chrome remains attached");
  assert.ok(textOf(stats).includes("tracked"), "stats reflects the tracked runtime result without stroke events");
  assert.ok(map.querySelector(".bv-court").querySelectorAll("circle").length > initialMapCircles, "court map reflects tracked player/shuttle positions without stroke events");
  assert.ok(textOf(root.querySelector(".bv-runtime-signal")).includes("players 1"), "full-density runtime signal reflects the tracked player");
  assert.ok(textOf(root.querySelector(".bv-runtime-signal")).includes("tracked"), "full-density runtime signal reflects the tracked shuttle");
});

test("runtime feed reconciliation removes, updates, reorders, and retains rows", async () => {
  const session = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  session.flushStorage();
  session.onMessage({ type: "SET_PANELS", panels: { feed: true }, requestId: "feed-reconcile-open" });
  const makeResult = (strokeEvents) => Object.assign(evidenceResult(), { strokeEvents });
  const first = [
    { eventId: "a", sequence: 1, shot_family: "Clear", hit_media_time: 12, status: "accepted", classification_confidence: 0.4 },
    { eventId: "b", sequence: 2, shot_family: "Drop", hit_media_time: 13, status: "accepted", classification_confidence: 0.5 },
    { eventId: "d", sequence: 3, shot_family: "Lift", hit_media_time: 14, status: "accepted", classification_confidence: 0.6 }
  ];
  session.publishRuntimeView(resultView(makeResult(first)));
  let feed = session.overlayRoot().querySelector(".bv-feed");
  const retained = feed.querySelector('[data-bso-event-id="d"]');
  const changed = feed.querySelector('[data-bso-event-id="b"]');
  const second = [
    { eventId: "c", sequence: 1, shot_family: "Serve", hit_media_time: 11, status: "accepted", classification_confidence: 0.7 },
    { eventId: "b", sequence: 2, shot_family: "Smash", hit_media_time: 13, status: "corrected", classification_confidence: 0.9 },
    { eventId: "d", sequence: 3, shot_family: "Lift", hit_media_time: 14, status: "accepted", classification_confidence: 0.6 }
  ];
  session.publishRuntimeView(resultView(makeResult(second)));
  feed = session.overlayRoot().querySelector(".bv-feed");
  assert.deepEqual(feed.querySelectorAll("[data-bso-event-id]").map((row) => row.getAttribute("data-bso-event-id")), ["c", "b", "d"]);
  assert.equal(feed.querySelector('[data-bso-event-id="a"]'), null, "removed runtime rows leave the feed");
  assert.notEqual(feed.querySelector('[data-bso-event-id="b"]'), changed, "changed runtime rows are replaced");
  assert.equal(feed.querySelector('[data-bso-event-id="d"]'), retained, "unchanged runtime rows retain their DOM node");
  assert.equal(feed.querySelector('[data-bso-event-id="b"]').querySelector(".bv-confidence").getAttribute("title"), "confidence 90%");
});

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
  assert.equal(drawing.querySelectorAll(".bv-player-box").length, 0, "player boxes are opt-in in the minimal detection layer");
  session.onMessage({ type: "SET_TRACKER", tracker: "players", value: true, requestId: "live-players-on" });
  root = session.overlayRoot();
  drawing = root.querySelector(".bv-runtime-evidence");
  assert.equal(drawing.querySelectorAll(".bv-player-box").length, 1, "player boxes appear after an explicit opt-in");
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

test("live racket detections render as runtime racket boxes, not pose proxy lines", async () => {
  const session = await createLiveEvidenceSession();
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12, includeRacketDetections: true })));
  let drawing = session.overlayRoot().querySelector(".bv-runtime-evidence");
  const boxes = drawing.querySelectorAll(".bv-racket-box");
  assert.equal(boxes.length, 2, "each emitted tennis-racket detection is drawn as a box");
  assert.equal(drawing.querySelectorAll(".bv-racket-signal").length, 0, "no orange wrist/elbow proxy lines for real detector output");
  boxes.forEach((node) => {
    assert.equal(node.getAttribute("data-box-source"), "runtime");
    assert.equal(node.getAttribute("data-racket-state"), "tracked");
  });
  // The racket visibility toggle applies to detection boxes like any other
  // racket evidence layer.
  session.onMessage({ type: "SET_TRACKER", tracker: "racket", value: false, requestId: "racket-detections-off" });
  drawing = session.overlayRoot().querySelector(".bv-runtime-evidence");
  assert.equal(drawing.querySelectorAll(".bv-racket-box").length, 0, "racket boxes respect the evidence visibility toggle");
});


test("live overlay panels keep the native player control strip clear and stay movable", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "strip-full-1" });
  const root = live.overlayRoot();
  const viewportHeight = 360;
  const stripReserve = 72;
  const pointer = (node, type, x, y, id = 31, target = node) => node.dispatchEvent({
    type, target, pointerId: id, button: 0, clientX: x, clientY: y,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }
  });
  const panelRects = root.querySelectorAll("[data-bso-panel-layout]").map((panel) => ({
    panel: panel.getAttribute("data-bso-panel"),
    left: parseFloat(panel.style.left), top: parseFloat(panel.style.top),
    width: parseFloat(panel.style.width), height: parseFloat(panel.style.height)
  }));
  assert.ok(panelRects.length >= 4, "the full live overlay renders its remaining panels");
  for (const rect of panelRects) {
    assert.ok(Number.isFinite(rect.left) && Number.isFinite(rect.top) && Number.isFinite(rect.width) && Number.isFinite(rect.height), `${rect.panel} has a clamped pixel placement`);
    assert.ok(rect.top + rect.height <= viewportHeight - stripReserve + 1e-9, `${rect.panel} never covers the player control strip`);
  }
  // The native strip (pause, time bar, settings) must not sit under any panel.
  for (const point of [{ x: 20, y: viewportHeight - 20 }, { x: 320, y: viewportHeight - 20 }, { x: 620, y: viewportHeight - 20 }]) {
    for (const rect of panelRects) {
      const covers = point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
      assert.equal(covers, false, `${rect.panel} does not intercept strip point ${point.x},${point.y}`);
    }
  }
  // Evidence layers stay click-transparent by declaration.
  const evidence = root.querySelector(".bv-runtime-evidence");
  assert.equal(evidence.getAttribute("pointer-events"), "none");
  assert.equal(evidence.style.pointerEvents, "none");

  // Panels remain draggable: dragging the court map toward the bottom clamps
  // it above the strip instead of letting it cover the player controls.
  const map = root.querySelector('[data-bso-panel="map"]');
  const mapHeader = map.querySelector("[data-bso-panel-drag-handle]");
  pointer(mapHeader, "pointerdown", 10, 10, 32);
  pointer(mapHeader, "pointermove", 10, 1000, 32);
  pointer(mapHeader, "pointerup", 10, 1000, 32);
  assert.ok(Number.parseFloat(map.style.top) + Number.parseFloat(map.style.height) <= viewportHeight - stripReserve + 1e-9, "a downward drag clamps the panel above the strip");
  const storedMap = live.storageWrites.at(-1).bvState.panelLayoutsByVideo["youtube:real-match"].map;
  assert.ok(storedMap, "the map drag still persists its video-local layout");
  // Panels remain resizable: the keyboard affordance still changes the size.
  const mapResize = map.querySelector("[data-bso-panel-resize-handle]");
  const beforeMapWidth = live.storageWrites.at(-1).bvState.panelLayouts.map.width;
  mapResize.dispatchEvent({ type: "keydown", target: mapResize, key: "ArrowRight", preventDefault() {}, stopPropagation() {} });
  assert.ok(live.storageWrites.at(-1).bvState.panelLayouts.map.width >= beforeMapWidth, "resize keyboard affordance still works on the map panel");
});

test("every live panel collapses to its header bar, re-expands, and persists per video", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "collapse-full-1" });
  let root = live.overlayRoot();
  for (const id of ["feed", "stats", "map", "controls"]) {
    const panel = root.querySelector(`[data-bso-panel="${id}"]`);
    assert.ok(panel, `${id} panel renders`);
    const collapse = panel.querySelector("[data-bso-panel-collapse]");
    assert.ok(collapse, `${id} exposes a header collapse affordance`);
    assert.equal(collapse.getAttribute("aria-expanded"), "true");
    assert.equal(panel.getAttribute("data-bso-panel-collapsed"), "false");
    assert.ok(panel.querySelector(".bv-panel-body"), `${id} starts expanded`);
  }

  // Collapse the stroke feed: only the header bar remains and it can reopen.
  root.querySelector('[data-bso-panel="feed"]').querySelector("[data-bso-panel-collapse]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  let collapsedFeed = root.querySelector('[data-bso-panel="feed"]');
  assert.equal(collapsedFeed.getAttribute("data-bso-panel-collapsed"), "true");
  assert.equal(collapsedFeed.querySelector(".bv-panel-body"), null, "a collapsed panel shows only its header bar");
  assert.equal(collapsedFeed.querySelector("[data-bso-panel-resize-handle]"), null, "a collapsed panel has no resize surface");
  assert.ok(collapsedFeed.querySelector("[data-bso-panel-drag-handle]"), "the header stays the move surface while collapsed");
  assert.deepEqual(JSON.parse(JSON.stringify(live.storageWrites.at(-1).bvState.collapsedPanelsByVideo["youtube:real-match"])), { feed: true }, "collapse state is stored per video");

  // A rerender keeps the collapsed presentation.
  live.onMessage({ type: "SET_DENSITY", value: "balanced", requestId: "collapse-rerender-1" });
  root = live.overlayRoot();
  collapsedFeed = root.querySelector('[data-bso-panel="feed"]');
  assert.equal(collapsedFeed.getAttribute("data-bso-panel-collapsed"), "true", "collapse survives a panel rerender");

  // Evidence visibility is not live overlay furniture. It remains available
  // through the popup disclosure while the feed can independently expand.
  assert.equal(root.querySelector('[data-bso-panel="evidence"]'), null);
  root.querySelector('[data-bso-panel="feed"]').querySelector("[data-bso-panel-collapse]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  const expandedFeed = root.querySelector('[data-bso-panel="feed"]');
  assert.equal(expandedFeed.getAttribute("data-bso-panel-collapsed"), "false");
  assert.ok(expandedFeed.querySelector(".bv-panel-body"), "re-expanding restores the panel body");
  assert.ok(expandedFeed.querySelector("[data-bso-panel-resize-handle]"), "re-expanding restores the resize surface");

  // The manual labeling panel is collapsible too.
  live.onMessage({ type: "OPEN_LABELING", requestId: "collapse-manual-1" });
  root = live.overlayRoot();
  const manual = root.querySelector('[data-bso-panel="manual"]');
  assert.ok(manual.querySelector("[data-bso-panel-collapse]"), "manual labeling collapses from its header");
  manual.querySelector("[data-bso-panel-collapse]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  const collapsedManual = root.querySelector('[data-bso-panel="manual"]');
  assert.equal(collapsedManual.getAttribute("data-bso-panel-collapsed"), "true");
  assert.equal(collapsedManual.querySelector(".bv-panel-body"), null);
  collapsedManual.querySelector("[data-bso-panel-collapse]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.ok(root.querySelector('[data-bso-panel="manual"]').querySelector(".bv-panel-body"), "manual labeling re-expands");

  // A reload restores the per-video collapse state.
  const persisted = JSON.parse(JSON.stringify(live.storageWrites.at(-1).bvState));
  const reloaded = await createSession({ storedState: persisted });
  reloaded.flushStorage();
  root = reloaded.overlayRoot();
  assert.equal(root.querySelector('[data-bso-panel="evidence"]'), null, "the retired evidence panel never comes back after reload");
  assert.equal(root.querySelector('[data-bso-panel="feed"]').getAttribute("data-bso-panel-collapsed"), "false", "expanded panels stay expanded after reload");
});

test("evidence visibility remains a single popup control surface while content stays panel-free", async () => {
  const live = await createLiveEvidenceSession();
  live.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12 })));
  let root = live.overlayRoot();
  assert.equal(root.querySelector('[data-bso-panel="evidence"]'), null, "the evidence visibility panel is not mounted");
  assert.equal(root.querySelector('[data-bso-overlay-shortcut="evidence"]'), null, "the old overlay shortcut is retired");

  const has = (selector) => Boolean(live.overlayRoot().querySelector(".bv-runtime-evidence").querySelector(selector));
  const setTracker = (tracker, value, requestId) => live.onMessage({ type: "SET_TRACKER", tracker, value, requestId });
  setTracker("body", false, "evidence-body-off");
  assert.equal(has(".bv-pose-keypoint"), false);
  live.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.1, keypointOffset: 0.01 })));
  assert.equal(has(".bv-pose-keypoint"), false, "pose visibility survives a result rerender");

  setTracker("players", true, "evidence-players-on");
  assert.equal(has(".bv-player-box"), true, "player boxes still respond to the retained visibility setting");
  setTracker("shuttle", false, "evidence-shuttle-off");
  assert.equal(has(".bv-shuttle-trajectory"), false);
  assert.equal(has(".bv-shuttle-point"), false);
  setTracker("racket", false, "evidence-racket-off");
  assert.equal(has(".bv-racket-signal"), false);

  live.onMessage({ type: "SET_COURT_LINES", videoKey: "youtube:real-match", value: false, requestId: "evidence-court-off" });
  assert.equal(live.overlayRoot().querySelector(".bv-calibration-court"), null, "court projection keeps its one retained visibility setting");
  root = live.overlayRoot();
  assert.equal(root.querySelector('[data-bso-evidence-control="players"]'), null, "evidence controls do not leak into the content overlay");
  assert.equal(live.storageWrites.at(-1).bvState.trackerSettingsByVideo["youtube:real-match"].body, false);
});

test("the calibrated court projection renders in the bright highlight and has exactly one per-video toggle", async () => {
  // The seed layer draws its corner polyline and preview lines in the bright
  // setup highlight while the user is clicking the four corners.
  const seeding = await createSession();
  seeding.flushStorage();
  seeding.onMessage({ type: "START_SEED", requestId: "lines-seed-1" });
  let layer = seeding.overlayRoot().querySelector("[data-bso-court-seeding]");
  layer.dispatchEvent({ type: "click", target: layer, clientX: 64, clientY: 324, defaultPrevented: false });
  layer.dispatchEvent({ type: "click", target: layer, clientX: 576, clientY: 324, defaultPrevented: false });
  layer = seeding.overlayRoot().querySelector("[data-bso-court-seeding]");
  const polyline = layer.querySelector(".bv-seed-drawing").querySelector("polyline");
  assert.ok(polyline, "the corner polyline renders during setup");
  assert.equal(polyline.getAttribute("stroke"), "var(--court-setup-line)", "the setup polyline uses the bright highlight");

  const session = await createLiveEvidenceSession();
  let root = session.overlayRoot();
  let court = root.querySelector(".bv-calibration-court");
  assert.ok(court, "the fitted court projection draws after setup");
  const drawnLines = court.querySelectorAll("[data-court-line-role]");
  assert.ok(drawnLines.length > 0, "the projection includes the official court lines");
  for (const line of drawnLines) {
    const stroke = line.getAttribute("stroke");
    assert.match(stroke, /^var\(--court-setup-(?:line|net)\)$/, "drawn court lines use the bright setup highlight");
  }

  // The one clearly labeled projection toggle lives in the popup disclosure,
  // while its message changes the content renderer without mounting a panel.
  const popup = await createPopupSession();
  let popupRoot = popup.app;
  assert.equal(popupRoot.querySelector("[data-bso-evidence-disclosure]").getAttribute("hidden") !== null, true);
  popupRoot.querySelector("[data-bso-evidence-disclosure-toggle]").dispatchEvent({ type: "click" });
  const projectionToggle = popup.app.querySelector("[data-bso-court-projection-toggle]").querySelector("button");
  assert.equal(projectionToggle.getAttribute("aria-checked"), "true");
  assert.ok(textOf(popup.app.querySelector("[data-bso-court-projection-toggle]")).includes("Court projection"));
  assert.equal(textOf(popup.app).includes("Court setup lines"), false, "the retired second toggle is gone");
  projectionToggle.dispatchEvent({ type: "click" });
  assert.equal(popup.sent.at(-1).message.type, "SET_COURT_LINES");

  session.onMessage({ type: "SET_COURT_LINES", videoKey: "youtube:real-match", value: false, requestId: "lines-content-off" });
  assert.equal(session.overlayRoot().querySelector(".bv-calibration-court"), null, "hiding the projection removes the court polygon");
  assert.equal(session.storageWrites.at(-1).bvState.courtLinesByVideo["youtube:real-match"], false, "the hide is stored per video");
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.1 })));
  assert.equal(session.overlayRoot().querySelector(".bv-calibration-court"), null, "hidden projection stays hidden after a result rerender");

  // Reload restores the per-video hide.
  const lastState = session.storageWrites.slice().reverse().find((write) => write.bvState).bvState;
  const persisted = JSON.parse(JSON.stringify(lastState));
  const reloaded = await createSession({ storedState: persisted });
  reloaded.flushStorage();
  assert.equal(reloaded.overlayRoot().querySelector(".bv-calibration-court"), null, "the projection hide survives reload");
  reloaded.onMessage({ type: "SET_COURT_LINES", videoKey: "youtube:real-match", value: true, requestId: "lines-reenable" });
  assert.ok(reloaded.overlayRoot().querySelector(".bv-calibration-court"), "re-enabling restores the projection");
  assert.equal(reloaded.storageWrites.at(-1).bvState.courtLinesByVideo["youtube:real-match"], undefined, "showing again clears the stored hide");
});

test("native player control points stay reachable while panels stay interactive", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "strip-points-full-1" });
  live.onMessage({ type: "OPEN_LABELING", requestId: "strip-points-manual-1" });
  const root = live.overlayRoot();
  const rects = root.querySelectorAll("[data-bso-panel-layout]").map((panel) => ({
    panel: panel.getAttribute("data-bso-panel"),
    left: parseFloat(panel.style.left), top: parseFloat(panel.style.top),
    width: parseFloat(panel.style.width), height: parseFloat(panel.style.height)
  }));
  assert.ok(rects.length >= 5, "full density plus the manual panel renders all remaining panel surfaces");
  // The native strip (pause, seek bar, volume, settings) must never sit under
  // any panel surface, including the tall manual panel on a small player.
  const viewportHeight = 360;
  const stripPoints = [
    { name: "play/pause", x: 30, y: viewportHeight - 24 },
    { name: "volume", x: 60, y: viewportHeight - 24 },
    { name: "seek start", x: 120, y: viewportHeight - 6 },
    { name: "seek middle", x: 320, y: viewportHeight - 6 },
    { name: "seek end", x: 600, y: viewportHeight - 6 },
    { name: "settings", x: 610, y: viewportHeight - 24 }
  ];
  for (const point of stripPoints) {
    for (const rect of rects) {
      const covers = point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
      assert.equal(covers, false, `${rect.panel} does not intercept ${point.name} at ${point.x},${point.y}`);
    }
  }
  const pointer = (node, type, x, y, id = 41, target = node) => node.dispatchEvent({
    type, target, pointerId: id, button: 0, clientX: x, clientY: y,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }
  });
  // Panels remain fully interactive: drag the feed header, resize the map, and
  // collapse the stats panel all still work with the overlay active.
  const feed = root.querySelector('[data-bso-panel="feed"]');
  const feedHeader = feed.querySelector("[data-bso-panel-drag-handle]");
  pointer(feedHeader, "pointerdown", 10, 10, 42);
  pointer(feedHeader, "pointermove", 90, 40, 42);
  pointer(feedHeader, "pointerup", 90, 40, 42);
  assert.ok(live.storageWrites.at(-1).bvState.panelLayoutsByVideo["youtube:real-match"].feed, "the feed header drag persists");
  const map = root.querySelector('[data-bso-panel="map"]');
  const mapResize = map.querySelector("[data-bso-panel-resize-handle]");
  mapResize.dispatchEvent({ type: "keydown", target: mapResize, key: "ArrowRight", preventDefault() {}, stopPropagation() {} });
  assert.ok(live.storageWrites.at(-1).bvState.panelLayouts.map.width > 0, "map resize keyboard affordance still works");
  const stats = root.querySelector('[data-bso-panel="stats"]');
  stats.querySelector("[data-bso-panel-collapse]").dispatchEvent({ type: "click" });
  assert.equal(live.overlayRoot().querySelector('[data-bso-panel="stats"]').getAttribute("data-bso-panel-collapsed"), "true", "collapse still works");
});

test("court setup keeps the player strip reachable and guides near corners above it", async () => {
  // The fake-DOM video (and host) is 640x360, so the near-corner guides would
  // land inside the 72px player strip; they must clamp above it.
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "seed-guide-1" });
  const root = live.overlayRoot();
  const layer = root.querySelector("[data-bso-court-seeding]");
  assert.ok(layer, "the setup surface renders");
  const guide = layer.querySelector("[data-bso-seed-guide]");
  assert.ok(guide, "the current-corner guide marker renders");
  const stripTop = 360 - 72;
  const guideTop = Number.parseFloat(guide.style.top);
  assert.ok(guideTop > 0 && guideTop < 100, "the guide stays inside the video");
  assert.ok(guideTop / 100 * 360 + 13 <= stripTop, `the near-corner guide (${guideTop}%) stays above the player strip`);
  assert.ok(guideTop < 82, "the guide is clamped above the nominal 82% near-corner position on small players");
  // The seed card is a normal reserved panel: its default placement is bounded
  // and a drag toward the bottom clamps above the strip.
  const card = layer.querySelector("[data-bso-seed-card]");
  assert.ok(Number.parseFloat(card.style.top) + Number.parseFloat(card.style.height) <= stripTop + 1e-9, "the setup card stays above the strip");
  const header = card.querySelector("[data-bso-panel-drag-handle]");
  const pointer = (node, type, x, y, id = 51) => node.dispatchEvent({
    type, target: node, pointerId: id, button: 0, clientX: x, clientY: y,
    preventDefault() {}, stopPropagation() {}
  });
  pointer(header, "pointerdown", 20, 20, 52);
  pointer(header, "pointermove", 20, 500, 52);
  pointer(header, "pointerup", 20, 500, 52);
  assert.ok(Number.parseFloat(card.style.top) + Number.parseFloat(card.style.height) <= stripTop + 1e-9, "dragging the setup card cannot cover the player strip");
});

test("court seeding offers tappable floating corner labels and 1-4 keyboard placement on small players", async () => {
  // The 640x360 host puts the 72px strip reserve at y=288, so the nominal
  // 82% near-corner row is inside the native controls. The floating pill and
  // the number keys place each corner at its clamped marked spot instead,
  // while direct layer clicks stay available for precise placement.
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "corner-pill-1" });
  const root = () => live.overlayRoot();
  const host = live.host();
  const pill = () => root().querySelector("[data-bso-seed-corner-button]");
  let layer = root().querySelector("[data-bso-court-seeding]");
  assert.equal(layer.getAttribute("data-bso-seed-click-policy"), "layer-only");
  assert.equal(pill().getAttribute("data-bso-seed-corner-button"), "0");
  assert.equal(pill().getAttribute("data-bso-seed-corner"), "near-left");
  assert.equal(pill().getAttribute("aria-label"), "Place the near left outer corner at the marked spot");
  assert.equal(pill().getAttribute("aria-keyshortcuts"), "1");
  assert.equal(textOf(pill()).trim(), "Near left outer corner");
  assert.ok(Math.abs(Number.parseFloat(pill().style.top) - 239) < 0.01, "the near-corner pill floats above the strip");
  assert.ok(Math.abs(Number.parseFloat(pill().style.left) - 140.8) < 0.01, "the pill is pinned to the corner column");
  const card = layer.querySelector("[data-bso-seed-card]");
  const tip = card.querySelector("[data-bso-seed-shortcuts]");
  assert.ok(tip, "the seed card explains the corner number keys");
  assert.equal(tip.querySelectorAll("kbd").length, 4);
  assert.match(textOf(tip), /near left/);
  assert.match(textOf(tip), /marked spot/);
  // Number keys yield to focused card controls and only the current corner's
  // key places a point.
  const undo = buttonWithText(card, "Undo");
  assert.equal(live.emitKey("1", { target: undo }), false, "focused card controls keep native keys");
  assert.equal(host.getAttribute("data-bso-seed-count"), "0");
  assert.equal(live.emitKey("2"), false, "an out-of-order corner key is inert");
  assert.equal(host.getAttribute("data-bso-seed-count"), "0");
  assert.equal(live.emitKey("1"), true, "the current corner's number key places it");
  assert.equal(host.getAttribute("data-bso-seed-count"), "1");
  const placed = live.storageWrites.at(-1).bvState.seedDraftPoints[0];
  assert.ok(Math.abs(placed.x - 0.22) < 1e-9);
  assert.ok(Math.abs(placed.y - (1 - (72 + 24) / 360)) < 1e-9, "the near corner lands at the clamped marked spot");
  // The floating button advances to the next corner and flips to the
  // right-anchored geometry; tapping it seeds like the number key.
  let nextPill = pill();
  assert.equal(nextPill.getAttribute("data-bso-seed-corner"), "near-right");
  assert.ok(Math.abs(Number.parseFloat(nextPill.style.right) - 140.8) < 0.01);
  nextPill.dispatchEvent({ type: "click", target: nextPill });
  assert.equal(host.getAttribute("data-bso-seed-count"), "2");
  // Far corners keep their nominal marked spot (already above the strip) and
  // complete the flow through the 3/4 keys from the accessibility report.
  const farRight = pill();
  assert.equal(farRight.getAttribute("data-bso-seed-corner"), "far-right");
  assert.ok(Math.abs(Number.parseFloat(farRight.style.right) - 236.8) < 0.01);
  assert.ok(Math.abs(Number.parseFloat(farRight.style.top) - 93.8) < 0.01);
  assert.equal(live.emitKey("3"), true);
  assert.equal(host.getAttribute("data-bso-seed-count"), "3");
  const farLeft = pill();
  assert.equal(farLeft.getAttribute("data-bso-seed-corner"), "far-left");
  assert.ok(Math.abs(Number.parseFloat(farLeft.style.left) - 236.8) < 0.01);
  assert.equal(live.emitKey("4"), true);
  assert.equal(host.getAttribute("data-bso-seed-count"), "4");
  layer = root().querySelector("[data-bso-court-seeding]");
  assert.equal(layer.getAttribute("data-bso-seed-lockable"), "true", "marked-spot placement fits the court");
  assert.equal(pill(), null, "the floating button retires once every corner is placed");
  assert.equal(layer.querySelector("[data-bso-seed-guide]"), null);
  assert.equal(layer.querySelector("[data-bso-seed-shortcuts]"), null, "the shortcut tip retires with the last step");
  // Undo restores the floating affordance for the corner that was removed.
  buttonWithText(root(), "Undo").dispatchEvent({ type: "click", target: buttonWithText(root(), "Undo") });
  assert.equal(pill().getAttribute("data-bso-seed-corner"), "far-left", "undo brings the corner pill back");
  // Direct layer clicks remain untouched by the floating pill.
  layer = root().querySelector("[data-bso-court-seeding]");
  layer.dispatchEvent({ type: "click", target: layer, clientX: 120, clientY: 60 });
  layer = root().querySelector("[data-bso-court-seeding]");
  assert.equal(host.getAttribute("data-bso-seed-count"), "4");
  assert.equal(layer.querySelector("[data-bso-seed-guide]"), null);
});

test("the corner pill's advertised digit fires while the pill itself is focused", async () => {
  // Tab focus lands on the floating corner pill (the first focusable node in
  // the seed layer), and the pill's aria-keyshortcuts and title promise its
  // own digit, so that key must place the corner even though the pill is a
  // focused button. Out-of-order digits and every other focused control stay
  // inert, keeping the yield contract intact.
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "pill-key-1" });
  const root = () => live.overlayRoot();
  const host = live.host();
  const pill = () => root().querySelector("[data-bso-seed-corner-button]");
  assert.equal(pill().getAttribute("aria-keyshortcuts"), "1");
  assert.equal(live.emitKey("2", { target: pill() }), false, "an out-of-order digit is inert while the pill is focused");
  assert.equal(host.getAttribute("data-bso-seed-count"), "0");
  assert.equal(live.emitKey("1", { target: pill() }), true, "the pill's advertised digit fires while the pill is focused");
  assert.equal(host.getAttribute("data-bso-seed-count"), "1");
  const placed = live.storageWrites.at(-1).bvState.seedDraftPoints[0];
  assert.ok(Math.abs(placed.x - 0.22) < 1e-9);
  assert.ok(Math.abs(placed.y - (1 - (72 + 24) / 360)) < 1e-9, "the focused-pill digit seeds the clamped marked spot");
  // The advanced pill advertises and fires its own next digit the same way.
  assert.equal(pill().getAttribute("data-bso-seed-corner-button"), "1");
  assert.equal(live.emitKey("2", { target: pill() }), true, "the next pill's advertised digit fires while it is focused");
  assert.equal(host.getAttribute("data-bso-seed-count"), "2");
  // Digits still yield to a focused card control: the step-2 pill's own digit
  // stays inert while the card's Undo button has focus.
  const undo = buttonWithText(root().querySelector("[data-bso-seed-card]"), "Undo");
  assert.equal(live.emitKey("3", { target: undo }), false, "digits still yield to a focused card control");
  assert.equal(host.getAttribute("data-bso-seed-count"), "2");
});

test("the floating corner pill paints above the seed card on small players", async () => {
  // At the default layout on the 640x360 player the setup card is clamped
  // against the control-strip reserve, so its opaque box covers the pill's
  // marked-spot band; the pill needs the higher stacking level (a declared
  // z-index contract, pinned in seed-card.test.mjs) to stay visible there.
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "pill-above-card-1" });
  const root = live.overlayRoot();
  const layer = root.querySelector("[data-bso-court-seeding]");
  const pill = layer.querySelector("[data-bso-seed-corner-button]");
  const card = layer.querySelector("[data-bso-seed-card]");
  assert.ok(pill && card, "setup renders the floating pill and the instruction card");
  const pillLeft = Number.parseFloat(pill.style.left);
  const pillTop = Number.parseFloat(pill.style.top);
  const cardLeft = Number.parseFloat(card.style.left);
  const cardTop = Number.parseFloat(card.style.top);
  const cardRight = cardLeft + Number.parseFloat(card.style.width);
  const cardBottom = cardTop + Number.parseFloat(card.style.height);
  // translateY(-100%) lifts the 40px pill body above its top anchor, so its
  // visual box is [pillTop - 40, pillTop]; that whole band lies inside the
  // rendered card box at the default placement.
  assert.ok(pillTop - 40 >= cardTop - 1e-9, "the pill's visual band starts inside the card");
  assert.ok(pillTop <= cardBottom + 1e-9, "the pill's visual band ends inside the card");
  assert.ok(pillLeft >= cardLeft - 1e-9 && pillLeft <= cardRight + 1e-9, "the pill's corner column crosses the card");
  // The pill is overlapped by the card but still receives the click that
  // seeds the corner at its marked spot.
  pill.dispatchEvent({ type: "click", target: pill });
  assert.equal(live.host().getAttribute("data-bso-seed-count"), "1");
  const placed = live.storageWrites.at(-1).bvState.seedDraftPoints[0];
  assert.ok(Math.abs(placed.y - (1 - (72 + 24) / 360)) < 1e-9, "the click seeds the corner at the clamped marked spot");
});

test("seed markers re-anchor on mid-seeding geometry changes", async () => {
  // The pill is pixel-anchored and the guide ring percentage-anchored at
  // render time, so a mid-seeding resize or fullscreen toggle must re-derive
  // both in place from the new host box: they never disagree with the marked
  // spot and never disappear below the player strip in the shrink direction.
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "seed-resize-1" });
  const root = live.overlayRoot();
  const host = live.host();
  const layer = root.querySelector("[data-bso-court-seeding]");
  const guide = layer.querySelector("[data-bso-seed-guide]");
  const pill = layer.querySelector("[data-bso-seed-corner-button]");
  assert.ok(guide && pill, "setup renders the guide ring and the floating pill");
  assert.equal(host.getAttribute("data-bso-seed-count"), "0");
  const spotY = (height) => 1 - (72 + 24) / height;
  assert.ok(Math.abs(Number.parseFloat(guide.style.left) - 22) < 1e-9, "the ring keeps the near-left corner column");
  assert.ok(Math.abs(Number.parseFloat(guide.style.top) - spotY(360) * 100) < 1e-9, "the ring clamps above the 640x360 strip");
  assert.ok(Math.abs(Number.parseFloat(pill.style.top) - (spotY(360) * 360 - 25)) < 0.01, "the pill floats above the 640x360 strip");
  assert.ok(Math.abs(Number.parseFloat(pill.style.left) - 140.8) < 0.01, "the pill pins to the corner column");
  // Grow to a fullscreen-size player: the same nodes re-anchor to the new
  // box. At 1080p the nominal 82% near-corner row is already above the strip,
  // so the marked spot is unclamped and the pill follows it upward.
  live.video.rect = { left: 0, top: 0, width: 1920, height: 1080 };
  host.rect = live.video.rect;
  live.emitWindow("resize");
  assert.equal(root.querySelector("[data-bso-court-seeding]"), layer, "a geometry change does not rebuild the seed layer");
  assert.equal(layer.querySelector("[data-bso-seed-guide]"), guide, "the guide ring node is refreshed in place");
  assert.equal(layer.querySelector("[data-bso-seed-corner-button]"), pill, "the floating pill node is refreshed in place");
  assert.equal(host.getAttribute("data-bso-seed-count"), "0", "a geometry change does not place a corner");
  assert.ok(Math.abs(Number.parseFloat(guide.style.left) - 22) < 1e-9, "the ring keeps its corner column fullscreen");
  assert.ok(Math.abs(Number.parseFloat(guide.style.top) - 82) < 1e-9, "the ring re-anchors to the fullscreen box");
  assert.ok(Math.abs(Number.parseFloat(pill.style.top) - (0.82 * 1080 - 25)) < 0.01, "the pill re-anchors to the unclamped marked spot");
  assert.ok(Math.abs(Number.parseFloat(pill.style.left) - 422.4) < 0.01, "the pill keeps its pinned column fullscreen");
  assert.ok(Number.parseFloat(pill.style.top) <= 1080 - 72, "the pill stays clear of the fullscreen strip");
  // The refreshed pill places the corner at the freshly recomputed fullscreen
  // marked spot, not at the stale small-player position it used to show.
  pill.dispatchEvent({ type: "click", target: pill });
  assert.equal(host.getAttribute("data-bso-seed-count"), "1");
  const placedFullscreen = live.storageWrites.at(-1).bvState.seedDraftPoints[0];
  assert.ok(Math.abs(placedFullscreen.x - 0.22) < 1e-9);
  assert.ok(Math.abs(placedFullscreen.y - 0.82) < 1e-9, "the pill click seeds the freshly recomputed marked spot");
  const nextGuide = root.querySelector("[data-bso-seed-guide]");
  const nextPill = root.querySelector("[data-bso-seed-corner-button]");
  assert.equal(nextPill.getAttribute("data-bso-seed-corner"), "near-right", "the flow advances to the next corner");
  // Shrink back to the small player: the markers re-anchor inside the
  // strip-free area instead of staying clipped below it or off-host.
  live.video.rect = { left: 0, top: 0, width: 640, height: 360 };
  host.rect = live.video.rect;
  live.emitWindow("resize");
  assert.equal(root.querySelector("[data-bso-court-seeding]")
    .querySelector("[data-bso-seed-guide]"), nextGuide, "the shrink refreshes the ring in place");
  assert.equal(root.querySelector("[data-bso-court-seeding]")
    .querySelector("[data-bso-seed-corner-button]"), nextPill, "the shrink refreshes the pill in place");
  assert.ok(Math.abs(Number.parseFloat(nextGuide.style.left) - 78) < 1e-9);
  assert.ok(Math.abs(Number.parseFloat(nextGuide.style.top) - spotY(360) * 100) < 1e-9, "the ring re-clamps on the shrink back");
  assert.ok(Math.abs(Number.parseFloat(nextPill.style.top) - 239) < 0.01, "the pill re-anchors on the shrink back");
  assert.ok(Math.abs(Number.parseFloat(nextPill.style.right) - 140.8) < 0.01, "the right corner pill re-pins its column");
  const pillTop = Number.parseFloat(nextPill.style.top);
  assert.ok(pillTop - 40 >= 0 && pillTop <= 360 - 72, "the pill visual band stays inside the strip-free area");
  nextPill.dispatchEvent({ type: "click", target: nextPill });
  assert.equal(host.getAttribute("data-bso-seed-count"), "2");
  const placedSmall = live.storageWrites.at(-1).bvState.seedDraftPoints[1];
  assert.ok(Math.abs(placedSmall.x - 0.78) < 1e-9);
  assert.ok(Math.abs(placedSmall.y - spotY(360)) < 1e-9, "the shrunk pill seeds the re-clamped marked spot");
});

test("collapse and close are visually distinct header affordances on every panel", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "afford-full-1" });
  const root = live.overlayRoot();
  for (const id of ["feed", "stats", "map", "controls"]) {
    const panel = root.querySelector(`[data-bso-panel="${id}"]`);
    const collapse = panel.querySelector("[data-bso-panel-collapse]");
    const close = panel.querySelectorAll("button").find((button) => String(button.getAttribute("aria-label") || "").indexOf("Hide ") === 0);
    assert.ok(collapse, `${id} exposes a collapse affordance`);
    // The live controls panel only collapses; every hideable panel also has a
    // distinct close action that is never the collapse toggle.
    if (id === "controls") {
      assert.equal(close, undefined, "the controls panel has no separate close action");
      continue;
    }
    assert.ok(close, `${id} exposes a close affordance`);
    assert.match(collapse.getAttribute("aria-label"), /^(Collapse|Expand) /, `${id} collapse label is explicit`);
    assert.notEqual(collapse.getAttribute("aria-label"), close.getAttribute("aria-label"), `${id} collapse and close labels differ`);
    assert.equal(collapse.getAttribute("aria-expanded"), "true");
    assert.notEqual(collapse.getAttribute("data-bso-panel-collapse"), null);
    assert.equal(close.getAttribute("data-bso-panel-collapse"), null, "the close button is not the collapse toggle");
  }
  live.onMessage({ type: "OPEN_LABELING", requestId: "afford-manual-1" });
  const manual = live.overlayRoot().querySelector('[data-bso-panel="manual"]');
  assert.ok(manual.querySelector("[data-bso-panel-collapse]"), "manual labeling collapses from its header");
  assert.ok(manual.querySelector('[aria-label="Close manual labeling"]'), "manual labeling closes with an explicit close action");
});

test("the stroke feed renders every manual and runtime stroke in a scrollable list", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_PANELS", panels: { feed: true }, requestId: "feed-all-panel" });
  live.onMessage({ type: "OPEN_LABELING", requestId: "feed-all-open" });
  let root = live.overlayRoot();
  function setTime(seconds) { live.video.currentTime = seconds; live.video.dispatchEvent({ type: "timeupdate", target: live.video }); }
  const shots = ["Serve", "Clear", "Drop", "Smash", "Lift", "Net Shot", "Drive", "Push", "Block", "Half Smash", "Net Kill", "Serve"];
  shots.forEach((shot, index) => {
    setTime(20 + index);
    buttonWithText(root, "Start").dispatchEvent({ type: "click" });
    setTime(20.5 + index);
    buttonWithText(root, "End").dispatchEvent({ type: "click" });
    root = live.overlayRoot();
    root.querySelector(`[data-bso-shot="${shot}"]`).dispatchEvent({ type: "click" });
    root = live.overlayRoot();
    root.querySelector("[data-bso-label-save]").dispatchEvent({ type: "click" });
    root = live.overlayRoot();
  });
  const feed = root.querySelector('[data-bso-panel="feed"]');
  const feedRows = feed.querySelectorAll('[data-bso-label-source="manual"]');
  assert.equal(feedRows.length, 12, "all twelve saved labels appear in the live feed (no silent 7-shot cap)");
  assert.equal(feed.querySelector(".bv-feed").children.length, 12, "the feed list container holds every row");
  const savedList = root.querySelector(".bv-manual-saved").querySelector(".bv-feed");
  assert.equal(savedList.querySelectorAll('[data-bso-label-source="manual"]').length, 12, "the manual panel lists every saved label in its scrollable feed");
  assert.equal(live.storageWrites.at(-1).bvState.manualLabelsByVideo["youtube:real-match"].length, 12);
});

test("popup shows the real tab video identity and keeps the fixture as a labeled fallback", async () => {
  const realTitle = "2026 All England — Men's Singles Final";
  const popup = await createPopupSession({
    tabTitle: realTitle + " - YouTube",
    videoInfo: { url: "https://www.youtube.com/watch?v=real-match", title: realTitle, channel: "Court Side Archive", duration: "1:12:40" }
  });
  assert.ok(textOf(popup.app).includes(realTitle), "the detected block shows the real tab title");
  assert.ok(textOf(popup.app).includes("Court Side Archive · 1:12:40"), "the detected block shows the real channel and duration");
  assert.equal(textOf(popup.app).includes("fixture preview"), false, "a real tab never shows the fixture fallback");
  assert.equal(textOf(popup.app).includes("Men's Singles Final — full match"), false, "the fixture title is not shown for a real tab");

  // Without a watch page the fixture block is clearly labeled as a preview.
  const other = await createPopupSession({ tabUrl: "https://example.com/", tabTitle: "Example", videoInfo: null });
  assert.ok(textOf(other.app).includes("fixture preview"), "the fallback fixture is labeled");
  assert.ok(textOf(other.app).includes("Court Side Archive"), "the fixture channel identifies the preview source");
  assert.equal(textOf(other.app).includes("Detecting video"), false);
});

test("S and E keyboard shortcuts and the Start/End controls both capture the live video clock", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "OPEN_LABELING", requestId: "keyboard-shortcut-test" });
  let root = live.overlayRoot();
  assert.ok(root.querySelector(".bv-label-panel"), "manual labeling panel is open");

  // Playback advances the media clock between timeupdate callbacks, so the
  // cached mediaTime (seeded at 12s on attach) is stale at capture time.
  live.video.currentTime = 47;
  assert.equal(live.emitKey("s"), true, "the S shortcut is handled by the registered keydown listener");
  root = live.overlayRoot();
  assert.ok(root.querySelector("[data-bso-label-window]").textContent.includes("00:47.000"), `S captures the live clock: ${root.querySelector("[data-bso-label-window]").textContent}`);

  live.video.currentTime = 63.5;
  assert.equal(live.emitKey("e"), true, "the E shortcut is handled by the registered keydown listener");
  root = live.overlayRoot();
  assert.ok(root.querySelector("[data-bso-label-window]").textContent.includes("01:03.500"), `E captures the live clock: ${root.querySelector("[data-bso-label-window]").textContent}`);

  live.emitKey("4");
  live.emitKey("Enter");
  const saved = live.storageWrites.at(-1).bvState.manualLabelsByVideo["youtube:real-match"].at(-1);
  assert.equal(saved.shot, "Smash");
  assert.equal(saved.startSec, 47);
  assert.equal(saved.endSec, 63.5);

  // The equivalent Start/End controls share the same boundary.
  live.onMessage({ type: "OPEN_LABELING", requestId: "start-end-control-test" });
  root = live.overlayRoot();
  live.video.currentTime = 81;
  buttonWithText(root, "Start").dispatchEvent({ type: "click" });
  live.video.currentTime = 95.25;
  root = live.overlayRoot();
  buttonWithText(root, "End").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  const controlWindow = root.querySelector("[data-bso-label-window]").textContent;
  assert.ok(controlWindow.includes("01:21.000"), `Start captures the live clock: ${controlWindow}`);
  assert.ok(controlWindow.includes("01:35.250"), `End captures the live clock: ${controlWindow}`);
});

test("the settings panel mounts without inference and renders version, note, and links", async () => {
  const session = await createSession();
  session.flushStorage();
  assert.equal(session.overlayRoot().querySelector('[data-bso-panel="settings"]'), null, "settings starts closed");
  session.onMessage({ type: "SET_PANELS", panels: { settings: true }, requestId: "settings-open-1" });
  const root = session.overlayRoot();
  const panel = root.querySelector('[data-bso-panel="settings"]');
  assert.ok(panel, "the settings panel mounts while inference is off (About content needs no runtime)");
  assert.equal(session.runtimeStarts, 0, "opening settings never starts the analyzer runtime");
  assert.equal(root.querySelector('[data-bso-panel="feed"]'), null, "no other panel mounts with it");
  assert.ok(panel.querySelector(".bv-settings-about"), "the About block renders");
  assert.ok(panel.querySelector(".bv-settings-row"), "the version row renders");
  const version = panel.querySelector("[data-bso-extension-version]");
  assert.equal(version.getAttribute("data-bso-extension-version"), "0.1.0", "the version comes from the extension manifest");
  assert.equal(textOf(version), "0.1.0");
  assert.match(textOf(panel), /Local-first analysis\./);
  const link = panel.querySelector(".bv-settings-links").querySelectorAll("a")[0];
  assert.ok(link, "the About link list renders");
  assert.equal(link.getAttribute("href"), "https://github.com/Jin-HoMLee/badminton-vision");
  assert.equal(link.getAttribute("rel"), "noreferrer");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(textOf(link), /Project source & licenses/);

  // The panel is standard movable furniture with collapse and close affordances.
  assert.ok(panel.querySelector("[data-bso-panel-drag-handle]"), "settings has a header drag surface");
  assert.ok(panel.querySelector("[data-bso-panel-resize-handle]"), "settings has a resize affordance");
  const collapse = panel.querySelector("[data-bso-panel-collapse]");
  assert.ok(collapse, "settings collapses from its header");
  assert.equal(collapse.getAttribute("aria-expanded"), "true");
  assert.equal(panel.getAttribute("data-bso-panel-collapsed"), "false");

  // Close (x) is the distinct hide action and persists per video.
  const close = panel.querySelector('[aria-label="Hide settings"]');
  assert.ok(close, "settings has an explicit close action");
  close.dispatchEvent({ type: "click" });
  assert.equal(session.overlayRoot().querySelector('[data-bso-panel="settings"]'), null, "closing removes the panel");
  assert.equal(session.storageWrites.at(-1).bvState.panelsByVideo["youtube:real-match"].settings, false, "the hide is stored for this video");
});

test("the settings panel stays available during setup and withholds only for a camera-cut reseed", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_PANELS", panels: { settings: true }, requestId: "settings-seed-1" });
  assert.ok(live.overlayRoot().querySelector('[data-bso-panel="settings"]'), "settings is open before setup");

  // User-initiated court setup is layered over the live surface; furniture
  // such as settings stays mounted (matching stats/feed during setup).
  live.onMessage({ type: "START_SEED", requestId: "settings-seed-2" });
  let root = live.overlayRoot();
  assert.ok(root.querySelector("[data-bso-court-seeding]"), "the setup surface renders");
  assert.ok(root.querySelector('[data-bso-panel="settings"]'), "settings stays mounted during user-initiated setup");
  buttonWithText(root, "Cancel").dispatchEvent({ type: "click", target: buttonWithText(root, "Cancel") });
  assert.ok(live.overlayRoot().querySelector('[data-bso-panel="settings"]'), "settings remains after cancelling setup");

  // A camera cut invalidates every stale layer over the new camera angle.
  live.onMessage({ type: "CAMERA_CUT", requestId: "settings-cut-1" });
  root = live.overlayRoot();
  assert.ok(root.querySelector("[data-bso-court-seeding]"), "the reseed flow renders after a camera cut");
  assert.equal(root.querySelector('[data-bso-panel="settings"]'), null, "settings withholds during the camera-cut reseed");
  assert.equal(root.querySelector(".bv-runtime-evidence"), null, "raw evidence withholds during the reseed too");
  buttonWithText(root, "Cancel").dispatchEvent({ type: "click", target: buttonWithText(root, "Cancel") });
  assert.ok(live.overlayRoot().querySelector('[data-bso-panel="settings"]'), "settings returns when the reseed resolves");
});

test("the overlay access point opens the settings panel from the video", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  let root = live.overlayRoot();
  root.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  const shortcut = root.querySelector('[data-bso-overlay-shortcut="settings"]');
  assert.ok(shortcut, "the access point menu lists Settings");
  shortcut.dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.ok(root.querySelector('[data-bso-panel="settings"]'), "the shortcut opens the settings panel");
  assert.equal(root.querySelector("[data-bso-overlay-access]").getAttribute("aria-expanded"), "false", "opening a panel closes the shortcut menu");
  assert.equal(live.storageWrites.at(-1).bvState.panelsByVideo["youtube:real-match"].settings, true, "the opened panel preference is saved for this video");
});

test("the popup settings gear toggles the panel and the Panel Controls row stays wired", async () => {
  const popup = await createPopupSession();
  let gear = popup.app.querySelector("[data-bso-settings-toggle]");
  assert.ok(gear, "the header gear renders");
  assert.equal(Boolean(gear.disabled), false, "the gear is enabled on a watch page");
  assert.equal(gear.getAttribute("aria-label"), "Show settings panel");
  assert.equal(gear.className.includes("active"), false, "the gear is inactive while the panel is closed");
  gear.dispatchEvent({ type: "click" });
  assert.equal(popup.sent.at(-1).message.type, "SET_PANELS", "the gear messages the content script");
  assert.equal(popup.sent.at(-1).message.panels.settings, true, "the gear opens the settings panel");
  gear = popup.app.querySelector("[data-bso-settings-toggle]");
  assert.equal(gear.getAttribute("aria-label"), "Hide settings panel");
  assert.equal(gear.className.includes("active"), true, "the gear reflects the open panel");
  gear.dispatchEvent({ type: "click" });
  assert.equal(popup.sent.at(-1).message.panels.settings, false, "the gear closes the panel again");
  assert.equal(popup.app.querySelector("[data-bso-settings-toggle]").getAttribute("aria-label"), "Show settings panel");

  // The disclosure row is the same per-video toggle as the other panels.
  const toggle = popup.app.querySelector("[data-bso-panel-controls-toggle]");
  toggle.dispatchEvent({ type: "click" });
  const settingsToggle = popup.app.querySelector('[aria-label="Toggle Settings"]');
  assert.ok(settingsToggle, "Panel Controls lists a Settings toggle");
  assert.equal(settingsToggle.getAttribute("aria-checked"), "false");
  settingsToggle.dispatchEvent({ type: "click" });
  assert.equal(popup.app.querySelector('[aria-label="Toggle Settings"]').getAttribute("aria-checked"), "true", "the disclosure row opens settings");
  assert.equal(popup.sent.at(-1).message.panels.settings, true);

  // Outside a watch page the gear stays disabled with an honest label.
  const other = await createPopupSession({ tabUrl: "https://example.com/", tabTitle: "Example", videoInfo: null });
  const offPageGear = other.app.querySelector("[data-bso-settings-toggle]");
  assert.equal(Boolean(offPageGear.disabled), true, "settings is disabled without a watch page");
  assert.equal(offPageGear.getAttribute("aria-label"), "Settings unavailable here");
});

test("first-open settings placement cascades below an already-open feed panel", async () => {
  const slotRects = {
    feed: { left: 336, top: 16, width: 288, height: 180 },
    stats: { left: 16, top: 58, width: 288, height: 210 },
    settings: { left: 336, top: 58, width: 288, height: 170 }
  };
  const originalAppend = FakeNode.prototype.appendChild;
  FakeNode.prototype.appendChild = function (child) {
    originalAppend.call(this, child);
    if (child && typeof child.getAttribute === "function") {
      const panelId = child.getAttribute("data-bso-panel");
      if (panelId && slotRects[panelId]) child.rect = Object.assign({}, slotRects[panelId]);
      else if (child.getAttribute("data-bso-runtime-phase") != null) child.rect = { left: 0, top: 0, width: 640, height: 560 };
    }
    return child;
  };
  try {
    const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
    live.overlayRoot().rect = { left: 0, top: 0, width: 640, height: 560 };
    live.flushStorage();
    live.onMessage({ type: "SET_PANELS", panels: { feed: true, settings: true }, requestId: "settings-stack-feed-1" });
    const root = live.overlayRoot();
    const settings = root.querySelector('[data-bso-panel="settings"]');
    const feed = root.querySelector('[data-bso-panel="feed"]');
    assert.ok(feed, "the stroke feed is open before settings");
    assert.ok(settings, "the settings panel mounts beside the feed");
    const rectOf = (node) => ({ left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height) });
    const intersects = (a, b) => a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9 && a.top < b.top + b.height - 1e-9 && b.top < a.top + a.height - 1e-9;
    const feedRect = rectOf(feed);
    const settingsRect = rectOf(settings);
    assert.ok(settingsRect.top >= feedRect.top + feedRect.height + 12 - 1e-6, `settings stacks below the feed (settings top ${settingsRect.top}, feed bottom ${feedRect.top + feedRect.height})`);
    assert.equal(intersects(settingsRect, feedRect), false, "the first-open settings panel never covers the feed content");
    assert.ok(settingsRect.top + settingsRect.height <= 560 - 72 + 1e-9, "the stacked settings panel clears the player control strip");
    const stored = live.storageWrites.at(-1).bvState;
    assert.equal(stored.panelLayouts.settings, undefined, "the cascade never persists a settings layout");
    assert.ok(!stored.panelLayoutsByVideo["youtube:real-match"] || !stored.panelLayoutsByVideo["youtube:real-match"].settings, "the cascade writes no per-video settings layout");

    // The placement is deterministic per render while the feed stays open.
    live.onMessage({ type: "SET_PANELS", panels: { feed: true, settings: true }, requestId: "settings-stack-feed-2" });
    const rerendered = rectOf(live.overlayRoot().querySelector('[data-bso-panel="settings"]'));
    assert.equal(rerendered.top, settingsRect.top, "a rerender lands the settings panel at the same stacked spot");
    assert.equal(live.storageWrites.at(-1).bvState.panelLayouts.settings, undefined, "rerenders never persist the stacked offset either");
  } finally {
    FakeNode.prototype.appendChild = originalAppend;
  }
});

test("first-open settings placement stays in its own slot beside the open stats panel", async () => {
  const slotRects = {
    stats: { left: 16, top: 58, width: 288, height: 210 },
    settings: { left: 336, top: 58, width: 288, height: 170 }
  };
  const originalAppend = FakeNode.prototype.appendChild;
  FakeNode.prototype.appendChild = function (child) {
    originalAppend.call(this, child);
    if (child && typeof child.getAttribute === "function") {
      const panelId = child.getAttribute("data-bso-panel");
      if (panelId && slotRects[panelId]) child.rect = Object.assign({}, slotRects[panelId]);
      else if (child.getAttribute("data-bso-runtime-phase") != null) child.rect = { left: 0, top: 0, width: 640, height: 560 };
    }
    return child;
  };
  try {
    const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
    live.overlayRoot().rect = { left: 0, top: 0, width: 640, height: 560 };
    live.flushStorage();
    live.onMessage({ type: "SET_PANELS", panels: { stats: true, settings: true }, requestId: "settings-stack-stats-1" });
    const root = live.overlayRoot();
    const settings = root.querySelector('[data-bso-panel="settings"]');
    const stats = root.querySelector('[data-bso-panel="stats"]');
    assert.ok(stats, "the rally stats panel is open first");
    assert.ok(settings, "the settings panel mounts beside the stats panel");
    const rectOf = (node) => ({ left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height) });
    const intersects = (a, b) => a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9 && a.top < b.top + b.height - 1e-9 && b.top < a.top + a.height - 1e-9;
    const settingsRect = rectOf(settings);
    assert.equal(intersects(settingsRect, rectOf(stats)), false, "settings first-opens clear of the stats panel");
    assert.ok(Math.abs(settingsRect.top - 58) < 1e-6, "settings keeps its default slot when nothing occupies it");
    assert.ok(settingsRect.top + settingsRect.height <= 560 - 72 + 1e-9, "the slotted settings panel clears the player control strip");
    assert.equal(live.storageWrites.at(-1).bvState.panelLayouts.settings, undefined, "an unstacked first open persists no layout either");
  } finally {
    FakeNode.prototype.appendChild = originalAppend;
  }
});
