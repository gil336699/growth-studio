// Measurements a designer reads while growing: waves around a rim and overall size.

// Count up-and-down waves along a rim: zero crossings of height around its mean, halved.
export function rimWaves(rim: { vertices: number[] }, rest: ArrayLike<number>, positions: ArrayLike<number>) {
  const { vertices } = rim
  if (vertices.length < 6) return 0
  const cx = vertices.reduce((sum, v) => sum + rest[v * 3], 0) / vertices.length
  const cz = vertices.reduce((sum, v) => sum + rest[v * 3 + 2], 0) / vertices.length
  const ordered = vertices
    .map(v => ({ angle: Math.atan2(rest[v * 3 + 2] - cz, rest[v * 3] - cx), height: positions[v * 3 + 1] }))
    .sort((a, b) => a.angle - b.angle)
  const mean = ordered.reduce((sum, p) => sum + p.height, 0) / ordered.length
  const range = Math.max(...ordered.map(p => p.height)) - Math.min(...ordered.map(p => p.height))
  // Ignore ripples smaller than 1% of the rim's height range or of a unit model.
  const threshold = Math.max(0.01, range * 0.08)
  let crossings = 0, side = 0
  for (const { height } of [...ordered, ordered[0]]) {
    const offset = height - mean
    if (Math.abs(offset) < threshold) continue
    const next = Math.sign(offset)
    if (side && next !== side) crossings++
    side = next
  }
  return Math.round(crossings / 2)
}

function bounds(points: ArrayLike<number>) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < points.length; i++) {
    low[i % 3] = Math.min(low[i % 3], points[i])
    high[i % 3] = Math.max(high[i % 3], points[i])
  }
  return high.map((value, axis) => value - low[axis])
}

// Size relative to the starting shape, and dimensions in millimeters for an STL (Y-up solver axes to X, Y, Z).
export function formSize(positions: ArrayLike<number>, rest: ArrayLike<number>, scale?: number) {
  const now = bounds(positions), start = bounds(rest)
  const multiple = Math.hypot(...now) / (Math.hypot(...start) || 1)
  const millimeters = scale ? [now[0] * scale, now[2] * scale, now[1] * scale] : null
  return { multiple, millimeters }
}
