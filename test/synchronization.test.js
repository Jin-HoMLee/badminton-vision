const test = require('node:test');
const assert = require('node:assert/strict');
const { MediaTimestampSynchronizer, selectSynchronizedResult } = require('../src/extension/common/synchronization.js');

function result(sessionId, requestId, mediaTime) {
  return { sessionId, requestId, mediaTime, result: { shotFamily: 'unclassified' } };
}

test('selector holds future results and selects the newest result at or before media time', () => {
  const values = [result('s', 'old', 1), result('s', 'new', 2), result('s', 'future', 8)];
  const selected = selectSynchronizedResult(values, 2.25, 's');
  assert.equal(selected.result.requestId, 'new');
  assert.equal(selected.ageSeconds, 0.25);
  assert.equal(selectSynchronizedResult(values, 1.5, 's').result.requestId, 'old');
  assert.equal(selectSynchronizedResult(values, 2.25, 'other').result, null);
});

test('synchronizer retains a lagging result and marks age without blocking playback', () => {
  const displayed = [];
  const statuses = [];
  const sync = new MediaTimestampSynchronizer({
    sessionId: 's', staleAfterSeconds: 1,
    onDisplay: (view) => displayed.push(view),
    onStatus: (status) => statuses.push(status)
  });
  assert.equal(sync.ingest(result('s', 'one', 1)), true);
  assert.equal(sync.update(0.5).result, null);
  assert.equal(sync.update(1.2).result.requestId, 'one');
  assert.equal(sync.update(1.8).stale, false);
  assert.equal(sync.update(2.5).stale, true);
  assert.equal(displayed.at(-1).ageSeconds, 1.5);
  assert.equal(statuses.some((status) => status.status === 'awaiting-result'), true);
});

test('results from an old session and timestamps older than the watermark are discarded', () => {
  const sync = new MediaTimestampSynchronizer({ sessionId: 'new' });
  assert.equal(sync.ingest(result('old', 'wrong-session', 1)), false);
  assert.equal(sync.ingest(result('new', 'first', 3)), true);
  assert.equal(sync.update(3).result.requestId, 'first');
  assert.equal(sync.ingest(result('new', 'late-old', 2)), false);
});

test('a backward media-time jump resets the timeline, while rate changes need no frame counter', () => {
  const statuses = [];
  const sync = new MediaTimestampSynchronizer({ sessionId: 's', onStatus: (status) => statuses.push(status) });
  sync.ingest(result('s', 'first', 5));
  sync.update(5);
  const afterJump = sync.update(2);
  assert.equal(afterJump.result, null);
  assert.equal(statuses.some((status) => status.status === 'timeline-reset'), true);
  sync.ingest(result('s', 'after-jump', 2.1));
  assert.equal(sync.update(2.1).result.requestId, 'after-jump');
});
