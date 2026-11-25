import { describe, expect, it } from 'vitest'
import { createGrowingDisk } from '../physics/growingDisk'
import { readGrowthStl } from '../physics/growthStl'
import { findBorders } from './borders'
import { closedSolid } from './closedSolid'
import { sharpEdges } from './smoothSheet'
import { latheTriangles, stl } from './testStl'

// A closed cylinder 20 mm across and 30 mm tall in 48 facets (or as many as asked), Y up, its ends fanned from their middles.
function cylinder(n = 48) {
  const positions: number[] = [0, 0, 0, 0, 30, 0], indices: number[] = []
  for (const y of [0, 30]) for (let i = 0; i < n; i++) positions.push(10 * Math.cos(2 * Math.PI * i / n), y, 10 * Math.sin(2 * Math.PI * i / n))
  const low = (i: number) => 2 + (i % n), high = (i: number) => 2 + n + (i % n)
  for (let i = 0; i < n; i++) indices.push(0, low(i), low(i + 1), 1, high(i + 1), high(i), low(i), high(i), high(i + 1), low(i), high(i + 1), low(i + 1))
  return { positions, indices }
}

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

describe('rounds on the print', () => {
  it('rounds a loop after smoothing, keeping it sharp until then, and still cuts the base flat', () => {
    const can = cylinder(), creases = sharpEdges(can.positions, can.indices)
    // The bottom rim: its 48 edges, both ends at the bottom.
    const rim: number[] = []
    for (let i = 0; i < creases.length; i += 2) if (can.positions[creases[i] * 3 + 1] === 0 && can.positions[creases[i + 1] * 3 + 1] === 0) rim.push(creases[i], creases[i + 1])
    expect(rim.length / 2).toBe(48)
    for (const passes of [0, 1]) {
      // A full bevel would round every crease while smoothing; the loop to round stays sharp for the round to take.
      const solid = closedSolid(can.positions, can.indices, { passes, creases, bevel: 1, rounds: [{ edges: rim, radius: 2 }], tolerance: 0.005 })
      expect(solid.skipped).toEqual([])
      expect(closed(solid.indices)).toBe(true)
      // The flat bottom now ends about 2 mm in from the wall.
      let bottom = 0
      for (let v = 0; v < solid.positions.length / 3; v++) if (Math.abs(solid.positions[v * 3 + 1]) < 1e-6) bottom = Math.max(bottom, Math.hypot(solid.positions[v * 3], solid.positions[v * 3 + 2]))
      expect(bottom).toBeGreaterThan(7.9)
      expect(bottom).toBeLessThan(8.1)
      // Cut 0.5 mm up, the base is the round's ring at that height: wider than the round's flat bottom.
      const cut = closedSolid(can.positions, can.indices, { passes, creases, rounds: [{ edges: rim, radius: 2 }], cut: 0.5 })
      expect(closed(cut.indices)).toBe(true)
      expect(cut.capArea).toBeGreaterThan(Math.PI * 8.1 ** 2)
    }
  })

  it('says when the flat base cuts a round away', () => {
    const can = cylinder(), creases = sharpEdges(can.positions, can.indices)
    const rim: number[] = []
    for (let i = 0; i < creases.length; i += 2) if (can.positions[creases[i] * 3 + 1] === 0 && can.positions[creases[i + 1] * 3 + 1] === 0) rim.push(creases[i], creases[i + 1])
    // A 2 mm round on the bottom rim, under a base cut 5 mm up: nothing of it is left. Cut 1 mm up, part of it is.
    expect(closedSolid(can.positions, can.indices, { passes: 1, creases, rounds: [{ edges: rim, radius: 2 }], cut: 5 }).skipped).toEqual([{ loop: 0, problem: 'cut away' }])
    expect(closedSolid(can.positions, can.indices, { passes: 1, creases, rounds: [{ edges: rim, radius: 2 }], cut: 1 }).skipped).toEqual([])
  })

  it('rounds with the Sharp edge angle asked for, so the facets of a coarse cylinder are no edges meeting the loop', () => {
    // A cylinder in 10 facets, which meet at 36°: sharp at 30°, the default, so they meet the bottom rim as edges.
    const can = cylinder(10), rim = Array.from({ length: 10 }, (_, i) => [2 + i, 2 + (i + 1) % 10]).flat()
    const round = (sharpAngle?: number) => closedSolid(can.positions, can.indices, { passes: 0, rounds: [{ edges: rim, radius: 2 }], sharpAngle }).skipped
    expect(round()).toEqual([{ loop: 0, problem: 'meets an edge' }])
    expect(round(40)).toEqual([])
  })

  it('leaves a round sharp that would leave a wall too thin, and says how thin', () => {
    // A pot 60 mm across with 1.2 mm walls and bottom, Z up as CAD writes it: a 3 mm round on its outer bottom edge
    // would leave 0.45 mm at the corner, less than the 0.8 mm asked for; a 2 mm round leaves 0.87 mm.
    const pot = readGrowthStl(stl(latheTriangles([[0, 0], [30, 0], [30, 50], [28.8, 50], [28.8, 1.2], [0, 1.2]], 96)), 'pot.stl'), mm = pot.scale
    const borders = findBorders(pot.positions, pot.indices), P = pot.positions
    let low = Infinity
    for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i])
    const bottom: number[] = []
    for (let i = 0; i < borders.sharp.length; i += 2) {
      const a = borders.sharp[i], b = borders.sharp[i + 1]
      if (P[a * 3 + 1] === low && P[b * 3 + 1] === low) bottom.push(a, b)
    }
    const round = (r: number) => closedSolid(pot.positions, pot.indices, { passes: 0, rounds: [{ edges: bottom, radius: r / mm }], minWall: 0.8 / mm }).skipped
    expect(round(2)).toEqual([])
    const [refused] = round(3)
    expect(refused.problem).toBe('thins the wall')
    expect(refused.left! * mm).toBeCloseTo(0.454, 2)
  })

  it('measures the wall a round leaves past the edge it cuts, on sharp edges, solid shapes and thin designs', () => {
    // The loop around the bottom of a shape of revolution: its sharp edges whose ends both lie on the bottom.
    const bottomLoop = (P: ArrayLike<number>, I: ArrayLike<number>) => {
      const borders = findBorders(P, I), loop: number[] = []
      let low = Infinity
      for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i])
      for (let i = 0; i < borders.sharp.length; i += 2) {
        const a = borders.sharp[i], b = borders.sharp[i + 1]
        if (Math.abs(P[a * 3 + 1] - low) < 1e-9 && Math.abs(P[b * 3 + 1] - low) < 1e-9) loop.push(a, b)
      }
      return loop
    }
    // Shapes as the app prepares them to grow, smoothed once, rounded at radii in mm with 0.8 mm as the thinnest wall.
    const rounded = (profile: [number, number][], prepare: boolean) => {
      const shape = readGrowthStl(stl(latheTriangles(profile, 96)), 'shape.stl'), mm = shape.scale, grown = prepare ? createGrowingDisk(shape) : null
      const P = grown ? Float32Array.from(grown.referencePositions) : shape.positions, I = grown ? Uint32Array.from(grown.indices) : shape.indices
      const loop = bottomLoop(P, I)
      return (r: number) => {
        const [refused] = closedSolid(P, I, { passes: 1, creases: sharpEdges(P, I), rounds: [{ edges: loop, radius: r / mm }], tolerance: 0.005 / mm, minWall: 0.8 / mm }).skipped
        return refused ? { problem: refused.problem, left: (refused.left ?? 0) * mm, need: (refused.need ?? 0) * mm } : null
      }
    }
    // A pot whose side leans in 30°, so its outer bottom edge is 60°, with 1.2 mm walls: a round leaves 2.4 − r at the
    // corner. Rays from the faces beside the loop cross the edge's own wedge, which the round cuts away; counted, they
    // made the pot's own walls seem as thin as the wedge, and a 2.2 mm round passed.
    const outerAt = (z: number) => 30 - z * Math.tan(Math.PI / 6), innerAt = (z: number) => outerAt(z) - 1.2 / Math.cos(Math.PI / 6)
    const leaning = rounded([[0, 0], [30, 0], [outerAt(30), 30], [innerAt(30), 30], [innerAt(1.2), 1.2], [0, 1.2]], true)
    expect(leaning(1.6)).toBeNull()
    expect(leaning(1.7)).toEqual({ problem: 'thins the wall', left: expect.closeTo(0.7, 1), need: expect.closeTo(0.8, 2) })
    // A solid puck has no thin wall to leave: rays that start a hair outside a face don't stop at it.
    expect(rounded([[0, 0], [20, 0], [20, 10], [0, 10]], true)(5)).toBeNull()
    // A pot with 1.2 mm walls and a groove inside from 2 mm to 4 mm up, leaving 0.6 mm there: the thinnest allowed is
    // the pot's own 0.6 mm, found from the round's touching line.
    const groove = rounded([[0, 0], [30, 0], [30, 50], [28.8, 50], [28.8, 4], [29.4, 4], [29.4, 2], [28.8, 2], [28.8, 1.2], [0, 1.2]], false)
    expect(groove(2.5)).toEqual({ problem: 'thins the wall', left: expect.closeTo(0.55, 1), need: expect.closeTo(0.6, 2) })
  })

  it('rounds a knife edge, which a round makes thicker, however thin the shape is there', () => {
    // A lens 20 mm across whose rim's faces meet at 30°: within a few millimetres of the rim it is thinner than 0.8 mm.
    // A round there leaves the tip thicker than the knife edge was, and as thick as the lens where the round ends.
    // As uploaded and as the app prepares it, with each smoothing.
    const lens = readGrowthStl(stl(latheTriangles([[0, 0], [10, 10 * Math.tan(Math.PI / 12)], [0, 20 * Math.tan(Math.PI / 12)]], 96)), 'lens.stl'), mm = lens.scale
    const grown = createGrowingDisk(lens)
    for (const [P, I] of [[lens.positions, lens.indices], [Float32Array.from(grown.referencePositions), Uint32Array.from(grown.indices)]] as const) {
      const borders = findBorders(P, I), rim: number[] = []
      let wide = 0
      for (let i = 0; i < P.length; i += 3) wide = Math.max(wide, Math.hypot(P[i], P[i + 2]))
      const onRim = (v: number) => Math.abs(Math.hypot(P[v * 3], P[v * 3 + 2]) - wide) < 1e-6
      for (let i = 0; i < borders.sharp.length; i += 2) if (onRim(borders.sharp[i]) && onRim(borders.sharp[i + 1])) rim.push(borders.sharp[i], borders.sharp[i + 1])
      for (const passes of [0, 1, 2]) for (const r of [0.2, 0.3, 0.5]) {
        const solid = closedSolid(P, I, { passes, creases: passes ? sharpEdges(P, I) : undefined, rounds: [{ edges: rim, radius: r / mm }], tolerance: 0.005 / mm, minWall: 0.8 / mm })
        expect(solid.skipped).toEqual([])
      }
    }
  })

  it('says which loops it left sharp', () => {
    const can = cylinder(), creases = sharpEdges(can.positions, can.indices)
    const solid = closedSolid(can.positions, can.indices, { passes: 1, creases, rounds: [{ edges: creases.slice(0, 8), radius: 2 }] })
    expect(solid.skipped).toEqual([{ loop: 0, problem: 'not a loop' }])
  })
})
