import { describe, expect, it } from 'vitest'
import { createGrowingDisk } from '../physics/growingDisk'
import { SMOOTH_MAX_TRIANGLES, smoothPassesFor, smoothSheet } from './smoothSheet'
import { solidLeaks, thicken } from './thicken'

// Edges used by one face: the sheet's open rims.
function rimEdges(indices: ArrayLike<number>) {
  const count = new Map<string, number>()
  for (let f = 0; f < indices.length; f += 3) for (let k = 0; k < 3; k++) {
    const a = indices[f + k], b = indices[f + (k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  return [...count.values()].filter(c => c === 1).length
}
// The largest angle, in degrees, between the normals of two faces that share an edge: how faceted a surface is.
function sharpestFold(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const normal = (f: number) => {
    const p = (v: number) => [0, 1, 2].map(k => positions[indices[f * 3 + v] * 3 + k])
    const [a, b, c] = [p(0), p(1), p(2)], u = b.map((x, k) => x - a[k]), w = c.map((x, k) => x - a[k])
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n)
    return n.map(x => x / l)
  }
  const byEdge = new Map<string, number[]>()
  for (let f = 0; f < indices.length / 3; f++) for (let k = 0; k < 3; k++) {
    const a = indices[f * 3 + k], b = indices[f * 3 + (k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`
    byEdge.set(key, [...(byEdge.get(key) ?? []), f])
  }
  let worst = 0
  for (const pair of byEdge.values()) {
    if (pair.length !== 2) continue
    const [m, n] = pair.map(normal), dot = m[0] * n[0] + m[1] * n[1] + m[2] * n[2]
    worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI)
  }
  return worst
}
// A coarse open tube, 8 sides by 4 rings: 45° between neighbouring faces, like a low-detail vase wall.
function tube() {
  const positions: number[] = [], indices: number[] = [], sides = 8, rings = 4
  for (let j = 0; j <= rings; j++) for (let i = 0; i < sides; i++) {
    const a = 2 * Math.PI * i / sides
    positions.push(Math.cos(a), j * 0.5, Math.sin(a))
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    const a = j * sides + i, b = j * sides + (i + 1) % sides, c = a + sides, d = b + sides
    indices.push(a, c, b, b, c, d)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

describe('smoothSheet', () => {
  it('splits every triangle into four each pass and keeps the same open rims', () => {
    const disk = createGrowingDisk(), faces = disk.indices.length / 3, rims = rimEdges(disk.indices)
    for (const passes of [1, 2]) {
      const sheet = smoothSheet(disk.positions, disk.indices, passes)
      expect(sheet.indices.length / 3).toBe(faces * 4 ** passes)
      // A rim edge splits in two, so a pass doubles them and no new rim appears.
      expect(rimEdges(sheet.indices)).toBe(rims * 2 ** passes)
      expect(sheet.positions.every(Number.isFinite)).toBe(true)
      expect(Math.max(...sheet.origin)).toBeLessThan(disk.positions.length / 3)
      expect(Math.max(...sheet.origin2)).toBeLessThan(disk.positions.length / 3)
      // New points on edges blend two sheet vertices, so overlay colors change smoothly across the solid.
      expect(sheet.origin.some((v, i) => v !== sheet.origin2[i])).toBe(true)
    }
  })

  it('keeps a flat sheet flat, rim included', () => {
    const disk = createGrowingDisk(), positions = disk.positions.slice()
    for (let v = 0; v < positions.length / 3; v++) positions[v * 3 + 1] = 0.25
    const sheet = smoothSheet(positions, disk.indices, 2)
    for (let v = 0; v < sheet.positions.length / 3; v++) expect(sheet.positions[v * 3 + 1]).toBeCloseTo(0.25, 6)
  })

  it('smooths a faceted surface and keeps a flat rim in its plane', () => {
    const { positions, indices } = tube()
    expect(sharpestFold(positions, indices)).toBeCloseTo(45, 0)
    const light = smoothSheet(positions, indices, 1), strong = smoothSheet(positions, indices, 2)
    expect(sharpestFold(light.positions, light.indices)).toBeLessThan(25)
    expect(sharpestFold(strong.positions, strong.indices)).toBeLessThan(13)
    // The bottom rim of the tube stays at its height, like a vase standing on its rim.
    const bottom = [...Array(strong.positions.length / 3).keys()].filter(v => strong.positions[v * 3 + 1] < 0.01)
    expect(bottom.length).toBeGreaterThan(8 * 4 - 1)
    for (const v of bottom) expect(strong.positions[v * 3 + 1]).toBeCloseTo(0, 6)
  })

  it('still makes a closed solid once the wall is added', () => {
    const { positions, indices } = tube()
    const sheet = smoothSheet(positions, indices, 2)
    const solid = thicken(sheet.positions, sheet.indices, 0.05, 1, 4, 1)
    expect(solidLeaks(solid.indices)).toBe(0)
  })

  it('takes fewer passes on a dense sheet, so the solid stays under the triangle limit', () => {
    expect(smoothPassesFor('off', 1000)).toBe(0)
    expect(smoothPassesFor('strong', 2_000)).toBe(2)
    expect(smoothPassesFor('strong', 50_000)).toBe(1)
    expect(smoothPassesFor('light', SMOOTH_MAX_TRIANGLES)).toBe(0)
  })
})
