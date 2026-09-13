/* global globalThis, BSOProtocol, BSOSynchronization, BSOCapabilities, BSOFrameTransport, BSOCapture, BSOVideoDiscovery */
(function installRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSORuntime = api;
}(typeof globalThis === 'object' ? globalThis : self, function runtimeFactory() {
  'use strict';

  class RuntimeBridge {
    constructor({
      chromeApi = globalThis.chrome,
      onMessage = () => {},
      onStatus = () => {},
      supportsTransferList = true
    } = {}) {
      this.chrome = chromeApi;
      this.onMessage = onMessage;
      this.onStatus = onStatus;
      this.supportsTransferList = supportsTransferList;
      this.transferFallbackReported = false;
      this.port = null;
      this.sessionId = null;
    }

    start(sessionId, capabilities) {
      this.sessionId = sessionId;
      this.transferFallbackReported = false;
      if (!this.chrome || !this.chrome.runtime || typeof this.chrome.runtime.connect !== 'function') {
        this.onStatus({ type: 'bridge-unavailable', reason: 'runtime-connect-unavailable' });
        return false;
      }
      try {
        this.port = this.chrome.runtime.connect({ name: 'bso-runtime-v1' });
        if (this.port.onMessage && this.port.onMessage.addListener) this.port.onMessage.addListener((message) => this.onMessage(message));
        if (this.port.onDisconnect && this.port.onDisconnect.addListener) {
          this.port.onDisconnect.addListener(() => {
            this.onStatus({ type: 'bridge-disconnected', reason: 'service-worker-disconnected' });
          });
        }
        this.post(BSOProtocol.createSessionStart({
          sessionId,
          pageUrl: typeof location === 'object' ? location.href : '',
          capabilities
        }));
        return true;
      } catch (error) {
        this.port = null;
        this.onStatus({ type: 'bridge-unavailable', reason: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }

    post(message, transferables = []) {
      if (!this.port || typeof this.port.postMessage !== 'function') {
        this.onStatus({ type: 'bridge-unavailable', reason: 'runtime-port-not-connected' });
        return false;
      }
      try {
        // Runtime ports do not provide a transferable-list contract that is
        // safe to assume on stable Chrome. The selected frame transport sends
        // plain RGBA data there; an explicitly structured-clone-capable
        // channel may still use the ImageBitmap branch.
        if (!transferables.length || this.supportsTransferList) {
          this.port.postMessage(message, transferables);
        } else {
          this.port.postMessage(message);
          if (!this.transferFallbackReported) {
            this.transferFallbackReported = true;
            this.onStatus({ type: 'frame-transport-fallback', reason: 'mv3-runtime-port-uses-structured-clone' });
          }
        }
        return true;
      } catch (error) {
        if (transferables.length) {
          try {
            this.port.postMessage(message);
            this.onStatus({ type: 'frame-transport-fallback', reason: error instanceof Error ? error.message : String(error) });
            return true;
          } catch (_) {
            // Fall through to the explicit transport error below.
          }
        }
        this.onStatus({ type: 'frame-transport-error', reason: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }

    sendFrameSample(message, transferables) {
      if (!BSOProtocol.isFrameSample(message) || message.sessionId !== this.sessionId) {
        this.onStatus({ type: 'frame-rejected', reason: 'invalid-frame-sample' });
        return false;
      }
      return this.post(message, transferables);
    }

    end(reason = 'detached') {
      if (this.port && this.sessionId) {
        this.post(BSOProtocol.createSessionEnd({ sessionId: this.sessionId, reason }));
        if (typeof this.port.disconnect === 'function') this.port.disconnect();
      }
      this.port = null;
      this.sessionId = null;
    }
  }

  class RuntimeController {
    constructor({
      documentRef = globalThis.document,
      windowRef = globalThis.window,
      chromeApi = globalThis.chrome,
      // The design-system content UI owns the visible overlay. Keeping this
      // boundary null by default prevents the retired plain-text status layer
      // from appearing when a controller is constructed directly.
      overlay = null,
      bridge = null,
      onRuntimeMessage = () => {},
      onRuntimeStatus = () => {},
      onRuntimeView = () => {},
      onSessionReset = () => {}
    } = {}) {
      this.document = documentRef;
      this.window = windowRef;
      this.chrome = chromeApi;
      this.overlay = overlay;
      this.onRuntimeMessage = onRuntimeMessage;
      this.onRuntimeStatus = onRuntimeStatus;
      this.onRuntimeView = onRuntimeView;
      this.onSessionReset = onSessionReset;
      this.bridge = bridge || new RuntimeBridge({
        chromeApi,
        // Stable Chrome receives the serializable RGBA frame selected by the
        // content runtime. This bridge still accepts the ImageBitmap branch
        // for an explicitly structured-clone-capable channel.
        supportsTransferList: false,
        onMessage: (message) => this.handleMessage(message),
        onStatus: (status) => this.handleBridgeStatus(status)
      });
      this.discovery = null;
      this.video = null;
      this.capture = null;
      this.rateListener = null;
      this.pauseListener = null;
      this.playListener = null;
      this.visibilityListener = null;
      this.pagehideListener = null;
      this.metadataListener = null;
      this.sessionId = null;
      this.capabilities = null;
      this.synchronizer = null;
      this.lastMediaTime = null;
      this.paused = false;
      this.pageHidden = false;
    }

    start() {
      this.discovery = new BSOVideoDiscovery.VideoDiscovery({
        documentRef: this.document,
        windowRef: this.window,
        onVideo: (video, reason) => this.setVideo(video, reason),
        onNavigation: ({ reason }) => this.handleNavigation(reason)
      });
      this.discovery.start();
    }

    stop() {
      if (this.discovery) this.discovery.stop();
      this.discovery = null;
      this.setVideo(null, 'runtime-stopped');
    }

    handleNavigation(reason) {
      if (this.synchronizer) this.synchronizer.reset(this.sessionId, reason);
      this.lastMediaTime = null;
      this.onSessionReset(reason || 'navigation');
      if (this.overlay) this.overlay.setStatus('Navigating', 'waiting for video');
    }

    setVideo(video, reason = 'video-change') {
      if (video === this.video) return;
      this.detachVideo(reason);
      if (!video) {
        if (this.overlay) this.overlay.setStatus('Waiting', 'YouTube video unavailable');
        return;
      }
      const initiallyPaused = Boolean(video.paused);
      const initiallyHidden = Boolean(this.document && typeof this.document.visibilityState === 'string'
        && this.document.visibilityState !== 'visible');
      this.video = video;
      this.paused = false;
      this.pageHidden = false;
      this.sessionId = this.newSessionId();
      this.synchronizer = new BSOSynchronization.MediaTimestampSynchronizer({
        sessionId: this.sessionId,
        onDisplay: (view) => this.renderSynchronized(view),
        onStatus: (status) => this.handleSynchronizerStatus(status)
      });
      if (this.overlay) {
        this.overlay.attach(video);
        this.overlay.setStatus('Starting', 'local runtime');
      }
      this.rateListener = () => {
        // Read playbackRate for honest status only. Playback properties are
        // never assigned by this runtime.
        const rate = Number.isFinite(video.playbackRate) ? video.playbackRate : null;
        this.handleMediaTime(video.currentTime, { reason: 'ratechange', playbackRate: rate });
        if (this.overlay) this.overlay.setStatus('Watching', rate === null ? 'playback rate changed' : `rate ${rate}x`);
      };
      this.pauseListener = () => this.handlePause(video);
      this.playListener = () => this.handlePlay(video);
      this.visibilityListener = () => {
        if (this.document && this.document.visibilityState !== 'visible') this.handlePause(video, 'hidden');
        else this.handlePlay(video);
      };
      this.pagehideListener = () => this.handlePause(video, 'pagehide');
      this.metadataListener = () => this.overlay && this.overlay.refresh();
      video.addEventListener('ratechange', this.rateListener);
      video.addEventListener('pause', this.pauseListener);
      video.addEventListener('play', this.playListener);
      video.addEventListener('loadedmetadata', this.metadataListener);
      if (this.document && typeof this.document.addEventListener === 'function') {
        this.document.addEventListener('visibilitychange', this.visibilityListener);
      }
      if (this.window && typeof this.window.addEventListener === 'function') {
        this.window.addEventListener('pagehide', this.pagehideListener);
      }
      const captureCapability = BSOCapabilities.detectCapture(video, globalThis);
      const offscreenAvailable = Boolean(this.chrome && this.chrome.offscreen && typeof this.chrome.offscreen.createDocument === 'function');
      const frameTransport = BSOFrameTransport && typeof BSOFrameTransport.selectTransport === 'function'
        ? BSOFrameTransport.selectTransport(this.chrome)
        : 'image-bitmap';
      const capabilities = {
        capture: captureCapability.mode,
        // Stable Chrome uses the serializable RGBA fallback unless the
        // manifest explicitly opts into structured-clone messaging on a
        // channel that supports it. ImageBitmap remains the capture source in
        // both paths; only the message payload changes.
        transferableFrames: frameTransport === 'image-bitmap' && (typeof globalThis.ImageBitmap === 'function' || typeof globalThis.VideoFrame === 'function'),
        frameTransport,
        offscreen: offscreenAvailable,
        inference: false,
        analyzer: 'pending',
        transport: 'mv3-runtime-messaging'
      };
      this.capabilities = capabilities;
      this.bridge.start(this.sessionId, capabilities);
      this.capture = new BSOCapture.VideoCapture({
        video,
        sessionId: this.sessionId,
        sendSample: (message, transferables) => this.bridge.sendFrameSample(message, transferables),
        onMediaTime: (mediaTime, metadata) => this.handleMediaTime(mediaTime, metadata),
        onStatus: (status) => this.handleCaptureStatus(status),
        environment: globalThis,
        frameTransport,
        prepareFrame: BSOFrameTransport && typeof BSOFrameTransport.prepareFrame === 'function'
          ? (frame) => BSOFrameTransport.prepareFrame(frame, { mode: frameTransport, environment: globalThis })
          : null
      });
      if (initiallyPaused) this.handlePause(video, 'paused');
      else if (initiallyHidden) this.handlePause(video, 'hidden');
      else this.capture.start();
      if (reason === 'video-replaced') this.handleNavigation('video-replaced');
    }

    detachVideo(reason) {
      if (!this.video) return;
      if (this.capture) this.capture.stop();
      this.capture = null;
      if (this.rateListener) this.video.removeEventListener('ratechange', this.rateListener);
      if (this.pauseListener) this.video.removeEventListener('pause', this.pauseListener);
      if (this.playListener) this.video.removeEventListener('play', this.playListener);
      if (this.metadataListener) this.video.removeEventListener('loadedmetadata', this.metadataListener);
      if (this.visibilityListener && this.document && typeof this.document.removeEventListener === 'function') {
        this.document.removeEventListener('visibilitychange', this.visibilityListener);
      }
      if (this.pagehideListener && this.window && typeof this.window.removeEventListener === 'function') {
        this.window.removeEventListener('pagehide', this.pagehideListener);
      }
      this.rateListener = null;
      this.pauseListener = null;
      this.playListener = null;
      this.visibilityListener = null;
      this.pagehideListener = null;
      this.metadataListener = null;
      this.bridge.end(reason);
      this.video = null;
      this.sessionId = null;
      this.capabilities = null;
      this.synchronizer = null;
      this.lastMediaTime = null;
      this.paused = false;
      this.pageHidden = false;
      this.onSessionReset(reason || 'video-detached');
      if (this.overlay) this.overlay.detach();
    }

    handlePause(video = this.video, reason = 'paused') {
      if (!video || video !== this.video) return;
      if (reason === 'pagehide') this.pageHidden = true;
      if (this.paused) return;
      this.paused = true;
      if (this.capture) this.capture.stop();
      this.bridge.end(reason);
      this.sessionId = this.newSessionId();
      if (this.synchronizer) this.synchronizer.reset(this.sessionId, reason);
      this.lastMediaTime = null;
      this.onSessionReset(reason);
      const view = { result: null, ageSeconds: null, stale: true, reason };
      if (this.overlay) {
        this.overlay.setSynchronizedView(view, null);
        this.overlay.setStatus('Paused', 'waiting for playback');
      }
      this.onRuntimeView(view, null);
    }

    handlePlay(video = this.video) {
      if (!video || video !== this.video || this.pageHidden) return;
      if (this.document && typeof this.document.visibilityState === 'string'
        && this.document.visibilityState !== 'visible') return;
      if (video.paused) return;
      this.paused = false;
      this.bridge.start(this.sessionId, this.capabilities || {});
      if (this.capture) this.capture.sessionId = this.sessionId;
      if (this.capture) this.capture.start();
      if (this.overlay) this.overlay.setStatus('Watching', 'playback resumed');
    }

    handleMediaTime(mediaTime, metadata = {}) {
      if (!this.synchronizer || !Number.isFinite(mediaTime) || mediaTime < 0) return;
      this.lastMediaTime = mediaTime;
      const view = this.synchronizer.update(mediaTime);
      if (this.overlay) this.overlay.setSynchronizedView(view, mediaTime);
      this.onRuntimeView(view, mediaTime);
      if (metadata.reason === 'ratechange' && this.overlay) this.overlay.setStatus('Watching', `rate ${metadata.playbackRate}x`);
      return view;
    }

    handleMessage(message) {
      if (!message || message.sessionId !== this.sessionId) return;
      if (this.paused) return;
      if (BSOProtocol.isAnalyzerResult(message)) {
        let view = null;
        if (this.synchronizer) {
          this.synchronizer.ingest(message);
          if (this.lastMediaTime !== null) view = this.handleMediaTime(this.lastMediaTime);
        }
        // Do not bypass media-time selection before the first captured frame.
        // A result may arrive ahead of the clock; the synchronizer must hold it
        // until playback reaches its timestamp rather than exposing a future
        // pose to the UI. Direct seam consumers without a controller still
        // retain their compatibility path in src/runtime.js.
        if (!this.synchronizer || view) this.onRuntimeMessage(message, view, this.lastMediaTime);
        return;
      }
      if (BSOProtocol.isCapabilityReport(message)) {
        this.applyCapabilities(message.capabilities, message.fallbacks, message.reason);
        this.onRuntimeMessage(message);
        return;
      }
      if (message.type === BSOProtocol.TYPES.RUNTIME_STATUS) {
        this.applyCapabilities(message.capabilities || {}, [], message.reason || message.message);
        if (this.overlay && message.message) this.overlay.setStatus(message.phase || 'Runtime', message.message);
        this.onRuntimeMessage(message);
      }
    }

    applyCapabilities(capabilities, fallbacks = [], reason = '') {
      const analyzer = capabilities.analyzer || 'none';
      const label = analyzer === 'fixture-probe-v1'
        ? 'runtime integration probe (not production CV)'
        : (capabilities.inference ? analyzer : 'local analyzer unavailable');
      const fallback = fallbacks.length ? ` · ${fallbacks.join(', ')}` : '';
      if (this.overlay) this.overlay.setStatus(capabilities.inference ? 'Ready' : 'Fallback', `${label}${fallback}${reason ? ` · ${reason}` : ''}`);
    }

    handleBridgeStatus(status) {
      this.onRuntimeStatus(status);
      if (!this.overlay) return;
      const messages = {
        'bridge-unavailable': 'offscreen bridge unavailable',
        'bridge-disconnected': 'runtime disconnected',
        'frame-transport-error': 'frame transfer unavailable',
        'frame-transport-fallback': 'ImageBitmap copied by MV3 structured-clone transport',
        'frame-rejected': 'frame sample rejected'
      };
      this.overlay.setStatus('Fallback', messages[status.type] || status.reason || 'runtime fallback');
    }

    handleCaptureStatus(status) {
      this.onRuntimeStatus(status);
      if (!this.overlay) return;
      if (status.type === 'capture-capability') {
        const label = status.mode === 'request-video-frame-callback' ? 'frame callback capture' : status.mode;
        const transport = status.frameTransport ? ` · ${status.frameTransport}` : '';
        this.overlay.setStatus(status.mode === 'unavailable' ? 'Fallback' : 'Starting', label + transport);
      } else if (status.type === 'capture-error') {
        this.overlay.setStatus('Fallback', status.message);
      }
    }

    handleSynchronizerStatus(status) {
      this.onRuntimeStatus(status);
      if (!this.overlay) return;
      if (status.status === 'timeline-reset') this.overlay.setStatus('Resyncing', 'media timeline changed');
    }

    renderSynchronized(view) {
      if (this.overlay && this.lastMediaTime !== null) this.overlay.setSynchronizedView(view, this.lastMediaTime);
    }

    newSessionId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
      return `video-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  return Object.freeze({ RuntimeBridge, RuntimeController });
}));
