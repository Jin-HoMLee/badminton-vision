/*
 * Read-only playback boundary.
 * This adapter intentionally has no methods that can pause, seek, mute, resize,
 * replace, or restyle a video. Inference can be attached through onFrame later.
 */
(function (root) {
  function snapshot(video) {
    if (!video) return null;
    return {
      mediaTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      paused: Boolean(video.paused),
      muted: Boolean(video.muted),
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
      readyState: video.readyState || 0,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1
    };
  }

  function clientRect(value) {
    value = value || {};
    return {
      left: Number(value.left) || 0,
      top: Number(value.top) || 0,
      width: Math.max(0, Number(value.width) || 0),
      height: Math.max(0, Number(value.height) || 0)
    };
  }

  function geometryNumber(value) {
    if (!Number.isFinite(value)) return 0;
    var rounded = Math.round(value * 1e9) / 1e9;
    return Math.abs(rounded) < 1e-9 ? 0 : rounded;
  }

  function objectPositionOffset(token, freeSpace, startKeyword, endKeyword) {
    token = String(token || "50%").toLowerCase();
    if (token === "center") return freeSpace / 2;
    if (token === startKeyword) return 0;
    if (token === endKeyword) return freeSpace;
    if (/^-?\d+(?:\.\d+)?%$/.test(token)) return freeSpace * Number(token.slice(0, -1)) / 100;
    if (/^-?\d+(?:\.\d+)?px$/.test(token)) return Number(token.slice(0, -2));
    return freeSpace / 2;
  }

  /**
   * Return the rectangle occupied by captured video pixels, not merely the
   * HTMLVideoElement box. YouTube may letterbox that box with object-fit while
   * switching theater/fullscreen layouts; normalized runtime coordinates must
   * stay attached to the rendered pixels through those changes.
   */
  function videoContentRect(video, windowRef) {
    if (!video || typeof video.getBoundingClientRect !== "function") return clientRect();
    windowRef = windowRef || root;
    var elementRect = clientRect(video.getBoundingClientRect());
    var intrinsicWidth = Number(video.videoWidth);
    var intrinsicHeight = Number(video.videoHeight);
    if (!elementRect.width || !elementRect.height || !Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0 || !Number.isFinite(intrinsicHeight) || intrinsicHeight <= 0) {
      return Object.assign({}, elementRect, { elementRect: elementRect, objectFit: "fill", clipped: false });
    }
    var style = windowRef && typeof windowRef.getComputedStyle === "function" ? windowRef.getComputedStyle(video) : null;
    var objectFit = String(style && style.objectFit || "fill").toLowerCase();
    var scaleX = elementRect.width / intrinsicWidth;
    var scaleY = elementRect.height / intrinsicHeight;
    var renderedWidth = elementRect.width;
    var renderedHeight = elementRect.height;
    if (objectFit === "contain" || objectFit === "scale-down") {
      var containScale = Math.min(scaleX, scaleY);
      if (objectFit === "scale-down") containScale = Math.min(1, containScale);
      renderedWidth = intrinsicWidth * containScale;
      renderedHeight = intrinsicHeight * containScale;
    } else if (objectFit === "cover") {
      var coverScale = Math.max(scaleX, scaleY);
      renderedWidth = intrinsicWidth * coverScale;
      renderedHeight = intrinsicHeight * coverScale;
    } else if (objectFit === "none") {
      renderedWidth = intrinsicWidth;
      renderedHeight = intrinsicHeight;
    }
    var position = String(style && style.objectPosition || "50% 50%").trim().split(/\s+/);
    if (position.length === 1) position.push("50%");
    var left = elementRect.left + objectPositionOffset(position[0], elementRect.width - renderedWidth, "left", "right");
    var top = elementRect.top + objectPositionOffset(position[1], elementRect.height - renderedHeight, "top", "bottom");
    var clipInsets = {
      top: geometryNumber(Math.max(0, elementRect.top - top)),
      right: geometryNumber(Math.max(0, left + renderedWidth - (elementRect.left + elementRect.width))),
      bottom: geometryNumber(Math.max(0, top + renderedHeight - (elementRect.top + elementRect.height))),
      left: geometryNumber(Math.max(0, elementRect.left - left))
    };
    return {
      left: geometryNumber(left),
      top: geometryNumber(top),
      width: geometryNumber(renderedWidth),
      height: geometryNumber(renderedHeight),
      elementRect: elementRect,
      objectFit: objectFit,
      clipped: clipInsets.top > 0 || clipInsets.right > 0 || clipInsets.bottom > 0 || clipInsets.left > 0,
      clipInsets: clipInsets
    };
  }

  function createPlaybackAdapter(video, onFrame) {
    var active = false;
    var callbackId = null;
    var timerId = null;
    var frameHandler = typeof onFrame === "function" ? onFrame : function () {};

    function emit(mediaTime, metadata) {
      var current = snapshot(video);
      if (!current) return;
      frameHandler(Object.assign({}, current, {
        mediaTime: Number.isFinite(mediaTime) ? mediaTime : current.mediaTime,
        presentedFrames: metadata && metadata.presentedFrames
      }));
    }

    function requestNext() {
      if (!active) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        callbackId = video.requestVideoFrameCallback(function (now, metadata) {
          emit(metadata && metadata.mediaTime, metadata);
          requestNext();
        });
        return;
      }
      timerId = setTimeout(function () {
        emit(video.currentTime);
        requestNext();
      }, 250);
    }

    return {
      start: function () {
        if (active) return;
        active = true;
        requestNext();
      },
      stop: function () {
        active = false;
        if (callbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(callbackId);
        }
        if (timerId !== null) clearTimeout(timerId);
        callbackId = null;
        timerId = null;
      },
      read: function () { return snapshot(video); },
      isRunning: function () { return active; }
    };
  }

  function runtimeViewDefaults() {
    return {
      phase: "idle",
      message: "Local runtime starting",
      reason: "",
      analyzer: "none",
      inference: false,
      fallbacks: [],
      capabilities: {},
      result: null,
      currentMediaTime: null,
      ageSeconds: null,
      stale: true
    };
  }

  /**
   * Explicit UI seam for the runtime foundation. It accepts capability and
   * result envelopes without knowing an analyzer implementation. The result
   * remains model-neutral (including any future array of player tracks), while
   * synchronization age/stale state is kept visible to the renderer.
   */
  function createRuntimeUiSeam(options) {
    options = options || {};
    var onChange = typeof options.onChange === "function" ? options.onChange : function () {};
    var view = runtimeViewDefaults();

    function publish() { onChange(Object.assign({}, view, { fallbacks: view.fallbacks.slice() })); }
    function update(patch) {
      view = Object.assign({}, view, patch);
      publish();
    }
    function resultUpdate(message, synchronizationView, currentMediaTime) {
      var sync = synchronizationView || {};
      var resultCapabilities = message.capabilities || message.capabilityState || {};
      return {
        phase: message.status === "fallback" ? "fallback" : "result",
        message: message.result && message.result.note ? message.result.note : "Local analyzer result received",
        reason: message.result && message.result.runtimeIntegrationTest
          ? "runtime-integration-probe"
          : message.status === "fallback" && !message.inferenceAvailable
            ? (message.result && message.result.reason) || "local-inference-unavailable"
            : "",
        analyzer: message.inferenceAvailable ? (message.analyzer || resultCapabilities.analyzer || "none") : (resultCapabilities.analyzer || "none"),
        inference: Boolean(message.inferenceAvailable),
        fallbacks: Array.isArray(resultCapabilities.fallbacks) ? resultCapabilities.fallbacks.slice() : view.fallbacks,
        capabilities: resultCapabilities,
        result: message.result || null,
        currentMediaTime: Number.isFinite(currentMediaTime) ? currentMediaTime : view.currentMediaTime,
        ageSeconds: Number.isFinite(sync.ageSeconds) ? sync.ageSeconds : view.ageSeconds,
        stale: sync.stale == null ? view.stale : Boolean(sync.stale)
      };
    }
    function synchronizedEnvelope(synchronizationView) {
      var sync = synchronizationView || {};
      return sync.result && sync.result.type === "analysis.result" ? sync.result : null;
    }
    function acceptMessage(message, synchronizationView, currentMediaTime) {
      if (!message) return;
      if (message.type === "runtime.capabilities") {
        var capabilityState = message.capabilities || {};
        update({
          phase: capabilityState.inference ? "ready" : "fallback",
          message: message.reason || (capabilityState.inference ? "Local runtime ready" : "Local analysis unavailable"),
          reason: message.reason || "",
          analyzer: capabilityState.analyzer || "none",
          inference: Boolean(capabilityState.inference),
          fallbacks: Array.isArray(message.fallbacks) ? message.fallbacks.slice() : [],
          capabilities: capabilityState
        });
      } else if (message.type === "analysis.result") {
        var sync = synchronizationView || {};
        // RuntimeController always supplies a result key. If it is null, this
        // envelope is still in the future and must not bypass synchronization.
        // Direct seam consumers that omit the key retain the model-neutral
        // compatibility path used by summaries/tests.
        if (Object.prototype.hasOwnProperty.call(sync, "result")) {
          var selected = synchronizedEnvelope(sync);
          if (selected) update(resultUpdate(selected, sync, currentMediaTime));
          else update({
            currentMediaTime: Number.isFinite(currentMediaTime) ? currentMediaTime : view.currentMediaTime,
            ageSeconds: Number.isFinite(sync.ageSeconds) ? sync.ageSeconds : null,
            stale: sync.stale == null ? view.stale : Boolean(sync.stale)
          });
        } else update(resultUpdate(message, sync, currentMediaTime));
      } else if (message.type === "runtime.status") {
        var statusCapabilities = message.capabilities || {};
        update({
          phase: message.phase || view.phase,
          message: message.message || view.message,
          reason: message.reason || view.reason,
          analyzer: statusCapabilities.analyzer || view.analyzer,
          inference: statusCapabilities.inference == null ? view.inference : Boolean(statusCapabilities.inference),
          fallbacks: Array.isArray(statusCapabilities.fallbacks) ? statusCapabilities.fallbacks.slice() : view.fallbacks,
          capabilities: Object.keys(statusCapabilities).length ? statusCapabilities : view.capabilities
        });
      }
    }
    function acceptStatus(status) {
      if (!status) return;
      if (status.type === "capture-capability") {
        update({
          phase: status.mode === "unavailable" ? "fallback" : "starting",
          message: status.mode === "unavailable" ? "Frame capture unavailable" : "Frame capture ready",
          reason: status.fallback || "",
          inference: false
        });
        return;
      }
      if (status.type === "synchronizer-status") {
        if (status.status === "timeline-reset") update({ phase: "resyncing", message: "Media timeline changed", reason: "timeline-reset" });
        return;
      }
      update({
        phase: status.type === "frame-transport-fallback" ? view.phase : "fallback",
        message: status.reason || "Runtime fallback",
        reason: status.reason || status.type || "runtime-fallback",
        inference: status.type === "frame-transport-fallback" ? view.inference : false
      });
    }
    function acceptSynchronization(synchronizationView, currentMediaTime) {
      var sync = synchronizationView || {};
      var selected = synchronizedEnvelope(sync);
      if (selected) {
        update(resultUpdate(selected, sync, currentMediaTime));
        return;
      }
      update({
        currentMediaTime: Number.isFinite(currentMediaTime) ? currentMediaTime : view.currentMediaTime,
        ageSeconds: Number.isFinite(sync.ageSeconds) ? sync.ageSeconds : null,
        stale: sync.stale == null ? view.stale : Boolean(sync.stale)
      });
    }
    function reset(reason) {
      view = runtimeViewDefaults();
      view.phase = "resyncing";
      view.message = "Local runtime session reset";
      view.reason = reason || "session-reset";
      publish();
    }
    return {
      acceptMessage: acceptMessage,
      acceptStatus: acceptStatus,
      acceptSynchronization: acceptSynchronization,
      reset: reset,
      snapshot: function () { return Object.assign({}, view, { fallbacks: view.fallbacks.slice() }); }
    };
  }

  function startIntegratedRuntime(options) {
    options = options || {};
    if (!root.BSORuntime || typeof root.BSORuntime.RuntimeController !== "function") return null;
    var seam = createRuntimeUiSeam({ onChange: options.onChange });
    var controller = new root.BSORuntime.RuntimeController({
      documentRef: options.documentRef || root.document,
      windowRef: options.windowRef || root,
      chromeApi: options.chromeApi || root.chrome,
      // The design-system content UI owns the visible overlay. Runtime
      // messages and synchronization are adapted before they reach it.
      overlay: null,
      onRuntimeMessage: function (message, view, currentMediaTime) {
        seam.acceptMessage(message, view, currentMediaTime);
      },
      onRuntimeStatus: function (status) { seam.acceptStatus(status); },
      onRuntimeView: function (view, currentMediaTime) {
        if (typeof options.onMediaTime === "function") options.onMediaTime(currentMediaTime);
        seam.acceptSynchronization(view, currentMediaTime);
      },
      onSessionReset: function (reason) { seam.reset(reason); }
    });
    controller.start();
    return { controller: controller, seam: seam };
  }

  root.BVRuntime = {
    createPlaybackAdapter: createPlaybackAdapter,
    createRuntimeUiSeam: createRuntimeUiSeam,
    startIntegratedRuntime: startIntegratedRuntime,
    snapshot: snapshot,
    videoContentRect: videoContentRect
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
