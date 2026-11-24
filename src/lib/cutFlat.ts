// Flat base for a closed solid, without voxels: everything below a floor height (y, up) is cut away and the cut is
// closed with a flat cap, so the solid stays watertight and stands on the bed. Triangles that cross the floor are split
// along it, so the walls keep their shape exactly down to the floor. The cap is a constrained Delaunay triangulation
// (cdt2d) of the cut's outlines in the floor plane, holes included, facing down and sharing the walls' vertices.
import triangulate from 'cdt2d'

export type CutMesh = { positions: Float32Array; indices: Uint32Array; origin: Uint32Array; origin2: Uint32Array; capArea: number }

// origin and origin2 carry each vertex's source vertices through the cut, for overlay colors; a point made on an edge
// takes the end above the floor.
export function cutFlat(positions: ArrayLike<number>, indices: ArrayLike<number>, floor: number,
  origin?: ArrayLike<number>, origin2?: ArrayLike<number>): CutMesh {
  const n = positions.length / 3
  let low = Infinity, high = -Infinity, span = 0
  for (let v = 0; v < n; v++) { low = Math.min(low, positions[v * 3 + 1]); high = Math.max(high, positions[v * 3 + 1]) }
  for (let a = 0; a < 3; a++) {
    let lo = Infinity, hi = -Infinity
    for (let v = 0; v < n; v++) { lo = Math.min(lo, positions[v * 3 + a]); hi = Math.max(hi, positions[v * 3 + a]) }
    span = Math.max(span, hi - lo)
  }
  const own = (v: number) => origin ? origin[v] : v, own2 = (v: number) => origin2 ? origin2[v] : own(v)
  if (!(floor > low) || !n) {
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), origin: Uint32Array.from({ length: n }, (_, v) => own(v)),
      origin2: Uint32Array.from({ length: n }, (_, v) => own2(v)), capArea: 0 }
  }
  // Points this close to the floor are on it, so a vertex just above or below doesn't leave a sliver.
  const near = 1e-6 * (span || 1)
  const y = (v: number) => { const h = positions[v * 3 + 1]; return Math.abs(h - floor) <= near ? floor : h }
  const side = (v: number) => Math.sign(y(v) - floor)

  const P: number[] = [], O: number[] = [], O2: number[] = [], out: number[] = []
  const kept = new Int32Array(n).fill(-1)
  const vertex = (v: number) => {
    if (kept[v] < 0) { kept[v] = P.length / 3; P.push(positions[v * 3], y(v), positions[v * 3 + 2]); O.push(own(v)); O2.push(own2(v)) }
    return kept[v]
  }
  const crossings = new Map<number, number>()
  const crossing = (a: number, b: number) => {
    const key = a < b ? a * n + b : b * n + a
    let made = crossings.get(key)
    if (made === undefined) {
      const t = (floor - y(a)) / (y(b) - y(a)), up = side(a) > 0 ? a : b
      made = P.length / 3
      P.push(positions[a * 3] + t * (positions[b * 3] - positions[a * 3]), floor, positions[a * 3 + 2] + t * (positions[b * 3 + 2] - positions[a * 3 + 2]))
      O.push(own(up)); O2.push(own2(up))
      crossings.set(key, made)
    }
    return made
  }
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]], sides = corners.map(side)
    if (sides.every(s => s <= 0)) continue          // below, or lying on the floor: the cap replaces it
    if (sides.every(s => s >= 0)) { out.push(vertex(corners[0]), vertex(corners[1]), vertex(corners[2])); continue }
    // Crosses the floor: keep the part above, a triangle or a quadrilateral, in the same turning order.
    const polygon: number[] = []
    for (let k = 0; k < 3; k++) {
      const a = corners[k], b = corners[(k + 1) % 3]
      if (sides[k] >= 0) polygon.push(vertex(a))
      if (sides[k] * sides[(k + 1) % 3] < 0) polygon.push(crossing(a, b))
    }
    for (let k = 1; k + 1 < polygon.length; k++) out.push(polygon[0], polygon[k], polygon[k + 1])
  }
  // The cut leaves edges with a face on one side only, all on the floor. Their outlines are the cap's boundary.
  const directed = new Set<number>(), total = P.length / 3
  for (let t = 0; t < out.length; t += 3) for (let k = 0; k < 3; k++) directed.add(out[t + k] * total + out[t + (k + 1) % 3])
  const local = new Map<number, number>(), points: number[][] = [], edges: number[][] = []
  const at = (v: number) => { let i = local.get(v); if (i === undefined) { i = points.length; local.set(v, i); points.push([P[v * 3], P[v * 3 + 2]]) } return i }
  for (const key of directed) {
    const a = Math.floor(key / total), b = key % total
    // Only the cut's own edges, both ends on the floor: an open edge elsewhere would mean the mesh wasn't closed.
    if (directed.has(b * total + a) || P[a * 3 + 1] !== floor || P[b * 3 + 1] !== floor) continue
    edges.push([at(a), at(b)])
  }
  const globalOf = [...local.keys()]
  let capArea = 0
  if (edges.length) {
    for (const [a, b, c] of triangulate(points, edges, { exterior: false })) {
      const [ga, gb, gc] = [globalOf[a], globalOf[b], globalOf[c]]
      // The height part of the triangle's normal: below zero, it faces down, out of the solid.
      const cross = (P[gb * 3 + 2] - P[ga * 3 + 2]) * (P[gc * 3] - P[ga * 3]) - (P[gb * 3] - P[ga * 3]) * (P[gc * 3 + 2] - P[ga * 3 + 2])
      if (cross === 0) continue
      if (cross < 0) out.push(ga, gb, gc); else out.push(ga, gc, gb)
      capArea += Math.abs(cross) / 2
    }
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(out), origin: Uint32Array.from(O), origin2: Uint32Array.from(O2), capArea }
}
