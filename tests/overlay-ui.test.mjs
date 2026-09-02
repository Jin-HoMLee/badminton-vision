import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(projectRoot, path), "utf8");
const tokenFiles = [
  "design-system/tokens/colors.css",
  "design-system/tokens/elevation.css",
  "design-system/tokens/motion.css",
  "design-system/tokens/spacing.css",
  "design-system/tokens/typography.css"
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    this.dataset = {};
  }

  appendChild(child) {
    if (child == null) return child;
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
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

  removeEventListener(name, listener) {
    this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== listener);
  }

  dispatchEvent(event) {
    if (this.disabled && event.type === "click") return;
    event = Object.assign({
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}
    }, event);
    for (const listener of this.listeners[event.type] || []) listener.call(this, event);
  }

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
    this.isConnected = false;
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
    this.documentElement = new FakeNode("html");
    this.body = new FakeNode("body");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName) { return new FakeNode(tagName); }
  createElementNS(_namespace, tagName) { return new FakeNode(tagName); }
  createTextNode(text) { const node = new FakeNode("#text", 3); node.textContent = String(text); return node; }
  getElementById(id) { return this.querySelector(`[id="${id}"]`); }
}

async function createPopupSession({ runtimeStatus = null } = {}) {
  const documentRef = new FakeDocument();
  const app = new FakeNode("main");
  app.setAttribute("id", "app");
  documentRef.body.appendChild(app);
  const sent = [];
  const manifest = JSON.parse(await read("manifest.json"));
  const runtime = { lastError: null, getURL: (path) => `chrome-extension://test/${path}`, getManifest: () => manifest };
  const chromeApi = {
    runtime,
    tabs: {
      query: (_query, callback) => callback([{ id: 7, url: "https://www.youtube.com/watch?v=real-match", title: "Real Match - YouTube" }]),
      sendMessage: (tabId, message, callback) => { sent.push({ tabId, message }); callback?.(); }
    },
    storage: { local: {
      get: (_keys, callback) => callback({ bvState: { videoKey: "youtube:real-match", enabled: false, seeded: false }, bvRuntimeStatus: runtimeStatus }),
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
    close: () => {}
  });
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  for (const file of ["src/fixtures.js", "src/review.js", "src/state.js", "src/ui.js", "src/popup.js"]) {
    vm.runInContext(await read(file), context, { filename: file });
  }
  return { app, sent };
}

async function createContentSession() {
  const documentRef = new FakeDocument();
  const video = new FakeNode("video");
  Object.assign(video, { currentTime: 12, paused: false, muted: false, playbackRate: 1, readyState: 4, videoWidth: 640, videoHeight: 360 });
  documentRef.body.appendChild(video);
  const retired = new FakeNode("div");
  retired.setAttribute("data-bso-runtime-overlay", "true");
  documentRef.body.appendChild(retired);
  const storageReads = [];
  const windowListeners = Object.create(null);
  let onMessage;
  let runtimeChange;
  const chromeApi = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: (_message, callback) => callback?.(),
      onMessage: { addListener: (listener) => { onMessage = listener; } }
    },
    storage: { local: {
      get: (_keys, callback) => storageReads.push(callback),
      set: (_value, callback) => callback?.()
    } }
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
  const files = [
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
  for (const file of files) vm.runInContext(await read(file), context, { filename: file });
  context.BVRuntime.startIntegratedRuntime = (options = {}) => {
    runtimeChange = options.onChange || null;
    return { controller: { stop() {} } };
  };
  return {
    root: () => documentRef.querySelector("[data-badminton-vision]").shadowRoot.querySelector(".bv-overlay-root"),
    flush() { storageReads.shift()({ bvState: { videoKey: "youtube:real-match", enabled: true, seeded: false } }); },
    get onMessage() { return onMessage; },
    get runtimeChange() { return runtimeChange; }
  };
}

test("all design-system token sheets retain the shadow-root host contract and values", async () => {
  const manifest = JSON.parse(await read("design-system/_ds_manifest.json"));
  const sources = await Promise.all(tokenFiles.map(async (file) => [file, await read(file)]));
  const byFile = new Map(sources);

  for (const [file, source] of sources) {
    assert.match(source, /:root\s*,\s*:host\s*\{/,
      `${file} must expose tokens to both document and shadow roots`);
    assert.doesNotMatch(source, /^\s*:root\s*\{/,
      `${file} must not regress to a :root-only token rule`);
  }

  for (const token of manifest.tokens) {
    const source = byFile.get(`design-system/${token.definedIn}`);
    assert.ok(source, `manifest token source is shipped: ${token.definedIn}`);
    assert.match(source, new RegExp(`${escapeRegExp(token.name)}\\s*:\\s*${escapeRegExp(token.value)}\\s*;`),
      `${token.name} value must remain the supplied design token`);
  }
});

test("overlay geometry, treatment, and hit targets cannot fall back when mounted in Shadow DOM", async () => {
  const css = await read("src/styles.css");
  assert.match(css, /@import url\("\.\/design-system\/tokens\/fonts\.css"\)/);
  assert.match(css, /\.bv-overlay-stack\.left\s*\{[^}]*left:\s*var\(--overlay-gutter\)[^}]*top:\s*var\(--overlay-gutter\)/s);
  assert.match(css, /\.bv-overlay-stack\.right\s*\{[^}]*right:\s*var\(--overlay-gutter\)[^}]*top:\s*var\(--overlay-gutter\)[^}]*width:\s*var\(--overlay-panel-width\)/s);
  assert.match(css, /\.bv-overlay-label\s*\{[^}]*right:\s*var\(--overlay-gutter\)[^}]*top:\s*var\(--overlay-gutter\)[^}]*bottom:\s*var\(--overlay-gutter\)/s);
  assert.match(css, /\.bv-overlay-actions\s*\{[^}]*right:\s*var\(--overlay-gutter\)[^}]*bottom:/s);
  assert.match(css, /\.bv-icon-button\s*\{[^}]*width:\s*var\(--control-height-md\)[^}]*height:\s*var\(--control-height-md\)/s);
  // Every overlay layer passes pointer events through by default; only the
  // explicit interactive surfaces (stacks, panels, seed layer) opt back in.
  assert.match(css, /\.bv-overlay-root\s*>\s*\*\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-overlay-stack,\s*\.bv-overlay-empty,[^}]*\[data-bso-panel-layout\]:not\(\.bv-panel\)[^}]*\.bv-seed-layer\s*\{\s*pointer-events:\s*auto\s*;/s);
  assert.match(css, /\.bv-runtime-evidence\s*\{[^}]*pointer-events:\s*none\s*;/s);
  assert.match(css, /\.bv-overlay-root\s*>\s*\.bv-runtime-evidence\s*\{\s*pointer-events:\s*none\s*;/);
  // Panel chrome also passes through: the header/footer/resize surfaces and
  // actual controls keep their hit areas, empty body space never blocks the
  // player (including popups such as YouTube's settings menu).
  assert.match(css, /\.bv-panel\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-panel-header,\s*\.bv-panel-footer,\s*\.bv-panel-resize-handle\s*\{\s*pointer-events:\s*auto\s*;/);
  assert.match(css, /\.bv-panel-body\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-panel-body\s*button,[^}]*\[role="button"\][^}]*\.bv-feed[^}]*\{\s*pointer-events:\s*auto\s*;/s);
  assert.match(css, /\.bv-label-panel \.bv-panel-body\s*\{\s*pointer-events:\s*auto\s*;/);
  // The seed layer's capture surface ends at the player control strip.
  assert.match(css, /\.bv-seed-layer\s*\{[^}]*clip-path:\s*inset\(0 0 var\(--overlay-controls-reserve\) 0\)/s);
  assert.match(css, /\.bv-overlay-root \.bv-panel\s*\{[^}]*background:\s*var\(--ink-900\)[^}]*border-color:\s*var\(--border-subtle\)[^}]*box-shadow:/s);
});

test("overlay panels reserve the native player strip and every panel collapses from its header", async () => {
  const css = await read("src/styles.css");
  const ui = await read("src/ui.js");
  // The bottom strip is reserved in tokens, default placement, and clamping.
  assert.match(css, /--overlay-controls-reserve:\s*72px/);
  assert.match(css, /\[data-bso-panel="map"\]\s*\{[^}]*bottom:\s*calc\(var\(--overlay-controls-reserve\) \+ 16px\)/s);
  assert.match(css, /\[data-bso-panel="controls"\]\s*\{[^}]*bottom:\s*var\(--overlay-controls-reserve\)/s);
  // The court projection is one toggle: the calibrated court polygon over the
  // video, backed by the per-video court-lines store. There is no second,
  // confusing "setup lines" control.
  assert.match(css, /--court-setup-line:\s*var\(--lime-400\)/);
  assert.match(css, /--court-setup-net:\s*var\(--lime-300\)/);
  // Collapse (chevron, aria-expanded) and close (x icon) are visually and
  // semantically distinct header affordances.
  assert.match(ui, /data-bso-panel-collapse/);
  assert.match(ui, /bv-panel-collapsed/);
  assert.match(ui, /if \(movable && opts\.collapsible !== false\)/);
  assert.match(ui, /aria-expanded/);
  assert.match(css, /\.bv-panel-layout\.bv-panel-collapsed/);
  // Evidence visibility is a popup disclosure, not movable on-video
  // furniture. Layer preferences remain independent and video-local.
  assert.match(css, /\.bv-overlay-access\s*\{[^}]*top:\s*var\(--overlay-gutter\)[^}]*right:\s*var\(--overlay-gutter\)/s);
});

test("evidence disclosure owns the popup controls while content keeps one overlay surface", async () => {
  const popup = await createPopupSession();
  let disclosureToggle = popup.app.querySelector("[data-bso-evidence-disclosure-toggle]");
  const disclosureId = disclosureToggle.getAttribute("aria-controls");
  assert.equal(disclosureToggle.tagName, "BUTTON");
  assert.equal(disclosureToggle.getAttribute("aria-expanded"), "false");
  assert.equal(disclosureToggle.getAttribute("aria-label"), "Expand Evidence visibility controls");
  assert.equal(popup.app.querySelector(`[id="${disclosureId}"]`).getAttribute("hidden") !== null, true);
  assert.equal(popup.app.querySelector('[data-bso-panel="evidence"]'), null);

  disclosureToggle.dispatchEvent({ type: "click" });
  disclosureToggle = popup.app.querySelector("[data-bso-evidence-disclosure-toggle]");
  const controls = popup.app.querySelector(`[id="${disclosureId}"]`);
  assert.equal(disclosureToggle.getAttribute("aria-expanded"), "true");
  assert.equal(disclosureToggle.getAttribute("aria-label"), "Collapse Evidence visibility controls");
  assert.equal(controls.getAttribute("hidden"), null);
  assert.equal(controls.parentNode.parentNode.className, "bv-section");
  assert.equal(controls.querySelector('[data-bso-evidence-control="body"]').querySelector("button").focused, true);
  assert.ok(controls.querySelector('[data-bso-evidence-control="players"]'));
  assert.ok(controls.querySelector('[data-bso-evidence-control="racket"]'));
  assert.ok(controls.querySelector('[data-bso-evidence-control="shuttle"]'));
  assert.ok(controls.querySelector("[data-bso-court-projection-toggle]"));

  const fixturePopup = await createPopupSession({ runtimeStatus: { phase: "result", analyzer: "fixture-probe-v1", inference: true } });
  fixturePopup.app.querySelector("[data-bso-evidence-disclosure-toggle]").dispatchEvent({ type: "click" });
  const fixtureShuttle = fixturePopup.app.querySelector('[data-bso-evidence-control="shuttle"]');
  const fixtureShuttleSwitch = fixtureShuttle.querySelector("button");
  assert.equal(fixtureShuttle.getAttribute("data-bso-evidence-state"), "unavailable");
  assert.equal(fixtureShuttleSwitch.disabled, true);
  const fixtureMessageCount = fixturePopup.sent.length;
  fixtureShuttleSwitch.dispatchEvent({ type: "click" });
  assert.equal(fixturePopup.sent.length, fixtureMessageCount);

  const bodySwitch = controls.querySelector('[data-bso-evidence-control="body"]').querySelector("button");
  bodySwitch.dispatchEvent({ type: "click" });
  assert.equal(popup.app.querySelector('[data-bso-evidence-control="body"]').querySelector("button").getAttribute("aria-checked"), "false");
  assert.equal(popup.sent.at(-1).message.type, "SET_TRACKER");

  disclosureToggle = popup.app.querySelector("[data-bso-evidence-disclosure-toggle]");
  disclosureToggle.dispatchEvent({ type: "click" });
  assert.equal(popup.app.querySelector("[data-bso-evidence-disclosure-toggle]").getAttribute("aria-expanded"), "false");
  assert.equal(popup.app.querySelector("[data-bso-evidence-disclosure-toggle]").focused, true);

  const content = await createContentSession();
  content.flush();
  const overlayRoot = content.root();
  assert.equal(overlayRoot.querySelector('[data-bso-panel="evidence"]'), null);
  assert.equal(overlayRoot.querySelectorAll("[data-bso-overlay-access]").length, 1);
  assert.equal(overlayRoot.querySelector("[data-bso-overlay-menu]").getAttribute("hidden") !== null, true);
});

test("popup actions and overlay panel toggles remain wired", async () => {
  const popup = await read("src/popup.js");
  const content = await read("src/content.js");
  for (const label of ["Minimal", "Balanced", "Full", "Set up court", "Label it myself"]) {
    assert.match(popup, new RegExp(escapeRegExp(label)));
  }
  for (const action of ["seed-court", "manual-only", "open-overlay"]) assert.match(popup, new RegExp(`data-bso-action.*${action}`));
  for (const panel of ["stats", "map", "feed"]) assert.match(content, new RegExp(`TOGGLE_PANEL.*panel: "${panel}"`));
  assert.match(content, /function openLabeling/);
});

test("the stroke feed renders every entry inside a scrollable bounded body", async () => {
  const css = await read("src/styles.css");
  assert.match(css, /\.bv-feed\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(css, /\.bv-feed\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.bv-manual-saved \.bv-feed\s*\{[^}]*overflow-y:\s*auto/s);
});

test("popup font packaging is local-only and records the supplied-system limitation", async () => {
  const fonts = await read("design-system/tokens/fonts.css");
  const typography = await read("design-system/tokens/typography.css");
  const manifest = JSON.parse(await read("manifest.json"));
  assert.doesNotMatch(fonts, /@import|@font-face|(?:https?:)?\/\//i);
  assert.match(fonts, /:root\s*,\s*:host\s*\{/);
  assert.match(typography, /system-ui/);
  assert.match(typography, /ui-monospace/);
  assert.equal(manifest.web_accessible_resources.some((entry) => entry.resources.includes("design-system/tokens/*")), true);
  assert.match(await read("docs/overlay-ui.md"), /no redistributable font binaries/);
  assert.match(await read("docs/overlay-ui.md"), /does not fetch Google Fonts/);
});
