const assert = require('node:assert/strict');
const test = require('node:test');
const discovery = require('../src/extension/content/video-discovery.js');

test('badminton detection uses local page metadata and keeps unknown pages unconfirmed', () => {
  const match = discovery.detectBadmintonVideo({ title: 'BWF World Tour badminton highlights' });
  assert.equal(match.detected, true);
  assert.equal(match.state, 'detected');
  assert.ok(match.signals.includes('badminton'));
  assert.equal(discovery.isBadmintonVideo({ title: 'Nature documentary' }), false);
  assert.equal(discovery.detectBadmintonVideo({ title: 'Nature documentary' }).state, 'unconfirmed');
});

test('metadata extraction reads title, channel, description, duration, and detection without playback writes', () => {
  const nodes = new Map([
    ['meta[itemprop="channelName"]', { getAttribute: () => 'Badminton Central' }],
    ['meta[name="description"]', { getAttribute: () => 'Full badminton match' }]
  ]);
  const documentRef = {
    title: 'Full Badminton Match - YouTube',
    querySelector(selector) { return nodes.get(selector) || null; }
  };
  const video = { duration: 123.5 };
  const result = discovery.extractVideoMetadata(documentRef, video, { location: { href: 'https://m.youtube.com/watch?v=match' } });
  assert.deepEqual(result, {
    url: 'https://m.youtube.com/watch?v=match',
    title: 'Full Badminton Match',
    channel: 'Badminton Central',
    description: 'Full badminton match',
    keywords: null,
    category: null,
    duration: 123.5,
    badmintonDetected: true,
    badmintonDetectionState: 'detected',
    badmintonConfidence: 1,
    badmintonSignals: ['badminton']
  });
  assert.equal(video.duration, 123.5);
});

test('video discovery emits metadata when a visible video appears or page metadata changes', () => {
  const video = {
    isConnected: true,
    duration: 60,
    getBoundingClientRect: () => ({ width: 640, height: 360 })
  };
  const documentRef = {
    title: 'Badminton replay',
    querySelectorAll: () => [video],
    querySelector: () => null
  };
  const metadata = [];
  const instance = new discovery.VideoDiscovery({
    documentRef,
    windowRef: { location: { href: 'https://www.youtube.com/watch?v=one' } },
    onMetadata: (value) => metadata.push(value)
  });
  instance.started = true;
  instance.scan('test');
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].badmintonDetected, true);
  documentRef.title = 'Different badminton replay';
  instance.scan('metadata-change');
  assert.equal(metadata.length, 2);
  assert.equal(instance.metadata.title, 'Different badminton replay');
});

test('YouTube watch detection covers desktop and mobile hosts only', () => {
  assert.equal(discovery.isYouTubeWatchUrl('https://www.youtube.com/watch?v=x'), true);
  assert.equal(discovery.isYouTubeWatchUrl('https://m.youtube.com/watch?v=x'), true);
  assert.equal(discovery.isYouTubeWatchUrl('https://www.youtube.com/shorts/x'), false);
  assert.equal(discovery.isYouTubeWatchUrl('https://example.test/watch?v=x'), false);
});
