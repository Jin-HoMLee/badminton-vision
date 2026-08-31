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
        var resultCapabilities = message.capabilities || message.capabilityState || {};
        var sync = synchronizationView || {};
        update({
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
        });
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
    snapshot: snapshot
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
