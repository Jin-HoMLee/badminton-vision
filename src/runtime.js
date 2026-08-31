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

  root.BVRuntime = { createPlaybackAdapter: createPlaybackAdapter, snapshot: snapshot };
})(typeof globalThis !== "undefined" ? globalThis : window);
