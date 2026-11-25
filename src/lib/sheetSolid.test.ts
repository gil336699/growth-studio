import { describe, expect, it } from 'vitest'
import { createGrowingDisk } from '../physics/growingDisk'
import { readGrowthStl, type GrowthStlSource } from '../physics/growthStl'
import { findBorders, traceLoop } from './borders'
import { smallestRound } from './edgeChoices'
import { roundEdges } from './roundEdges'
import { printSheet, roundGroups, sheetSolid } from './sheetSolid'
import { latheTriangles, stl } from './testStl'
import { facingSign, rimProfile, solidCrossings, solidLeaks, thicken, WALL_SHIFT, type Solid } from './thicken'

// A point's place on a shape of revolution in mm: how far it is from the axis, and how high above the bottom.
const placeOn = (shape: GrowthStlSource, P: ArrayLike<number>) => {
  let low = Infinity
  for (let i = 1; i < shape.positions.length; i += 3) low = Math.min(low, shape.positions[i])
  return (v: number) => ({ rho: Math.hypot(P[v * 3], P[v * 3 + 2]) * shape.scale, h: (P[v * 3 + 1] - low) * shape.scale })
}
// The loop of sharp edges through the sharp edge nearest the given place (radius and height in mm).
function loopAt(shape: GrowthStlSource, rho: number, h: number) {
  const borders = findBorders(shape.positions, shape.indices), place = placeOn(shape, shape.positions)
  let pick = 0, best = Infinity
  for (let i = 0; i < borders.sharp.length; i += 2) {
    const a = place(borders.sharp[i]), b = place(borders.sharp[i + 1]), d = Math.hypot((a.rho + b.rho) / 2 - rho, (a.h + b.h) / 2 - h)
    if (d < best) { best = d; pick = i }
  }
  return traceLoop(borders, shape.positions, borders.sharp[pick], borders.sharp[pick + 1])
}
// The places where the wall crosses itself, counted as the app's status line counts them.
const crossings = (solid: Solid) => solidCrossings(solid.positions, solid.indices, 100, solid.groups ?? solid.origin).pairs
// Faces of the wall turned over: over each face of the sheet, the wall's two faces should face opposite ways
// (lib/thicken makes faces 2f and 2f + 1 over the sheet's face f).
function turnedFaces(solid: Solid, roundness: number) {
  const P = solid.positions, J = solid.indices, steps = rimProfile(1, roundness).length - 1
  const normal = (f: number) => {
    const [a, b, c] = [J[f * 3] * 3, J[f * 3 + 1] * 3, J[f * 3 + 2] * 3], u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
  }
  let turned = 0
  for (let f = 0; f < (J.length / 3 - solid.rimEdges * steps * 2) / 2; f++) {
    const a = normal(2 * f), b = normal(2 * f + 1)
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0) turned++
  }
  return turned
}

describe('sheetSolid', () => {
  it('rounds a sheet so its wall gets the round larger outside and smaller inside, and leaves a round under the wall sharp', () => {
    // A cup 20 mm across and 30 mm tall, open on top, its faces facing out: in 192 facets, so it is round to 2 µm.
    const cup = readGrowthStl(stl(latheTriangles([[0, 0], [10, 0], [10, 30]], 192)), 'cup.stl'), mm = cup.scale, loop = loopAt(cup, 10, 0)
    const outside = WALL_SHIFT.outside * facingSign(cup.positions, cup.indices, 'outward')
    const solid = (radius: number, shift: number) => sheetSolid(printSheet(cup.positions, cup.indices, { passes: 0, rounds: [{ edges: loop, radius: radius / mm }] }),
      { wall: 1.2 / mm, roundness: 1, shift, tolerance: 0.005 / mm })
    // The bottom edge turns out, so the round's inner side is the cup's inside, where a 1.2 mm wall on both sides puts
    // 0.6 mm: a 0.5 mm round is under it. With all of the wall outside, the sheet itself is the inner face, so it fits.
    expect(solid(0.5, 0).skipped).toEqual([{ loop: 0, problem: 'under the wall' }])
    const out = solid(0.5, outside)
    expect(out.skipped).toEqual([])
    expect(crossings(out)).toBe(0)
    // All of the wall inside: a 1 mm round is under it.
    expect(solid(1, -outside).skipped).toEqual([{ loop: 0, problem: 'under the wall' }])
    // A 2 mm round with the wall on both sides: every point of the solid in the corner lies on the outer face, rounded
    // 2.6 mm about the round's center (8 mm out and 2 mm up), or on the inner face, rounded 1.4 mm.
    const made = solid(2, 0)
    expect(made.skipped).toEqual([])
    expect(solidLeaks(made.indices)).toBe(0)
    expect(crossings(made)).toBe(0)
    const place = placeOn(cup, made.positions), radii: number[] = []
    for (let v = 0; v < made.positions.length / 3; v++) {
      const { rho, h } = place(v)
      if (rho > 8.01 && h < 1.99) radii.push(Math.hypot(rho - 8, h - 2))
    }
    expect(radii.filter(d => Math.abs(d - 2.6) < 0.01).length).toBeGreaterThan(192 * 5)
    expect(radii.filter(d => Math.abs(d - 1.4) < 0.01).length).toBeGreaterThan(192 * 5)
    expect(radii.filter(d => Math.abs(d - 2.6) >= 0.01 && Math.abs(d - 1.4) >= 0.01)).toEqual([])
  })

  it('fits the smallest round the card offers under a wall', () => {
    // Walls that are multiples of 0.45 mm on the round's inner side put the smallest round exactly on the limit, where
    // rounding decided before; at two sizes of cup, so the model's units differ.
    for (const size of [10, 33]) {
      const cup = readGrowthStl(stl(latheTriangles([[0, 0], [size, 0], [size, 3 * size]])), 'cup.stl'), mm = cup.scale, loop = loopAt(cup, size, 0)
      for (let k = 1; k <= 10; k++) {
        const inner = 0.45 * k, least = smallestRound(inner)
        expect(least).toBeCloseTo(inner / 0.9, 9)
        const [problem] = roundEdges(cup.positions, cup.indices, [{ edges: loop, radius: least / mm }], { wall: { front: inner / mm, back: inner / mm } }).skipped
        expect(problem?.problem).not.toBe('under the wall')
      }
    }
  })

  it('leaves a round sharp where its wall would cross another part of the sheet, but not for a crossing that was there', () => {
    // A hat: a brim out to 20 mm, and a crown 20 mm across rising 30 mm from it, open on top, with the edge between them
    // to round 2 mm. A ring 22.6 mm across stands 0.7 mm above the brim, inside that edge's corner: the round itself
    // passes under it, and the plain 1.2 mm wall clears it by 0.1 mm, but the round's wall fills the corner it stands in.
    const brimAndCrown = latheTriangles([[20, 0], [10, 0], [10, 30]])
    const hat = readGrowthStl(stl([...brimAndCrown, ...latheTriangles([[11.3, 0.7], [11.3, 5]])]), 'hat.stl'), mm = hat.scale
    const sheet = printSheet(hat.positions, hat.indices, { passes: 0, rounds: [{ edges: loopAt(hat, 10, 0), radius: 2 / mm }] })
    expect(roundEdges(sheet.positions, sheet.indices, sheet.rounds, { tolerance: 0.005 / mm }).skipped).toEqual([])
    const wall = (thickness: number) => sheetSolid(sheet, { wall: thickness / mm, roundness: 0, shift: 0, tolerance: 0.005 / mm })
    const thick = wall(1.2)
    expect(thick.skipped).toEqual([{ loop: 0, problem: 'folds the wall' }])
    expect(solidLeaks(thick.indices)).toBe(0)
    expect(crossings(thick)).toBe(0)
    // A 0.4 mm wall clears the ring with the round.
    const thin = wall(0.4)
    expect(thin.skipped).toEqual([])
    expect(crossings(thin)).toBe(0)
    // A ring higher up that crosses the crown's wall already, on faces the round reaches (each runs the crown's height),
    // still crosses it with the round: that isn't the round's doing.
    const crossed = readGrowthStl(stl([...brimAndCrown, ...latheTriangles([[11, 10], [11, 15]])]), 'crossed.stl')
    const before = sheetSolid(printSheet(crossed.positions, crossed.indices, { passes: 0 }), { wall: 1.2 / mm, roundness: 0, shift: 0 })
    expect(crossings(before)).toBeGreaterThan(0)
    const after = sheetSolid(printSheet(crossed.positions, crossed.indices, { passes: 0, rounds: [{ edges: loopAt(crossed, 10, 0), radius: 2 / mm }] }),
      { wall: 1.2 / mm, roundness: 0, shift: 0, tolerance: 0.005 / mm })
    expect(after.skipped).toEqual([])
  })

  it('rounds with the Sharp edge angle asked for, its wall a round too, even where a coarse sheet\'s facets meet', () => {
    // A cup in 10 facets, which meet at 36°: sharp at 30°, the default, so they meet the bottom loop as edges.
    const cup = readGrowthStl(stl(latheTriangles([[0, 0], [10, 0], [10, 30]], 10)), 'cup.stl'), mm = cup.scale
    const outside = WALL_SHIFT.outside * facingSign(cup.positions, cup.indices, 'outward')
    const sheet = printSheet(cup.positions, cup.indices, { passes: 0, rounds: [{ edges: loopAt(cup, 10, 0), radius: 2 / mm }] })
    const round = (shift: number, sharpAngle?: number) => sheetSolid(sheet, { wall: 1.2 / mm, roundness: 1, shift, tolerance: 0.005 / mm, sharpAngle })
    expect(round(outside).skipped).toEqual([{ loop: 0, problem: 'meets an edge' }])
    // At 40° the round is made, with the wall outside or half of it inside. The wall follows the round's own normals,
    // so its inner face is a smaller round even where the facets meet at a crease: no face of it turns over.
    for (const shift of [outside, 0]) {
      const made = round(shift, 40)
      expect(made.skipped).toEqual([])
      expect(crossings(made)).toBe(0)
      expect(turnedFaces(made, 1)).toBe(0)
    }
  })

  it('makes a clean wall on a CAD cup with every default, and counts folds inside a round where there are any', () => {
    // A 48-facet cup, as the app prepares it to grow, with a 1.2 mm wall on both sides and its bottom rounded 2 mm.
    const cup = readGrowthStl(stl(latheTriangles([[0, 0], [10, 0], [10, 30]])), 'cup.stl'), mm = cup.scale
    const grown = createGrowingDisk(cup), P = Float32Array.from(grown.referencePositions), I = Uint32Array.from(grown.indices)
    const sheet = printSheet(P, I, { passes: 0, rounds: [{ edges: loopAt({ ...cup, positions: P, indices: I }, 10, 0), radius: 2 / mm }] })
    const made = sheetSolid(sheet, { wall: 1.2 / mm, roundness: 1, shift: 0, tolerance: 0.005 / mm })
    expect(made.skipped).toEqual([])
    expect(crossings(made)).toBe(0)
    expect(turnedFaces(made, 1)).toBe(0)
    // A wall that took its faces' average normals instead folds inside the round, where thin faces skew them. Counted
    // by the grown sheet's points, as the check counted before, those folds are hidden: the round's points take the
    // grown point at the far end of the edge they were cut on, so whole strips of it share one.
    const rounded = roundEdges(sheet.positions, sheet.indices, sheet.rounds, { tolerance: 0.005 / mm, wall: { front: 0.6 / mm, back: 0.6 / mm } })
    const folded = thicken(rounded.positions, rounded.indices, 1.2 / mm, 1, 4, 0), groups = roundGroups(rounded)
    expect(turnedFaces(folded, 1)).toBeGreaterThan(0)
    expect(crossings({ ...folded, origin: Uint32Array.from(folded.origin, v => rounded.origin[v]) })).toBe(0)
    expect(crossings({ ...folded, groups: Uint32Array.from(folded.origin, v => groups[v]) })).toBeGreaterThan(0)
  })

  it('leaves no sliver turned over where a round meets the faces beside it', () => {
    // Cups of 32 and 48 facets as the app prepares them, rounded 3 and 4 mm. Merging two points a hair apart at the
    // round's edge could turn a face beside them over, a sliver a fraction of a micrometre wide, and a wall built on it
    // folded by millimetres; a sliver that turns over anyway leaves the loop sharp ('turns over').
    for (const facets of [32, 48]) {
      const cup = readGrowthStl(stl(latheTriangles([[0, 0], [10, 0], [10, 30]], facets)), 'cup.stl'), mm = cup.scale
      const grown = createGrowingDisk(cup), P = Float32Array.from(grown.referencePositions), I = Uint32Array.from(grown.indices)
      for (const r of [3, 4]) {
        const sheet = printSheet(P, I, { passes: 0, rounds: [{ edges: loopAt({ ...cup, positions: P, indices: I }, 10, 0), radius: r / mm }] })
        const made = sheetSolid(sheet, { wall: 1.2 / mm, roundness: 1, shift: 0, tolerance: 0.005 / mm })
        expect(made.skipped).toEqual([])
        expect(turnedFaces(made, 1)).toBe(0)
      }
    }
  })

  it('leaves a round sharp that adds places where the wall crosses itself, however short', () => {
    // The hat with a ring crossing its crown's wall high up, on faces the round reaches: 133 mm of lines where faces
    // cross, there already. A patch 0.1 mm wide stands in the round's corner, clear of the plain wall by 0.05 mm; the
    // round's wall cuts through it along about half a millimetre, under a hundredth of what crossed before, but in
    // places the wall didn't cross before.
    const patch = [[[11.25, -0.05, 0.95], [11.25, 0.05, 0.95], [11.25, 0.05, 1.05]], [[11.25, -0.05, 0.95], [11.25, 0.05, 1.05], [11.25, -0.05, 1.05]]]
    const tris = [...latheTriangles([[20, 0], [10, 0], [10, 30]]), ...latheTriangles([[11, 10], [11, 15]])]
    const options = (mm: number) => ({ wall: 1.2 / mm, roundness: 0, shift: 0, tolerance: 0.005 / mm })
    for (const [shape, problems] of [[tris, []], [[...tris, ...patch], [{ loop: 0, problem: 'folds the wall' }]]] as const) {
      const hat = readGrowthStl(stl([...shape]), 'hat.stl'), mm = hat.scale
      const plain = sheetSolid(printSheet(hat.positions, hat.indices, { passes: 0 }), options(mm))
      const made = sheetSolid(printSheet(hat.positions, hat.indices, { passes: 0, rounds: [{ edges: loopAt(hat, 10, 0), radius: 2 / mm }] }), options(mm))
      expect(made.skipped).toEqual(problems)
      expect(crossings(made)).toBe(crossings(plain))
    }
  })
})
