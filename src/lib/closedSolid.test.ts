import { describe, expect, it } from 'vitest'
import { closedSolid } from './closedSolid'
import { sharpEdges } from './smoothSheet'

// A cube with outward-facing triangles, Y up.
function cube(size: number) {
  const s = size
  const positions = [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s]
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
  return { positions, indices: quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]) }
}
function closed(indices: ArrayLike<number>) {
  const edges = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const key = `${indices[t + k]}>${indices[t + (k + 1) % 3]}`
    edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  for (const [key, uses] of edges) { const [a, b] = key.split('>'); if (uses !== 1 || edges.get(`${b}>${a}`) !== 1) return false }
  return true
}
function volume(P: ArrayLike<number>, I: ArrayLike<number>) {
  let v = 0
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
  }
  return v
}

describe('closed solid', () => {
  it('uses the grown surface as it is when nothing is smoothed or cut', () => {
    const box = cube(10)
    const solid = closedSolid(box.positions, box.indices, { passes: 0 })
    expect(Array.from(solid.positions)).toEqual(box.positions)
    expect(Array.from(solid.indices)).toEqual(box.indices)
    expect(solid.rimEdges).toBe(0)
  })

  it('keeps a shape with designed sharp edges as it is: a cube stays a cube when its edges are creased', () => {
    const box = cube(10)
    const creases = sharpEdges(box.positions, box.indices)
    const kept = closedSolid(box.positions, box.indices, { passes: 2, creases, bevel: 0 })
    expect(closed(kept.indices)).toBe(true)
    expect(kept.indices.length / 3).toBe(12 * 16)
    expect(volume(kept.positions, kept.indices)).toBeCloseTo(1000, 1)
    // Without creases, or with a full bevel, Loop subdivision rounds it into a much smaller blob.
    const rounded = closedSolid(box.positions, box.indices, { passes: 2, creases, bevel: 1 })
    expect(volume(rounded.positions, rounded.indices)).toBeLessThan(600)
  })

  it('smooths and then cuts a flat base, staying watertight, with the base where it was asked for', () => {
    const box = cube(10)
    const solid = closedSolid(box.positions, box.indices, { passes: 1, creases: sharpEdges(box.positions, box.indices), bevel: 0, cut: 2 })
    expect(closed(solid.indices)).toBe(true)
    let low = Infinity
    for (let i = 1; i < solid.positions.length; i += 3) low = Math.min(low, solid.positions[i])
    expect(low).toBeCloseTo(2, 5)
    expect(solid.capArea).toBeCloseTo(100, 3)
    expect(volume(solid.positions, solid.indices)).toBeCloseTo(800, 1)
    // Every vertex still points at a grown-surface vertex, for overlay colors.
    expect(Math.max(...solid.origin)).toBeLessThan(box.positions.length / 3)
  })
})
