import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGeometryResolver,
  geometryMode,
  internationalMode,
} from "../quadstream-globe/src/globe/geometry-sources.mjs";

test("local geometry remains the default for offline tests", () => {
  const params = new URLSearchParams();
  assert.equal(geometryMode(params), "local");
  assert.equal(internationalMode(params, "local"), "local");
  const resolve = createGeometryResolver({
    mode: "local",
    localAsset: (path) => "/migration/globe-data/" + path,
  });
  assert.equal(resolve("world/50m.json"), "/migration/globe-data/world/50m.json");
});

test("all built-in production geometry URLs are pinned in CDN mode", () => {
  const params = new URLSearchParams("geometry=cdn");
  assert.equal(geometryMode(params), "cdn");
  assert.equal(internationalMode(params, "cdn"), "cdn");
  const resolve = createGeometryResolver({
    mode: "cdn",
    localAsset: () => assert.fail("CDN mode used a local asset"),
  });
  const base = "https://cdn.jsdelivr.net/npm/";
  assert.equal(resolve("world/50m.json"), base + "visionscarto-world-atlas@1.0.0/world/50m.json");
  assert.equal(resolve("world/110m.json"), base + "visionscarto-world-atlas@1.0.0/world/110m.json");
  assert.equal(resolve("us/states-10m.json"), base + "us-atlas@3.0.1/states-10m.json");
  assert.equal(resolve("us/counties-10m.json"), base + "us-atlas@3.0.1/counties-10m.json");
  assert.throws(() => resolve("regional/missing.json"), /No CDN geometry source/);
});

test("CDN-only builds and international overrides are deterministic", () => {
  assert.equal(geometryMode(new URLSearchParams("geometry=local"), true), "cdn");
  assert.equal(internationalMode(new URLSearchParams("international=0"), "cdn"), "0");
  assert.equal(internationalMode(new URLSearchParams("international=cdn"), "local"), "cdn");
});
