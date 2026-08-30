const test = require('node:test');
const assert = require('node:assert/strict');
const { rectFromClientRect, isUsableRect } = require('../src/extension/content/overlay.js');

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
