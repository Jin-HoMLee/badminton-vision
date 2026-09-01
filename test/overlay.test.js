const test = require('node:test');
const assert = require('node:assert/strict');
const { rectFromClientRect, isUsableRect } = require('../src/extension/content/overlay.js');
require('../src/runtime.js');
const { videoContentRect } = globalThis.BVRuntime;

test('overlay anchor normalizes client geometry for theater/fullscreen resize', () => {
  assert.deepEqual(rectFromClientRect({ left: 8, top: 12, width: 1280, height: 720 }), {
    left: 8, top: 12, width: 1280, height: 720
  });
  assert.deepEqual(rectFromClientRect({ left: 0, top: 0, width: 0, height: -2 }), {
    left: 0, top: 0, width: 0, height: 0
  });
  assert.equal(isUsableRect({ width: 1920, height: 1080 }), true);
  assert.equal(isUsableRect({ width: 0, height: 1080 }), false);
});

test('video content geometry follows letterboxed pixels rather than the element box', () => {
  const video = {
    videoWidth: 1920,
    videoHeight: 1080,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 800 })
  };
  const contain = videoContentRect(video, { getComputedStyle: () => ({ objectFit: 'contain', objectPosition: '50% 50%' }) });
  assert.deepEqual(contain, {
    left: 100,
    top: 168.75,
    width: 1000,
    height: 562.5,
    elementRect: { left: 100, top: 50, width: 1000, height: 800 },
    objectFit: 'contain',
    clipped: false,
    clipInsets: { top: 0, right: 0, bottom: 0, left: 0 }
  });

  const cover = videoContentRect(video, { getComputedStyle: () => ({ objectFit: 'cover', objectPosition: '50% 50%' }) });
  assert.equal(cover.left, -111.111111111);
  assert.equal(cover.top, 50);
  assert.equal(cover.width, 1422.222222222);
  assert.equal(cover.height, 800);
  assert.equal(cover.clipped, true);
  assert.deepEqual(cover.clipInsets, { top: 0, right: 211.111111111, bottom: 0, left: 211.111111111 });
});
