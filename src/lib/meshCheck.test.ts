import { describe, expect, it } from 'vitest'
import { readGrowthStl } from '../physics/growthStl'
import { edgeProblems, edgeUse, orientClosed, signedVolume, splitTouching } from './meshCheck'
import { ballTriangles, stl } from './testStl'

// A box with outward-facing triangles, Y up, shifted by dx.
function box(dx = 0) {
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((v, i) => i % 3 === 0 ? v + dx : v)
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
  return { positions, indices: quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]) }
}
const turnOver = (indices: number[], faces: number[]) => {
  const out = indices.slice()
  for (const f of faces) [out[f * 3 + 1], out[f * 3 + 2]] = [out[f * 3 + 2], out[f * 3 + 1]]
  return out
}

describe('orientClosed', () => {
  it('leaves a closed, outward-facing mesh as it is', () => {
    const { positions, indices } = box()
    expect(Array.from(orientClosed(positions, indices)!)).toEqual(indices)
  })

  it('turns back faces that a CAD export turned the wrong way', () => {
    const { positions, indices } = box()
    const mixed = turnOver(indices, [1, 4, 9])
    expect(edgeProblems(mixed)).toBeGreaterThan(0)
    const fixed = orientClosed(positions, mixed)!
    expect(edgeProblems(fixed)).toBe(0)
    expect(signedVolume(positions, fixed)).toBeCloseTo(1, 6)
  })

  it('turns an inside-out mesh to face out, each piece on its own', () => {
    const a = box(), b = box(3)
    const positions = [...a.positions, ...b.positions]
    // The second box is inside out.
    const indices = [...a.indices, ...turnOver(b.indices.map(i => i + 8), [...Array(12).keys()])]
    const fixed = orientClosed(positions, indices)!
    expect(edgeProblems(fixed)).toBe(0)
    expect(signedVolume(positions, fixed.subarray(0, 36))).toBeCloseTo(1, 6)
    expect(signedVolume(positions, fixed.subarray(36))).toBeCloseTo(1, 6)
  })

  it('keeps a sealed hollow hollow: a piece inside another faces into it', () => {
    // A 40 mm ball with a 20 mm hollow at its middle, written three ways.
    const outer = ballTriangles(2), inner = ballTriangles(2).map(t => t.map(p => p.map(v => v / 2)))
    const turned = (tris: number[][][]) => tris.map(([a, b, c]) => [a, c, b])
    const check = (tris: number[][][]) => {
      const { positions, indices } = readGrowthStl(stl(tris), 'hollow.stl')
      const fixed = orientClosed(positions, indices)!
      const half = fixed.length / 2
      return [signedVolume(positions, fixed.subarray(0, half)), signedVolume(positions, fixed.subarray(half))]
    }
    for (const tris of [[...outer, ...turned(inner)], [...outer, ...inner], [...turned(outer), ...inner]]) {
      const [outside, hollow] = check(tris)
      expect(outside).toBeGreaterThan(0)
      expect(hollow).toBeLessThan(0)
      expect(-hollow).toBeCloseTo(outside / 8, 2)
    }
  })

  it('refuses an open mesh and edges shared by more than two faces', () => {
    const { positions, indices } = box()
    expect(orientClosed(positions, indices.slice(0, -3))).toBeNull()
    // Two boxes side by side, as two bodies exported together: welding the second box's left face onto the first
    // box's right face gives that face's edges four faces each.
    const touching = box(1)
    const both = [...positions, ...touching.positions]
    const shared = [...indices, ...touching.indices.map(i => i + 8)]
    const welded = shared.map(i => i === 8 ? 1 : i === 12 ? 5 : i === 11 ? 2 : i === 15 ? 6 : i)
    expect(edgeUse(welded, both.length / 3).crowded).toBeGreaterThan(0)
    expect(orientClosed(both, welded)).toBeNull()
  })

  it('refuses a closed surface whose faces cannot agree on a side', () => {
    // The smallest closed one-sided surface: the projective plane on six vertices, ten triangles.
    const faces = [[1, 2, 3], [1, 3, 4], [1, 4, 5], [1, 5, 6], [1, 6, 2], [2, 3, 5], [3, 4, 6], [4, 5, 2], [5, 6, 3], [6, 2, 4]]
    const indices = faces.flat().map(v => v - 1)
    const use = edgeUse(indices, 6)
    expect(use.open).toBe(0)
    expect(use.crowded).toBe(0)
    expect(orientClosed(Array.from({ length: 18 }, (_, i) => Math.sin(i)), indices)).toBeNull()
  })
})

describe('splitTouching', () => {
  it('gives bodies that touch along an edge their own points, and refuses a piece left open', () => {
    // Two unit boxes that meet along one edge, the second one along and one up, welded by position: that edge has four
    // faces.
    const a = box(), b = box(1)
    const positions = [...a.positions, ...b.positions.map((x, i) => i % 3 === 2 ? x + 1 : x)]
    const ids = new Map<string, number>(), welded: number[] = [], map: number[] = []
    for (let v = 0; v < positions.length / 3; v++) {
      const key = positions.slice(v * 3, v * 3 + 3).join(',')
      if (!ids.has(key)) { ids.set(key, welded.length / 3); welded.push(...positions.slice(v * 3, v * 3 + 3)) }
      map.push(ids.get(key)!)
    }
    const indices = [...a.indices, ...b.indices.map(i => i + 8)].map(i => map[i])
    expect(edgeUse(indices, welded.length / 3).crowded).toBe(1)
    const split = splitTouching(welded, indices)!
    expect(split.pieces).toBe(2)
    expect(split.positions.length / 3).toBe(16)
    expect(edgeProblems(split.indices)).toBe(0)
    // An extra face on three of the box's edges leaves a piece that isn't closed, so the mesh can't be split.
    expect(splitTouching(a.positions, [...a.indices, 0, 1, 2])).toBeNull()
  })
})
