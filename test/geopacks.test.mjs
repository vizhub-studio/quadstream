import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GEO_PACKS_BASE,
  GEO_PACKS_INVENTORY,
  geoPacksConfigs,
  geoPacksObject,
  loadGeoPacksConfigs,
} from "../examples/globe/geopacks.mjs";
import { layerActive } from "../examples/globe/regional.mjs";

const inventory = {
  files: [
    { name: "/data/countries/CAN.adm1.topo.json" },
    { name: "/data/countries/CAN.adm2.topo.json" },
    { name: "/data/countries/USA.adm1.topo.json" },
    { name: "/data/countries/BRA.adm1.topo.json" },
  ],
};
const world = {
  type: "Topology",
  objects: { world: { type: "GeometryCollection", geometries: [] } },
};
const feature = (iso3, x, y) => ({
  type: "Feature",
  properties: { iso3 },
  geometry: {
    type: "Polygon",
    coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y]]],
  },
});
const topojson = {
  feature: () => ({
    type: "FeatureCollection",
    features: [
      feature("CAN", -100, 55),
      feature("USA", -100, 35),
      feature("BRA", -50, -10),
      feature("FRA", 2, 45),
    ],
  }),
};

test("CDN catalog admits only listed international ADM1 assets", () => {
  const configs = geoPacksConfigs(inventory, world, topojson);
  assert.deepEqual(configs.map((c) => c.id), ["can-adm1", "bra-adm1"]);
  const canada = configs[0];
  assert.equal(canada.url, GEO_PACKS_BASE + "countries/CAN.adm1.topo.json");
  assert.equal(canada.autoObject, true);
  const view = { rotation: [100, -55, 0], initialScale: 100, scale: 300, width: 100, height: 100 };
  assert.equal(layerActive(canada, view, false), true);
  assert.equal(layerActive(canada, { ...view, scale: 299 }, false), false);
  assert.equal(layerActive(canada, { ...view, rotation: [-80, 55, 0] }, false), false);
});

test("CDN catalog fetches no country boundary files at startup", async () => {
  const calls = [];
  const configs = await loadGeoPacksConfigs(topojson, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url === GEO_PACKS_INVENTORY ? inventory : world };
  });
  assert.equal(configs.length, 2);
  assert.deepEqual(calls, [GEO_PACKS_INVENTORY, GEO_PACKS_BASE + "world.topo.json"]);
  await assert.rejects(loadGeoPacksConfigs(topojson, async () => ({ ok: false, status: 503 })), /HTTP 503/);
});

test("remote polygon collection must be unambiguous", () => {
  const object = { type: "GeometryCollection", geometries: [{ type: "Polygon" }] };
  assert.equal(geoPacksObject({ type: "Topology", objects: { regions: object } }), "regions");
  assert.throws(() => geoPacksObject({ type: "Topology", objects: { a: object, b: object } }), /Expected one/);
});
