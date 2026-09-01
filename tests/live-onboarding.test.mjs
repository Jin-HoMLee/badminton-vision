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
  let runtimeChange = null;
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
    flushStorage(value = storedState) {
      assert.equal(storageReads.length, 1);
      storageReads.shift()({ bvState: value });
    },
    host() { return documentRef.querySelector("[data-badminton-vision]"); },
    overlayRoot() { return this.host().shadowRoot.querySelector(".bv-overlay-root"); }
  };
}

async function createPopupSession({ deferStorage = false, failInjection = false, tabUrl = "https://www.youtube.com/watch?v=real-match", tabTitle = "Real Match Title - YouTube", videoInfo = null, initialVideoKey = "youtube:real-match" } = {}) {
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
        else callback({ bvState: { videoKey: initialVideoKey, enabled: false, seeded: false }, bvVideoInfo: videoInfo });
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
    flushStorage() { storageReads.shift()({ bvState: { videoKey: initialVideoKey, enabled: false, seeded: false }, bvVideoInfo: videoInfo }); },
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
  for (const label of ["Rally stats", "Court map", "Evidence visibility"]) {
    switchButton = popup.app.querySelector(`[aria-label="Toggle ${label}"]`);
    const before = switchButton.getAttribute("aria-checked");
    switchButton.dispatchEvent({ type: "click" });
    switchButton = popup.app.querySelector(`[aria-label="Toggle ${label}"]`);
    assert.notEqual(switchButton.getAttribute("aria-checked"), before, `${label} switch changes state`);
  }
});

test("minimal live overlay keeps only detection evidence and one on-demand access point", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  let root = live.overlayRoot();
  assert.equal(root.querySelector("[data-bso-density]").getAttribute("data-bso-density"), "minimal");
  assert.equal(root.querySelectorAll("[data-bso-overlay-access]").length, 1, "minimal mode has one compact access point");
  assert.equal(root.querySelector("[data-bso-overlay-access]").getAttribute("aria-expanded"), "false");
  assert.equal(root.querySelector("[data-bso-overlay-menu]").getAttribute("hidden") !== null, true, "the shortcut menu is on demand");
  for (const panel of ["stats", "map", "feed", "evidence", "controls"]) {
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
  assert.ok(root.querySelector('[data-bso-overlay-shortcut="manual"]'), "manual labeling is available from the same access point");
  root.querySelector('[data-bso-overlay-shortcut="stats"]').dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.ok(root.querySelector('[data-bso-panel="stats"]'), "the access point opens a panel on demand");
  assert.equal(root.querySelector("[data-bso-overlay-access]").getAttribute("aria-expanded"), "false", "opening a panel closes the shortcut menu");
  assert.equal(live.storageWrites.at(-1).bvState.panelsByVideo["youtube:real-match"].stats, true, "the opened panel preference is saved for this video");
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
  assert.deepEqual(panelIds.sort(), ["controls", "evidence", "feed", "map", "stats"]);
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

  const evidence = root.querySelector('[data-bso-panel="evidence"]');
  const evidenceHeader = evidence.querySelector("[data-bso-panel-drag-handle]");
  pointer(evidenceHeader, "pointerdown", 10, 10, 10);
  pointer(evidenceHeader, "pointermove", 150, 100, 10);
  pointer(evidenceHeader, "pointerup", 150, 100, 10);
  assert.ok(live.storageWrites.at(-1).bvState.panelLayoutsByVideo["youtube:real-match"].evidence, "evidence visibility layout is persisted independently");
  const evidenceResize = evidence.querySelector("[data-bso-panel-resize-handle]");
  const beforeEvidenceWidth = live.storageWrites.at(-1).bvState.panelLayouts.evidence.width;
  evidenceResize.dispatchEvent({ type: "keydown", target: evidenceResize, key: "ArrowRight", preventDefault() {}, stopPropagation() {} });
  assert.ok(live.storageWrites.at(-1).bvState.panelLayouts.evidence.width >= beforeEvidenceWidth, "resize keyboard affordance changes only the panel size");
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
  assert.equal(drawing.querySelectorAll(".bv-player-box").length, 0, "player boxes are opt-in in the minimal detection layer");
  root.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  root = session.overlayRoot();
  root.querySelector('[data-bso-overlay-shortcut="evidence"]').dispatchEvent({ type: "click" });
  root = session.overlayRoot();
  root.querySelector('[data-bso-evidence-control="players"]').querySelector("button").dispatchEvent({ type: "click" });
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

test("live evidence visibility switches are independent, persistent across result rerenders, and honest about missing signals", async () => {
  const session = await createLiveEvidenceSession();
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12 })));
  let accessRoot = session.overlayRoot();
  accessRoot.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  accessRoot = session.overlayRoot();
  accessRoot.querySelector('[data-bso-overlay-shortcut="evidence"]').dispatchEvent({ type: "click" });
  const toggle = (name) => session.overlayRoot().querySelector(`[data-bso-evidence-control="${name}"]`).querySelector("button");
  const projectionToggle = () => session.overlayRoot().querySelector("[data-bso-court-projection-toggle]").querySelector("button");
  const has = (selector) => Boolean(session.overlayRoot().querySelector(".bv-runtime-evidence").querySelector(selector));

  toggle("body").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-pose-keypoint"), false);
  assert.equal(has(".bv-player-box"), false, "player boxes remain off until explicitly enabled");
  session.publishRuntimeView(resultView(evidenceResult({ mediaTime: 12.1, keypointOffset: 0.01 })));
  assert.equal(has(".bv-pose-keypoint"), false, "pose visibility survives a result rerender");

  toggle("players").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-player-box"), true, "the evidence panel can explicitly enable player boxes");
  assert.equal(has(".bv-pose-keypoint"), false);
  toggle("shuttle").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-shuttle-trajectory"), false);
  assert.equal(has(".bv-shuttle-point"), false);
  toggle("racket").dispatchEvent({ type: "click" });
  assert.equal(has(".bv-racket-signal"), false);
  // The calibrated court polygon has exactly one toggle (Court projection);
  // turning it off removes the projection from the video.
  assert.equal(projectionToggle().getAttribute("aria-checked"), "true");
  projectionToggle().dispatchEvent({ type: "click" });
  assert.equal(session.overlayRoot().querySelector(".bv-calibration-court"), null);
  assert.equal(session.overlayRoot().querySelector('[data-bso-evidence-control="court"]'), null, "there is no second court toggle");

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
  assert.ok(panelRects.length >= 5, "the full live overlay renders its panels");
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
  for (const id of ["feed", "stats", "map", "controls", "evidence"]) {
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

  // Evidence visibility is not part of Balanced's default furniture. Re-open
  // it through the single access point before exercising its panel behavior.
  root.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  root.querySelector('[data-bso-overlay-shortcut="evidence"]').dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  // Collapse evidence too, then expand the feed again.
  root.querySelector('[data-bso-panel="evidence"]').querySelector("[data-bso-panel-collapse]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.equal(root.querySelector('[data-bso-panel="evidence"]').getAttribute("data-bso-panel-collapsed"), "true");
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
  assert.equal(root.querySelector('[data-bso-panel="evidence"]').getAttribute("data-bso-panel-collapsed"), "true", "collapsed evidence comes back after reload");
  assert.equal(root.querySelector('[data-bso-panel="feed"]').getAttribute("data-bso-panel-collapsed"), "false", "expanded panels stay expanded after reload");
});

test("evidence visibility hides and reopens like the other panels", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  let root = live.overlayRoot();
  assert.equal(root.querySelector('[data-bso-panel="evidence"]'), null, "evidence visibility stays off by default");
  root.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  root.querySelector('[data-bso-overlay-shortcut="evidence"]').dispatchEvent({ type: "click" });
  root = live.overlayRoot();
  assert.ok(root.querySelector('[data-bso-panel="evidence"]'), "the access point opens evidence visibility on demand");
  root.querySelector('[aria-label="Hide evidence visibility"]').dispatchEvent({ type: "click" });
  assert.equal(live.overlayRoot().querySelector('[data-bso-panel="evidence"]'), null, "the evidence panel hides like other panels");
  assert.equal(live.storageWrites.at(-1).bvState.panels.evidence, false);
  // Reopen through the panel message the popup sends for its toggle.
  live.onMessage({ type: "SET_PANELS", panels: { evidence: true }, requestId: "evidence-reopen-1" });
  assert.ok(live.overlayRoot().querySelector('[data-bso-panel="evidence"]'), "the evidence panel reopens from the popup toggle");
  // Density presets do not resurrect an explicitly hidden evidence panel.
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "evidence-density-1" });
  assert.ok(live.overlayRoot().querySelector('[data-bso-panel="evidence"]'), "evidence stays visible when the panel is on");
  live.onMessage({ type: "SET_PANELS", panels: { evidence: false }, requestId: "evidence-hide-1" });
  live.onMessage({ type: "SET_DENSITY", value: "balanced", requestId: "evidence-density-2" });
  assert.equal(live.overlayRoot().querySelector('[data-bso-panel="evidence"]'), null, "an explicit hide survives a density preset");
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
  root.querySelector("[data-bso-overlay-access]").dispatchEvent({ type: "click" });
  root = session.overlayRoot();
  root.querySelector('[data-bso-overlay-shortcut="evidence"]').dispatchEvent({ type: "click" });
  root = session.overlayRoot();
  let court = root.querySelector(".bv-calibration-court");
  assert.ok(court, "the fitted court projection draws after setup");
  const drawnLines = court.querySelectorAll("[data-court-line-role]");
  assert.ok(drawnLines.length > 0, "the projection includes the official court lines");
  for (const line of drawnLines) {
    const stroke = line.getAttribute("stroke");
    assert.match(stroke, /^var\(--court-setup-(?:line|net)\)$/, "drawn court lines use the bright setup highlight");
  }
  // One clearly labeled toggle controls the whole projection.
  const projectionToggle = root.querySelector("[data-bso-court-projection-toggle]").querySelector("button");
  assert.equal(projectionToggle.getAttribute("aria-checked"), "true");
  assert.ok(textOf(root.querySelector("[data-bso-court-projection-toggle]")).includes("Court projection"));
  assert.equal(textOf(root).includes("Court setup lines"), false, "the retired second toggle is gone");
  projectionToggle.dispatchEvent({ type: "click" });
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
  reloaded.overlayRoot().querySelector("[data-bso-court-projection-toggle]").querySelector("button").dispatchEvent({ type: "click" });
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
  assert.ok(rects.length >= 6, "full density plus the manual panel renders all panel surfaces");
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

test("collapse and close are visually distinct header affordances on every panel", async () => {
  const live = await createSession({ storedState: { videoKey: "youtube:real-match", enabled: true, seeded: false } });
  live.flushStorage();
  live.onMessage({ type: "SET_DENSITY", value: "full", requestId: "afford-full-1" });
  const root = live.overlayRoot();
  for (const id of ["feed", "stats", "map", "controls", "evidence"]) {
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
