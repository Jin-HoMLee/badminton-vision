/* global globalThis */
(function installSynchronization(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOSynchronization = api;
}(typeof globalThis === 'object' ? globalThis : self, function synchronizationFactory() {
  'use strict';

  const EPSILON = 1e-4;

  function validResult(result) {
    return result && typeof result.sessionId === 'string' && result.sessionId.length > 0 &&
      typeof result.mediaTime === 'number' && Number.isFinite(result.mediaTime) && result.mediaTime >= 0;
  }

  /**
   * Pure public selector used by the renderer and tests. Results newer than the
   * current media timestamp are held, not displayed. A displayed result is
   * never replaced by an older timestamp or by another video session.
   */
  function selectSynchronizedResult(results, currentMediaTime, sessionId, lastDisplayedMediaTime = -Infinity) {
    if (!Array.isArray(results) || !Number.isFinite(currentMediaTime) || currentMediaTime < 0) {
      return { result: null, ageSeconds: null, stale: true, reason: 'invalid-clock' };
    }
    const eligible = results
      .filter((result) => validResult(result) && result.sessionId === sessionId)
      .filter((result) => result.mediaTime <= currentMediaTime + EPSILON)
      .filter((result) => result.mediaTime + EPSILON >= lastDisplayedMediaTime)
      .sort((a, b) => (b.mediaTime - a.mediaTime) || String(b.requestId || '').localeCompare(String(a.requestId || '')));
    const result = eligible[0] || null;
    return {
      result,
      ageSeconds: result ? Math.max(0, currentMediaTime - result.mediaTime) : null,
      stale: !result,
      reason: result ? 'eligible' : 'no-result-at-or-before-media-time'
    };
  }

  class MediaTimestampSynchronizer {
    constructor({ sessionId, staleAfterSeconds = 1.5, onDisplay = () => {}, onStatus = () => {} } = {}) {
      if (!sessionId) throw new TypeError('sessionId is required');
      this.sessionId = sessionId;
      this.staleAfterSeconds = staleAfterSeconds;
      this.onDisplay = onDisplay;
      this.onStatus = onStatus;
      this.pending = [];
      this.displayed = null;
      this.currentMediaTime = null;
      this.lastDisplayedMediaTime = -Infinity;
    }

    reset(sessionId = this.sessionId, reason = 'reset') {
      this.sessionId = sessionId;
      this.pending = [];
      this.displayed = null;
      this.currentMediaTime = null;
      this.lastDisplayedMediaTime = -Infinity;
      this.onStatus({ type: 'synchronizer-reset', reason, sessionId });
    }

    ingest(result) {
      if (!validResult(result) || result.sessionId !== this.sessionId) return false;
      if (this.displayed && result.mediaTime + EPSILON < this.lastDisplayedMediaTime) return false;
      if (this.pending.some((item) => item.requestId && item.requestId === result.requestId)) return false;
      this.pending.push(result);
      return true;
    }

    update(currentMediaTime) {
      if (!Number.isFinite(currentMediaTime) || currentMediaTime < 0) {
        this.onStatus({ type: 'synchronizer-status', status: 'invalid-clock' });
        return { result: this.displayed, ageSeconds: null, stale: true, reason: 'invalid-clock' };
      }
      if (this.currentMediaTime !== null && currentMediaTime + EPSILON < this.currentMediaTime) {
        this.pending = [];
        this.displayed = null;
        this.lastDisplayedMediaTime = -Infinity;
        this.onStatus({ type: 'synchronizer-status', status: 'timeline-reset', from: this.currentMediaTime, to: currentMediaTime });
      }
      this.currentMediaTime = currentMediaTime;
      const selection = selectSynchronizedResult(this.pending, currentMediaTime, this.sessionId, this.lastDisplayedMediaTime);
      if (selection.result) {
        this.displayed = selection.result;
        this.lastDisplayedMediaTime = selection.result.mediaTime;
        this.pending = this.pending.filter((item) => item.mediaTime > selection.result.mediaTime + EPSILON);
        this.onDisplay({ result: this.displayed, ageSeconds: selection.ageSeconds, stale: false });
      } else if (this.displayed) {
        const ageSeconds = Math.max(0, currentMediaTime - this.displayed.mediaTime);
        const view = { result: this.displayed, ageSeconds, stale: ageSeconds > this.staleAfterSeconds, reason: 'retained-while-inference-lags' };
        this.onDisplay(view);
        return view;
      }
      const view = { ...selection, result: selection.result || this.displayed };
      if (view.stale) this.onStatus({ type: 'synchronizer-status', status: 'awaiting-result', mediaTime: currentMediaTime });
      return view;
    }
  }

  return Object.freeze({
    EPSILON,
    selectSynchronizedResult,
    MediaTimestampSynchronizer
  });
}));
