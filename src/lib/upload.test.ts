import { describe, expect, it } from 'vitest'
import { readGrowthStl } from '../physics/growthStl'
import { edgeProblems, signedVolume } from './meshCheck'
import { ballTriangles, boxTriangles, stl } from './testStl'
import { BrokenShapeError, readUpload } from './upload'

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

  it('refuses two bodies exported together, touching along a face, and says how to fix it', () => {
    const buffer = stl([...boxTriangles(10, 10, 10), ...boxTriangles(10, 10, 10, 10)])
    expect(() => readUpload(buffer, 'two.stl')).toThrow(BrokenShapeError)
    expect(() => readUpload(buffer, 'two.stl')).toThrow(/shared by more than two faces.*Combine the bodies/)
  })
})
