import { Vector3 } from 'three'

export function balanceSurfaceTriangles(positions: Float32Array, indices: Uint32Array) {
  const faces = indices.slice()
  const points = Array.from({ length: positions.length / 3 }, (_, i) => new Vector3().fromArray(positions, 3 * i))
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`
  const cross = (a: number, b: number, c: number) => points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]))
  const quality = (a: number, b: number, c: number, area: number) => area /
    (points[a].distanceToSquared(points[b]) + points[b].distanceToSquared(points[c]) + points[c].distanceToSquared(points[a]))
  let flips = 0
  for (let pass = 0; pass < 6; pass++) {
    const edges = new Map<string, { offset: number; a: number; b: number; c: number }[]>()
    for (let offset = 0; offset < faces.length; offset += 3) {
      for (let j = 0; j < 3; j++) {
        const a = faces[offset + j], b = faces[offset + (j + 1) % 3], c = faces[offset + (j + 2) % 3]
        const edge = key(a, b)
        const adjacent = edges.get(edge) ?? []
        adjacent.push({ offset, a, b, c })
        edges.set(edge, adjacent)
      }
    }
    const touched = new Set<number>()
    const added = new Set<string>()
    for (const adjacent of edges.values()) {
      if (adjacent.length !== 2) continue
      const [left, right] = adjacent
      const { a, b, c } = left, d = right.c
      if (left.a !== right.b || left.b !== right.a || touched.has(left.offset) || touched.has(right.offset)) continue
      const diagonal = key(c, d)
      if (c === d || edges.has(diagonal) || added.has(diagonal)) continue
      const normal = cross(a, b, c), other = cross(b, a, d)
      const area = normal.length(), otherArea = other.length()
      if (area < 1e-10 || otherArea < 1e-10) continue
      normal.divideScalar(area)
      if (normal.dot(other) / otherArea < 0.999999 || Math.abs(points[d].clone().sub(points[a]).dot(normal)) > 1e-6) continue
      const first = cross(c, d, b).dot(normal), second = cross(d, c, a).dot(normal)
      if (first <= 1e-10 || second <= 1e-10) continue
      const before = Math.min(quality(a, b, c, area), quality(b, a, d, otherArea))
      const after = Math.min(quality(c, d, b, first), quality(d, c, a, second))
      if (after <= before + 1e-5) continue
      faces.set([c, d, b], left.offset)
      faces.set([d, c, a], right.offset)
      touched.add(left.offset)
      touched.add(right.offset)
      added.add(diagonal)
      flips++
    }
    if (!touched.size) break
  }
  return { indices: faces, flips }
}
