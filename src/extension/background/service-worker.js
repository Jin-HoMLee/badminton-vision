/* global chrome, BSOProtocol */
'use strict';

importScripts('../common/protocol.js');

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const sessions = new Map();
const sessionQueues = new Map();
let offscreenReady = null;
let offscreenFailureReason = '';

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
    })().then((ready) => {
      if (ready) offscreenFailureReason = '';
      return ready;
    }).catch((error) => {
      offscreenFailureReason = error instanceof Error ? error.message : String(error);
      // Allow a later session to retry after an offscreen startup failure.
      offscreenReady = null;
      return false;
    });
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
  // A frame can arrive while offscreen startup is pending. Do not leave that
  // coalesced bitmap or a session-end waiter stranded when startup fails.
  if (state.pendingFrame) {
    closeFrame(state.pendingFrame);
    state.pendingFrame = null;
  }
  settleFrameWaiters(state);
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

function closeFrame(message) {
  if (message?.frame && typeof message.frame.close === 'function') message.frame.close();
}

function settleFrameWaiters(state) {
  if (state.frameBusy || state.pendingFrame) return;
  const waiters = state.frameWaiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

function waitForFrameRelays(state) {
  if (!state.frameBusy && !state.pendingFrame) return Promise.resolve();
  return new Promise((resolve) => state.frameWaiters.push(resolve));
}

function relayFrame(state, message) {
  // Do not race a frame ahead of the session-start message. The service worker
  // owns this gate because content can emit a sample while offscreen startup is
  // still awaiting createDocument; keep only the newest such sample.
  if (!state || !state.ready || state.starting) {
    if (state?.pendingFrame) closeFrame(state.pendingFrame);
    if (state) state.pendingFrame = message;
    else closeFrame(message);
    return;
  }
  if (state.frameBusy) {
    if (state.pendingFrame) closeFrame(state.pendingFrame);
    state.pendingFrame = message;
    return;
  }
  state.frameBusy = true;
  void forwardToOffscreen(state, message).finally(() => {
    state.frameBusy = false;
    if (state.pendingFrame && state.ready) {
      const next = state.pendingFrame;
      state.pendingFrame = null;
      relayFrame(state, next);
    } else {
      if (state.pendingFrame && !state.ready) {
        closeFrame(state.pendingFrame);
        state.pendingFrame = null;
      }
      settleFrameWaiters(state);
    }
  });
}

async function restartOffscreenDocument(state) {
  // Chrome may close the offscreen document at any time (idle, memory
  // pressure, crash). When the relay fails mid-session, recreate the document
  // once and re-establish the session before reporting a capability failure.
  try {
    if (chrome.offscreen && typeof chrome.offscreen.closeDocument === 'function') await chrome.offscreen.closeDocument();
  } catch (_) {
    // No document to close (already closed/crashed) is the expected path.
  }
  offscreenReady = null;
  const ready = await ensureOffscreenDocument();
  if (!ready) return { ok: false, reason: offscreenFailureReason || 'offscreen-document-restart-failed' };
  try {
    await chrome.runtime.sendMessage(BSOProtocol.createSessionStart({
      sessionId: state.sessionId,
      capabilities: state.capabilities || {},
      pageUrl: state.pageUrl || ''
    }));
    return { ok: true, reason: '' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function forwardToOffscreen(state, message, { allowRestart = true } = {}) {
  if (!state || !state.ready) return false;
  try {
    // chrome.runtime messaging is the MV3 service-worker/offscreen relay.
    // Stable Chrome receives a plain RGBA frame; an explicitly
    // structured-clone-capable channel may carry an ImageBitmap. Errors are
    // surfaced instead of claiming CV.
    await chrome.runtime.sendMessage(message);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A closed/restarted offscreen document makes the relay fail while the
    // session is still live. Recreate it once and retry; only report the
    // fallback state when recreation itself fails.
    if (allowRestart) {
      const restarted = await restartOffscreenDocument(state);
      if (restarted.ok) return forwardToOffscreen(state, message, { allowRestart: false });
      offscreenReady = null;
      unavailable(state, restarted.reason || reason);
      state.ready = false;
      return false;
    }
    offscreenReady = null;
    unavailable(state, reason);
    state.ready = false;
    return false;
  }
}

function setupSession(state, message) {
  return enqueue(state.sessionId, async () => {
    const ready = await ensureOffscreenDocument();
    if (!ready) {
      state.starting = false;
      unavailable(state, offscreenFailureReason || 'offscreen-document-unavailable');
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
    // Complete session setup before a frame can be analyzed. Frames that
    // arrived during startup are coalesced into one newest pending sample.
    await forwardToOffscreen(state, message);
    state.starting = false;
    if (state.pendingFrame && state.ready) {
      const pending = state.pendingFrame;
      state.pendingFrame = null;
      relayFrame(state, pending);
    } else if (state.pendingFrame) {
      closeFrame(state.pendingFrame);
      state.pendingFrame = null;
    }
    return true;
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
        starting: true,
        fallbackReported: false,
        endRequested: false,
        disconnectCleanupQueued: false,
        frameBusy: false,
        pendingFrame: null,
        frameWaiters: []
      };
      sessions.set(sessionId, state);
      setupSession(state, message).catch((error) => {
        state.starting = false;
        unavailable(state, String(error));
      });
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
      // The offscreen scheduler has the same one-active/one-pending contract;
      // coalesce here too so a slow relay cannot build an unbounded worker
      // promise chain before the message reaches it.
      relayFrame(state, message);
      return;
    }
    if (message.type === BSOProtocol.TYPES.SESSION_END) {
      state.endRequested = true;
      // Queue end behind all pending frame relays. Keep a ready session until
      // offscreen acknowledges the end, so in-flight results can return.
      enqueue(sessionId, async () => {
        await waitForFrameRelays(state);
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
    const state = sessionId && sessions.get(sessionId);
    if (!state || state.port !== port || state.disconnectCleanupQueued || state.endRequested) return;
    // Navigation can disconnect the content port immediately after posting a
    // frame. Send an explicit end marker behind relays so offscreen analyzers
    // reset trackers and release per-session state even when no result can be
    // delivered back to the page.
    state.disconnectCleanupQueued = true;
    if (state.pendingFrame) {
      closeFrame(state.pendingFrame);
      state.pendingFrame = null;
    }
    enqueue(sessionId, async () => {
      await waitForFrameRelays(state);
      if (state.ready) await forwardToOffscreen(state, BSOProtocol.createSessionEnd({ sessionId, reason: 'content-disconnected' }));
      sessions.delete(sessionId);
      sessionQueues.delete(sessionId);
    }).catch(() => {
      sessions.delete(sessionId);
      sessionQueues.delete(sessionId);
    });
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

// Hough detection messages from content script need the offscreen document created first.
// Content scripts cannot call chrome.offscreen.createDocument(), so the service worker
// must ensure it exists before relaying Hough detection frames to the offscreen document.
// IMPORTANT: Use a distinct relay action name to avoid listener collision. Both service-worker
// and offscreen register listeners, but MV3 broadcasts to all matching listeners. We must
// distinguish the relayed message so only the offscreen document processes it, not both.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'detectHoughLines') {
    (async () => {
      try {
        const ready = await ensureOffscreenDocument();
        if (!ready) {
          sendResponse({ ok: false, error: 'Offscreen document unavailable: ' + (offscreenFailureReason || 'unknown') });
          return;
        }
        // Relay the Hough detection request to the offscreen document with a distinct action name
        // to avoid both offscreen and service-worker listeners responding to the same message
        const relayMessage = { ...message, action: 'detectHoughLinesRelay' };
        const response = await chrome.runtime.sendMessage(relayMessage);
        sendResponse(response || { ok: false, error: 'No response from offscreen' });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true; // Keep the channel open for async sendResponse
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
