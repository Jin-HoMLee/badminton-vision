/* global chrome, BSOProtocol */
'use strict';

importScripts('../common/protocol.js');

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const sessions = new Map();
const sessionQueues = new Map();
let offscreenReady = null;

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    return contexts.length > 0;
  } catch (_) {
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') return false;
  if (!offscreenReady) {
    offscreenReady = (async () => {
      if (await hasOffscreenDocument()) return true;
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['WORKERS'],
          justification: 'Run a local deterministic runtime integration probe outside the YouTube page UI thread.'
        });
        return true;
      } catch (error) {
        // A concurrent session may have created it between the query and the
        // create call. Verify before reporting a real capability failure.
        if (await hasOffscreenDocument()) return true;
        throw error;
      }
    })().catch(() => false);
  }
  return offscreenReady;
}

function send(port, message) {
  try {
    port.postMessage(message);
  } catch (_) {
    // A disconnected content port is expected during SPA navigation.
  }
}

function stateCapabilities(state, overrides = {}) {
  const capture = state?.capabilities?.capture || 'unknown';
  const captureAvailable = capture !== 'unavailable';
  return {
    capture,
    transferableFrames: Boolean(state?.capabilities?.transferableFrames),
    offscreen: Boolean(overrides.offscreen ?? state?.ready),
    inference: Boolean(overrides.inference ?? (state?.ready && captureAvailable)),
    analyzer: overrides.analyzer || (state?.ready ? 'pending' : 'none'),
    transport: 'mv3-runtime-messaging',
    frameTransport: state?.capabilities?.frameTransport || 'unknown'
  };
}

function unavailable(state, reason) {
  if (!state || state.fallbackReported) return;
  state.fallbackReported = true;
  send(state.port, BSOProtocol.createCapabilityReport({
    sessionId: state.sessionId,
    capture: state.capabilities?.capture || 'unknown',
    transferableFrames: Boolean(state.capabilities?.transferableFrames),
    offscreen: false,
    inference: false,
    analyzer: 'none',
    frameTransport: state?.capabilities?.frameTransport || 'unknown',
    fallbacks: ['offscreen-document-unavailable'],
    reason
  }));
  send(state.port, BSOProtocol.createRuntimeStatus({
    sessionId: state.sessionId,
    phase: 'fallback',
    message: 'Local analysis unavailable; playback is unaffected.',
    capabilities: stateCapabilities(state, { offscreen: false, inference: false, analyzer: 'none' }),
    reason
  }));
}

function enqueue(sessionId, task) {
  const previous = sessionQueues.get(sessionId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  sessionQueues.set(sessionId, next);
  return next;
}

async function forwardToOffscreen(state, message) {
  if (!state || !state.ready) return false;
  try {
    // chrome.runtime messaging is the MV3 service-worker/offscreen relay.
    // Stable Chrome receives a plain RGBA frame; an explicitly
    // structured-clone-capable channel may carry an ImageBitmap. Errors are
    // surfaced instead of claiming CV.
    await chrome.runtime.sendMessage(message);
    return true;
  } catch (error) {
    // Allow a later session to recreate the document after a transient
    // offscreen crash or a structured-clone transport failure.
    offscreenReady = null;
    unavailable(state, error instanceof Error ? error.message : String(error));
    state.ready = false;
    return false;
  }
}

function setupSession(state, message) {
  return enqueue(state.sessionId, async () => {
    const ready = await ensureOffscreenDocument();
    if (!ready) {
      unavailable(state, 'offscreen-document-unavailable');
      return false;
    }
    state.ready = true;
    send(state.port, BSOProtocol.createRuntimeStatus({
      sessionId: state.sessionId,
      phase: 'ready',
      message: 'Offscreen boundary ready; local analyzer initializing.',
      capabilities: stateCapabilities(state, { offscreen: true, analyzer: 'pending', inference: false }),
      reason: 'offscreen-runtime'
    }));
    // Complete session setup before a frame can be analyzed. The per-session
    // queue also preserves start -> frames -> end ordering across navigation.
    return forwardToOffscreen(state, message);
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'bso-runtime-v1') return;
  let sessionId = null;
  port.onMessage.addListener((message) => {
    if (!BSOProtocol.isRuntimeMessage(message)) return;
    if (message.type === BSOProtocol.TYPES.SESSION_START) {
      sessionId = message.sessionId;
      const state = {
        sessionId,
        port,
        capabilities: message.capabilities || {},
        ready: false,
        fallbackReported: false
      };
      sessions.set(sessionId, state);
      setupSession(state, message).catch((error) => unavailable(state, String(error)));
      return;
    }
    const state = sessions.get(sessionId);
    if (!state || message.sessionId !== sessionId) return;
    if (message.type === BSOProtocol.TYPES.FRAME_SAMPLE) {
      if (!BSOProtocol.isFrameSample(message)) {
        send(port, BSOProtocol.createRuntimeStatus({
          sessionId,
          phase: 'fallback',
          message: 'Invalid frame sample; sample discarded.',
          capabilities: stateCapabilities(state, { inference: false }),
          reason: 'message-contract-rejected'
        }));
        return;
      }
      enqueue(sessionId, () => forwardToOffscreen(state, message)).catch((error) => unavailable(state, String(error)));
      return;
    }
    if (message.type === BSOProtocol.TYPES.SESSION_END) {
      // Queue end behind all pending frame relays. Keep a ready session until
      // offscreen acknowledges the end, so in-flight results can return.
      enqueue(sessionId, async () => {
        if (state.ready) await forwardToOffscreen(state, message);
        if (!state.ready) {
          sessions.delete(sessionId);
          sessionQueues.delete(sessionId);
        }
      }).catch(() => {
        sessions.delete(sessionId);
        sessionQueues.delete(sessionId);
      });
    }
  });
  port.onDisconnect.addListener(() => {
    if (sessionId && sessions.get(sessionId)?.port === port) {
      sessions.delete(sessionId);
      // The content page has gone away; queued frame work is allowed to finish
      // locally, but no result can be delivered to this disconnected port.
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!BSOProtocol.isRuntimeMessage(message)) return false;
  if (message.type !== BSOProtocol.TYPES.ANALYZER_RESULT &&
      message.type !== BSOProtocol.TYPES.CAPABILITY_REPORT &&
      message.type !== BSOProtocol.TYPES.RUNTIME_STATUS) return false;
  const state = sessions.get(message.sessionId);
  if (state) {
    send(state.port, message);
    if (message.type === BSOProtocol.TYPES.RUNTIME_STATUS && message.phase === 'ended') {
      // The offscreen acknowledgement is emitted after its queued frame work,
      // allowing the final analyzer result to reach the content port first.
      sessions.delete(message.sessionId);
      sessionQueues.delete(message.sessionId);
    }
  }
  return false;
});

// UI actions use this separate, deliberately small message surface. Runtime
// envelopes stay on the versioned port protocol; the popup can read the last
// sanitized capability snapshot without coupling itself to frame transport.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_SUMMARY') {
    const origin = sender?.tab?.url;
    const summary = chrome.runtime.getURL('summary.html');
    const url = origin ? `${summary}?from=${encodeURIComponent(origin)}` : summary;
    void chrome.tabs.create({ url });
    return false;
  }
  if (message?.type === 'GET_RUNTIME_STATUS') {
    if (!chrome.storage?.local) {
      sendResponse({ status: null });
      return false;
    }
    chrome.storage.local.get(['bvRuntimeStatus'], (result) => sendResponse({ status: result?.bvRuntimeStatus || null }));
    return true;
  }
  return false;
});
