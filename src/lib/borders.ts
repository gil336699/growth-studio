// Design borders on a starting shape, for the Edges tool: every edge sharper than the sharp-edge angle, and where a flat
// face of the design ends at a curve, such as where a fillet starts, though the surface turns smoothly there. And edge
// loops through them: from a clicked edge, along borders, until the loop closes or turns a corner.
//
// A CAD export cuts a curve into flat facets, so a flat face is a design face only if it's much wider than the faces it
// turns smoothly into: the flat top of a filleted block is nine times wider than the fillet's strips, while a coarse
// cylinder's facets are all as wide as each other, so the cylinder has no borders between them.
import { SHARP_ANGLE } from './smoothSheet'
import { edgeUse } from './meshCheck'

// Faces joined across edges that bend less than this are one flat face.
const FLAT_ANGLE = 0.5
// How much wider than the faces it turns smoothly into a flat face must be to count as a design face.
const DESIGN_WIDTH = 3
// A loop stops where it would turn more than this.
export const CORNER_ANGLE = 45

export type Borders = { sharp: Uint32Array; smooth: Uint32Array }

export function findBorders(positions: ArrayLike<number>, indices: ArrayLike<number>, sharpAngle = SHARP_ANGLE): Borders {
  const P = positions, I = indices, F = I.length / 3, n = P.length / 3
  const N = new Float64Array(F * 3), A = new Float64Array(F)
  for (let f = 0; f < F; f++) {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2]
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz)
    if (l > 0) { N[f * 3] = nx / l; N[f * 3 + 1] = ny / l; N[f * 3 + 2] = nz / l; A[f] = l / 2 }
  }
  const { faces } = edgeUse(I, n)
  const bend = (f: number, g: number) => Math.acos(Math.max(-1, Math.min(1, N[f * 3] * N[g * 3] + N[f * 3 + 1] * N[g * 3 + 1] + N[f * 3 + 2] * N[g * 3 + 2]))) * 180 / Math.PI
  // Flat faces: faces joined across edges that bend under FLAT_ANGLE.
  const parent = Int32Array.from({ length: F }, (_, i) => i)
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const bends = new Map<number, number>()
  for (const [key, list] of faces) {
    if (list.length !== 2 || !A[list[0]] || !A[list[1]]) continue
    const angle = bend(list[0], list[1])
    bends.set(key, angle)
    if (angle < FLAT_ANGLE) { const r = find(list[0]), s = find(list[1]); if (r !== s) parent[r] = s }
  }
  // Each flat face's width, 2 × area / perimeter, and the widest face it turns smoothly into.
  const area = new Map<number, number>(), perimeter = new Map<number, number>()
  for (let f = 0; f < F; f++) { const r = find(f); area.set(r, (area.get(r) ?? 0) + A[f]) }
  const length = (key: number) => { const a = Math.floor(key / n) * 3, b = (key % n) * 3; return Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]) }
  for (const [key, list] of faces) {
    const groups = new Set(list.map(find))
    if (groups.size === 1 && list.length === 2) continue
    for (const r of groups) perimeter.set(r, (perimeter.get(r) ?? 0) + length(key))
  }
  const width = (r: number) => 2 * (area.get(r) ?? 0) / (perimeter.get(r) || Infinity)
  const widestNeighbour = new Map<number, number>()
  for (const [key, angle] of bends) {
    if (angle < FLAT_ANGLE || angle > sharpAngle) continue
    const [f, g] = faces.get(key)!, r = find(f), s = find(g)
    widestNeighbour.set(r, Math.max(widestNeighbour.get(r) ?? 0, width(s)))
    widestNeighbour.set(s, Math.max(widestNeighbour.get(s) ?? 0, width(r)))
  }
  const design = (r: number) => width(r) >= DESIGN_WIDTH * (widestNeighbour.get(r) ?? 0)
  const sharp: number[] = [], smooth: number[] = []
  for (const [key, angle] of bends) {
    const a = Math.floor(key / n), b = key % n
    if (angle > sharpAngle) { sharp.push(a, b); continue }
    if (angle < FLAT_ANGLE) continue
    const [f, g] = faces.get(key)!
    if (design(find(f)) || design(find(g))) smooth.push(a, b)
  }
  return { sharp: Uint32Array.from(sharp), smooth: Uint32Array.from(smooth) }
}

// The loop through the border edge (a, b): it carries on at each end along the border that turns least, up to
// cornerAngle, and stops where it would turn more or where it closes. Returns the loop's edges as pairs.
export function traceLoop(borders: Borders, positions: ArrayLike<number>, a: number, b: number, cornerAngle = CORNER_ANGLE): Uint32Array {
  const next = new Map<number, number[]>()
  const link = (u: number, v: number) => { (next.get(u) ?? next.set(u, []).get(u)!).push(v) }
  for (const list of [borders.sharp, borders.smooth]) for (let i = 0; i < list.length; i += 2) { link(list[i], list[i + 1]); link(list[i + 1], list[i]) }
  const dir = (u: number, v: number) => {
    const x = positions[v * 3] - positions[u * 3], y = positions[v * 3 + 1] - positions[u * 3 + 1], z = positions[v * 3 + 2] - positions[u * 3 + 2], l = Math.hypot(x, y, z) || 1
    return [x / l, y / l, z / l]
  }
  const limit = Math.cos(cornerAngle * Math.PI / 180)
  // Walk on from cur (having come from prev) while the border turns little; returns the points passed and whether the
  // walk came back to `home`.
  const walk = (prev: number, cur: number, home: number, seen: Set<number>) => {
    const path: number[] = []
    for (;;) {
      const d = dir(prev, cur)
      let best = -1, bestCos = -Infinity
      for (const v of next.get(cur) ?? []) {
        if (v === prev) continue
        const e = dir(cur, v), cos = d[0] * e[0] + d[1] * e[1] + d[2] * e[2]
        if (cos > bestCos) { bestCos = cos; best = v }
      }
      if (best < 0 || bestCos < limit) return { path, closed: false }
      if (best === home) return { path, closed: true }
      if (seen.has(best)) return { path, closed: false }
      seen.add(best); path.push(best); prev = cur; cur = best
    }
  }
  const seen = new Set([a, b])
  const ahead = walk(a, b, a, seen)
  const points = [a, b, ...ahead.path]
  if (!ahead.closed) {
    const behind = walk(b, a, b, seen)
    points.unshift(...behind.path.reverse())
  }
  const edges: number[] = []
  for (let i = 0; i + 1 < points.length; i++) edges.push(points[i], points[i + 1])
  if (ahead.closed) edges.push(points[points.length - 1], points[0])
  return Uint32Array.from(edges)
}

// A loop as points on the starting shape, in order, which stays valid while growth splits its edges.
export type LoopPoints = { points: Float32Array; closed: boolean }

export function loopPoints(edges: ArrayLike<number>, positions: ArrayLike<number>): LoopPoints {
  const next = new Map<number, number[]>()
  for (let i = 0; i < edges.length; i += 2) {
    (next.get(edges[i]) ?? next.set(edges[i], []).get(edges[i])!).push(edges[i + 1]);
    (next.get(edges[i + 1]) ?? next.set(edges[i + 1], []).get(edges[i + 1])!).push(edges[i])
  }
  const start = [...next.keys()].find(v => next.get(v)!.length === 1) ?? edges[0]
  const closed = [...next.values()].every(list => list.length === 2)
  const order = [start]
  for (let prev = -1, cur = start; ;) {
    const v = next.get(cur)!.find(u => u !== prev && !order.includes(u))
    if (v === undefined) break
    order.push(v); prev = cur; cur = v
  }
  return { points: Float32Array.from(order.flatMap(v => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]])), closed }
}

// The edges of a mesh that lie on a loop: both ends and the middle on its line, so an edge that growth split in two is
// found as its two halves. positions are the starting shape's, for the mesh as it is now.
export function edgesOnLoop(loop: LoopPoints, positions: ArrayLike<number>, indices: ArrayLike<number>, tolerance = 1e-5): Uint32Array {
  const L = loop.points, segments = L.length / 3 - (loop.closed ? 0 : 1)
  // The loop's box, widened by the tolerance: most of a mesh lies outside it, and is passed over at once.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < L.length; i++) { lo[i % 3] = Math.min(lo[i % 3], L[i] - tolerance); hi[i % 3] = Math.max(hi[i % 3], L[i] + tolerance) }
  const onLine = (x: number, y: number, z: number) => {
    if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) return false
    for (let s = 0; s < segments; s++) {
      const a = s * 3, b = ((s + 1) % (L.length / 3)) * 3
      const dx = L[b] - L[a], dy = L[b + 1] - L[a + 1], dz = L[b + 2] - L[a + 2], d2 = dx * dx + dy * dy + dz * dz
      const t = Math.max(0, Math.min(1, ((x - L[a]) * dx + (y - L[a + 1]) * dy + (z - L[a + 2]) * dz) / (d2 || 1)))
      if (Math.hypot(x - L[a] - t * dx, y - L[a + 1] - t * dy, z - L[a + 2] - t * dz) <= tolerance) return true
    }
    return false
  }
  const P = positions, n = P.length / 3, seen = new Set<number>(), out: number[] = []
  const at = new Map<number, boolean>()
  const on = (v: number) => { let r = at.get(v); if (r === undefined) { r = onLine(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); at.set(v, r) } return r }
  for (let f = 0; f < indices.length; f += 3) for (let k = 0; k < 3; k++) {
    const a = indices[f + k], b = indices[f + (k + 1) % 3], key = a < b ? a * n + b : b * n + a
    if (seen.has(key)) continue
    seen.add(key)
    if (on(a) && on(b) && onLine((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2)) out.push(a, b)
  }
  return Uint32Array.from(out)
}
