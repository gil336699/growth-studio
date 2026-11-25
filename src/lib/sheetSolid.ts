// The print solid of an open sheet, such as a grown vase: the sheet smoothed (lib/smoothSheet), the loops chosen in the
// Edges tool rounded in mm (lib/roundEdges), and a wall of even thickness on one or both sides (lib/thicken).
// A round is made on the sheet, so the wall's two faces get it larger by the wall on the round's outer side and smaller
// by the wall on its inner side. A round that would leave the inner face less than a tenth of itself is left sharp
// ('under the wall'), and so is one along which the wall would cross itself more than it does without the round, as
// where it comes close to another part of the sheet ('folds the wall').
import { roundEdges, type Round, type RoundedMesh, type Skipped } from './roundEdges'
import { smoothSheet } from './smoothSheet'
import { thicken, zoneCrossings, type Solid } from './thicken'

// The sheet ready for its wall: smoothed, with each loop to round as the edges it became. Smoothing takes the longest,
// so a print whose size depends on its wall, as the default disk's does, smooths once and tries walls.
export type PrintSheet = {
  positions: Float32Array
  indices: Uint32Array
  // The grown sheet's vertices each vertex came from, once smoothed (lib/smoothSheet).
  origin?: Uint32Array
  origin2?: Uint32Array
  smooth: boolean
  rounds: Round[]
}
export type SheetSolid = Solid & { skipped: Skipped }

// passes: Loop subdivision passes (0 leaves the sheet as it grew). keep: edges kept fully sharp whatever the bevel.
// rounds: loops to round, as edges of the grown sheet, with radii in model units. A loop to round stays fully sharp while
// the sheet is smoothed, so the round starts from a crisp edge, and is followed through each pass to the edges it became.
export function printSheet(positions: ArrayLike<number>, indices: ArrayLike<number>,
  options: { passes: number; creases?: ArrayLike<number>; bevel?: number; keep?: ArrayLike<number>; rounds?: Round[] }): PrintSheet {
  const rounds = options.rounds ?? [], passes = Math.max(0, Math.round(options.passes))
  if (!passes) return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), smooth: false, rounds }
  const keep = [...Array.from(options.keep ?? []), ...rounds.flatMap(round => Array.from(round.edges))]
  const sheet = smoothSheet(positions, indices, passes, { creases: options.creases, bevel: options.bevel, keep, track: rounds.map(round => round.edges) })
  return { positions: sheet.positions, indices: sheet.indices, origin: sheet.origin, origin2: sheet.origin2, smooth: true,
    rounds: rounds.map((round, k) => ({ edges: sheet.tracked[k], radius: round.radius })) }
}

// The print solid with a wall `wall` model units thick, its rims shaped by roundness and the wall moved by shift, as
// lib/thicken takes them. tolerance: how far the rounds' facets may stray from a true circle, in model units.
// sharpAngle: an edge within a round's reach that bends more than this, in degrees, leaves the loop sharp.
// Skipped says which rounds were left sharp, by their place in sheet.rounds, and why.
export function sheetSolid(sheet: PrintSheet, options: { wall: number; roundness: number; shift: number; tolerance?: number; sharpAngle?: number }): SheetSolid {
  const { rounds } = sheet
  const wallOn = (positions: Float32Array, indices: Uint32Array, normals?: Float32Array) => thicken(positions, indices, options.wall, options.roundness, 4, options.shift, normals)
  // How far the wall reaches on the side the faces point to, and on the other side, as lib/thicken puts it.
  const half = options.wall / 2, middle = half * Math.min(1, Math.max(-1, options.shift))
  const wall = { front: half + middle, back: half - middle }
  const skipped: Skipped = []
  let left = rounds.map((_, k) => k), plain: Solid | null = null
  for (;;) {
    const rounded = left.length ? roundEdges(sheet.positions, sheet.indices, left.map(k => rounds[k]),
      { tolerance: options.tolerance, origin: sheet.origin, origin2: sheet.origin2, sharpAngle: options.sharpAngle, wall }) : null
    // The wall follows each round's own normals, so its faces there are rounds too, larger and smaller.
    const made = rounded ? wallOn(rounded.positions, rounded.indices, rounded.normals) : plain ?? wallOn(sheet.positions, sheet.indices)
    const groups = rounded ? roundGroups(rounded) : null
    if (rounded && groups) {
      const folded = foldedRounds(made, rounded, groups, left.map(k => rounds[k].radius), () => plain ??= wallOn(sheet.positions, sheet.indices), sheet.origin)
      if (folded.length) {
        for (const k of folded) skipped.push({ loop: left[k], problem: 'folds the wall' })
        left = left.filter((_, k) => !folded.includes(k))
        continue
      }
      for (const { loop, problem } of rounded.skipped) skipped.push({ loop: left[loop], problem })
    }
    // Point every solid vertex back to the grown sheet's vertices, so overlay colors carry over, and draw a smoothed
    // sheet smooth: it has no facets to keep.
    const from = rounded ? rounded.origin : sheet.origin, also = rounded ? rounded.origin2 : sheet.origin2
    if (groups) made.groups = Uint32Array.from(made.origin, v => groups[v])
    if (from && also) {
      made.blend = Uint32Array.from(made.origin, v => also[v])
      made.origin = Uint32Array.from(made.origin, v => from[v])
    }
    made.smooth = sheet.smooth
    skipped.sort((a, b) => a.loop - b.loop)
    return { ...made, skipped }
  }
}

// The rounds, by their place in rounded's list, along which the wall crosses itself more than it does without them: in
// more places, or along longer lines where the wall's faces over each round cross other faces, as roundEdges measures a
// round cutting through, so a wall that crossed itself there already isn't blamed on the round. A face of the sheet that
// runs on past the round, as a CAD face does, tilts a little in the wall when the round moves its corners, and so can a
// crossing on it, by a hundredth of its length at most. lib/thicken makes faces 2f and 2f + 1 over the sheet's face f.
// Faces of the wall whose corners count as one point aren't counted, as the solid's own check doesn't count them
// (lib/thicken): where a sheet crumples at a point, the wall overlaps within itself there, and smoothing spreads that
// point over several. Counted the same way (groups, roundGroups), a round is left sharp exactly when it adds to what that
// check shows. without: the wall without any round, made only if it's needed; grown: the grown sheet's point each point
// of the sheet came from, once smoothed.
function foldedRounds(made: Solid, rounded: RoundedMesh, groups: Uint32Array, radii: number[], without: () => Solid, grown?: ArrayLike<number>) {
  const roundOf = new Int32Array(rounded.positions.length / 3).fill(-1)
  rounded.zones.forEach((zone, k) => { for (const v of zone) roundOf[v] = k })
  // Each round's faces of the rounded sheet, and the faces of the sheet as given they were cut from.
  const mine = new Map<number, number>(), was = new Map<number, number>()
  for (let f = 0; f < rounded.indices.length / 3; f++) {
    let k = -1
    for (let c = 0; c < 3 && k < 0; c++) k = roundOf[rounded.indices[f * 3 + c]]
    if (k >= 0) { mine.set(f, k); was.set(rounded.faceOrigin[f], k) }
  }
  // What each point of a wall counts as: through the rounded sheet's points, or the sheet's.
  const crossing = (solid: Solid, faces: Map<number, number>, from: ArrayLike<number> | undefined) => {
    const wallFaces: number[] = [], roundOfFace = new Map<number, number>()
    for (const [f, k] of faces) for (const g of [2 * f, 2 * f + 1]) { wallFaces.push(g); roundOfFace.set(g, k) }
    const { indices } = solid, origin = from ? Uint32Array.from(solid.origin, v => from[v]) : solid.origin
    const shared = (f: number, g: number) => {
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (origin[indices[f * 3 + a]] === origin[indices[g * 3 + b]]) return true
      return false
    }
    const length = new Float64Array(radii.length), places = new Uint32Array(radii.length)
    for (const [f, , l] of zoneCrossings(solid.positions, indices, wallFaces, shared)) { const k = roundOfFace.get(f)!; length[k] += l; places[k]++ }
    return { length, places }
  }
  const after = crossing(made, mine, groups)
  if (after.places.every(p => p === 0)) return []
  const before = crossing(without(), was, grown)
  return radii.map((_, k) => k).filter(k => after.places[k] > before.places[k] || after.length[k] > 1.01 * before.length[k] + 0.01 * radii[k])
}

// What each point of the rounded sheet counts as for the crossing check: the grown sheet's point it came from, or, for
// a round's points, itself. A round's points take the grown point at the far end of the edge they were cut on, so whole
// strips of a round share one, and a fold inside the round would go unseen.
export function roundGroups(rounded: RoundedMesh) {
  const count = rounded.positions.length / 3, own = new Uint8Array(count)
  for (const zone of rounded.zones) for (const v of zone) own[v] = 1
  return Uint32Array.from(rounded.origin, (v, i) => own[i] ? count + i : v)
}
