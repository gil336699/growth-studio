type Point = [number, number]
type Binding = { a: number; b: number; c: number; u: number; v: number }

function clip(polygon: Point[], nx: number, ny: number, limit: number) {
  const result: Point[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const da = a[0] * nx + a[1] * ny - limit
    const db = b[0] * nx + b[1] * ny - limit
    if (da <= 0) result.push(a)
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db)
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
  }
  return result
}

export function buildDiskVoronoi(uv: Float32Array, indices: Uint32Array) {
  const sites: Point[] = Array.from({ length: uv.length / 2 }, (_, i) => [uv[2 * i], uv[2 * i + 1]])
  const radius = (p: Point) => Math.hypot(p[0] - 0.5, p[1] - 0.5)
  const boundary = sites.filter(p => radius(p) > 0.49999)
    .sort((a, b) => Math.atan2(a[1] - 0.5, a[0] - 0.5) - Math.atan2(b[1] - 0.5, b[0] - 0.5))

  function bind([x, y]: Point): Binding {
    let best: Binding | undefined
    let bestError = Infinity
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2]
      const [ax, ay] = sites[a], [bx, by] = sites[b], [cx, cy] = sites[c]
      const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      const u = ((x - ax) * (cy - ay) - (y - ay) * (cx - ax)) / determinant
      const v = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / determinant
      const error = Math.max(0, -u, -v, u + v - 1)
      if (error < 1e-7) return { a, b, c, u, v }
      if (error < bestError) { best = { a, b, c, u, v }; bestError = error }
    }
    if (!best || bestError > 1e-5) throw new Error('Voronoi corner lies outside the disk mesh')
    return best
  }

  const meshEdges = new Map<string, [Point, Point]>()
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const a = indices[offset + corner], b = indices[offset + (corner + 1) % 3]
      meshEdges.set(`${Math.min(a, b)}:${Math.max(a, b)}`, [sites[a], sites[b]])
    }
  }
  const edges = [...meshEdges.values()]
  function trace(a: Point, b: Point): Binding[] {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const cuts = [0, 1]
    for (const [u, v] of edges) {
      const ex = v[0] - u[0], ey = v[1] - u[1]
      const determinant = dx * ey - dy * ex
      if (Math.abs(determinant) < 1e-12) continue
      const ox = u[0] - a[0], oy = u[1] - a[1]
      const t = (ox * ey - oy * ex) / determinant
      const alongEdge = (ox * dy - oy * dx) / determinant
      if (t > 1e-7 && t < 1 - 1e-7 && alongEdge >= -1e-7 && alongEdge <= 1 + 1e-7) cuts.push(t)
    }
    cuts.sort((a, b) => a - b)
    return cuts.filter((t, i) => !i || t - cuts[i - 1] > 1e-7)
      .map(t => bind([a[0] + dx * t, a[1] + dy * t]))
  }

  const cells = sites.map((site, index) => {
    let polygon = boundary
    for (let i = 0; i < sites.length && polygon.length; i++) {
      if (i === index) continue
      const [x, y] = sites[i]
      polygon = clip(polygon, x - site[0], y - site[1], (x * x + y * y - site[0] ** 2 - site[1] ** 2) / 2)
    }
    return {
      boundaries: polygon.map((corner, i) => trace(corner, polygon[(i + 1) % polygon.length])),
      spokes: polygon.map(corner => trace(corner, site)),
    }
  })
  return cells
}

export function diskVoronoiLines(cells: ReturnType<typeof buildDiskVoronoi>, positions: Float32Array, fans: boolean) {
  const lines: number[] = []
  const colors: number[] = []
  function emit(path: Binding[], color: [number, number, number]) {
    const vertices = path.map(({ a, b, c, u, v }) => [0, 1, 2].map(axis =>
      positions[a * 3 + axis] * (1 - u - v) + positions[b * 3 + axis] * u + positions[c * 3 + axis] * v))
    for (let i = 1; i < vertices.length; i++) {
      lines.push(...vertices[i - 1], ...vertices[i])
      colors.push(...color, ...color)
    }
  }
  for (const { boundaries, spokes } of cells) {
    boundaries.forEach(path => emit(path, [0.025, 0.07, 0.1]))
    if (fans) spokes.forEach(path => emit(path, [0.72, 0.22, 0.045]))
  }
  return { positions: new Float32Array(lines), colors: new Float32Array(colors) }
}
