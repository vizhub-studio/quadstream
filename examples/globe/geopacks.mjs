// Experimental version-pinned CDN source. Fetch only inventory and country
// envelopes at boot; regional workers fetch actual ADM1 topology on activation.
import { computeFeatureCap } from "./cull.mjs";

export const GEO_PACKS_VERSION = "0.1.0";
export const GEO_PACKS_BASE =
  "https://cdn.jsdelivr.net/npm/@paramira/geo-packs@" +
  GEO_PACKS_VERSION +
  "/data/";
export const GEO_PACKS_INVENTORY =
  "https://data.jsdelivr.com/v1/package/npm/@paramira/geo-packs@" +
  GEO_PACKS_VERSION +
  "/flat";
export const GEO_PACKS_CREDITS = GEO_PACKS_BASE + "CREDITS.md";

export function geoPacksConfigs(inventory, world, topojson) {
  if (!Array.isArray(inventory?.files) || world?.type !== "Topology")
    throw new Error("Invalid Geo Packs inventory or world topology");
  const available = new Set(
    inventory.files
      .map((file) => /^\/data\/countries\/([A-Z]{3})\.adm1\.topo\.json$/.exec(file.name)?.[1])
      .filter(Boolean),
  );
  const objects = Object.values(world.objects ?? {}).filter(
    (object) => object.type === "GeometryCollection",
  );
  if (objects.length !== 1)
    throw new Error("Expected one Geo Packs world geometry collection");
  const features = topojson.feature(world, objects[0]).features;
  const seen = new Set();
  const configs = [];
  for (const feature of features) {
    const iso = feature.properties?.iso3;
    if (!available.has(iso) || iso === "USA" || seen.has(iso)) continue;
    if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type))
      continue;
    const cap = computeFeatureCap(feature);
    if (!cap || !Number.isFinite(cap.radiusRad)) continue;
    seen.add(iso);
    configs.push({
      id: iso.toLowerCase() + "-adm1",
      url: GEO_PACKS_BASE + "countries/" + iso + ".adm1.topo.json",
      autoObject: true,
      // World outlines are only an approximation to subdivision extents.
      // Pad the cap by 5 degrees to reduce cross-source boundary misses.
      caps: [{ ...cap, radiusRad: Math.min(Math.PI, cap.radiusRad + Math.PI / 36) }],
      enter: 3,
      exit: 2.7,
      offset: 3,
      color: "#aca4ee",
      width: 0.65,
      international: true,
    });
  }
  if (!configs.length) throw new Error("No Geo Packs ADM1 layers matched");
  return configs;
}

export async function loadGeoPacksConfigs(topojson, fetcher = globalThis.fetch) {
  async function json(url) {
    const response = await fetcher(url);
    if (!response.ok) throw new Error("Geo Packs HTTP " + response.status + ": " + url);
    return response.json();
  }
  const [inventory, world] = await Promise.all([
    json(GEO_PACKS_INVENTORY),
    json(GEO_PACKS_BASE + "world.topo.json"),
  ]);
  return geoPacksConfigs(inventory, world, topojson);
}

// Do not guess the object key of a remote topology.
export function geoPacksObject(topology) {
  if (topology?.type !== "Topology") throw new Error("Expected Geo Packs TopoJSON");
  const keys = Object.keys(topology.objects ?? {}).filter((key) => {
    const object = topology.objects[key];
    return object.type === "GeometryCollection" &&
      object.geometries.length > 0 &&
      object.geometries.every((g) => ["Polygon", "MultiPolygon"].includes(g.type));
  });
  if (keys.length !== 1) throw new Error("Expected one Geo Packs polygon collection");
  return keys[0];
}
