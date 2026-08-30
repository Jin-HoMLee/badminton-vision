import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const source = await readFile(new URL("../src/runtime.js", import.meta.url), "utf8");
  const context = { setTimeout, clearTimeout, globalThis: {} };
  vm.runInNewContext(source, context, { filename: "runtime.js" });
  return context.globalThis.BVRuntime;
}

test("playback adapter reads video state without touching playback properties", async () => {
  const runtime = await loadRuntime();
  let callback;
  const writes = [];
  const rawVideo = {
    currentTime: 12.04,
    paused: false,
    muted: false,
    videoWidth: 1280,
    videoHeight: 720,
    readyState: 4,
    playbackRate: 1,
    requestVideoFrameCallback(next) { callback = next; return 7; },
    cancelVideoFrameCallback(id) { assert.equal(id, 7); }
  };
  const video = new Proxy(rawVideo, {
    set(target, property, value) { writes.push([property, value]); return Reflect.set(target, property, value); }
  });
  const frames = [];
  const adapter = runtime.createPlaybackAdapter(video, (frame) => frames.push(frame));
  const snapshot = adapter.read();
  assert.equal(snapshot.mediaTime, 12.04);
  assert.equal(snapshot.paused, false);
  assert.equal(snapshot.muted, false);
  assert.equal(snapshot.width, 1280);
  assert.equal(snapshot.height, 720);
  assert.equal(snapshot.readyState, 4);
  assert.equal(snapshot.playbackRate, 1);
  adapter.start();
  callback(0, { mediaTime: 12.08, presentedFrames: 4 });
  adapter.stop();
  assert.equal(frames[0].mediaTime, 12.08);
  assert.deepEqual(writes, []);
  assert.equal(video.currentTime, 12.04);
  assert.equal(video.paused, false);
  assert.equal(video.muted, false);
});
