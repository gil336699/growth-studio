import { describe, expect, it } from 'vitest'
import { readGrowthStl } from '../physics/growthStl'
import { findBorders } from './borders'
import { edgeProblems, signedVolume } from './meshCheck'
import { ballTriangles, boxTriangles, stl } from './testStl'
import { BrokenShapeError, readUpload } from './upload'

// A box from (x0, y0, z0) to (x1, y1, z1) mm with outward triangles, Z up, its top face listed first, or its bottom.
const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, first: 'top' | 'bottom' = 'top') => {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
  const top = [[4, 5, 6], [4, 6, 7]], bottom = [[0, 2, 1], [0, 3, 2]]
  const sides = [[0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  return (first === 'top' ? [...top, ...bottom, ...sides] : [...bottom, ...top, ...sides]).map(face => face.map(v => p[v]))
}
const span = (positions: ArrayLike<number>, axis: number) => {
  let lo = Infinity, hi = -Infinity
  for (let i = axis; i < positions.length; i += 3) { lo = Math.min(lo, positions[i]); hi = Math.max(hi, positions[i]) }
  return hi - lo
}

describe('readUpload', () => {
  it('uses a closed STL as it is: every point kept, faces outward', () => {
    const buffer = stl(boxTriangles(30, 20, 10))
    const { source, closed, nearlyClosed } = readUpload(buffer, 'box.stl')
    expect(closed).toBe(true)
    expect(nearlyClosed).toBe(false)
    const plain = readGrowthStl(buffer, 'box.stl')
    expect(source.positions).toEqual(plain.positions)
    expect(edgeProblems(source.indices)).toBe(0)
    expect(signedVolume(source.positions, source.indices) * source.scale ** 3).toBeCloseTo(6000, 1)
  })

  it('keeps thin walls that a voxel rebuild lost: a 0.8 mm plate stays 0.8 mm', () => {
    const { source, closed } = readUpload(stl(boxTriangles(60, 40, 0.8)), 'plate.stl')
    expect(closed).toBe(true)
    // Z up in the STL is Y up in the app.
    expect(span(source.positions, 1) * source.scale).toBeCloseTo(0.8, 4)
  })

  it('turns faces a CAD export turned inside out, so the solid faces outward', () => {
    const { source } = readUpload(stl(boxTriangles(30, 20, 10, 0, [0, 5, 7])), 'mixed.stl')
    expect(edgeProblems(source.indices)).toBe(0)
    expect(signedVolume(source.positions, source.indices) * source.scale ** 3).toBeCloseTo(6000, 1)
  })

  it('opens an open surface as it is, to grow from its rims', () => {
    const { source, closed } = readUpload(stl(boxTriangles(30, 20, 10).slice(0, 10)), 'open.stl')
    expect(closed).toBe(false)
    expect(source.indices).toEqual(readGrowthStl(stl(boxTriangles(30, 20, 10).slice(0, 10)), 'open.stl').indices)
  })

  it('turns back faces a CAD export turned the wrong way on an open surface, so its edges come out right', () => {
    // An open box, its bottom and one side each with a face written inside out.
    const clean = readGrowthStl(stl(boxTriangles(30, 20, 10).slice(0, 10)), 'open.stl'), mixed = stl(boxTriangles(30, 20, 10, 0, [1, 6]).slice(0, 10))
    const { source, closed } = readUpload(mixed, 'mixed.stl')
    expect(closed).toBe(false)
    expect(Array.from(source.indices)).toEqual(Array.from(clean.indices))
    // As written, the turned faces made sharp edges across the flat bottom and side, where the Edges tool found loops.
    const asWritten = readGrowthStl(mixed, 'mixed.stl')
    expect(findBorders(asWritten.positions, asWritten.indices).sharp.length).toBeGreaterThan(findBorders(clean.positions, clean.indices).sharp.length)
  })

  it('says when an open STL is almost closed, so a hairline gap is not mistaken for an opening', () => {
    const ball = ballTriangles(4)
    expect(readUpload(stl(ball), 'ball.stl').closed).toBe(true)
    const gap = readUpload(stl(ball.slice(1)), 'gap.stl')
    expect(gap.closed).toBe(false)
    expect(gap.nearlyClosed).toBe(true)
    expect(readUpload(stl(ball.slice(0, ball.length / 2)), 'bowl.stl').nearlyClosed).toBe(false)
    // A finely meshed cup with a real opening, 8 mm across on a 40 mm ball: only 0.23% of its edges are open, but they
    // add up to twice the limit.
    const cup = ballTriangles(5).filter(t => t.reduce((z, p) => z + p[2], 0) / 3 < 0.98 * 20)
    expect(readUpload(stl(cup), 'cup.stl').nearlyClosed).toBe(false)
  })

  it('opens bodies exported together that touch along an edge, each as its own closed body', () => {
    // Two 10 mm boxes that meet only along one edge: that edge has four faces.
    const buffer = stl([...boxTriangles(10, 10, 10), ...boxTriangles(10, 10, 10, 10).map(t => t.map(([x, y, z]) => [x, y, z + 10]))])
    const { source, closed, touching } = readUpload(buffer, 'two.stl')
    expect(closed).toBe(true)
    expect(touching).toBeGreaterThan(0)
    // Each body keeps its own copy of the two points they share, so both are closed, and they face outward.
    expect(source.positions.length / 3).toBe(16)
    expect(edgeProblems(source.indices)).toBe(0)
    expect(signedVolume(source.positions, source.indices) * source.scale ** 3).toBeCloseTo(2000, 1)
  })

  it('opens bodies lying flat against each other facing outward, whichever face is listed first', () => {
    // A 20 × 10 × 10 mm block under a 20 × 20 × 10 mm plate, sharing the plate's front bottom edge, its top face listed
    // first; then the block on the plate, the plate's top face listed first. The body whose first face lay on the other
    // one opened inside out.
    for (const tris of [[...block(0, 20, 0, 20, 10, 20), ...block(0, 20, 0, 10, 0, 10)],
      [...block(0, 20, 0, 20, 0, 10), ...block(0, 20, 0, 10, 10, 20, 'bottom')]]) {
      const { source, touching } = readUpload(stl(tris), 'stack.stl')
      expect(touching).toBeGreaterThan(0)
      expect(signedVolume(source.positions, source.indices) * source.scale ** 3).toBeCloseTo(6000, 0)
    }
  })

  it('refuses two bodies whose shared edges close into a loop, and says how to fix it', () => {
    // Two boxes sharing a whole square face: the four edges around it close into a loop, which cuts that face off from
    // each box, so no box is left closed.
    const buffer = stl([...boxTriangles(10, 10, 10), ...boxTriangles(10, 10, 10, 10)])
    expect(() => readUpload(buffer, 'two.stl')).toThrow(BrokenShapeError)
    expect(() => readUpload(buffer, 'two.stl')).toThrow(/closed loop of edges.*Combine the bodies/)
  })
})
