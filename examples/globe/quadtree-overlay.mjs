// Cube-face cells are radial projections of planar squares. A spherical cap
// smaller than a hemisphere that contains the four corners contains the
// entire square (and every descendant), including its great-circle edges.
const axes = {
  "+X": [0, 1, 2, 1],
  "-X": [0, 1, 2, -1],
  "+Y": [1, 0, 2, 1],
  "-Y": [1, 0, 2, -1],
  "+Z": [2, 0, 1, 1],
  "-Z": [2, 0, 1, -1],
};

function vector(face, u, v) {
  const [n, a, b, sign] = axes[face];
  const p = [0, 0, 0];
  p[n] = sign;
  p[a] = u;
  p[b] = v;
  const len = Math.hypot(...p);
  return p.map((x) => x / len);
}

function bounds(cell) {
  const half = 2 ** -cell.level;
  return [2 * cell.i * half - 1, 2 * cell.j * half - 1, half];
}

export function cellCap(cell) {
  const [u, v, h] = bounds(cell);
  const [cx, cy, cz] = vector(cell.face, u + h, v + h);
  let radiusRad = 0;
  for (const x of [u, u + 2 * h]) {
    for (const y of [v, v + 2 * h]) {
      const [a, b, c] = vector(cell.face, x, y);
      // atan2 is stable even at very deep levels.
      const angle = Math.atan2(
        Math.hypot(cy * c - cz * b, cz * a - cx * c, cx * b - cy * a),
        cx * a + cy * b + cz * c,
      );
      radiusRad = Math.max(radiusRad, angle);
    }
  }
  return { cx, cy, cz, radiusRad: radiusRad + 1e-9 };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// Maximum dot product along a minor great-circle arc, not just endpoints:
// an edge with both endpoints outside can still cross the viewing circle.
export function edgeIntersectsCone(a, b, cone) {
  const view = [cone.vx, cone.vy, cone.vz];
  const threshold = Math.cos(cone.viewRadius) - 1e-12;
  if (Math.max(dot(a, view), dot(b, view)) >= threshold) return true;
  const normal = cross(a, b);
  const length = Math.hypot(...normal);
  // Fail open for a numerically ambiguous arc.
  if (length < 1e-12) return true;
  const unit = normal.map((x) => x / length);
  const tangentA = cross(unit, a);
  const tangentB = cross(unit, b);
  return (
    dot(view, tangentA) >= -1e-12 &&
    dot(view, tangentB) <= 1e-12 &&
    Math.hypot(dot(view, a), dot(view, tangentA)) >= threshold
  );
}

export function cellBoundary(cell, cone) {
  const [u, v, h] = bounds(cell);
  const corners = [
    vector(cell.face, u, v),
    vector(cell.face, u + 2 * h, v),
    vector(cell.face, u + 2 * h, v + 2 * h),
    vector(cell.face, u, v + 2 * h),
  ];
  const visible = corners.map(
    (a, i) => !cone || edgeIntersectsCone(a, corners[(i + 1) % 4], cone),
  );
  if (!visible.some(Boolean)) return null;
  const lonLat = ([a, b, c]) => [
    (Math.atan2(b, a) * 180) / Math.PI,
    (Math.atan2(c, Math.hypot(a, b)) * 180) / Math.PI,
  ];
  // A line, not a polygon: clipping must not create synthetic circle edges.
  if (visible.every(Boolean)) {
    const ring = corners.map(lonLat);
    return { type: "LineString", coordinates: [...ring, ring[0]] };
  }
  const lines = [];
  let line = null;
  const start = (visible.indexOf(false) + 1) % 4;
  for (let k = 0; k < 4; k++) {
    const i = (start + k) % 4;
    if (!visible[i]) {
      line = null;
      continue;
    }
    if (!line) {
      line = [lonLat(corners[i])];
      lines.push(line);
    }
    line.push(lonLat(corners[(i + 1) % 4]));
  }
  return { type: "MultiLineString", coordinates: lines };
}

// Incremental, identity-cached index. Synthetic ancestors are traversed but
// never drawn. Duplicate occupied addresses from multiple groups share a node.
export function createCellIndex(cells) {
  const roots = new Map();
  const index = { cursor: 0, occupied: 0, roots };
  index.step = () => {
    const cell = cells[index.cursor++];
    let node = roots.get(cell.face);
    if (!node) {
      node = { face: cell.face, level: 0, i: 0, j: 0, children: [] };
      roots.set(cell.face, node);
    }
    for (let level = 1; level <= cell.level; level++) {
      const divisor = 2 ** (cell.level - level);
      const i = Math.floor(cell.i / divisor);
      const j = Math.floor(cell.j / divisor);
      const slot = (i % 2) + 2 * (j % 2);
      node = (node.children[slot] ??= {
        face: cell.face,
        level,
        i,
        j,
        children: [],
      });
    }
    if (!node.occupied) {
      node.occupied = true;
      index.occupied++;
    }
  };
  return index;
}

// The overlay has no padded-window cache: use the current conservative
// viewport cone itself, including the full hemisphere at low zoom.
export function createCellTraversal(index, cone, level, stats) {
  const stack = [...index.roots.values()].reverse();
  return {
    hasWork: () => stack.length > 0,
    step(render) {
      const node = stack.pop();
      if (node.level > level) return;
      stats.visited++;
      const cap = (node.cap ??= cellCap(node));
      const dot = cap.cx * cone.vx + cap.cy * cone.vy + cap.cz * cone.vz;
      if (
        cap.radiusRad + cone.viewRadius < Math.PI &&
        dot + 1e-12 < Math.cos(cap.radiusRad + cone.viewRadius)
      ) {
        stats.pruned++;
        return;
      }
      if (node.occupied) {
        if (render(node)) stats.rendered++;
        else stats.edgesRejected++;
      }
      if (node.level < level) {
        for (let k = node.children.length - 1; k >= 0; k--) {
          if (node.children[k]) stack.push(node.children[k]);
        }
      }
    },
  };
}
