// Draw a deduplicated state mesh, including exterior arcs such as lake shores.
export function internalBoundaryMesh(topology, config, topojson) {
  const object = topology.objects?.[config.object];
  if (!object) throw new Error("Missing regional object: " + config.object);
  const mesh = topojson.mesh(
    topology,
    object,
    (a, b) =>
      // TopoJSON passes the same owning geometry twice for unshared arcs.
      (config.includeExternal && a != null && a === b) ||
      (a != null &&
        b != null &&
        a !== b &&
        (!config.sameState ||
          String(a.id).slice(0, 2) === String(b.id).slice(0, 2))),
  );
  if (!mesh.coordinates.length) throw new Error("Empty regional boundary mesh");
  return mesh;
}
