// Turns an open surface into a printable solid: a wall of even thickness on one or both sides of the surface,
// closed along the open rims with a round, soft, or square edge. The surface keeps every fold; nothing is resampled.
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3, type Triangle } from 'three'
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh'

export type RimProfile = 'round' | 'soft' | 'square'
// Where the wall goes: centered on the surface, or all of it on the outside or the inside.
export type WallSide = 'both' | 'outside' | 'inside'
export const WALL_SHIFT: Record<WallSide, number> = { both: 0, outside: 1, inside: -1 }
// How much of the half-thickness the rim's corners round off: 1 is a half-circle, 0 a flat cut.
export const RIM_ROUNDNESS: Record<RimProfile, number> = { round: 1, soft: 0.5, square: 0 }

export type Solid = {
  positions: Float32Array
  indices: Uint32Array
  // The surface vertex each solid vertex came from, so overlay colors carry over.
  origin: Uint32Array
  // What each solid vertex counts as for the crossing check, when that isn't origin: faces whose corners share one
  // aren't counted (solidCrossings). A round's points count as their own, so folds inside a round are seen.
  groups?: Uint32Array
  // A second surface vertex whose color is averaged with origin's: set for a sheet smoothed before its wall.
  blend?: Uint32Array
  // Surface edges used by only one face, now closed by the rim.
  rimEdges: number
  // Drawn with smooth shading: the outer layer of a closed shape, which has no facets to keep.
  smooth?: boolean
}

// The rim's cross-section from the top face to the bottom face, as [outward, along the normal] pairs.
export function rimProfile(half: number, roundness: number, quarterSegments = 4): [number, number][] {
  const r = half * Math.min(1, Math.max(0, roundness))
  if (r <= half * 1e-6) return [[0, half], [0, -half]]
  const points: [number, number][] = []
  for (let i = 0; i <= quarterSegments; i++) {
    const angle = Math.PI / 2 * (1 - i / quarterSegments)
    points.push([r * Math.cos(angle), half - r + r * Math.sin(angle)])
  }
  // A fully round rim meets itself halfway down, so the two corners share that point.
  for (let i = half - r <= half * 1e-6 ? 1 : 0; i <= quarterSegments; i++) {
    const angle = -Math.PI / 2 * (i / quarterSegments)
    points.push([r * Math.cos(angle), r - half + r * Math.sin(angle)])
  }
  return points
}

// shift moves the wall along the face normals: 0 centers it on the surface, 1 puts all of it on the side the faces
// point to, and -1 all of it on the other side, so the surface itself stays one face of the solid.
// given: a normal for some points, x, y, z for each point (zero for none), as a round knows its own (lib/roundEdges);
// the wall follows it there instead of the faces' average, and is pushed no further, since the surface is smooth there.
export function thicken(positions: ArrayLike<number>, indices: ArrayLike<number>, thickness: number, roundness: number,
  quarterSegments = 4, shift = 0, given?: ArrayLike<number>): Solid {
  const n = positions.length / 3, faces = indices.length / 3
  const half = thickness / 2, middle = half * Math.min(1, Math.max(-1, shift))
  const at = (v: number, axis: number) => positions[v * 3 + axis]

  // Unit face normals, angle-weighted vertex normals, and each corner's angle.
  const faceNormals = new Float64Array(faces * 3)
  const corners = new Float64Array(faces * 3)
  const normals = new Float64Array(n * 3)
  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2]
    const ab = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)]
    const ac = [at(c, 0) - at(a, 0), at(c, 1) - at(a, 1), at(c, 2) - at(a, 2)]
    const bc = [at(c, 0) - at(b, 0), at(c, 1) - at(b, 1), at(c, 2) - at(b, 2)]
    const nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0]
    const length = Math.hypot(nx, ny, nz)
    if (!length) continue
    faceNormals[f * 3] = nx / length; faceNormals[f * 3 + 1] = ny / length; faceNormals[f * 3 + 2] = nz / length
    const angle = (u: number[], w: number[]) => {
      const lu = Math.hypot(u[0], u[1], u[2]), lw = Math.hypot(w[0], w[1], w[2])
      return lu && lw ? Math.acos(Math.min(1, Math.max(-1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (lu * lw)))) : 0
    }
    const angles = [angle(ab, ac), angle(bc, ab.map(value => -value)), Math.PI - angle(ab, ac) - angle(bc, ab.map(value => -value))]
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k]
      corners[f * 3 + k] = angles[k]
      for (let axis = 0; axis < 3; axis++) normals[v * 3 + axis] += faceNormals[f * 3 + axis] * angles[k]
    }
  }
  for (let v = 0; v < n; v++) {
    const length = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2])
    if (length) for (let axis = 0; axis < 3; axis++) normals[v * 3 + axis] /= length
    else normals[v * 3 + 1] = 1
  }
  const own = new Uint8Array(n)
  if (given) for (let v = 0; v < n; v++) {
    const x = given[v * 3], y = given[v * 3 + 1], z = given[v * 3 + 2], length = Math.hypot(x, y, z)
    if (length > 0) { normals[v * 3] = x / length; normals[v * 3 + 1] = y / length; normals[v * 3 + 2] = z / length; own[v] = 1 }
  }
  // Even thickness: where faces meet at an angle, push the vertex further so each face's wall keeps its thickness.
  const lean = new Float64Array(n), weight = new Float64Array(n)
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k]
      lean[v] += corners[f * 3 + k] * (normals[v * 3] * faceNormals[f * 3] + normals[v * 3 + 1] * faceNormals[f * 3 + 1] + normals[v * 3 + 2] * faceNormals[f * 3 + 2])
      weight[v] += corners[f * 3 + k]
    }
  }
  const stretch = (v: number) => own[v] || !weight[v] ? 1 : 1 / Math.min(1, Math.max(0.4, lean[v] / weight[v]))

  // Rim edges are used by one face only. Each keeps the direction it runs in its face.
  const firstUse = new Map<number, number>()
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const a = indices[f * 3 + k], b = indices[f * 3 + (k + 1) % 3]
      const key = a < b ? a * n + b : b * n + a
      firstUse.set(key, firstUse.has(key) ? -1 : f * 3 + k)
    }
  }
  const rim: [number, number, number][] = []
  for (const corner of firstUse.values()) {
    if (corner < 0) continue
    const f = Math.floor(corner / 3), k = corner % 3
    rim.push([indices[corner], indices[f * 3 + (k + 1) % 3], f])
  }
  // Outward across each rim vertex: away from the face, in the plane of the surface.
  const slot = new Int32Array(n).fill(-1)
  const outward: number[] = []
  let slots = 0
  for (const [a, b, f] of rim) {
    const e = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)]
    let fn = [faceNormals[f * 3], faceNormals[f * 3 + 1], faceNormals[f * 3 + 2]]
    // A face with no area has no normal of its own, so lean on its rim vertices' normals instead.
    if (!fn[0] && !fn[1] && !fn[2]) fn = [0, 1, 2].map(axis => normals[a * 3 + axis] + normals[b * 3 + axis])
    const o = [e[1] * fn[2] - e[2] * fn[1], e[2] * fn[0] - e[0] * fn[2], e[0] * fn[1] - e[1] * fn[0]]
    const length = Math.hypot(o[0], o[1], o[2]) || 1
    for (const v of [a, b]) {
      if (slot[v] < 0) { slot[v] = slots++; outward.push(0, 0, 0) }
      for (let axis = 0; axis < 3; axis++) outward[slot[v] * 3 + axis] += o[axis] / length
    }
  }

  const profile = rimProfile(half, roundness, quarterSegments)
  const steps = profile.length - 1
  const inner = steps - 1
  const out = new Float32Array((2 * n + slots * inner) * 3)
  const origin = new Uint32Array(2 * n + slots * inner)
  for (let v = 0; v < n; v++) {
    const k = stretch(v)
    for (let axis = 0; axis < 3; axis++) {
      out[v * 3 + axis] = at(v, axis) + normals[v * 3 + axis] * (middle + half) * k
      out[(n + v) * 3 + axis] = at(v, axis) + normals[v * 3 + axis] * (middle - half) * k
    }
    origin[v] = v
    origin[n + v] = v
  }
  for (let v = 0; v < n; v++) {
    const s = slot[v]
    if (s < 0 || !inner) continue
    const normal = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]
    const o = [outward[s * 3], outward[s * 3 + 1], outward[s * 3 + 2]]
    const along = o[0] * normal[0] + o[1] * normal[1] + o[2] * normal[2]
    for (let axis = 0; axis < 3; axis++) o[axis] -= along * normal[axis]
    const length = Math.hypot(o[0], o[1], o[2]) || 1
    const k = stretch(v)
    for (let j = 1; j <= inner; j++) {
      const [u, w] = profile[j]
      const index = 2 * n + s * inner + j - 1
      for (let axis = 0; axis < 3; axis++) out[index * 3 + axis] = at(v, axis) + o[axis] / length * u + normal[axis] * (middle + w) * k
      origin[index] = v
    }
  }

  // Top faces as they are, bottom faces reversed, and a strip of quads around each rim edge.
  const level = (v: number, j: number) => j === 0 ? v : j === steps ? n + v : 2 * n + slot[v] * inner + j - 1
  const triangles = new Uint32Array((faces * 2 + rim.length * steps * 2) * 3)
  let cursor = 0
  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2]
    triangles.set([a, b, c, n + a, n + c, n + b], cursor)
    cursor += 6
  }
  for (const [a, b] of rim) {
    for (let j = 0; j < steps; j++) {
      triangles.set([level(b, j), level(a, j), level(a, j + 1), level(b, j), level(a, j + 1), level(b, j + 1)], cursor)
      cursor += 6
    }
  }
  return { positions: out, indices: triangles, origin, rimEdges: rim.length }
}

// +1 when the faces point to the outside: away from the middle of a form such as a vase, or up for a sheet such as
// the default disk. -1 when they point the other way, so Outside and Inside mean what they say either way.
// A form that is nearly flat has no clear middle to point away from, so it counts as a sheet and uses up.
// Give it the starting shape: the answer then can't change as the model grows.
export function facingSign(positions: ArrayLike<number>, indices: ArrayLike<number>, toward: 'outward' | 'up') {
  const n = positions.length / 3
  const center = [0, 0, 0], low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
  for (let v = 0; v < n; v++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[v * 3 + axis]
      center[axis] += value / n
      low[axis] = Math.min(low[axis], value)
      high[axis] = Math.max(high[axis], value)
    }
  }
  const extent = Math.hypot(...high.map((value, axis) => value - low[axis])) || 1
  let away = 0, up = 0, total = 0
  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [indices[f], indices[f + 1], indices[f + 2]]
    const u = [0, 1, 2].map(axis => positions[b * 3 + axis] - positions[a * 3 + axis])
    const w = [0, 1, 2].map(axis => positions[c * 3 + axis] - positions[a * 3 + axis])
    // Twice the face's area along its normal.
    const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    up += normal[1]
    total += Math.hypot(normal[0], normal[1], normal[2])
    for (let axis = 0; axis < 3; axis++) {
      away += normal[axis] * ((positions[a * 3 + axis] + positions[b * 3 + axis] + positions[c * 3 + axis]) / 3 - center[axis])
    }
  }
  const sum = toward === 'outward' && Math.abs(away) > 0.05 * total * extent ? away : up
  return sum < 0 ? -1 : 1
}

// Edges of a solid that are not shared by exactly two faces turned opposite ways: 0 means it is closed.
// A surface that pinches to a point, or whose faces are turned inconsistently, leaves some.
export function solidLeaks(indices: ArrayLike<number>) {
  let n = 0
  for (let i = 0; i < indices.length; i++) n = Math.max(n, indices[i] + 1)
  const directed = new Map<number, number>()
  for (let f = 0; f < indices.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const key = indices[f + k] * n + indices[f + (k + 1) % 3]
      directed.set(key, (directed.get(key) ?? 0) + 1)
    }
  }
  let leaks = 0
  for (const [key, count] of directed) {
    const a = Math.floor(key / n), b = key % n
    if (count !== 1 || directed.get(b * n + a) !== 1) leaks++
  }
  return leaks
}

// Places where the solid's wall passes through itself, as the solid vertices involved. Faces that share a
// vertex touch by construction and are not counted. Counting stops once there are more than limit, since a surface
// that already crosses itself can cross in millions of places; capped then says there are more than limit.
// Given origin, faces that came from sheet faces sharing a corner aren't counted either. Where a grown sheet crumples
// at a point, its faces there turn more than 90° apart and no single offset suits them all, so the wall overlaps
// within its own thickness of that point, whatever the wall. Slicers merge that; folds meeting and bends tighter
// than the wall, which a thinner wall does fix, are still counted.
export function solidCrossings(positions: Float32Array, indices: Uint32Array, limit = Infinity, origin?: ArrayLike<number>) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  // The tree reorders the index it is given, so give it a copy.
  const order = indices.slice()
  geometry.setIndex(new BufferAttribute(order, 1))
  const tree = new MeshBVH(geometry, { maxLeafTris: 4 })
  const vertices = new Set<number>()
  let pairs = 0
  tree.bvhcast(tree, new Matrix4(), {
    intersectsTriangles(first, second, i, j) {
      if (i >= j) return false
      for (let u = 0; u < 3; u++) for (let w = 0; w < 3; w++) {
        if (order[i * 3 + u] === order[j * 3 + w]) return false
        if (origin && origin[order[i * 3 + u]] === origin[order[j * 3 + w]]) return false
      }
      // A face with no area, such as a sliver in an STL, can't pass through anything, though the test says it touches.
      if (first.getArea() < 1e-14 || second.getArea() < 1e-14 || !first.intersectsTriangle(second) || !crosses(first, second)) return false
      pairs++
      for (let k = 0; k < 3; k++) { vertices.add(order[i * 3 + k]); vertices.add(order[j * 3 + k]) }
      return pairs > limit
    },
  })
  return { pairs: Math.min(pairs, limit), capped: pairs > limit, vertices: [...vertices] }
}

// The faces near `zone` (face numbers) that pass through one of its faces, as [zone face, other face, length of the line
// where they cross]. Faces that share a corner touch by construction and aren't counted, nor are pairs that skip turns
// down. Only faces whose boxes reach the zone's box are looked at, so a small zone on a large mesh is quick. For rounds
// (lib/roundEdges, lib/sheetSolid): a round must not cut through to another part of the surface, nor fold the wall.
export function zoneCrossings(positions: Float32Array, indices: ArrayLike<number>, zone: ArrayLike<number>,
  skip?: (zoneFace: number, other: number) => boolean): [number, number, number][] {
  if (!zone.length) return []
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < zone.length; k++) for (let c = 0; c < 3; c++) {
    const v = indices[zone[k] * 3 + c]
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], positions[v * 3 + a]); hi[a] = Math.max(hi[a], positions[v * 3 + a]) }
  }
  const pad = 1e-6 * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9)
  const near: number[] = []
  for (let f = 0; f < indices.length / 3; f++) {
    let inside = true
    for (let a = 0; a < 3 && inside; a++) {
      const x = positions[indices[f * 3] * 3 + a], y = positions[indices[f * 3 + 1] * 3 + a], z = positions[indices[f * 3 + 2] * 3 + a]
      if (Math.max(x, y, z) < lo[a] - pad || Math.min(x, y, z) > hi[a] + pad) inside = false
    }
    if (inside) near.push(f)
  }
  // A tree over some faces, and which face each of its triangles is: the tree reorders the index it is given.
  const key = (a: number, b: number, c: number) => { const [x, y, z] = [a, b, c].sort((p, q) => p - q); return `${x},${y},${z}` }
  const faceOf = new Map<string, number>()
  for (const f of near) faceOf.set(key(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]), f)
  const tree = (faces: ArrayLike<number>) => {
    const index = new Uint32Array(faces.length * 3)
    for (let k = 0; k < faces.length; k++) for (let c = 0; c < 3; c++) index[k * 3 + c] = indices[faces[k] * 3 + c]
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setIndex(new BufferAttribute(index, 1))
    const bvh = new MeshBVH(geometry, { maxLeafTris: 4 }), order = geometry.index!.array
    const ids = Int32Array.from({ length: faces.length }, (_, t) => faceOf.get(key(order[t * 3], order[t * 3 + 1], order[t * 3 + 2])) ?? -1)
    return { bvh, order, ids, geometry }
  }
  const mine = tree(zone), all = tree(near), out: [number, number, number][] = []
  mine.bvh.bvhcast(all.bvh, new Matrix4(), {
    intersectsTriangles(first, second, i, j) {
      const f = mine.ids[i], g = all.ids[j]
      if (f < 0 || g < 0 || f === g) return false
      for (let u = 0; u < 3; u++) for (let w = 0; w < 3; w++) if (mine.order[i * 3 + u] === all.order[j * 3 + w]) return false
      if (first.getArea() < 1e-14 || second.getArea() < 1e-14 || !first.intersectsTriangle(second) || !crosses(first, second)) return false
      if (skip?.(f, g)) return false
      out.push([f, g, crossingLength(first, second)])
      return false
    },
  })
  mine.geometry.dispose(); all.geometry.dispose()
  return out
}

// How far rays travel from each start (x, y, z) along its direction through a closed mesh whose faces face out, before
// they leave it through a face, up to far: for how thick a wall a round leaves (lib/roundEdges). Only faces a ray leaves
// through count, those whose normal points along it, so a ray that starts a hair outside a face doesn't stop at it.
// A face that uses the ray's own point (own, or -1 for none) doesn't count, nor one within a millionth of far of the
// start, nor one skip(ray, face) turns down (face numbers of indices). Only faces whose boxes come within far of a start
// are looked at.
export function rayDepths(positions: Float32Array, indices: ArrayLike<number>, starts: ArrayLike<number>, directions: ArrayLike<number>,
  own: ArrayLike<number>, far: number, skip?: (ray: number, face: number) => boolean): Float64Array {
  const count = starts.length / 3, out = new Float64Array(count).fill(far)
  if (!count || !(far > 0)) return out
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < count; k++) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], starts[k * 3 + a] - far); hi[a] = Math.max(hi[a], starts[k * 3 + a] + far)
  }
  const near: number[] = []
  for (let f = 0; f < indices.length / 3; f++) {
    let inside = true
    for (let a = 0; a < 3 && inside; a++) {
      const x = positions[indices[f * 3] * 3 + a], y = positions[indices[f * 3 + 1] * 3 + a], z = positions[indices[f * 3 + 2] * 3 + a]
      if (Math.max(x, y, z) < lo[a] || Math.min(x, y, z) > hi[a]) inside = false
    }
    if (inside) near.push(f)
  }
  if (!near.length) return out
  const index = new Uint32Array(near.length * 3)
  for (let k = 0; k < near.length; k++) for (let c = 0; c < 3; c++) index[k * 3 + c] = indices[near[k] * 3 + c]
  // The tree reorders the faces it is given but keeps each face's corners in order, which is how a hit is found again.
  const faceOf = new Map<string, number>()
  if (skip) for (const f of near) faceOf.set(`${indices[f * 3]},${indices[f * 3 + 1]},${indices[f * 3 + 2]}`, f)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  const bvh = new MeshBVH(geometry, { maxLeafTris: 4 }), order = geometry.index!.array
  const ray = new Ray(), origin = new Vector3(), direction = new Vector3()
  const at = (v: number, axis: number) => positions[v * 3 + axis]
  for (let k = 0; k < count; k++) {
    direction.set(directions[k * 3], directions[k * 3 + 1], directions[k * 3 + 2])
    if (!(direction.lengthSq() > 0)) continue
    direction.normalize()
    ray.set(origin.set(starts[k * 3], starts[k * 3 + 1], starts[k * 3 + 2]), direction)
    const v = own[k]
    for (const hit of bvh.raycast(ray, DoubleSide, 0, far)) {
      const t = hit.faceIndex ?? -1
      if (t < 0 || hit.distance <= far * 1e-6 || !(hit.distance < out[k])) continue
      const a = order[t * 3], b = order[t * 3 + 1], c = order[t * 3 + 2]
      if (v >= 0 && (a === v || b === v || c === v)) continue
      const ux = at(b, 0) - at(a, 0), uy = at(b, 1) - at(a, 1), uz = at(b, 2) - at(a, 2), wx = at(c, 0) - at(a, 0), wy = at(c, 1) - at(a, 1), wz = at(c, 2) - at(a, 2)
      if (!((uy * wz - uz * wy) * direction.x + (uz * wx - ux * wz) * direction.y + (ux * wy - uy * wx) * direction.z > 0)) continue
      if (skip && skip(k, faceOf.get(`${a},${b},${c}`) ?? -1)) continue
      out[k] = hit.distance
    }
  }
  geometry.dispose()
  return out
}

// Whether faces (a, b, c) and (d, e, f) of a mesh pass through each other, by the same tests.
export function facesCross(positions: ArrayLike<number>, first: ArrayLike<number>, second: ArrayLike<number>) {
  const at = (v: number) => new Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
  const t1 = new ExtendedTriangle(at(first[0]), at(first[1]), at(first[2])), t2 = new ExtendedTriangle(at(second[0]), at(second[1]), at(second[2]))
  t1.needsUpdate = true; t2.needsUpdate = true
  return t1.getArea() >= 1e-14 && t2.getArea() >= 1e-14 && t1.intersectsTriangle(t2) && crosses(t1, t2)
}

// Whether two faces the tree's test says intersect pass through each other or meet along a line: the line where their
// planes meet holds a piece of each, and the pieces overlap by more than rounding (Möller's interval test, with a
// tolerance scaled to the faces). The tree's test, whose tolerance is a fixed 1e-15, also counts faces that only touch
// at a point, as where a round's last row on a flat face meets a face hinged on that row. Faces in one plane, or lying
// on each other within a ten-millionth of their size, count when they overlap in that plane by more than rounding: the
// line where such planes meet is rounding noise.
function crosses(first: Triangle, second: Triangle) {
  const meet = meeting(first, second)
  return meet.flat ? meet.overlaps : meet.length > meet.tolerance
}
// How long the line is where two faces cross: 0 for faces that only touch, and for faces in one plane.
export function crossingLength(first: Triangle, second: Triangle) {
  const meet = meeting(first, second)
  return !meet.flat && meet.length > meet.tolerance ? meet.length : 0
}
// How two faces meet: for faces in one plane, whether they overlap there; otherwise the overlap of their pieces of the
// line where their planes meet, with the tolerance for rounding. A negative length: the pieces don't meet.
function meeting(first: Triangle, second: Triangle): { flat: true; overlaps: boolean } | { flat: false; length: number; tolerance: number } {
  const A = [first.a, first.b, first.c], B = [second.a, second.b, second.c]
  const normal = (T: Vector3[]) => new Vector3().subVectors(T[1], T[0]).cross(new Vector3().subVectors(T[2], T[0]))
  const nA = normal(A), nB = normal(B), line = new Vector3().crossVectors(nA, nB)
  let size = 0
  for (const p of [...A, ...B]) for (const q of [...A, ...B]) size = Math.max(size, p.distanceTo(q))
  const tolerance = 1e-9 * size
  const depth = (p: Vector3, n: Vector3, on: Vector3) => Math.abs(n.dot(new Vector3().subVectors(p, on))) / n.length()
  if (line.length() <= 1e-10 * nA.length() * nB.length()
    || (A.every(p => depth(p, nB, B[0]) <= 1e-7 * size) && B.every(p => depth(p, nA, A[0]) <= 1e-7 * size))) {
    return { flat: true, overlaps: overlapInPlane(A, B, nA, tolerance) }
  }
  const along = line.normalize()
  // A face's piece of the line: where its edges cross the other face's plane, and its corners that lie on that plane.
  const piece = (T: Vector3[], n: Vector3, on: Vector3) => {
    const d = T.map(p => { const x = n.dot(new Vector3().subVectors(p, on)) / n.length(); return Math.abs(x) < tolerance ? 0 : x })
    if (d.every(x => x > 0) || d.every(x => x < 0)) return null
    let low = Infinity, high = -Infinity
    const add = (p: Vector3) => { const s = p.dot(along); low = Math.min(low, s); high = Math.max(high, s) }
    for (let k = 0; k < 3; k++) {
      const dp = d[k], dq = d[(k + 1) % 3]
      if (dp === 0) add(T[k])
      if (dp * dq < 0) add(new Vector3().lerpVectors(T[k], T[(k + 1) % 3], dp / (dp - dq)))
    }
    return [low, high]
  }
  const a = piece(A, nB, B[0]), b = piece(B, nA, A[0])
  if (!a || !b) return { flat: false, length: -Infinity, tolerance }
  return { flat: false, length: Math.min(a[1], b[1]) - Math.max(a[0], b[0]), tolerance }
}
// Whether two faces in one plane (normal n) overlap there by more than tolerance: no edge of either separates them
// (the separating-axis test, in the plane seen along the axis it faces most).
function overlapInPlane(A: Vector3[], B: Vector3[], n: Vector3, tolerance: number) {
  const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2
  const flat = (p: Vector3): [number, number] => ax === 0 ? [p.y, p.z] : ax === 1 ? [p.z, p.x] : [p.x, p.y]
  const a = A.map(flat), b = B.map(flat)
  const span = (T: [number, number][], nx: number, ny: number) => {
    let low = Infinity, high = -Infinity
    for (const [x, y] of T) { const s = x * nx + y * ny; low = Math.min(low, s); high = Math.max(high, s) }
    return [low, high]
  }
  for (const T of [a, b]) for (let k = 0; k < 3; k++) {
    const p = T[k], q = T[(k + 1) % 3], l = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (!l) continue
    const nx = (q[1] - p[1]) / l, ny = (p[0] - q[0]) / l, [l1, h1] = span(a, nx, ny), [l2, h2] = span(b, nx, ny)
    if (Math.min(h1, h2) - Math.max(l1, l2) <= tolerance) return false
  }
  return true
}

// Millimeters per model unit for printing: an STL keeps its own millimeters, and the default disk is scaled
// so its longest side has the chosen length.
export function printScale(positions: ArrayLike<number>, sourceScale: number | null, longestSide: number) {
  if (sourceScale) return sourceScale
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    low[i % 3] = Math.min(low[i % 3], positions[i])
    high[i % 3] = Math.max(high[i % 3], positions[i])
  }
  const extent = Math.max(...high.map((value, axis) => value - low[axis]))
  return extent > 0 ? longestSide / extent : 1
}
