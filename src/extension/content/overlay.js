/* global globalThis */
/* Geometry helper retained for isolated tests; the retired text overlay is not packaged. */
(function installOverlay(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOOverlay = api;
}(typeof globalThis === 'object' ? globalThis : self, function overlayFactory() {
  'use strict';

  function rectFromClientRect(rect) {
    return {
      left: Number(rect.left) || 0,
      top: Number(rect.top) || 0,
      width: Math.max(0, Number(rect.width) || 0),
      height: Math.max(0, Number(rect.height) || 0)
    };
  }

  function isUsableRect(rect) {
    return rect.width > 0 && rect.height > 0;
  }

  class OverlayAnchor {
    constructor({ documentRef = globalThis.document, windowRef = globalThis.window, onAnchor = () => {} } = {}) {
      this.document = documentRef;
      this.window = windowRef;
      this.onAnchor = onAnchor;
      this.video = null;
      this.element = null;
      this.resizeObserver = null;
      this.mutationObserver = null;
      this.listeners = [];
      this.status = 'Starting';
      this.detail = '';
      this.lastView = null;
    }

    createElement() {
      if (this.element || !this.document || !this.document.createElement) return this.element;
      const element = this.document.createElement('div');
      element.setAttribute('data-bso-runtime-overlay', 'true');
      element.setAttribute('aria-live', 'polite');
      element.setAttribute('role', 'status');
      element.style.position = 'fixed';
      element.style.zIndex = '2147483646';
      element.style.pointerEvents = 'none';
      element.style.boxSizing = 'border-box';
      element.style.border = '1px solid rgba(111, 209, 255, .55)';
      element.style.borderRadius = '5px';
      element.style.background = 'rgba(8, 16, 28, .78)';
      element.style.color = '#e8f5ff';
      element.style.font = '12px/1.3 system-ui, sans-serif';
      element.style.padding = '4px 7px';
      element.style.overflow = 'hidden';
      element.style.whiteSpace = 'nowrap';
      element.style.maxWidth = 'min(320px, 90vw)';
      element.style.transition = 'opacity 120ms ease';
      this.element = element;
      this.render();
      return element;
    }

    mount() {
      const element = this.createElement();
      if (!element || !this.video) return;
      const parent = this.video.parentElement || this.document.body || this.document.documentElement;
      if (parent && element.parentNode !== parent) parent.appendChild(element);
    }

    attach(video) {
      if (!video) return;
      if (this.video === video) {
        this.mount();
        this.refresh();
        return;
      }
      this.detachObservers();
      this.video = video;
      this.mount();
      const ResizeObserverImpl = this.window && this.window.ResizeObserver
        ? this.window.ResizeObserver
        : typeof ResizeObserver === 'function' ? ResizeObserver : null;
      if (ResizeObserverImpl) {
        this.resizeObserver = new ResizeObserverImpl(() => this.refresh());
        this.resizeObserver.observe(video);
      }
      const MutationObserverImpl = this.window && this.window.MutationObserver
        ? this.window.MutationObserver
        : typeof MutationObserver === 'function' ? MutationObserver : null;
      if (this.document && MutationObserverImpl) {
        const parent = video.parentElement || this.document.documentElement;
        if (parent) {
          this.mutationObserver = new MutationObserverImpl(() => {
            if (this.video && !this.video.isConnected) this.refresh();
            else this.mount();
          });
          this.mutationObserver.observe(parent, { childList: true, subtree: true });
        }
      }
      this.addWindowListener('resize', () => this.refresh());
      this.addWindowListener('scroll', () => this.refresh(), { passive: true });
      this.addWindowListener('fullscreenchange', () => this.refresh());
      this.setStatus(this.status, this.detail);
      this.refresh();
    }

    detachObservers() {
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.mutationObserver) this.mutationObserver.disconnect();
      this.resizeObserver = null;
      this.mutationObserver = null;
      for (const [name, listener, options] of this.listeners) {
        if (this.window && this.window.removeEventListener) this.window.removeEventListener(name, listener, options);
      }
      this.listeners = [];
    }

    addWindowListener(name, listener, options) {
      if (this.window && this.window.addEventListener) {
        this.window.addEventListener(name, listener, options);
        this.listeners.push([name, listener, options]);
      }
    }

    detach() {
      this.detachObservers();
      this.video = null;
      if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
    }

    refresh() {
      if (!this.element || !this.video) return null;
      if (!this.element.isConnected) this.mount();
      const rect = rectFromClientRect(this.video.getBoundingClientRect());
      const visible = Boolean(this.video.isConnected !== false) && isUsableRect(rect);
      this.element.style.left = `${rect.left}px`;
      this.element.style.top = `${rect.top}px`;
      this.element.style.width = `${rect.width}px`;
      this.element.style.height = 'auto';
      this.element.style.opacity = visible ? '1' : '0';
      this.onAnchor({ rect, visible, video: this.video });
      return { rect, visible };
    }

    setStatus(status, detail = '') {
      this.status = String(status || 'Unknown');
      this.detail = String(detail || '');
      this.render();
    }

    setSynchronizedView(view, currentMediaTime) {
      this.lastView = view;
      this.currentMediaTime = currentMediaTime;
      this.render();
    }

    render() {
      if (!this.element) return;
      const time = Number.isFinite(this.currentMediaTime) ? ` · t ${this.currentMediaTime.toFixed(2)}s` : '';
      const age = this.lastView && Number.isFinite(this.lastView.ageSeconds)
        ? ` · analysis ${(this.lastView.ageSeconds).toFixed(1)}s old${this.lastView.stale ? ' · stale' : ''}`
        : '';
      this.element.textContent = `BSO · ${this.status}${time}${age}${this.detail ? ` · ${this.detail}` : ''}`;
    }
  }

  return Object.freeze({ OverlayAnchor, rectFromClientRect, isUsableRect });
}));
