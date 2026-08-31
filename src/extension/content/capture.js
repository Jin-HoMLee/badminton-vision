/* global globalThis, BSOProtocol, BSOCapabilities */
(function installCapture(root, factory) {
  const api = factory(root.BSOProtocol, root.BSOCapabilities);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOCapture = api;
}(typeof globalThis === 'object' ? globalThis : self, function captureFactory(protocol, capabilityApi) {
  'use strict';

  class VideoCapture {
    constructor({
      video,
      sessionId,
      sendSample = () => {},
      onMediaTime = () => {},
      onStatus = () => {},
      environment = globalThis,
      minWallIntervalMs = 250,
      minMediaIntervalSeconds = 0.1,
      fallbackIntervalMs = 250,
      maxInFlight = 1
    } = {}) {
      if (!video || !sessionId) throw new TypeError('video and sessionId are required');
      if (!Number.isInteger(maxInFlight) || maxInFlight < 1) throw new TypeError('maxInFlight must be a positive integer');
      this.video = video;
      this.sessionId = sessionId;
      this.sendSample = sendSample;
      this.onMediaTime = onMediaTime;
      this.onStatus = onStatus;
      this.environment = environment;
      this.minWallIntervalMs = minWallIntervalMs;
      this.minMediaIntervalSeconds = minMediaIntervalSeconds;
      this.fallbackIntervalMs = fallbackIntervalMs;
      this.maxInFlight = maxInFlight;
      this.active = false;
      this.mode = 'unavailable';
      this.callbackHandle = null;
      this.fallbackTimer = null;
      this.sampleNumber = 0;
      this.lastSampleWall = -Infinity;
      this.lastSampleMediaTime = -Infinity;
      this.inFlightCount = 0;
      this.inFlight = false;
      this.captureGeneration = 0;
      this.backpressureNotified = false;
    }

    start() {
      if (this.active) return;
      this.active = true;
      const capability = capabilityApi.detectCapture(this.video, this.environment);
      this.mode = capability.mode;
      this.onStatus({ type: 'capture-capability', mode: this.mode, fallback: capability.fallback });
      if (!capability.available) return;
      if (this.mode === 'request-video-frame-callback') {
        this.scheduleVideoFrameCallback();
      } else {
        this.scheduleFallbackCapture();
      }
    }

    stop() {
      this.active = false;
      this.captureGeneration += 1;
      if (this.fallbackTimer !== null) {
        const clear = this.environment.clearTimeout || clearTimeout;
        clear(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      // requestVideoFrameCallback has no cancellation API. The active/video
      // and generation checks in the callback make a queued callback harmless.
      this.callbackHandle = null;
      this.backpressureNotified = false;
    }

    scheduleVideoFrameCallback() {
      if (!this.active || this.mode !== 'request-video-frame-callback') return;
      const callback = (now, metadata) => this.handleVideoFrame(now, metadata);
      this.callbackHandle = this.video.requestVideoFrameCallback(callback);
    }

    handleVideoFrame(now, metadata = {}) {
      if (!this.active || this.mode !== 'request-video-frame-callback') return;
      const mediaTime = Number.isFinite(metadata.mediaTime)
        ? metadata.mediaTime
        : Number.isFinite(this.video.currentTime) ? this.video.currentTime : null;
      if (mediaTime !== null) {
        this.onMediaTime(mediaTime, { mode: this.mode, metadata });
        this.maybeCapture(mediaTime, Number.isFinite(now) ? now : Date.now(), metadata);
      }
      this.scheduleVideoFrameCallback();
    }

    scheduleFallbackCapture() {
      if (!this.active || this.mode !== 'timer-fallback') return;
      const schedule = this.environment.setTimeout || setTimeout;
      this.fallbackTimer = schedule(() => {
        this.fallbackTimer = null;
        const mediaTime = Number.isFinite(this.video.currentTime) ? this.video.currentTime : null;
        if (mediaTime !== null) {
          const now = Date.now();
          this.onMediaTime(mediaTime, { mode: this.mode, metadata: {} });
          this.maybeCapture(mediaTime, now, {});
        }
        this.scheduleFallbackCapture();
      }, this.fallbackIntervalMs);
    }

    maybeCapture(mediaTime, wallTime, metadata) {
      if (!this.active) return;
      if (this.inFlightCount >= this.maxInFlight) {
        if (!this.backpressureNotified) {
          this.backpressureNotified = true;
          this.onStatus({
            type: 'capture-status',
            status: 'backpressure',
            inFlight: this.inFlightCount,
            maxInFlight: this.maxInFlight,
            message: 'Frame sample held back while the local analyzer is busy'
          });
        }
        return;
      }
      if (mediaTime + 1e-4 < this.lastSampleMediaTime) {
        this.lastSampleMediaTime = -Infinity;
        this.lastSampleWall = -Infinity;
        this.onStatus({ type: 'capture-status', status: 'timeline-reset', mediaTime });
      }
      if (wallTime - this.lastSampleWall < this.minWallIntervalMs &&
          mediaTime - this.lastSampleMediaTime < this.minMediaIntervalSeconds) return;
      if (typeof this.environment.createImageBitmap !== 'function') return;
      const width = Number.isInteger(metadata.width) && metadata.width > 0
        ? metadata.width
        : this.video.videoWidth;
      const height = Number.isInteger(metadata.height) && metadata.height > 0
        ? metadata.height
        : this.video.videoHeight;
      if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        this.onStatus({ type: 'capture-error', message: 'Video dimensions are unavailable' });
        return;
      }
      this.inFlightCount += 1;
      this.inFlight = true;
      const generation = this.captureGeneration;
      Promise.resolve(this.environment.createImageBitmap(this.video)).then((frame) => {
        if (!this.active || generation !== this.captureGeneration || this.mode === 'unavailable') {
          if (frame && typeof frame.close === 'function') frame.close();
          return;
        }
        const requestId = `${this.sessionId}:${++this.sampleNumber}`;
        const sample = protocol.createFrameSample({
          sessionId: this.sessionId,
          requestId,
          mediaTime,
          // rVFC's `now` is monotonic; capturedAt is wall-clock metadata.
          capturedAt: Date.now(),
          width: Number.isInteger(frame.width) && frame.width > 0 ? frame.width : width,
          height: Number.isInteger(frame.height) && frame.height > 0 ? frame.height : height,
          frame,
          frameFormat: 'image-bitmap'
        });
        this.lastSampleWall = wallTime;
        this.lastSampleMediaTime = mediaTime;
        const delivered = this.sendSample(sample.message, sample.transferables);
        if (delivered === false && frame && typeof frame.close === 'function') frame.close();
        this.backpressureNotified = false;
      }).catch((error) => {
        this.onStatus({ type: 'capture-error', message: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.inFlight = this.inFlightCount > 0;
      });
    }
  }

  return Object.freeze({ VideoCapture });
}));
