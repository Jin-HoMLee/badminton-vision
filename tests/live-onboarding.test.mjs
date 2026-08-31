import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

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
    this.documentElement = new FakeNode("html");
    this.body = new FakeNode("body");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName) { return new FakeNode(tagName); }
  createElementNS(_namespace, tagName) { return new FakeNode(tagName); }
  createTextNode(text) { const node = new FakeNode("#text", 3); node.textContent = String(text); return node; }
  getElementById(id) {
    return this.querySelector(`[id="${id}"]`);
  }
}

async function createSession() {
  const documentRef = new FakeDocument();
  const video = new FakeNode("video");
  Object.assign(video, { currentTime: 12, paused: false, muted: false, playbackRate: 1, readyState: 4, videoWidth: 640, videoHeight: 360 });
  documentRef.body.appendChild(video);
  const retiredOverlay = new FakeNode("div");
  retiredOverlay.setAttribute("data-bso-runtime-overlay", "true");
  documentRef.body.appendChild(retiredOverlay);
  const storageReads = [];
  const storageWrites = [];
  let onMessage;
  let runtimeStarts = 0;
  const chromeApi = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: (_message, callback) => callback?.(),
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
    console,
    document: documentRef,
    window: null,
    chrome: chromeApi,
    location: { href: "https://www.youtube.com/watch?v=real-match" },
    URL,
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    crypto: { randomUUID: () => "test-session" }
  });
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  for (const file of ["src/state.js", "src/calibration.js", "src/seed-card.js", "src/fixtures.js", "src/review.js", "src/ui.js"]) {
    vm.runInContext(await readFile(file, "utf8"), context, { filename: file });
  }
  context.BVRuntime = {
    startIntegratedRuntime: () => {
      runtimeStarts += 1;
      return { controller: { sessionId: "test-session" } };
    }
  };
  vm.runInContext(await readFile("src/content.js", "utf8"), context, { filename: "src/content.js" });

  return {
    documentRef,
    video,
    storageReads,
    storageWrites,
    get onMessage() { return onMessage; },
    get runtimeStarts() { return runtimeStarts; },
    flushStorage(value = { videoKey: "youtube:real-match", enabled: false, seeded: false }) {
      assert.equal(storageReads.length, 1);
      storageReads.shift()(value);
    },
    host() { return documentRef.querySelector("[data-badminton-vision]"); },
    overlayRoot() { return this.host().shadowRoot.querySelector(".bv-overlay-root"); }
  };
}

async function createPopupSession() {
  const documentRef = new FakeDocument();
  const app = new FakeNode("main");
  app.setAttribute("id", "app");
  documentRef.body.appendChild(app);
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const sent = [];
  let injection = null;
  let closed = false;
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
      get: (_keys, callback) => callback({ bvState: { videoKey: "youtube:real-match", enabled: false, seeded: false } }),
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
  return { app, sent, get injection() { return injection; }, get closed() { return closed; } };
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
  assert.ok(popup.injection.files.includes("content.js"));
  assert.equal(popup.injection.files.includes("content/overlay.js"), false, "the retired text overlay is not injected");
  assert.equal(popup.sent.length, 2);
  assert.equal(popup.sent[1].message.type, "ENABLE");
  assert.equal(popup.closed, true);
});
