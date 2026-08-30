/* global chrome, BSOProtocol */
'use strict';

importScripts('../common/protocol.js');

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const sessions = new Map();
const sessionSetup = new Map();
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
          justification: 'Run local mock analysis outside the YouTube page UI thread.'
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

function unavailable(port, sessionId, reason) {
  send(port, BSOProtocol.createCapabilityReport({
    sessionId,
    capture: 'unavailable',
    transferableFrames: false,
    offscreen: false,
    inference: false,
    analyzer: 'none',
    fallbacks: ['offscreen-document-unavailable', 'mock-result-unavailable'],
    reason
  }));
  send(port, BSOProtocol.createRuntimeStatus({
    sessionId,
    phase: 'fallback',
    message: 'Local analysis unavailable; playback is unaffected.',
    capabilities: { offscreen: false, inference: false, analyzer: 'none' },
    reason
  }));
}

async function forwardToOffscreen(message, port) {
  const ready = await ensureOffscreenDocument();
  if (!ready) {
    unavailable(port, message.sessionId, 'offscreen-document-unavailable');
    return false;
  }
  try {
    // Frame metadata and the transferable frame object follow the documented
    // protocol. Chrome runtime ports perform the extension relay; transports
    // with transfer-list support preserve the ImageBitmap without a copy.
    await chrome.runtime.sendMessage(message);
    return true;
  } catch (error) {
    unavailable(port, message.sessionId, error instanceof Error ? error.message : String(error));
    return false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'bso-runtime-v1') return;
  let sessionId = null;
  port.onMessage.addListener((message) => {
    if (!BSOProtocol.isRuntimeMessage(message)) return;
    if (message.type === BSOProtocol.TYPES.SESSION_START) {
      sessionId = message.sessionId;
      sessions.set(sessionId, port);
      const setup = ensureOffscreenDocument().then(async (ready) => {
        if (!ready) {
          unavailable(port, sessionId, 'offscreen-document-unavailable');
          return false;
        }
        send(port, BSOProtocol.createRuntimeStatus({
          sessionId,
          phase: 'ready',
          message: 'Offscreen boundary ready; mock analyzer active.',
          capabilities: { offscreen: true, inference: false, analyzer: 'mock' }
        }));
        try {
          // Complete session setup before a frame can be analyzed. This keeps
          // the offscreen session set ahead of the first frame sample.
          await chrome.runtime.sendMessage(message);
          return true;
        } catch (error) {
          unavailable(port, sessionId, error instanceof Error ? error.message : String(error));
          return false;
        }
      });
      sessionSetup.set(sessionId, setup);
      return;
    }
    if (message.sessionId !== sessionId) return;
    if (message.type === BSOProtocol.TYPES.FRAME_SAMPLE) {
      if (!BSOProtocol.isFrameSample(message)) {
        send(port, BSOProtocol.createRuntimeStatus({
          sessionId,
          phase: 'fallback',
          message: 'Invalid frame sample; sample discarded.',
          reason: 'message-contract-rejected'
        }));
        return;
      }
      const setup = sessionSetup.get(sessionId) || Promise.resolve(true);
      setup.then((ready) => ready && forwardToOffscreen(message, port)).catch(() => undefined);
      return;
    }
    if (message.type === BSOProtocol.TYPES.SESSION_END) {
      const setup = sessionSetup.get(sessionId) || Promise.resolve(true);
      sessions.delete(sessionId);
      setup.then((ready) => ready && forwardToOffscreen(message, port)).catch(() => undefined);
      sessionSetup.delete(sessionId);
    }
  });
  port.onDisconnect.addListener(() => {
    if (sessionId && sessions.get(sessionId) === port) {
      sessions.delete(sessionId);
      sessionSetup.delete(sessionId);
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!BSOProtocol.isRuntimeMessage(message)) return false;
  if (message.type !== BSOProtocol.TYPES.ANALYZER_RESULT &&
      message.type !== BSOProtocol.TYPES.CAPABILITY_REPORT &&
      message.type !== BSOProtocol.TYPES.RUNTIME_STATUS) return false;
  const port = sessions.get(message.sessionId);
  if (port) send(port, message);
  return false;
});
