import { describe, expect, it } from 'vitest'
import { readGrowthStl, type GrowthStlSource } from '../physics/growthStl'
import { findBorders, traceLoop } from './borders'
import { edgeProblems, edgeUse, signedVolume } from './meshCheck'
import { roundEdges } from './roundEdges'
import { boxTriangles, latheTriangles, stl } from './testStl'

const FACETS = 48
// A solid of revolution about the Z axis in 48 facets, Z up as CAD writes it, from a profile of (radius, height) points
// in mm that runs from the bottom of the axis out, up and back in to the top; one that doesn't come back is open there.
// Its flat ends are fans from the middle, or, fanned from the rim, fans from one rim point, as some CAD exports do.
function lathe(profile: [number, number][], fannedFromRim = false) {
  const tris: number[][][] = [], at = (i: number, [rho, z]: [number, number]) => [rho * Math.cos(2 * Math.PI * i / FACETS), rho * Math.sin(2 * Math.PI * i / FACETS), z]
  for (let k = 0; k + 1 < profile.length; k++) {
    const p = profile[k], q = profile[k + 1]
    for (let i = 0; i < FACETS; i++) {
      if (fannedFromRim && (p[0] === 0 || q[0] === 0)) {
        const rim = p[0] === 0 ? q : p
        if (i > 0 && i + 1 < FACETS) tris.push(p[0] === 0 ? [at(0, rim), at(i + 1, rim), at(i, rim)] : [at(0, rim), at(i, rim), at(i + 1, rim)])
      } else if (p[0] === 0) tris.push([at(i, p), at(i + 1, q), at(i, q)])
      else if (q[0] === 0) tris.push([at(i, p), at(i + 1, p), at(i, q)])
      else tris.push([at(i, p), at(i + 1, p), at(i + 1, q)], [at(i, p), at(i + 1, q), at(i, q)])
    }
  }
  return readGrowthStl(stl(tris), 'lathe.stl')
}
// A 20 mm square plate 3.5 mm thick with a stadium-shaped bar 1.1 mm wide and 7.1 mm long standing 2 mm on it, as a
// letter stroke: the plate's top filled the way CAD fills a face, with long triangles from its corners to the bar, and
// the bar's top fanned from one point, so its triangles run across it.
function bar(width = 1.1, length = 7.1, height = 2, perEnd = 16) {
  const R = width / 2, half = length / 2 - R, ring: [number, number][] = []
  for (let i = 0; i <= perEnd; i++) { const a = Math.PI + Math.PI * i / perEnd; ring.push([R * Math.cos(a), -half + R * Math.sin(a)]) }
  for (let i = 0; i <= perEnd; i++) { const a = Math.PI * i / perEnd; ring.push([R * Math.cos(a), half + R * Math.sin(a)]) }
  const corners: [number, number][] = [[10, 10], [-10, 10], [-10, -10], [10, -10]], plate = 3.5, top = plate + height
  const tris: number[][][] = [], p3 = ([x, y]: [number, number], z: number) => [x, y, z]
  const quadrant = ([x, y]: [number, number]) => { const a = Math.atan2(y, x); return a >= 0 ? (a < Math.PI / 2 ? 0 : 1) : (a < -Math.PI / 2 ? 2 : 3) }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], qa = quadrant(a), qb = quadrant(b)
    tris.push([p3(corners[qa], plate), p3(b, plate), p3(a, plate)])
    if (qa !== qb) tris.push([p3(corners[qa], plate), p3(corners[qb], plate), p3(b, plate)])
    tris.push([p3(a, plate), p3(b, plate), p3(b, top)], [p3(a, plate), p3(b, top), p3(a, top)])
    if (i > 0 && i + 1 < ring.length) tris.push([p3(ring[0], top), p3(a, top), p3(b, top)])
  }
  for (let k = 0; k < 4; k++) {
    const c = corners[k], d = corners[(k + 1) % 4]
    tris.push([p3(c, 0), p3(d, 0), p3(d, plate)], [p3(c, 0), p3(d, plate), p3(c, plate)])
  }
  tris.push([[10, 10, 0], [-10, -10, 0], [-10, 10, 0]], [[10, 10, 0], [10, -10, 0], [-10, -10, 0]])
  return readGrowthStl(stl(tris), 'bar.stl')
}
// A cylinder 20 mm across and 30 mm tall (or as tall as asked), open on top if asked.
const cylinder = (open = false, height = 30) => lathe(open ? [[0, 0], [10, 0], [10, height]] : [[0, 0], [10, 0], [10, height], [0, height]])
const lowY = (P: ArrayLike<number>) => { let low = Infinity; for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i]); return low }
// A point's place on a lathe shape in mm: how far it is from the axis and how high above the bottom.
const place = (shape: GrowthStlSource, P: ArrayLike<number>, v: number) => ({
  rho: Math.hypot(P[v * 3], P[v * 3 + 2]) * shape.scale, h: (P[v * 3 + 1] - lowY(shape.positions)) * shape.scale,
})
// The loop of sharp edges through the sharp edge nearest the given place (radius and height in mm).
function loopAt(shape: GrowthStlSource, rho: number, h: number) {
  const borders = findBorders(shape.positions, shape.indices)
  let pick = 0, best = Infinity
  for (let i = 0; i < borders.sharp.length; i += 2) {
    const a = place(shape, shape.positions, borders.sharp[i]), b = place(shape, shape.positions, borders.sharp[i + 1])
    const d = Math.hypot((a.rho + b.rho) / 2 - rho, (a.h + b.h) / 2 - h)
    if (d < best) { best = d; pick = i }
  }
  return traceLoop(borders, shape.positions, borders.sharp[pick], borders.sharp[pick + 1])
}
// In a section across the round at a point: how far in the point is from the facet's plane (a wall of radius R), in mm.
const inset = (shape: GrowthStlSource, P: ArrayLike<number>, v: number, R: number) => {
  const psi = Math.atan2(P[v * 3 + 2], P[v * 3]), mid = (Math.floor(((psi / (2 * Math.PI)) % 1 + 1) % 1 * FACETS) + 0.5) * 2 * Math.PI / FACETS
  return R * Math.cos(Math.PI / FACETS) - (P[v * 3] * Math.cos(mid) + P[v * 3 + 2] * Math.sin(mid)) * shape.scale
}
const volume = (shape: GrowthStlSource, P: ArrayLike<number>, I: ArrayLike<number>) => signedVolume(P, I) * shape.scale ** 3
// Faces turned over: each face of a lathe shape should face away from the axis, down on the bottom, or up on a top.
function turnedOver(shape: GrowthStlSource, P: ArrayLike<number>, I: ArrayLike<number>) {
  let flipped = 0
  for (let f = 0; f < I.length / 3; f++) {
    const [a, b, c] = [I[f * 3] * 3, I[f * 3 + 1] * 3, I[f * 3 + 2] * 3]
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const cx = (P[a] + P[b] + P[c]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3
    // Flat faces face straight up or down; any other face must face away from the axis.
    const flat = Math.abs(n[0]) + Math.abs(n[2]) < 1e-9 * Math.hypot(...n)
    if (!flat && n[0] * cx + n[2] * cz < 0) flipped++
  }
  return flipped
}

describe('roundEdges', () => {
  it('rounds a closed loop with the radius asked for, and the solid stays closed', () => {
    const can = cylinder(), rim = loopAt(can, 10, 0), r = 2
    expect(rim.length / 2).toBe(FACETS)
    const out = roundEdges(can.positions, can.indices, [{ edges: rim, radius: r / can.scale }])
    expect(out.skipped).toEqual([])
    expect(edgeProblems(out.indices)).toBe(0)
    expect(turnedOver(can, out.positions, out.indices)).toBe(0)
    // A 2 mm round takes (1 − π/4) r² off the section all round the rim, about 49 mm³ on this cylinder.
    const removed = volume(can, can.positions, can.indices) - volume(can, out.positions, out.indices)
    expect(removed).toBeGreaterThan(0.9 * (1 - Math.PI / 4) * r * r * 2 * Math.PI * 9.5)
    expect(removed).toBeLessThan(1.1 * (1 - Math.PI / 4) * r * r * 2 * Math.PI * 9.5)
    // In a section across the rim, every point in the 2 mm square at the corner is on the circle 2 mm in from the wall
    // and 2 mm up from the bottom, and the flat bottom and the wall end where the circle touches them.
    let onRound = 0, bottomEnds = Infinity, wallEnds = Infinity
    for (let v = 0; v < out.positions.length / 3; v++) {
      const { h } = place(can, out.positions, v), w = inset(can, out.positions, v, 10)
      if (h < 1e-6) bottomEnds = Math.min(bottomEnds, w)
      if (Math.abs(w) < 1e-6) wallEnds = Math.min(wallEnds, h)
      if (h < r - 1e-3 && w < r - 1e-3) { onRound++; expect(Math.abs(Math.hypot(w - r, h - r) - r)).toBeLessThan(0.02 * r) }
    }
    expect(onRound).toBeGreaterThan(FACETS * 6)
    expect(bottomEnds).toBeCloseTo(r, 2)
    expect(wallEnds).toBeCloseTo(r, 2)
    // The rows cut the wall's long triangles next to points they cut already, and those points merge: about 1,350 faces
    // in all, where keeping them all made 3,360.
    expect(out.indices.length / 3).toBeLessThan(2000)
  })

  it('leaves the surface beyond the round exactly as it was', () => {
    const can = cylinder(), out = roundEdges(can.positions, can.indices, [{ edges: loopAt(can, 10, 0), radius: 2 / can.scale }])
    // Every original point more than 2 mm from the bottom edge stays where it was.
    for (let v = 0; v < can.positions.length / 3; v++) {
      const { rho, h } = place(can, can.positions, v)
      if (h > 2 + 1e-6 || rho < 8 - 1e-6) for (let k = 0; k < 3; k++) expect(out.positions[v * 3 + k]).toBe(can.positions[v * 3 + k])
    }
    // Every new point comes from a point of the original surface.
    expect(Math.max(...out.origin)).toBeLessThan(can.positions.length / 3)
  })

  it('rounds an edge that turns in, adding material where a boss meets its plate', () => {
    // A boss 16 mm across and 10 mm tall on a plate 30 mm across and 5 mm thick.
    const part = lathe([[0, 0], [15, 0], [15, 5], [8, 5], [8, 15], [0, 15]]), r = 2
    const out = roundEdges(part.positions, part.indices, [{ edges: loopAt(part, 8, 5), radius: r / part.scale }])
    expect(out.skipped).toEqual([])
    expect(edgeProblems(out.indices)).toBe(0)
    expect(turnedOver(part, out.positions, out.indices)).toBe(0)
    const added = volume(part, out.positions, out.indices) - volume(part, part.positions, part.indices)
    expect(added).toBeGreaterThan(0.9 * (1 - Math.PI / 4) * r * r * 2 * Math.PI * 8.4)
    expect(added).toBeLessThan(1.1 * (1 - Math.PI / 4) * r * r * 2 * Math.PI * 8.4)
    // The round's points are on the circle 2 mm out from the boss and 2 mm above the plate.
    let onRound = 0
    for (let v = 0; v < out.positions.length / 3; v++) {
      const { h } = place(part, out.positions, v), w = -inset(part, out.positions, v, 8)
      if (h > 5 + 1e-3 && h < 5 + r - 1e-3 && w > 1e-3 && w < r - 1e-3) { onRound++; expect(Math.abs(Math.hypot(w - r, h - 5 - r) - r)).toBeLessThan(0.02 * r) }
    }
    expect(onRound).toBeGreaterThan(FACETS * 6)
  })

  it('rounds the edge of an open sheet without opening it further, and leaves a chain that isn\'t a loop sharp', () => {
    const cup = cylinder(true), rim = loopAt(cup, 10, 0)
    const open = edgeUse(cup.indices, cup.positions.length / 3).open
    const out = roundEdges(cup.positions, cup.indices, [{ edges: rim, radius: 2 / cup.scale }])
    expect(out.skipped).toEqual([])
    expect(edgeUse(out.indices, out.positions.length / 3).open).toBe(open)
    expect(edgeUse(out.indices, out.positions.length / 3).crowded).toBe(0)
    expect(turnedOver(cup, out.positions, out.indices)).toBe(0)
    // Half the rim is a chain with two ends.
    const half = roundEdges(cup.positions, cup.indices, [{ edges: rim.slice(0, rim.length / 2), radius: 2 / cup.scale }])
    expect(half.skipped).toEqual([{ loop: 0, problem: 'not a loop' }])
    expect(Array.from(half.positions)).toEqual(Array.from(cup.positions))
  })

  it('rounds both rims of a cylinder', () => {
    const can = cylinder(), r = 2
    const out = roundEdges(can.positions, can.indices, [{ edges: loopAt(can, 10, 0), radius: r / can.scale }, { edges: loopAt(can, 10, 30), radius: r / can.scale }])
    expect(out.skipped).toEqual([])
    expect(edgeProblems(out.indices)).toBe(0)
    expect(turnedOver(can, out.positions, out.indices)).toBe(0)
    const removed = volume(can, can.positions, can.indices) - volume(can, out.positions, out.indices)
    expect(removed).toBeCloseTo(2 * (1 - Math.PI / 4) * r * r * 2 * Math.PI * 9.5, -1)
  })

  it('rounds a bottom whose faces run across it from one rim point to the others', () => {
    // The fan's edges leave the rim and come back to it, with the round's whole reach in between: they are split until
    // the rows cut them where they should.
    const can = lathe([[0, 0], [10, 0], [10, 30], [0, 30]], true), r = 2
    const out = roundEdges(can.positions, can.indices, [{ edges: loopAt(can, 10, 0), radius: r / can.scale }])
    expect(out.skipped).toEqual([])
    expect(edgeProblems(out.indices)).toBe(0)
    expect(turnedOver(can, out.positions, out.indices)).toBe(0)
    let onRound = 0, bottomEnds = Infinity
    for (let v = 0; v < out.positions.length / 3; v++) {
      const { h } = place(can, out.positions, v), w = inset(can, out.positions, v, 10)
      if (h < 1e-6) bottomEnds = Math.min(bottomEnds, w)
      if (h < r - 1e-3 && w < r - 1e-3) { onRound++; expect(Math.abs(Math.hypot(w - r, h - r) - r)).toBeLessThan(0.02 * r) }
    }
    expect(onRound).toBeGreaterThan(FACETS * 6)
    expect(bottomEnds).toBeCloseTo(r, 2)
  })

  it('rounds a narrow letter stroke with a round that fits it, and leaves it sharp when two rounds would meet on top', () => {
    const stroke = bar(), top = loopAt(stroke, 0.55, 5.5)
    expect(top.length / 2).toBe(34)
    // Its top is 1.1 mm wide, its ends curve with a radius of 0.55 mm: a 0.4 mm round fits, two 1 mm rounds would overlap.
    const fits = roundEdges(stroke.positions, stroke.indices, [{ edges: top, radius: 0.4 / stroke.scale }])
    expect(fits.skipped).toEqual([])
    expect(edgeProblems(fits.indices)).toBe(0)
    expect(roundEdges(stroke.positions, stroke.indices, [{ edges: top, radius: 1 / stroke.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
    // A 0.5 mm round would nearly fold where it turns round the ends, leaving faces too small to move cleanly.
    expect(roundEdges(stroke.positions, stroke.indices, [{ edges: top, radius: 0.5 / stroke.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
  })

  it('leaves a loop sharp where the loop curves tighter than the round', () => {
    // An oval pot 40 × 10 mm: its ends curve with a radius of 1.25 mm inside, so a 1 mm round fits and a 2 mm one doesn't.
    const oval = Array.from({ length: 192 }, (_, i) => [20 * Math.cos(2 * Math.PI * i / 192), 5 * Math.sin(2 * Math.PI * i / 192)])
    const tris: number[][][] = []
    for (let i = 0; i < 192; i++) {
      const [ax, ay] = oval[i], [bx, by] = oval[(i + 1) % 192]
      tris.push([[ax, ay, 0], [bx, by, 0], [bx, by, 20]], [[ax, ay, 0], [bx, by, 20], [ax, ay, 20]], [[0, 0, 0], [bx, by, 0], [ax, ay, 0]], [[0, 0, 20], [ax, ay, 20], [bx, by, 20]])
    }
    const pot = readGrowthStl(stl(tris), 'oval.stl'), borders = findBorders(pot.positions, pot.indices), low = lowY(pot.positions)
    let pick = 0
    while (pot.positions[borders.sharp[pick] * 3 + 1] !== low || pot.positions[borders.sharp[pick + 1] * 3 + 1] !== low) pick += 2
    const bottom = traceLoop(borders, pot.positions, borders.sharp[pick], borders.sharp[pick + 1])
    expect(roundEdges(pot.positions, pot.indices, [{ edges: bottom, radius: 1 / pot.scale }]).skipped).toEqual([])
    expect(roundEdges(pot.positions, pot.indices, [{ edges: bottom, radius: 2 / pot.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
  })

  it('leaves a loop sharp where two of its parts come close across a narrow waist', () => {
    // A peanut-shaped pot (a Cassini oval) 17 mm long whose middle is 1 mm wide, with gentle curves all round: a 0.3 mm
    // round on its top edge fits, but 0.8 mm rounds from the two sides of the waist would overlap across it.
    const c = 6, a2 = c * c + 0.25, outline = Array.from({ length: 192 }, (_, i) => {
      const th = 2 * Math.PI * i / 192, r = Math.sqrt(c * c * Math.cos(2 * th) + Math.sqrt(a2 * a2 - c ** 4 * Math.sin(2 * th) ** 2))
      return [r * Math.cos(th), r * Math.sin(th)]
    })
    const tris: number[][][] = []
    for (let i = 0; i < 192; i++) {
      const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % 192]
      tris.push([[ax, ay, 0], [bx, by, 0], [bx, by, 10]], [[ax, ay, 0], [bx, by, 10], [ax, ay, 10]], [[0, 0, 0], [bx, by, 0], [ax, ay, 0]], [[0, 0, 10], [ax, ay, 10], [bx, by, 10]])
    }
    const pot = readGrowthStl(stl(tris), 'peanut.stl'), borders = findBorders(pot.positions, pot.indices)
    let high = -Infinity
    for (let i = 1; i < pot.positions.length; i += 3) high = Math.max(high, pot.positions[i])
    let pick = 0
    while (pot.positions[borders.sharp[pick] * 3 + 1] !== high || pot.positions[borders.sharp[pick + 1] * 3 + 1] !== high) pick += 2
    const top = traceLoop(borders, pot.positions, borders.sharp[pick], borders.sharp[pick + 1])
    expect(top.length / 2).toBe(192)
    expect(roundEdges(pot.positions, pot.indices, [{ edges: top, radius: 0.3 / pot.scale }]).skipped).toEqual([])
    expect(roundEdges(pot.positions, pot.indices, [{ edges: top, radius: 0.8 / pot.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
  }, 30_000)

  it('leaves a loop sharp when the round has no room, and changes nothing', () => {
    const can = cylinder()
    // A 12 mm round on a bottom 20 mm across would meet itself across the bottom.
    const wide = roundEdges(can.positions, can.indices, [{ edges: loopAt(can, 10, 0), radius: 12 / can.scale }])
    expect(wide.skipped).toEqual([{ loop: 0, problem: 'no room' }])
    expect(Array.from(wide.positions)).toEqual(Array.from(can.positions))
    // On a cylinder 3 mm tall, 2 mm rounds on both rims would overlap on the wall: the first is made, the second not.
    const short = cylinder(false, 3), both = roundEdges(short.positions, short.indices,
      [{ edges: loopAt(short, 10, 0), radius: 2 / short.scale }, { edges: loopAt(short, 10, 3), radius: 2 / short.scale }])
    expect(both.skipped).toEqual([{ loop: 1, problem: 'no room' }])
    expect(edgeProblems(both.indices)).toBe(0)
    // A box's four bottom edges make a loop, but its upright edges, as sharp, meet it at the corners.
    const box = readGrowthStl(stl(boxTriangles(30, 20, 10)), 'box.stl'), borders = findBorders(box.positions, box.indices), low = lowY(box.positions)
    const bottom: number[] = []
    for (let i = 0; i < borders.sharp.length; i += 2) {
      const a = borders.sharp[i], b = borders.sharp[i + 1]
      if (box.positions[a * 3 + 1] === low && box.positions[b * 3 + 1] === low) bottom.push(a, b)
    }
    expect(bottom.length / 2).toBe(4)
    expect(roundEdges(box.positions, box.indices, [{ edges: bottom, radius: 2 / box.scale }]).skipped).toEqual([{ loop: 0, problem: 'meets an edge' }])
    // On a closed cylinder 1.5 mm tall, a 2 mm bottom round would reach the sharp top rim: a smaller one fits.
    const disc = cylinder(false, 1.5)
    expect(roundEdges(disc.positions, disc.indices, [{ edges: loopAt(disc, 10, 0), radius: 2 / disc.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
    expect(roundEdges(disc.positions, disc.indices, [{ edges: loopAt(disc, 10, 0), radius: 0.5 / disc.scale }]).skipped).toEqual([])
    // A cup 1.5 mm tall: a 2 mm round would reach its open rim.
    const lowCup = cylinder(true, 1.5)
    expect(roundEdges(lowCup.positions, lowCup.indices, [{ edges: loopAt(lowCup, 10, 0), radius: 2 / lowCup.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
    // A pyramid hanging from one point of the rim, a body touching the loop there, would be bent by the round.
    const P = 30, hang = [[10, 0, 0], [12, 1, -3], [12, -1, -3]], tip = [12, 0, -3.5]
    const tris = [...latheTriangles([[0, 0], [10, 0], [10, P], [0, P]]), [hang[0], hang[2], hang[1]], [hang[0], hang[1], tip], [hang[1], hang[2], tip], [hang[2], hang[0], tip]]
    const touched = readGrowthStl(stl(tris), 'touched.stl')
    expect(roundEdges(touched.positions, touched.indices, [{ edges: loopAt(touched, 10, 3.5), radius: 2 / touched.scale }]).skipped).toEqual([{ loop: 0, problem: 'no room' }])
  })

  it('leaves a loop sharp when the round would leave a closed shape\'s wall too thin, as at a thin pot\'s corner', () => {
    // Pots 60 mm across with 1.2 mm and 0.6 mm walls and bottoms. A round on the outer bottom edge leaves the wall
    // r − √2 (r − w) thick at the corner; the thinnest allowed is 0.8 mm, or the pot's own wall where that's thinner.
    for (const [w, fits, thin] of [[1.2, 2, 2.5], [0.6, 0.5, 1]]) {
      const pot = readGrowthStl(stl(latheTriangles([[0, 0], [30, 0], [30, 50], [30 - w, 50], [30 - w, w], [0, w]], 96)), 'pot.stl'), mm = pot.scale
      const bottom = loopAt(pot, 30, 0), round = (r: number, minWall?: number) => roundEdges(pot.positions, pot.indices, [{ edges: bottom, radius: r / mm }], { minWall })
      expect(round(fits, 0.8 / mm).skipped).toEqual([])
      const [refused] = round(thin, 0.8 / mm).skipped
      expect(refused.problem).toBe('thins the wall')
      expect(refused.left! * mm).toBeCloseTo(thin - Math.SQRT2 * (thin - w), 2)
      expect(refused.need! * mm).toBeCloseTo(Math.min(0.8, w), 2)
      expect(Array.from(round(thin, 0.8 / mm).positions)).toEqual(Array.from(pot.positions))
      // Without a thinnest wall, as on a sheet, whose wall is its own, the round is made.
      expect(round(thin).skipped).toEqual([])
    }
  })

  it('leaves a loop sharp when the round would cut through a thin wall, or its faces meet too sharply for any round', () => {
    // A pot 60 mm across and 50 mm tall with a 2 mm wall and bottom: a round on its outer bottom edge larger than about
    // 6.8 mm cuts away the inside corner, into the pot.
    const pot = readGrowthStl(stl(latheTriangles([[0, 0], [30, 0], [30, 50], [28, 50], [28, 2], [0, 2]], 96)), 'pot.stl'), bottom = loopAt(pot, 30, 0)
    expect(roundEdges(pot.positions, pot.indices, [{ edges: bottom, radius: 6 / pot.scale }]).skipped).toEqual([])
    const deep = roundEdges(pot.positions, pot.indices, [{ edges: bottom, radius: 8 / pot.scale }])
    expect(deep.skipped).toEqual([{ loop: 0, problem: 'cuts through' }])
    expect(Array.from(deep.positions)).toEqual(Array.from(pot.positions))
    // A block through the pot's wall 20 mm up, a body exported with it, crosses faces the round reaches (each runs the
    // wall's height): that crossing was there already, so the round is still made.
    const block = boxTriangles(4, 4, 5, 27).map(t => t.map(([x, y, z]) => [x, y - 2, z + 20]))
    const crossed = readGrowthStl(stl([...latheTriangles([[0, 0], [30, 0], [30, 50], [28, 50], [28, 2], [0, 2]], 96), ...block]), 'crossed.stl')
    expect(roundEdges(crossed.positions, crossed.indices, [{ edges: loopAt(crossed, 30, 0), radius: 6 / crossed.scale }]).skipped).toEqual([])
    // A lens 20 mm across and 1.6 mm thick: its rim's faces meet at 9°.
    const lens = lathe([[0, 0], [10, 0.8], [0, 1.6]])
    const knife = roundEdges(lens.positions, lens.indices, [{ edges: loopAt(lens, 10, 0.8), radius: 0.5 / lens.scale }])
    expect(knife.skipped).toEqual([{ loop: 0, problem: 'too sharp' }])
    expect(Array.from(knife.positions)).toEqual(Array.from(lens.positions))
  })
})
