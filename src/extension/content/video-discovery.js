/* global globalThis */
(function installVideoDiscovery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOVideoDiscovery = api;
}(typeof globalThis === 'object' ? globalThis : self, function videoDiscoveryFactory() {
  'use strict';

  const BADMINTON_TERMS = Object.freeze([
    ['badminton', 1],
    ['shuttlecock', 1],
    ['shuttle cock', 1],
    ['bwf', 0.85],
    ['thomas cup', 0.85],
    ['uber cup', 0.85],
    ['sudirman cup', 0.85],
    ['all england badminton', 0.85],
    ['world badminton', 0.55]
  ]);

  function visibleVideo(video) {
    if (!video || typeof video.getBoundingClientRect !== 'function') return false;
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && video.isConnected !== false;
  }

  function cleanTitle(value) {
    return String(value || '').replace(/\s*[-|]\s*YouTube\s*$/i, '').trim();
  }

  function metaContent(documentRef, selectors) {
    if (!documentRef || typeof documentRef.querySelector !== 'function') return '';
    for (const selector of selectors) {
      const node = documentRef.querySelector(selector);
      const content = node && typeof node.getAttribute === 'function' ? node.getAttribute('content') : '';
      if (content && String(content).trim()) return String(content).trim();
    }
    return '';
  }

  function extractVideoMetadata(documentRef = globalThis.document, video = null, windowRef = globalThis) {
    const location = windowRef && windowRef.location;
    const title = cleanTitle(documentRef && documentRef.title);
    const channel = metaContent(documentRef, ['meta[itemprop="channelName"]', 'meta[name="channelName"]']);
    const description = metaContent(documentRef, ['meta[name="description"]', 'meta[itemprop="description"]']);
    const keywords = metaContent(documentRef, ['meta[name="keywords"]', 'meta[itemprop="keywords"]']);
    const category = metaContent(documentRef, ['meta[itemprop="genre"]', 'meta[name="category"]']);
    const text = [title, channel, description, keywords, category].filter(Boolean).join(' ');
    const detection = detectBadmintonVideo({ title, channel, description, keywords, category, text });
    const duration = video && Number.isFinite(Number(video.duration)) && Number(video.duration) >= 0
      ? Number(video.duration)
      : null;
    return {
      url: location && /^https?:/.test(String(location.href || '')) ? String(location.href) : null,
      title: title || null,
      channel: channel || null,
      description: description || null,
      keywords: keywords || null,
      category: category || null,
      duration,
      badmintonDetected: detection.detected,
      badmintonDetectionState: detection.state,
      badmintonConfidence: detection.confidence,
      badmintonSignals: detection.signals
    };
  }

  function detectBadmintonVideo(metadata = {}) {
    const fields = ['title', 'channel', 'description', 'keywords', 'category'];
    const values = metadata.text
      ? [String(metadata.text).toLowerCase()]
      : fields.map((field) => String(metadata[field] || '').toLowerCase()).filter(Boolean);
    const text = values.join(' ');
    const signals = BADMINTON_TERMS.filter(([term]) => text.includes(term)).map(([term]) => term);
    const score = BADMINTON_TERMS.reduce((total, [term, weight]) => total + (text.includes(term) ? weight : 0), 0);
    const confidence = Math.min(1, score);
    return {
      detected: signals.length > 0,
      state: signals.length > 0 ? 'detected' : 'unconfirmed',
      confidence,
      signals
    };
  }

  function isBadmintonVideo(metadata = {}) {
    return detectBadmintonVideo(metadata).detected;
  }

  function isYouTubeWatchUrl(url) {
    return /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch(?:[?#]|$)/i.test(String(url || ''));
  }

  function findVideo(documentRef = globalThis.document) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return null;
    const videos = Array.from(documentRef.querySelectorAll('video'));
    const connected = videos.filter((video) => video.isConnected !== false);
    const visible = connected.filter(visibleVideo);
    return (visible.length ? visible : connected)[0] || null;
  }

  class VideoDiscovery {
    constructor({ documentRef = globalThis.document, windowRef = globalThis.window, onVideo = () => {}, onNavigation = () => {}, onMetadata = () => {} } = {}) {
      this.document = documentRef;
      this.window = windowRef;
      this.onVideo = onVideo;
      this.onNavigation = onNavigation;
      this.onMetadata = onMetadata;
      this.video = null;
      this.metadata = null;
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
      if (this.metadata) this.onMetadata(null, 'stopped');
      this.video = null;
      this.metadata = null;
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
      if (this.metadata) {
        this.onMetadata(null, reason);
        this.metadata = null;
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
      const metadata = candidate ? extractVideoMetadata(this.document, candidate, this.window) : null;
      if (JSON.stringify(metadata) !== JSON.stringify(this.metadata)) {
        this.metadata = metadata;
        this.onMetadata(metadata, reason);
      }
    }
  }

  return Object.freeze({
    BADMINTON_TERMS,
    VideoDiscovery,
    detectBadmintonVideo,
    extractVideoMetadata,
    findVideo,
    isBadmintonVideo,
    isYouTubeWatchUrl,
    visibleVideo
  });
}));
