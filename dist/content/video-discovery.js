/* global globalThis */
(function installVideoDiscovery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOVideoDiscovery = api;
}(typeof globalThis === 'object' ? globalThis : self, function videoDiscoveryFactory() {
  'use strict';

  function visibleVideo(video) {
    if (!video || typeof video.getBoundingClientRect !== 'function') return false;
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && video.isConnected !== false;
  }

  function findVideo(documentRef = globalThis.document) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return null;
    const videos = Array.from(documentRef.querySelectorAll('video'));
    const connected = videos.filter((video) => video.isConnected !== false);
    const visible = connected.filter(visibleVideo);
    return (visible.length ? visible : connected)[0] || null;
  }

  class VideoDiscovery {
    constructor({ documentRef = globalThis.document, windowRef = globalThis.window, onVideo = () => {}, onNavigation = () => {} } = {}) {
      this.document = documentRef;
      this.window = windowRef;
      this.onVideo = onVideo;
      this.onNavigation = onNavigation;
      this.video = null;
      this.observer = null;
      this.timer = null;
      this.started = false;
      this.listeners = [];
      this.navigationToken = 0;
    }

    start() {
      if (this.started) return;
      this.started = true;
      const MutationObserverImpl = this.window && this.window.MutationObserver
        ? this.window.MutationObserver
        : typeof MutationObserver === 'function' ? MutationObserver : null;
      if (this.document && MutationObserverImpl) {
        this.observer = new MutationObserverImpl(() => this.scheduleScan('dom-change'));
        this.observer.observe(this.document, { childList: true, subtree: true });
      }
      this.addListener('yt-navigate-start', () => this.navigate('youtube-spa-start'));
      this.addListener('yt-navigate-finish', () => {
        this.navigate('youtube-spa-finish');
        this.scheduleScan('youtube-spa-finish');
      });
      this.addListener('popstate', () => this.navigate('history-navigation'));
      this.addListener('hashchange', () => this.navigate('hash-navigation'));
      this.scheduleScan('initial');
    }

    stop() {
      this.started = false;
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      for (const [name, listener] of this.listeners) {
        if (this.window && this.window.removeEventListener) this.window.removeEventListener(name, listener);
      }
      this.listeners = [];
      if (this.video) this.onVideo(null, 'stopped');
      this.video = null;
    }

    addListener(name, listener) {
      if (this.window && this.window.addEventListener) {
        this.window.addEventListener(name, listener);
        this.listeners.push([name, listener]);
      }
    }

    navigate(reason) {
      this.navigationToken += 1;
      this.onNavigation({ reason, token: this.navigationToken });
      if (this.video) {
        this.onVideo(null, reason);
        this.video = null;
      }
    }

    scheduleScan(reason) {
      if (!this.started || this.timer !== null) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.scan(reason);
      }, 0);
    }

    scan(reason = 'scan') {
      if (!this.started) return;
      const candidate = findVideo(this.document);
      if (candidate !== this.video) {
        if (this.video) this.onVideo(null, 'video-replaced');
        this.video = candidate;
        this.onVideo(candidate, candidate ? reason : 'video-unavailable');
      }
    }
  }

  return Object.freeze({ VideoDiscovery, findVideo, visibleVideo });
}));
