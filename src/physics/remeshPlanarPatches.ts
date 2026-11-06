import { Vector3 } from 'three'
import triangulate from 'cdt2d'

const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`

export function remeshPlanarPatches(positions: Float32Array<ArrayBuffer>, indices: Uint32Array<ArrayBuffer>, spacing: number) {
  const points = Array.from({ length: positions.length / 3 }, (_, i) => new Vector3().fromArray(positions, i * 3))
  const faces = Array.from({ length: indices.length / 3 }, (_, i) => [...indices.subarray(i * 3, i * 3 + 3)])
  const edges = new Map<string, number[]>()
  const faceEdges = faces.map(([a, b, c], face) => [[a, b], [b, c], [c, a]].map(([u, v]) => {
    const key = edgeKey(u, v)
    const adjacent = edges.get(key) ?? []
    adjacent.push(face)
    edges.set(key, adjacent)
    return key
  }))
  const normals = faces.map(([a, b, c]) => points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a])))
  const visited = new Set<number>(), result: number[] = []
  let patches = 0, added = 0
  for (let seed = 0; seed < faces.length; seed++) {
    if (visited.has(seed)) continue
    const region = [seed]
    visited.add(seed)
    const origin = points[faces[seed][0]], normal = normals[seed].clone().normalize()
    for (let i = 0; i < region.length; i++) {
      for (const key of faceEdges[region[i]]) {
        const adjacent = edges.get(key)!
        if (adjacent.length !== 2) continue
        const next = adjacent[0] === region[i] ? adjacent[1] : adjacent[0]
        if (visited.has(next) || normal.dot(normals[next]) < 0.999999 * normals[next].length()
          || faces[next].some(vertex => Math.abs(points[vertex].clone().sub(origin).dot(normal)) > 2e-6)) continue
        visited.add(next)
        region.push(next)
      }
    }
    const area = region.reduce((sum, face) => sum + normals[face].length() / 2, 0)
    const replacement = region.length >= 8 && area >= 3 * spacing ** 2 && added < 900
      ? rebuild(region, origin, normal, area)
      : null
    if (replacement) {
      patches++
      for (const vertex of replacement) result.push(vertex)
    } else {
      for (const face of region) result.push(...faces[face])
    }
  }
  if (!patches) return { positions, indices, patches }
  const retained = [...new Set(result)].sort((a, b) => a - b)
  const remap = new Map(retained.map((vertex, index) => [vertex, index]))
  return {
    positions: Float32Array.from(retained.flatMap(vertex => points[vertex].toArray())),
    indices: Uint32Array.from(result, vertex => remap.get(vertex)!),
    patches,
  }

  function rebuild(region: number[], origin: Vector3, normal: Vector3, area: number) {
    const members = new Set(region), boundary: number[][] = []
    for (const face of region) {
      faceEdges[face].forEach((key, i) => {
        const adjacent = edges.get(key)!
        if (adjacent.length !== 2 || adjacent.some(next => !members.has(next))) {
          boundary.push([faces[face][i], faces[face][(i + 1) % 3]])
        }
      })
    }
    const ids = [...new Set(boundary.flat())]
    if (ids.length < 3 || ids.length !== boundary.length || new Set(boundary.map(edge => edge[0])).size !== ids.length
      || new Set(boundary.map(edge => edge[1])).size !== ids.length) return null
    const idMap = new Map(ids.map((id, i) => [id, i]))
    const constraints = boundary.map(([a, b]) => [idMap.get(a)!, idMap.get(b)!])
    const u = points[boundary[0][1]].clone().sub(points[boundary[0][0]]).normalize()
    const v = normal.clone().cross(u)
    const xy = ids.map(id => {
      const delta = points[id].clone().sub(origin)
      return [delta.dot(u), delta.dot(v)]
    })
    const xs = xy.map(point => point[0]), ys = xy.map(point => point[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pitch = Math.max(spacing * 0.65, Math.sqrt((maxX - minX) * (maxY - minY) / (900 - added)))
    let row = 0
    for (let y = minY + pitch / 2; y < maxY; y += pitch * Math.sqrt(3) / 2, row++) {
      for (let x = minX + pitch * (row % 2 ? 1 : 0.5); x < maxX; x += pitch) {
        let inside = false, nearBoundary = false
        for (const [a, b] of constraints) {
          const [ax, ay] = xy[a], [bx, by] = xy[b]
          if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside
          const dx = bx - ax, dy = by - ay
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
          if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < pitch * 0.38) nearBoundary = true
        }
        if (inside && !nearBoundary && added + xy.length - ids.length < 900) xy.push([x, y])
      }
    }
    if (xy.length === ids.length) return null
    let triangles: number[][]
    try {
      triangles = triangulate(xy, constraints, { exterior: false })
    } catch {
      return null
    }
    const counts = new Map<string, number>()
    let rebuiltArea = 0
    for (const triangle of triangles) {
      const [a, b, c] = triangle
      const [ax, ay] = xy[a], [bx, by] = xy[b], [cx, cy] = xy[c]
      const signed = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (Math.abs(signed) < 1e-10) return null
      if (signed < 0) [triangle[1], triangle[2]] = [c, b]
      rebuiltArea += Math.abs(signed) / 2
      for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const required = new Set(constraints.map(([a, b]) => edgeKey(a, b)))
    if (Math.abs(rebuiltArea - area) > area * 1e-4
      || [...required].some(key => counts.get(key) !== 1)
      || [...counts].some(([key, count]) => count !== (required.has(key) ? 1 : 2))) return null
    for (const [x, y] of xy.slice(ids.length)) {
      ids.push(points.length)
      points.push(origin.clone().addScaledVector(u, x).addScaledVector(v, y))
      added++
    }
    return triangles.flat().map(i => ids[i])
  }
}
