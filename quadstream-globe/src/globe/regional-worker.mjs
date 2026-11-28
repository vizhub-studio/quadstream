import * as topojson from "topojson-client";
import {
  buildSphericalQuadstream,
  canonicalLonLat,
} from "../../../dist/index.js";
import { internalBoundaryMesh } from "../../../examples/globe/regional-geometry.mjs";

import { geoPacksObject } from "../../../examples/globe/geopacks.mjs";

import { createRegionalFrameCache } from "../../../examples/globe/geometry-cache.mjs";

let original, engine, warning;
const frames = createRegionalFrameCache();
const cleanLine = (line) => {
  const result = [];
  for (const position of line) {
    const p = canonicalLonLat(position);
    const last = result.at(-1);
    if (!last || p[0] !== last[0] || p[1] !== last[1]) result.push(p);
  }
  return result;
};
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      frames.clear();
      engine = undefined;
      warning = undefined;
      if (data.original) original = data.original;
      else {
        let topology = data.topology;
        if (!topology) {
          const response = await fetch(data.config.url);
          if (!response.ok) throw new Error("Regional atlas HTTP " + response.status);
          topology = await response.json();
        }
        const config = data.config.autoObject
          ? { ...data.config, object: geoPacksObject(topology) }
          : data.config;
        original = internalBoundaryMesh(topology, config, topojson);
      }
      try {
        const features = original.coordinates
          .map(cleanLine)
          .filter((coordinates) => coordinates.length >= 2)
          .map((coordinates, i) => ({
            type: "Feature",
            id: String(i),
            properties: {},
            geometry: { type: "LineString", coordinates },
          }));
        engine = buildSphericalQuadstream(
          { type: "FeatureCollection", features },
          { maxLevel: 20 },
        );
      } catch (error) {
        warning = "Source fallback: " + String(error.message ?? error);
      }
      self.postMessage({ type: "ready", original, warning });
    } else if (data.type === "query") {
      const cached = frames.get(data.level);
      if (cached) {
        self.postMessage(cached);
        return;
      }
      let geometry = original;
      let frameWarning = warning;
      if (engine) {
        try {
          const frame = engine.query({ level: data.level });
          if (frame.valid)
            geometry = {
              type: "MultiLineString",
              coordinates: frame.geojson.features.map(
                (f) => f.geometry.coordinates,
              ),
            };
          else frameWarning = "Source fallback: invalid simplified boundaries";
        } catch (error) {
          frameWarning = "Source fallback: " + String(error.message ?? error);
        }
      }
      const result = {
        type: "frame",
        level: data.level,
        geometry,
        warning: frameWarning,
      };
      if (!frameWarning) frames.set(data.level, result);
      self.postMessage(result);
    }
  } catch (error) {
    self.postMessage({ error: String(error.message ?? error) });
  }
};
