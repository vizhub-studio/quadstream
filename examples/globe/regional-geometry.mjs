// Select intrastate county arcs before stitching the nationwide mesh.
// TopoJSON's mesh filter only receives the first and last owners of an arc.
// At quantized multi-owner junctions those owners may be in different states
// even when two distinct counties in one state share the arc.
function sameStateMesh(topology, object, topojson) {
  const byState = new Map();
  for (const geometry of object.geometries) {
    const state = String(geometry.id).slice(0, 2);
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(geometry);
  }
  const selected = new Set();
  for (const geometries of byState.values()) {
    const mesh = topojson.meshArcs(
      topology,
      { type: "GeometryCollection", geometries },
      (a, b) => a !== b,
    );
    for (const line of mesh.arcs) {
      for (const arc of line) selected.add(arc < 0 ? ~arc : arc);
    }
  }
  // Stitch once after deduplicating by absolute arc index, including arcs
  // shared by multiple intrastate groups. Do not duplicate state borders.
  return topojson.mesh(topology, {
    type: "MultiLineString",
    arcs: Array.from(selected, (arc) => [arc]),
  });
}

// Draw a deduplicated state mesh, including exterior arcs such as lake shores.
export function internalBoundaryMesh(topology, config, topojson) {
  const object = topology.objects?.[config.object];
  if (!object) throw new Error("Missing regional object: " + config.object);
  const mesh = config.sameState
    ? sameStateMesh(topology, object, topojson)
    : topojson.mesh(
        topology,
        object,
        // TopoJSON passes the same owning geometry twice for unshared arcs.
        (a, b) => a != null && b != null && (config.includeExternal || a !== b),
      );
  if (!mesh.coordinates.length) throw new Error("Empty regional boundary mesh");
  return mesh;
}
