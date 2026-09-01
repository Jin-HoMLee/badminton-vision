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
    for (const listener of this.listeners[event.type] || []) listener.call(this, event);
  }

  click() { this.dispatchEvent({ type: "click", target: this }); }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 640, height: 360 };
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

async function createSession({ bundle = false, storedState = { videoKey: "youtube:real-match", enabled: false, seeded: false } } = {}) {
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
  let onMessage;
  const messageListeners = [];
  let runtimeStarts = 0;
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
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  const files = bundle
    ? []
    : ["src/state.js", "src/calibration.js", "src/seed-card.js", "src/panel-layout.js", "src/fixtures.js", "src/review.js", "src/analysis.js", "src/ui.js", "src/content.js"];
  if (!bundle) {
    context.BVRuntime = {
      startIntegratedRuntime: () => {
        runtimeStarts += 1;
        return { controller: { sessionId: "test-session" } };
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
    context.BVRuntime.startIntegratedRuntime = () => {
      runtimeStarts += 1;
      return { controller: { sessionId: "test-session" } };
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
    flushStorage(value = storedState) {
      assert.equal(storageReads.length, 1);
      storageReads.shift()({ bvState: value });
    },
    host() { return documentRef.querySelector("[data-badminton-vision]"); },
    overlayRoot() { return this.host().shadowRoot.querySelector(".bv-overlay-root"); }
  };
}

async function createPopupSession({ deferStorage = false } = {}) {
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
        runtime.lastError = null;
        callback?.();
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

test("overlay panel surfaces expose independent move and resize semantics", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  let root = live.overlayRoot();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "layout-full-1" });
  root = live.overlayRoot();
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
});

test("court setup keeps corners clickable without a visible drag instruction", async () => {
  const live = await createSession();
  live.flushStorage();
  live.onMessage({ type: "START_SEED", requestId: "layout-seed-1" });
  let root = live.overlayRoot();
  let layer = root.querySelector("[data-bso-court-seeding]");
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
