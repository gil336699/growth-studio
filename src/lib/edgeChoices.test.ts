import { describe, expect, it } from 'vitest'
import { readGrowthStl } from '../physics/growthStl'
import { findBorders } from './borders'
import { finalStatus, pickLoop, printEdges, sameLoop, validChoice, type EdgeChoice } from './edgeChoices'
import { GROWN_LIMIT } from './smoothSheet'
import { stl } from './testStl'

// A closed cylinder 20 mm across and 30 mm tall in 48 facets, Z up as CAD writes it.
function cylinder() {
  const n = 48, H = 30, tris: number[][][] = [], at = (i: number, z: number) => [10 * Math.cos(2 * Math.PI * i / n), 10 * Math.sin(2 * Math.PI * i / n), z]
  for (let i = 0; i < n; i++) tris.push([at(i, 0), at(i + 1, 0), at(i + 1, H)], [at(i, 0), at(i + 1, H), at(i, H)], [[0, 0, 0], at(i + 1, 0), at(i, 0)], [[0, 0, H], at(i, H), at(i + 1, H)])
  return readGrowthStl(stl(tris), 'cylinder.stl')
}
const lowY = (P: ArrayLike<number>) => { let low = Infinity; for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i]); return low }
const choice = (id: string, points: Float32Array, action: EdgeChoice['action'], radius = 2): EdgeChoice => ({ id, points: Array.from(points), closed: true, action, radius })

describe('Edges tool choices', () => {
  it('picks the loop of the border nearest a click, and nothing far from a border', () => {
    const can = cylinder(), borders = findBorders(can.positions, can.indices), low = lowY(can.positions), mm = can.scale
    // A click on the bottom 0.2 mm in from the rim, and one on the wall half way up.
    const near = pickLoop(borders, can.positions, can.positions, [9.8 / mm, low, 0], 1 / mm)!
    expect(near.closed).toBe(true)
    expect(near.points.length / 3).toBe(48)
    for (let i = 1; i < near.points.length; i += 3) expect(near.points[i]).toBeCloseTo(low, 6)
    expect(pickLoop(borders, can.positions, can.positions, [10 / mm, low + 15 / mm, 0], 1 / mm)).toBeNull()
    // Clicked at another place on the rim, it is the same loop.
    expect(sameLoop(near, pickLoop(borders, can.positions, can.positions, [0, low, -9.9 / mm], 1 / mm)!)).toBe(true)
    expect(sameLoop(near, pickLoop(borders, can.positions, can.positions, [9.9 / mm, low + 30 / mm, 0], 1 / mm)!)).toBe(false)
  })

  it('keeps sharp, rounds in mm, and leaves grown or lost loops alone', () => {
    const can = cylinder(), borders = findBorders(can.positions, can.indices), low = lowY(can.positions), mm = can.scale
    const bottom = pickLoop(borders, can.positions, can.positions, [9.9 / mm, low, 0], 1 / mm)!.points
    const top = pickLoop(borders, can.positions, can.positions, [9.9 / mm, low + 30 / mm, 0], 1 / mm)!.points
    const elsewhere = Float32Array.from(bottom, (x, i) => i % 3 === 1 ? x + 5 / mm : x)
    const choices = [choice('a', bottom, 'round', 2), choice('b', top, 'sharp'), choice('c', elsewhere, 'sharp')]
    const growth = new Float32Array(can.positions.length / 3)
    const plan = printEdges(choices, can.positions, can.indices, growth, mm)
    expect(plan.rounds).toHaveLength(1)
    expect(plan.rounds[0].edges.length / 2).toBe(48)
    expect(plan.rounds[0].radius * mm).toBeCloseTo(2, 9)
    expect(plan.roundIds).toEqual(['a'])
    expect(plan.keep.length / 2).toBe(48)
    expect([...plan.status]).toEqual([['a', 'rounded'], ['b', 'kept'], ['c', 'missing']])
    // Where the top rim has grown, it is left alone.
    for (let v = 0; v < growth.length; v++) if (can.positions[v * 3 + 1] > low + 29 / mm) growth[v] = 2 * GROWN_LIMIT
    expect(printEdges(choices, can.positions, can.indices, growth, mm).status.get('b')).toBe('grown')
    // A round that couldn't be made says why.
    expect(finalStatus(plan.status, plan.roundIds, [{ loop: 0, problem: 'no room' }]).get('a')).toBe('no room')
  })

  it('reads choices from a project file only when they make sense', () => {
    const good = { id: 'a', points: [0, 0, 0, 1, 0, 0, 1, 1, 0], closed: true, action: 'round', radius: 2 }
    expect(validChoice(good)).toBe(true)
    expect(validChoice({ ...good, radius: 0.1 })).toBe(false)
    expect(validChoice({ ...good, action: 'bevel' })).toBe(false)
    expect(validChoice({ ...good, points: [0, 0, 0, 1] })).toBe(false)
  })
})
