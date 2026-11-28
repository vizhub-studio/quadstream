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

export function cellBoundary(cell) {
  const [u, v, h] = bounds(cell);
  const corners = [
    [u, v],
    [u + 2 * h, v],
    [u + 2 * h, v + 2 * h],
    [u, v + 2 * h],
    [u, v],
  ];
  // A line, not a polygon: clipping must not create synthetic circle edges.
  return {
    type: "LineString",
    coordinates: corners.map(([x, y]) => {
      const [a, b, c] = vector(cell.face, x, y);
      return [
        (Math.atan2(b, a) * 180) / Math.PI,
        (Math.atan2(c, Math.hypot(a, b)) * 180) / Math.PI,
      ];
    }),
  };
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
        render(node);
        stats.rendered++;
      }
      if (node.level < level) {
        for (let k = node.children.length - 1; k >= 0; k--) {
          if (node.children[k]) stack.push(node.children[k]);
        }
      }
    },
  };
}
