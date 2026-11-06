type Corner = [number, number, number]
type SurfaceLine = { face: [number, number, number]; a: Corner; b: Corner; seam: boolean }
const basis: Corner[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

// Clip the current Euclidean diagram to each solver face. The face bindings
// also let the preview follow motion between diagram refreshes.
export function buildSurfaceVoronoi(positions: Float32Array, indices: Uint32Array) {
  const lines: SurfaceLine[] = []
  const count = positions.length / 3
  const squaredDistance = (a: number, b: number) =>
    (positions[a * 3] - positions[b * 3]) ** 2 +
    (positions[a * 3 + 1] - positions[b * 3 + 1]) ** 2 +
    (positions[a * 3 + 2] - positions[b * 3 + 2]) ** 2
  const sites = Array.from({ length: count }, (_, i) => i)
    .sort((a, b) => positions[a * 3] - positions[b * 3])
  function firstSiteAt(x: number) {
    let low = 0, high = sites.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (positions[sites[middle] * 3] < x) low = middle + 1
      else high = middle
    }
    return low
  }
  for (let i = 0; i < indices.length; i += 3) {
    const face: [number, number, number] = [indices[i], indices[i + 1], indices[i + 2]]
    const reach = 2 * Math.max(squaredDistance(face[0], face[1]), squaredDistance(face[1], face[2]), squaredDistance(face[2], face[0])) ** 0.5
    const candidates: Corner[] = []
    const cornerDistances = face.map(site => face.map(vertex => squaredDistance(site, vertex)))
    const x = positions[face[0] * 3]
    const start = firstSiteAt(x - reach - 1e-6), end = firstSiteAt(x + reach + 1e-6)
    for (let j = start; j < end; j++) {
      const site = sites[j]
      if (squaredDistance(site, face[0]) > reach * reach + 1e-12) continue
      const distances = face.map(vertex => squaredDistance(site, vertex)) as Corner
      if (cornerDistances.some(corner => corner.every((distance, axis) => distance < distances[axis]))) continue
      candidates.push(distances)
    }
    for (const distances of candidates) {
      let polygon = basis
      for (const other of candidates) {
        if (other === distances || !polygon.length) continue
        const delta = distances.map((value, j) => value - other[j])
        if (delta.every(value => value <= 0)) continue
        if (delta.every(value => value > 0)) { polygon = []; break }
        const score = (corner: Corner) => delta[0] * corner[0] + delta[1] * corner[1] + delta[2] * corner[2]
        const clipped: Corner[] = []
        for (let k = 0; k < polygon.length; k++) {
          const a = polygon[k], b = polygon[(k + 1) % polygon.length]
          const sa = score(a), sb = score(b)
          if (sa <= 0) clipped.push(a)
          if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
            const t = sa / (sa - sb)
            clipped.push(a.map((value, j) => value + (b[j] - value) * t) as Corner)
          }
        }
        polygon = clipped
      }
      if (polygon.length < 3) continue
      const center = basis.map((_, axis) => polygon.reduce((sum, corner) => sum + corner[axis], 0) / polygon.length) as Corner
      polygon.forEach((a, k) => {
        const b = polygon[(k + 1) % polygon.length]
        lines.push({ face, a, b, seam: !a.some((value, axis) => Math.abs(value) < 1e-8 && Math.abs(b[axis]) < 1e-8) })
        lines.push({ face, a, b: center, seam: false })
      })
    }
  }
  return lines
}

export function surfaceVoronoiLines(lines: SurfaceLine[], positions: Float32Array, fans: boolean) {
  const visibleCount = fans ? lines.length : lines.reduce((count, line) => count + Number(line.seam), 0)
  const coordinates = new Float32Array(visibleCount * 6)
  const colors = new Float32Array(coordinates.length)
  let offset = 0
  for (const { face, a, b, seam } of lines) {
    if (!fans && !seam) continue
    for (const weights of [a, b]) {
      for (let axis = 0; axis < 3; axis++) {
        coordinates[offset + axis] = weights[0] * positions[face[0] * 3 + axis]
          + weights[1] * positions[face[1] * 3 + axis] + weights[2] * positions[face[2] * 3 + axis]
      }
      colors[offset] = seam ? 0.025 : 0.72
      colors[offset + 1] = seam ? 0.07 : 0.22
      colors[offset + 2] = seam ? 0.1 : 0.045
      offset += 3
    }
  }
  return { positions: coordinates, colors }
}
