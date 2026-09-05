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

function parseCssRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]+;/g, "");
  const rules = [];
  let depth = 0;
  let ruleStart = -1;
  let bodyStart = 0;
  let cursor = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) { ruleStart = cursor; bodyStart = i + 1; }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && ruleStart !== -1) {
        const selector = text.slice(ruleStart, bodyStart - 1).replace(/\s+/g, " ").trim();
        const declarations = Object.create(null);
        for (const entry of text.slice(bodyStart, i).split(";")) {
          const colon = entry.indexOf(":");
          if (colon > 0) {
            const property = entry.slice(0, colon).trim().toLowerCase();
            if (property) declarations[property] = entry.slice(colon + 1).trim();
          }
        }
        rules.push({ selector, declarations });
        ruleStart = -1;
        cursor = i + 1;
      }
    }
  }
  return rules;
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

async function createPopupSession({ runtimeStatus = null, poseModelSwitchReason = null, storedPoseModel = null, nestedPoseModel = null, racketModelSwitchReason = null, racketReport = null, storedRacketModel = null, nestedRacketModel = null } = {}) {
  const documentRef = new FakeDocument();
  const app = new FakeNode("main");
  app.setAttribute("id", "app");
  documentRef.body.appendChild(app);
  const sent = [];
  const runtimeMessages = [];
  const manifest = JSON.parse(await read("manifest.json"));
  const runtime = { lastError: null, getURL: (path) => `chrome-extension://test/${path}`, getManifest: () => manifest };
  runtime.sendMessage = (message, callback) => {
    runtimeMessages.push(message);
    if (poseModelSwitchReason !== null && message && message.action === "switchPoseModel") {
      callback({ ok: false, reason: poseModelSwitchReason, modelId: message.modelId });
    }
    if (racketModelSwitchReason !== null && message && message.action === "switchRacketModel") {
      callback({ ok: false, reason: racketModelSwitchReason, modelId: message.modelId });
    }
    if (racketReport !== null && message && message.action === "getAvailableRacketModels") {
      callback(racketReport);
    }
  };
  const chromeApi = {
    runtime,
    tabs: {
      query: (_query, callback) => callback([{ id: 7, url: "https://www.youtube.com/watch?v=real-match", title: "Real Match - YouTube" }]),
      sendMessage: (tabId, message, callback) => { sent.push({ tabId, message }); callback?.(); }
    },
    storage: { local: {
      get: (_keys, callback) => {
        const stored = { bvState: { videoKey: "youtube:real-match", enabled: false, seeded: false }, bvRuntimeStatus: runtimeStatus };
        if (storedPoseModel !== null) stored.bvSelectedPoseModel = storedPoseModel;
        if (nestedPoseModel !== null) stored.bvState.selectedPoseModel = nestedPoseModel;
        if (storedRacketModel !== null) stored.bvSelectedRacketModel = storedRacketModel;
        if (nestedRacketModel !== null) stored.bvState.selectedRacketModel = nestedRacketModel;
        callback(stored);
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
    close: () => {}
  });
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  for (const file of ["src/fixtures.js", "src/review.js", "src/state.js", "src/ui.js", "src/popup.js"]) {
    vm.runInContext(await read(file), context, { filename: file });
  }
  return { app, sent, runtimeMessages };
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
    "src/hough-guidance.js",
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
  assert.equal(controls.querySelectorAll(".bv-tracker-row").length, 4);
  assert.equal(controls.querySelector('[data-bso-evidence-control="score"]'), null);
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
  // The refreshed upstream policy comment names @import/@font-face in prose;
  // strip comments so the assertion targets declared mechanisms only.
  const fontsCss = fonts.replace(/\/\*[\s\S]*?\*\//g, "");
  const typography = await read("design-system/tokens/typography.css");
  const manifest = JSON.parse(await read("manifest.json"));
  assert.doesNotMatch(fontsCss, /@import|@font-face|(?:https?:)?\/\//i);
  assert.match(fontsCss, /:root\s*,\s*:host\s*\{/);
  assert.match(typography, /system-ui/);
  assert.match(typography, /ui-monospace/);
  assert.equal(manifest.web_accessible_resources.some((entry) => entry.resources.includes("design-system/tokens/*")), true);
  assert.match(await read("docs/overlay-ui.md"), /no redistributable font binaries/);
  assert.match(await read("docs/overlay-ui.md"), /does not fetch Google Fonts/);
});

test("popup intro callouts collapse to a sentence summary with an accessible full-text tooltip", async () => {
  const rules = parseCssRules(await read("src/styles.css"));
  const findRule = (selector) => rules.find((rule) => rule.selector === selector);
  const summaryLine = findRule(".bv-callout[data-bso-callout-compact] .bv-callout-copy .bv-callout-body");
  assert.ok(summaryLine, "compact callout styles the summary body line");
  assert.equal(summaryLine.declarations["display"], "block");
  assert.equal(summaryLine.declarations["overflow"], "hidden");
  assert.equal(summaryLine.declarations["white-space"], "nowrap");
  assert.equal(summaryLine.declarations["text-overflow"], "ellipsis");
  const tooltipBase = findRule(".bv-callout-tooltip");
  assert.ok(tooltipBase, "tooltip rule exists");
  assert.equal(tooltipBase.declarations["display"], "none");
  assert.equal(tooltipBase.declarations["position"], "absolute");
  const tooltipReveal = rules.find((rule) =>
    rule.selector.includes("data-bso-callout-compact") &&
    rule.selector.includes(":hover > .bv-callout-tooltip") &&
    rule.selector.includes(":focus-within > .bv-callout-tooltip"));
  assert.ok(tooltipReveal, "hover and keyboard focus reveal the tooltip");
  assert.equal(tooltipReveal.declarations["display"], "block");

  // The default popup session (watch page found, inference off) renders the
  // runtime-pending notice and the "Inference starts independently" guide
  // box; both collapse to their first sentence.
  const popup = await createPopupSession();
  const compact = popup.app.querySelectorAll("[data-bso-callout-compact]");
  assert.ok(compact.length >= 2, "intro callouts render in compact mode");
  for (const box of compact) {
    assert.ok(box.className.includes("bv-callout"));
    const body = box.querySelector(".bv-callout-body");
    assert.ok(body, "compact callout keeps a summary body line");
    assert.equal(body.getAttribute("tabindex"), "0", "summary line is the keyboard trigger");
    const tipId = body.getAttribute("aria-describedby");
    assert.ok(tipId && /^bv-callout-tooltip-/.test(tipId), "summary references its tooltip");
    const tip = box.querySelector(`[id="${tipId}"]`);
    assert.ok(tip, "described tooltip exists in the same callout");
    assert.equal(tip.getAttribute("role"), "tooltip");
    const summaryText = body.children[0].textContent;
    const fullText = tip.children[0].textContent;
    assert.ok(summaryText.length < fullText.length, "standing copy is only the first sentence");
    assert.ok(fullText.startsWith(summaryText), "tooltip carries the full body starting at the summary");
  }
  // Known first instance: the runtime-pending notice keeps its first sentence
  // standing and its whole body in the tooltip.
  const runtimeNotice = compact[0].querySelector("strong");
  assert.ok(runtimeNotice && runtimeNotice.children[0].textContent.includes("Local runtime pending"));
  assert.equal(compact[0].querySelector(".bv-callout-body").children[0].textContent, "The local pose model is starting.");
  const runtimeTooltip = compact[0].querySelector(".bv-callout-tooltip");
  assert.equal(runtimeTooltip.children[0].textContent, "The local pose model is starting. Until evidence arrives, player, shuttle, shot, rally-end, and winner fields remain unknown.");
});

test("pose model switch failure keeps the cause in the tooltip with a concise standing line", async () => {
  const popup = await createPopupSession({ poseModelSwitchReason: "the bundled pose runtime rejected the target model (404)." });
  const select = popup.app.querySelector("[data-bso-model-selector]");
  assert.ok(select, "model selector renders");
  select.value = "movenet-multipose-lightning-v1";
  select.dispatchEvent({ type: "change" });

  const callout = popup.app.querySelector(".bv-model-section-body").children.find((child) => child.matches("[data-bso-callout-compact]"));
  assert.ok(callout, "failed switch renders a compact callout in the model section");
  assert.ok(callout.className.includes("bv-callout warn"));
  const title = callout.querySelector("strong");
  assert.ok(title && title.children[0].textContent.includes("Pose model not switched"));
  const body = callout.querySelector(".bv-callout-body");
  const standing = body.children[0].textContent;
  const tipId = body.getAttribute("aria-describedby");
  const full = callout.querySelector(`[id="${tipId}"]`).children[0].textContent;
  assert.equal(standing, "The selected model could not start here.");
  assert.ok(!standing.includes("rejected the target model"), "standing line stays concise without the dynamic cause");
  assert.ok(full.startsWith(standing), "tooltip carries the full body starting at the standing line");
  assert.ok(full.includes("rejected the target model (404)."), "tooltip carries the full cause");
  assert.ok(full.includes("The previous model remains active."), "tooltip keeps the previous-model note");
  assert.equal(popup.app.querySelector("[data-bso-model-selector]").value, "lightweight-openpose-lite-256-v1", "selector reverts to the previous model");
});

test("the work-in-progress BlazePose option stays listed but grayed out and cannot be selected", async () => {
  const popup = await createPopupSession();
  const select = popup.app.querySelector("[data-bso-model-selector]");
  assert.ok(select, "model selector renders");
  const options = select.querySelectorAll("option");
  const byValue = {};
  options.forEach((option) => { byValue[option.getAttribute("value")] = option; });

  const blaze = byValue["blazepose-tfjs-heavy-v1"];
  assert.ok(blaze, "BlazePose keeps its menu entry");
  assert.equal(blaze.disabled, true, "BlazePose is grayed out/disabled");
  assert.equal(blaze.getAttribute("title"), "Work in progress: switching to BlazePose Heavy can freeze pose detection until the extension or the tab is reloaded. Disabled until it is fixed.");
  assert.ok(blaze.children[0].textContent.includes("(work in progress)"), "menu label carries the work-in-progress marker");
  assert.ok(!byValue["lightweight-openpose-lite-256-v1"].disabled, "production default stays selectable");
  assert.ok(!byValue["movenet-multipose-lightning-v1"].disabled, "MoveNet stays selectable");

  // A programmatic selection attempt is refused: no switch request leaves the
  // popup, while a selectable model still goes through to the offscreen.
  select.value = "blazepose-tfjs-heavy-v1";
  select.dispatchEvent({ type: "change" });
  assert.equal(popup.runtimeMessages.filter((message) => message.action === "switchPoseModel").length, 0, "work-in-progress selection is never sent to the offscreen analyzer");
  select.value = "movenet-multipose-lightning-v1";
  select.dispatchEvent({ type: "change" });
  const switches = popup.runtimeMessages.filter((message) => message.action === "switchPoseModel");
  assert.equal(switches.length, 1);
  assert.equal(switches[0].modelId, "movenet-multipose-lightning-v1", "selectable model switches still dispatch");
});

test("a stored BlazePose preference never re-selects the work-in-progress model", async () => {
  const popup = await createPopupSession({ storedPoseModel: "blazepose-tfjs-heavy-v1" });
  const select = popup.app.querySelector("[data-bso-model-selector]");
  assert.equal(select.value, "lightweight-openpose-lite-256-v1", "stored work-in-progress preference falls back to the production default");
  const blaze = select.querySelectorAll("option").find((option) => option.getAttribute("value") === "blazepose-tfjs-heavy-v1");
  assert.equal(blaze.disabled, true);
});

test("a BlazePose selection persisted inside bvState by older builds is filtered at hydration too", async () => {
  const popup = await createPopupSession({ nestedPoseModel: "blazepose-tfjs-heavy-v1" });
  const select = popup.app.querySelector("[data-bso-model-selector]");
  assert.equal(select.value, "lightweight-openpose-lite-256-v1", "nested work-in-progress selection falls back to the production default");
});

test("a stored MoveNet preference still re-selects its model", async () => {
  const popup = await createPopupSession({ storedPoseModel: "movenet-multipose-lightning-v1" });
  const select = popup.app.querySelector("[data-bso-model-selector]");
  assert.equal(select.value, "movenet-multipose-lightning-v1", "only work-in-progress models are filtered out of stored preferences");
});

test("the racket model selector mirrors the pose picker and marks the experimental YOLO-World entry", async () => {
  const racketReport = {
    ok: true,
    currentModel: "efficientdet-lite0-racket-v1",
    models: [
      { id: "efficientdet-lite0-racket-v1", label: "EfficientDet-Lite0 (Production)", available: true, reason: "", current: true, experimental: false },
      { id: "yolo-world-racket-detector-v1", label: "YOLO-World Open-Vocabulary (Experimental)", available: false, reason: "onnx-runtime-web-not-loaded", current: false, experimental: true }
    ]
  };
  const popup = await createPopupSession({ racketReport });
  const select = popup.app.querySelector("[data-bso-racket-model-selector]");
  assert.ok(select, "the racket model selector is rendered");
  assert.equal(select.value, "efficientdet-lite0-racket-v1", "the production default is active");
  const byValue = {};
  select.querySelectorAll("option").forEach((option) => { byValue[option.getAttribute("value")] = option; });
  assert.ok(byValue["efficientdet-lite0-racket-v1"], "EfficientDet keeps its menu entry");
  assert.ok(!byValue["efficientdet-lite0-racket-v1"].disabled, "the production default stays selectable");
  const yolo = byValue["yolo-world-racket-detector-v1"];
  assert.ok(yolo, "YOLO-World keeps its experimental menu entry");
  assert.equal(yolo.disabled, true, "the experimental entry is disabled when its runtime is not bundled");
  assert.match(yolo.getAttribute("title"), /Experimental/, "the entry is clearly labeled experimental");
  assert.match(yolo.getAttribute("title"), /AGPL-3\.0/, "the license implication is surfaced in the tooltip");
  assert.match(yolo.getAttribute("title"), /2-6 s\/frame/, "the measured per-frame cost is surfaced");
  assert.match(yolo.getAttribute("title"), /Unavailable: onnx-runtime-web-not-loaded/, "the specific unavailable reason is surfaced");
});

test("a stored experimental racket preference hydrates, and an unknown id falls back to the production default", async () => {
  const stored = await createPopupSession({ storedRacketModel: "yolo-world-racket-detector-v1" });
  const select = stored.app.querySelector("[data-bso-racket-model-selector]");
  assert.equal(select.value, "yolo-world-racket-detector-v1", "a valid stored experimental preference is preserved at hydration");
  const unknown = await createPopupSession({ storedRacketModel: "some-retired-model-id" });
  const unknownSelect = unknown.app.querySelector("[data-bso-racket-model-selector]");
  assert.equal(unknownSelect.value, "efficientdet-lite0-racket-v1", "an unknown stored id falls back to the production default");
  const nested = await createPopupSession({ nestedRacketModel: "some-retired-model-id" });
  const nestedSelect = nested.app.querySelector("[data-bso-racket-model-selector]");
  assert.equal(nestedSelect.value, "efficientdet-lite0-racket-v1", "an unknown nested bvState id falls back too");
});

test("a failed racket model switch keeps the cause in the tooltip with a concise standing line", async () => {
  const racketReport = {
    ok: true,
    currentModel: "efficientdet-lite0-racket-v1",
    models: [
      { id: "efficientdet-lite0-racket-v1", label: "EfficientDet-Lite0 (Production)", available: true, reason: "", current: true, experimental: false },
      { id: "yolo-world-racket-detector-v1", label: "YOLO-World Open-Vocabulary (Experimental)", available: true, reason: "", current: false, experimental: true }
    ]
  };
  const popup = await createPopupSession({ racketReport, racketModelSwitchReason: "the prepared artifact probe could not reach the local ONNX file (404)." });
  const select = popup.app.querySelector("[data-bso-racket-model-selector]");
  select.value = "yolo-world-racket-detector-v1";
  select.dispatchEvent({ type: "change" });
  const bodies = popup.app.querySelectorAll(".bv-model-section-body");
  const racketBody = bodies.find((body) => body.querySelector("[data-bso-racket-model-selector]"));
  assert.ok(racketBody, "the racket model section body is present");
  const compact = racketBody.querySelector("[data-bso-callout-compact]");
  assert.ok(compact, "the failure renders a compact callout in the racket model section");
  assert.ok(compact.className.includes("bv-callout warn"));
  const title = compact.querySelector("strong");
  assert.ok(title && title.children[0].textContent.includes("Racket model not switched"));
  const body = compact.querySelector(".bv-callout-body");
  const standing = body.children[0].textContent;
  const tipId = body.getAttribute("aria-describedby");
  const full = compact.querySelector(`[id="${tipId}"]`).children[0].textContent;
  assert.equal(standing, "The selected racket model could not start here.");
  assert.ok(!standing.includes("prepared artifact probe"), "standing line stays concise without the dynamic cause");
  assert.ok(full.startsWith(standing), "tooltip carries the full body starting at the standing line");
  assert.ok(full.includes("prepared artifact probe could not reach the local ONNX file (404)."), "tooltip carries the full cause");
  assert.ok(full.includes("The previous model remains active."), "tooltip keeps the previous-model note");
  const reverted = popup.app.querySelector("[data-bso-racket-model-selector]");
  assert.equal(reverted.value, "efficientdet-lite0-racket-v1", "the selector reverts to the previous model");
  const switches = popup.runtimeMessages.filter((message) => message.action === "switchRacketModel");
  assert.equal(switches.length, 1);
  assert.equal(switches[0].modelId, "yolo-world-racket-detector-v1", "the user's selection is what reached the offscreen analyzer");
});
