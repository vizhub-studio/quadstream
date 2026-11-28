import test from "node:test";
import assert from "node:assert/strict";
import { createGeometryCache, createWeightedCache, createRegionalFrameCache } from "../examples/globe/geometry-cache.mjs";

test("canonical URLs coalesce in-flight and completed geometry requests", async () => {
  let calls = 0;
  const cache = createGeometryCache({
    baseUrl: "https://example.com/globe/",
    fetcher: async () => {
      calls++;
      return { ok: true, text: async () => '{"type":"Topology"}' };
    },
  });
  const a = cache.load("./can.json");
  const b = cache.load("https://example.com/globe/can.json");
  assert.equal(a, b);
  const first = await a;
  assert.equal(await cache.load("./can.json"), first);
  assert.equal(calls, 1);
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().joined, 1);
  cache.dispose();
  await assert.rejects(cache.load("./can.json"), { name: "AbortError" });
});

test("failed fetch and malformed JSON remain retryable", async () => {
  let attempts = 0;
  const cache = createGeometryCache({
    fetcher: async () => {
      attempts++;
      return {
        ok: attempts !== 1,
        status: 503,
        text: async () => attempts === 2 ? "invalid" : "{}",
      };
    },
  });
  const url = "https://example.com/can.json";
  await assert.rejects(cache.load(url));
  await assert.rejects(cache.load(url));
  assert.deepEqual((await cache.load(url)).data, {});
  assert.equal(attempts, 3);
  cache.dispose();
});

test("weighted cache evicts least recently used entries", () => {
  const cache = createWeightedCache(10);
  cache.set("a", 1, 4);
  cache.set("b", 2, 4);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3, 4);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.stats().bytes, 8);
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
});

test("worker LOD cache keeps eight most recent successful frames", () => {
  const cache = createRegionalFrameCache();
  for (let level = 0; level < 9; level++)
    cache.set(level, { geometry: { coordinates: [] }, level });
  assert.equal(cache.get(0), undefined);
  assert.equal(cache.get(8).level, 8);
});
