// Turns an open surface into a printable solid: a wall of even thickness centered on the surface, closed along
// the open rims with a round, soft, or square edge. The surface keeps every fold; nothing is resampled.
import { BufferAttribute, BufferGeometry, Matrix4 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export type RimProfile = 'round' | 'soft' | 'square'
// How much of the half-thickness the rim's corners round off: 1 is a half-circle, 0 a flat cut.
export const RIM_ROUNDNESS: Record<RimProfile, number> = { round: 1, soft: 0.5, square: 0 }

export type Solid = {
  positions: Float32Array
  indices: Uint32Array
  // The surface vertex each solid vertex came from, so overlay colors carry over.
  origin: Uint32Array
  // Surface edges used by only one face, now closed by the rim.
  rimEdges: number
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

export function thicken(positions: ArrayLike<number>, indices: ArrayLike<number>, thickness: number, roundness: number, quarterSegments = 4): Solid {
  const n = positions.length / 3, faces = indices.length / 3
  const half = thickness / 2
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
  // Even thickness: where faces meet at an angle, push the vertex further so each face's wall keeps its thickness.
  const lean = new Float64Array(n), weight = new Float64Array(n)
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k]
      lean[v] += corners[f * 3 + k] * (normals[v * 3] * faceNormals[f * 3] + normals[v * 3 + 1] * faceNormals[f * 3 + 1] + normals[v * 3 + 2] * faceNormals[f * 3 + 2])
      weight[v] += corners[f * 3 + k]
    }
  }
  const stretch = (v: number) => weight[v] ? 1 / Math.min(1, Math.max(0.4, lean[v] / weight[v])) : 1

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
    const fn = [faceNormals[f * 3], faceNormals[f * 3 + 1], faceNormals[f * 3 + 2]]
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
    const offset = half * stretch(v)
    for (let axis = 0; axis < 3; axis++) {
      out[v * 3 + axis] = at(v, axis) + normals[v * 3 + axis] * offset
      out[(n + v) * 3 + axis] = at(v, axis) - normals[v * 3 + axis] * offset
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
      for (let axis = 0; axis < 3; axis++) out[index * 3 + axis] = at(v, axis) + o[axis] / length * u + normal[axis] * w * k
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

// Places where the solid's wall passes through itself, as the solid vertices involved. Faces that share a
// vertex touch by construction and are not counted. Counting stops at limit, since a surface that already
// crosses itself can cross in millions of places.
export function solidCrossings(positions: Float32Array, indices: Uint32Array, limit = Infinity) {
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
      for (let u = 0; u < 3; u++) for (let w = 0; w < 3; w++) if (order[i * 3 + u] === order[j * 3 + w]) return false
      if (!first.intersectsTriangle(second)) return false
      pairs++
      for (let k = 0; k < 3; k++) { vertices.add(order[i * 3 + k]); vertices.add(order[j * 3 + k]) }
      return pairs >= limit
    },
  })
  return { pairs, capped: pairs >= limit, vertices: [...vertices] }
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
