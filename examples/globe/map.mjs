// Adapted from VizHub rPa9vFJ0kEvpjaJn-280C (MIT). Geometry only.
import { filterVisibleFeatures, orthographicViewCone } from "./cull.mjs";
import { createViewClipper } from "./clip.mjs";
import { createFrameBatches } from "./frame-batches.mjs";
import {
  cellBoundary,
  createCellIndex,
  createCellTraversal,
} from "./quadtree-overlay.mjs";

function geometryRings(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates;
  if (geometry?.type === "MultiPolygon")
    return geometry.coordinates.flatMap((polygon) => polygon);
  return [];
}

function coordinateKey(point) {
  return `${Object.is(point[0], -0) ? 0 : point[0]},${Object.is(point[1], -0) ? 0 : point[1]}`;
}

function meshGeometry(geojson) {
  const edges = new Map();
  for (const feature of geojson?.features ?? []) {
    for (const ring of geometryRings(feature.geometry)) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i],
          aKey = coordinateKey(a),
          bKey = coordinateKey(b);
        if (aKey === bKey) continue;
        const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
        if (!edges.has(key)) edges.set(key, [a, b]);
      }
    }
  }
  return {
    type: "MultiLineString",
    coordinates: [...edges.values()],
  };
}

export function createGlobeRenderer(
  d3,
  ctx,
  { cull = false, clip = false, onQuadtreeStats } = {},
) {
  const projection = d3.geoOrthographic(),
    path = d3.geoPath(projection, ctx),
    graticule = d3.geoGraticule()(),
    finePrecision = projection.precision();
  const sphere = { type: "Sphere" };
  const capCache = cull || clip ? new WeakMap() : null;
  let quadtreeStats;
  const cellIndexes = new WeakMap();
  function indexFor(cells) {
    let index = cellIndexes.get(cells);
    if (!index) {
      index = createCellIndex(cells);
      cellIndexes.set(cells, index);
    }
    return index;
  }
  const quadtreeBatches = createFrameBatches();
  const clipper = clip ? createViewClipper() : null;
  const meshCache = new WeakMap();
  let oceanKey;
  let ocean;
  function drawShape(g, fill, stroke) {
    ctx.beginPath();
    path(g);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
  function render(state, geojson, source, quadtree = [], overlays = []) {
    // Every base redraw invalidates the previous canvas and projection.
    quadtreeBatches.cancel();
    quadtreeStats = null;
    const {
      width,
      height,
      rotation,
      scale,
      translation,
      interacting,
      dpr = 1,
    } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    projection.rotate(rotation).scale(scale).translate(translation);
    ctx.save();
    const key = `${width}x${height}`;
    if (key !== oceanKey) {
      oceanKey = key;
      ocean = ctx.createRadialGradient(
        width * 0.35,
        height * 0.3,
        0,
        width * 0.35,
        height * 0.3,
        Math.max(width, height) * 0.75,
      );
      ocean.addColorStop(0, "#2e2a5c");
      ocean.addColorStop(0.6, "#1e1c46");
      ocean.addColorStop(1, "#12122c");
    }
    ctx.fillStyle = ocean;
    ctx.strokeStyle = "#b7a9f5";
    ctx.lineWidth = 1.5;
    drawShape(sphere, true, true);
    ctx.strokeStyle = "#5c5c96";
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.5;
    drawShape(graticule, false, true);
    ctx.fillStyle = "#2b2856";
    ctx.strokeStyle = "#8f86d9";
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 0.5;
    let target = geojson,
      stats = null;
    if (clipper) {
      const res = clipper(geojson, state, source);
      target = res.geojson;
      stats = res.stats;
    } else if (cull)
      target = filterVisibleFeatures(geojson, state, capCache, source);
    if (target?.features?.length) {
      projection.precision(finePrecision);
      ctx.beginPath();
      path(target);
      ctx.fill();
      let mesh = meshCache.get(target);
      if (!mesh) {
        mesh = meshGeometry(target);
        meshCache.set(target, mesh);
      }
      ctx.beginPath();
      path(mesh);
      ctx.stroke();
    }
    for (const { geometry, color, width } of overlays) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      drawShape(geometry, false, true);
    }
    if (state.showQuadtree && !interacting) {
      const cone = orthographicViewCone(state);
      const trees = [
        { cells: quadtree, level: state.quadtreeLevel ?? Infinity, color: "yellow" },
        ...overlays.map((overlay) => ({
          cells: overlay.quadtree,
          level: overlay.quadtreeLevel,
          color: overlay.quadtreeColor,
        })),
      ].filter((tree) => tree.cells?.length).map((tree) => ({
        ...tree, index: indexFor(tree.cells),
      }));
      if (trees.length) {
        const started = performance.now();
        let current = 0, traversal, drawing = false;
        const metrics = (quadtreeStats = {
          total: trees.reduce((n, t) => n + t.cells.length, 0),
          indexed: trees.reduce((n, t) => n + t.index.cursor, 0),
          occupied: trees.reduce((n, t) => n + t.index.occupied, 0),
          visited: 0,
          pruned: 0,
          rendered: 0,
          edgesRejected: 0,
          geometryMs: 0,
          completionMs: null,
        });
        function flush() {
          if (!drawing) return;
          try {
            ctx.stroke();
          } finally {
            drawing = false;
            ctx.restore();
          }
        }
        function hasWork() {
          while (current < trees.length) {
            const tree = trees[current];
            if (tree.index.cursor < tree.cells.length) return true;
            traversal ??= createCellTraversal(tree.index, cone, tree.level, metrics);
            if (traversal.hasWork()) return true;
            flush();
            current++;
            traversal = undefined;
          }
          return false;
        }
        quadtreeBatches.startWork(
          hasWork,
          () => {
            const tree = trees[current];
            const index = tree.index;
            if (index.cursor < tree.cells.length) {
              const occupied = index.occupied;
              index.step();
              metrics.indexed++;
              metrics.occupied += index.occupied - occupied;
              return;
            }
            traversal.step((cell) => {
              const before = performance.now();
              const boundary = cellBoundary(cell, cone);
              metrics.geometryMs += performance.now() - before;
              if (!boundary) return false;
              if (!drawing) {
                ctx.save();
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.globalAlpha = tree.color === "yellow" ? 0.2 : 0.65;
                ctx.strokeStyle = tree.color;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                drawing = true;
              }
              path(boundary);
              return true;
            });
          },
          {
            begin() {},
            end: flush,
            complete() {
              metrics.completionMs = performance.now() - started;
              onQuadtreeStats?.(metrics);
            },
          },
        );
      }
    }
    ctx.restore();
    // `visible` is exactly what was handed to d3 for the land layer.
    return { visible: target, stats };
  }
  render.cancelQuadtree = quadtreeBatches.cancel;
  render.quadtreeStats = () => quadtreeStats;
  return render;
}
