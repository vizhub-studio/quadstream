// Resolve built-in atlas assets without mixing transport with geometry policy.
const npm = "https://cdn.jsdelivr.net/npm/";
const remote = Object.freeze({
  "world/50m.json": npm + "visionscarto-world-atlas@1.0.0/world/50m.json",
  "world/110m.json": npm + "visionscarto-world-atlas@1.0.0/world/110m.json",
  "us/states-10m.json": npm + "us-atlas@3.0.1/states-10m.json",
  "us/counties-10m.json": npm + "us-atlas@3.0.1/counties-10m.json",
});

export function geometryMode(params, cdnOnly = false) {
  return cdnOnly || params.get("geometry") === "cdn" ? "cdn" : "local";
}

export function internationalMode(params, mode) {
  const value = params.get("international");
  if (value === "0") return "0";
  if (value === "cdn") return "cdn";
  return mode === "cdn" ? "cdn" : "local";
}

export function createGeometryResolver({ mode, localAsset }) {
  return (path) => {
    if (mode === "local") return localAsset(path);
    if (Object.hasOwn(remote, path)) return remote[path];
    throw new Error("No CDN geometry source for " + path);
  };
}
