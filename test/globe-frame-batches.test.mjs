import test from "node:test";
import assert from "node:assert/strict";
import { createFrameBatches } from "../examples/globe/frame-batches.mjs";

function harness(options = {}) {
  let id = 0,
    time = 0;
  const frames = new Map();
  const scheduler = createFrameBatches({
    requestFrame(callback) {
      frames.set(++id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    now: () => time,
    ...options,
  });
  return {
    scheduler,
    frames,
    tick() {
      const entry = frames.entries().next().value;
      assert.ok(entry, "expected a pending frame");
      frames.delete(entry[0]);
      entry[1]();
    },
    spend(ms) {
      time += ms;
    },
  };
}

test("limits each frame to 500 visited cells and stops when complete", () => {
  const { scheduler, frames, tick } = harness();
  const visited = [],
    strokes = [];
  scheduler.start(Array.from({ length: 1201 }, (_, i) => i), {
    begin() {},
    visit: (item) => visited.push(item),
    end: () => strokes.push(visited.length),
  });
  assert.equal(visited.length, 0);
  tick();
  assert.equal(visited.length, 500);
  tick();
  tick();
  assert.deepEqual(strokes, [500, 1000, 1201]);
  assert.deepEqual(visited, Array.from({ length: 1201 }, (_, i) => i));
  assert.equal(frames.size, 0);
});

test("yields after the soft time budget, even when below the cell cap", () => {
  const { scheduler, frames, tick, spend } = harness();
  const visited = [];
  scheduler.start([0, 1, 2, 3, 4], {
    begin() {},
    visit(item) {
      visited.push(item);
      spend(2);
    },
    end() {},
  });
  tick();
  assert.deepEqual(visited, [0, 1]);
  tick();
  tick();
  assert.deepEqual(visited, [0, 1, 2, 3, 4]);
  assert.equal(frames.size, 0);
});

test("replacement and cancellation prevent obsolete callbacks from painting", () => {
  const { scheduler, frames, tick } = harness({ maxItems: 1 });
  const visited = [];
  const hooks = {
    begin() {},
    visit: (item) => visited.push(item),
    end() {},
  };
  scheduler.start(["old first", "old pending"], hooks);
  tick();
  const stale = frames.values().next().value;
  scheduler.start(["new first", "new pending"], hooks);
  stale();
  assert.equal(frames.size, 1);
  tick();
  const canceled = frames.values().next().value;
  scheduler.cancel();
  canceled();
  assert.deepEqual(visited, ["old first", "new first"]);
  assert.equal(frames.size, 0);
});

test("empty replacement cancels pending work without requesting a frame", () => {
  const { scheduler, frames } = harness();
  const hooks = {
    begin() {},
    visit() {
      assert.fail("unexpected visit");
    },
    end() {},
  };
  scheduler.start([1], hooks);
  scheduler.start([], hooks);
  assert.equal(frames.size, 0);
});
