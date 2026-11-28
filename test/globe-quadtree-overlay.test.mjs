import test from "node:test";
import assert from "node:assert/strict";
import {
  cellBoundary,
  cellCap,
  createCellIndex,
  createCellTraversal,
  edgeIntersectsCone,
} from "../examples/globe/quadtree-overlay.mjs";
import { createFrameBatches } from "../examples/globe/frame-batches.mjs";

const cell = (face, level, i, j) => ({ face, level, i, j });
const cone = (vx, vy, vz, viewRadius) => ({ vx, vy, vz, viewRadius });
const unit = (x, y, z) => {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
};

function traverse(cells, view, level = Infinity) {
  const index = createCellIndex(cells);
  while (index.cursor < cells.length) index.step();
  const stats = { visited: 0, pruned: 0, rendered: 0, edgesRejected: 0 };
  const drawn = [];
  const walk = createCellTraversal(index, view, level, stats);
  while (walk.hasWork()) {
    walk.step((c) => {
      if (!cellBoundary(c, view)) return false;
      drawn.push([c.face, c.level, c.i, c.j].join(":"));
      return true;
    });
  }
  return { stats, drawn, index };
}

test("an invisible branch skips thousands of occupied descendants", () => {
  const cells = [cell("+X", 0, 0, 0)];
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 64; j++) cells.push(cell("-X", 6, i, j));
  }
  const { stats, drawn } = traverse(cells, cone(1, 0, 0, Math.PI / 2));
  assert.deepEqual(drawn, ["+X:0:0:0"]);
  assert.equal(stats.visited, 2);
  assert.equal(stats.pruned, 1);
});

test("a cell containing the view but with no visible edges is not projected", () => {
  const root = cell("+X", 0, 0, 0);
  assert.equal(cellBoundary(root, cone(1, 0, 0, 0.05)), null);
  const { stats } = traverse([root], cone(1, 0, 0, 0.05));
  assert.equal(stats.rendered, 0);
  assert.equal(stats.edgesRejected, 1);
});

test("an edge crossing the viewing circle survives even with both endpoints outside", () => {
  const a = unit(1, -1, 0);
  const b = unit(1, 1, 0);
  assert.equal(edgeIntersectsCone(a, b, cone(1, 0, 0, 0.1)), true);
  assert.equal(edgeIntersectsCone(a, b, cone(-1, 0, 0, 0.1)), false);
  assert.equal(edgeIntersectsCone(a, b, cone(0, 0, 1, Math.PI / 2)), true);
});

test("sparse ancestors are not drawn, duplicate cells coalesce, level is honored", () => {
  const leaf = cell("+X", 2, 1, 1);
  const cells = [leaf, leaf];
  const view = cone(1, 0, 0, Math.PI / 2);
  const result = traverse(cells, view);
  assert.equal(result.index.occupied, 1);
  assert.deepEqual(result.drawn, ["+X:2:1:1"]);
  assert.deepEqual(traverse(cells, view, 1).drawn, []);
});

test("full hemisphere preserves near-limb edges, including cube seams", () => {
  const cells = [cell("+Y", 4, 8, 8), cell("+Z", 0, 0, 0)];
  const view = cone(1, 0, 0, Math.PI / 2);
  const { drawn } = traverse(cells, view);
  assert.ok(drawn.includes("+Y:4:8:8"));
  assert.ok(drawn.includes("+Z:0:0:0"));
});

test("hierarchical results match a flat edge test across faces and viewpoints", () => {
  const cells = [];
  for (const face of ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]) {
    for (let level = 0; level <= 4; level++) {
      const side = 2 ** level;
      for (let i = 0; i < side; i++) {
        for (let j = 0; j < side; j++) {
          if ((i + 3 * j + level) % 3 === 0)
            cells.push(cell(face, level, i, j));
        }
      }
    }
  }
  for (const direction of [unit(1, 1, 1), unit(-1, 0, 0), unit(0, 0, 1)]) {
    for (const radius of [0.03, 0.2, 1.0, Math.PI / 2]) {
      const view = cone(...direction, radius);
      const expected = cells
        .filter((c) => cellBoundary(c, view))
        .map((c) => [c.face, c.level, c.i, c.j].join(":"))
        .sort();
      assert.deepEqual(traverse(cells, view).drawn.sort(), expected);
    }
  }
});

test("deep cap remains nonzero and finite", () => {
  const cap = cellCap(cell("-Z", 25, 2 ** 24, 2 ** 24));
  assert.ok(cap.radiusRad > 0 && cap.radiusRad < 1e-6);
});

test("dynamic batches respect the item limit and cancellation", () => {
  const frames = new Map();
  let id = 0;
  let remaining = 1200;
  let complete = 0;
  const scheduler = createFrameBatches({
    requestFrame(fn) {
      frames.set(++id, fn);
      return id;
    },
    cancelFrame(key) {
      frames.delete(key);
    },
    now: () => 0,
  });
  const run = () => {
    const [key, fn] = frames.entries().next().value;
    frames.delete(key);
    fn();
  };
  const start = () =>
    scheduler.startWork(
      () => remaining > 0,
      () => remaining--,
      { begin() {}, end() {}, complete: () => complete++ },
    );
  start();
  run();
  assert.equal(remaining, 700);
  scheduler.cancel();
  assert.equal(frames.size, 0);
  assert.equal(complete, 0);
  start();
  run();
  run();
  assert.equal(remaining, 0);
  assert.equal(complete, 1);
});
