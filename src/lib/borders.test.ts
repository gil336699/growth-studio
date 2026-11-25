import { describe, expect, it } from 'vitest'
import { readGrowthStl } from '../physics/growthStl'
import { edgesOnLoop, findBorders, loopPoints, traceLoop } from './borders'
import { boxTriangles, stl } from './testStl'

// A 40 × 20 × 10 mm block whose two top long edges are rounded with a 4 mm fillet in 6 facets, as CAD exports one: the
// flat top and walls meet the fillets where the surface turns smoothly (15° per facet); the other edges are sharp.
function filleted() {
  const L = 40, W = 20, H = 10, R = 4, steps = 6
  const ring: [number, number][] = [[0, 0], [W, 0], [W, H - R]]
  for (let i = 1; i <= steps; i++) { const a = (Math.PI / 2) * i / steps; ring.push([W - R + R * Math.cos(a), H - R + R * Math.sin(a)]) }
  for (let i = 0; i <= steps; i++) { const a = Math.PI / 2 + (Math.PI / 2) * i / steps; ring.push([R + R * Math.cos(a), H - R + R * Math.sin(a)]) }
  return extrude(ring, L)
}
// A prism along x from a counterclockwise section in (y, z) = (across, up), with fan caps from the section's centre.
function extrude(ring: [number, number][], L: number) {
  const tris: number[][][] = [], p = (x: number, [z, y]: [number, number]) => [x, z, y]
  const cy = ring.reduce((s, q) => s + q[1], 0) / ring.length, cz = ring.reduce((s, q) => s + q[0], 0) / ring.length, c: [number, number] = [cz, cy]
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    tris.push([p(0, a), p(L, b), p(L, a)], [p(0, a), p(0, b), p(L, b)], [p(0, c), p(0, b), p(0, a)], [p(L, c), p(L, a), p(L, b)])
  }
  return readGrowthStl(stl(tris), 'part.stl')
}
// The same prism with caps fanned from the section's first point, as some CAD exports do: cap edges then run straight
// across, between points of the rim.
function extrudeFanned(ring: [number, number][], L: number) {
  const tris: number[][][] = [], p = (x: number, [z, y]: [number, number]) => [x, z, y]
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; tris.push([p(0, a), p(L, b), p(L, a)], [p(0, a), p(0, b), p(L, b)]) }
  for (let i = 1; i + 1 < ring.length; i++) tris.push([p(0, ring[0]), p(0, ring[i + 1]), p(0, ring[i])], [p(L, ring[0]), p(L, ring[i]), p(L, ring[i + 1])])
  return readGrowthStl(stl(tris), 'fanned.stl')
}
// A 24-sided prism: a cylinder as a coarse CAD export, its wall facets bending 15° from each other.
const cylinder = () => extrude(Array.from({ length: 24 }, (_, i) => [10 + 10 * Math.cos(2 * Math.PI * i / 24), 10 + 10 * Math.sin(2 * Math.PI * i / 24)] as [number, number]), 30)

describe('findBorders', () => {
  it('finds a box\'s twelve edges as sharp, and nothing else', () => {
    const box = readGrowthStl(stl(boxTriangles(30, 20, 10)), 'box.stl')
    const borders = findBorders(box.positions, box.indices)
    expect(borders.sharp.length / 2).toBe(12)
    expect(borders.smooth.length).toBe(0)
  })

  it('finds where a flat face meets a fillet, though the surface turns smoothly there, and not between the fillet\'s facets', () => {
    const part = filleted()
    const borders = findBorders(part.positions, part.indices)
    // Four smooth borders, each the block's full length: the top and each wall meet a fillet.
    expect(borders.smooth.length / 2).toBe(4)
    for (let i = 0; i < borders.smooth.length; i += 2) {
      const a = borders.smooth[i], b = borders.smooth[i + 1]
      expect(Math.abs(part.positions[a * 3] - part.positions[b * 3]) * part.scale).toBeCloseTo(40, 3)
    }
  })

  it('finds no borders between the facets of a coarse cylinder, only its sharp rims', () => {
    const borders = findBorders(cylinder().positions, cylinder().indices)
    expect(borders.smooth.length).toBe(0)
    expect(borders.sharp.length / 2).toBe(48)
  })
})

describe('traceLoop', () => {
  it('follows a rim all the way round, and stops at a corner', () => {
    const can = cylinder(), borders = findBorders(can.positions, can.indices)
    // One click on a rim edge: the 24-sided rim turns 15° at each point, so the whole closed loop is selected.
    const rim = traceLoop(borders, can.positions, borders.sharp[0], borders.sharp[1])
    expect(rim.length / 2).toBe(24)
    const ends = new Map<number, number>()
    for (const v of rim) ends.set(v, (ends.get(v) ?? 0) + 1)
    expect([...ends.values()].every(n => n === 2)).toBe(true)
    // A box's rim turns 90° at each corner, so a click selects one edge.
    const box = readGrowthStl(stl(boxTriangles(30, 20, 10)), 'box.stl'), edges = findBorders(box.positions, box.indices)
    expect(traceLoop(edges, box.positions, edges.sharp[0], edges.sharp[1]).length / 2).toBe(1)
  })

  it('walks both ways from a click in the middle of a border, and stops at the corners at its ends', () => {
    // A D-shaped prism: its rim's curve, 12 edges turning 15° each, meets the straight side at 90° corners.
    const d = extrude([...Array.from({ length: 13 }, (_, i) => [10 + 10 * Math.cos(Math.PI * i / 12), 10 * Math.sin(Math.PI * i / 12)] as [number, number])], 20)
    const borders = findBorders(d.positions, d.indices)
    // The rim edge at the middle of the curve: the one whose ends are both near the top of the D.
    let pick = 0
    for (let i = 0; i < borders.sharp.length; i += 2) {
      const a = borders.sharp[i], b = borders.sharp[i + 1]
      if (d.positions[a * 3] < 1e-6 && d.positions[b * 3] < 1e-6 && d.positions[a * 3 + 2] + d.positions[b * 3 + 2] > d.positions[borders.sharp[pick] * 3 + 2] + d.positions[borders.sharp[pick + 1] * 3 + 2]) pick = i
    }
    expect(traceLoop(borders, d.positions, borders.sharp[pick], borders.sharp[pick + 1]).length / 2).toBe(12)
  })

  it('finds only the rim\'s own edges, not cap edges running across between rim points', () => {
    const ring = Array.from({ length: 24 }, (_, i) => [10 + 10 * Math.cos(2 * Math.PI * i / 24), 10 + 10 * Math.sin(2 * Math.PI * i / 24)] as [number, number])
    const can = extrudeFanned(ring, 30), borders = findBorders(can.positions, can.indices)
    const rim = traceLoop(borders, can.positions, borders.sharp[0], borders.sharp[1])
    expect(rim.length / 2).toBe(24)
    expect(edgesOnLoop(loopPoints(rim, can.positions), can.positions, can.indices).length / 2).toBe(24)
  })

  it('keeps a selected loop through edge splits, as growth makes them', () => {
    const can = cylinder(), borders = findBorders(can.positions, can.indices)
    const rim = traceLoop(borders, can.positions, borders.sharp[0], borders.sharp[1])
    const points = loopPoints(rim, can.positions)
    expect(points.closed).toBe(true)
    expect(edgesOnLoop(points, can.positions, can.indices).length / 2).toBe(24)
    // Split one rim edge at its middle, as growth's remeshing does: both halves are on the loop, and no other edge is.
    const [a, b] = [rim[0], rim[1]], n = can.positions.length / 3
    const P = Float32Array.from([...can.positions, ...[0, 1, 2].map(k => (can.positions[a * 3 + k] + can.positions[b * 3 + k]) / 2)])
    const I: number[] = []
    for (let f = 0; f < can.indices.length; f += 3) {
      const t = Array.from(can.indices.subarray(f, f + 3)), k = [0, 1, 2].find(j => (t[j] === a && t[(j + 1) % 3] === b) || (t[j] === b && t[(j + 1) % 3] === a))
      if (k === undefined) { I.push(...t); continue }
      const u = t[k], v = t[(k + 1) % 3], w = t[(k + 2) % 3]
      I.push(u, n, w, n, v, w)
    }
    expect(edgesOnLoop(points, P, Uint32Array.from(I)).length / 2).toBe(25)
  })
})
