// The print solid of a closed shape, such as a brain, made without voxels: the grown surface itself, which is already
// closed and never passes through itself while it grows. Smooth rounds it with Loop subdivision (lib/smoothSheet), with
// the starting shape's sharp edges kept unless bevel rounds them, loops chosen in the Edges tool are rounded in mm
// (lib/roundEdges), and a flat base cuts its bottom flat (lib/cutFlat). Nothing is rebuilt, so thin walls and designed
// edges stay as they are.
import { cutFlat } from './cutFlat'
import { roundEdges, type Round, type Skipped } from './roundEdges'
import { smoothSheet } from './smoothSheet'
import type { Solid } from './thicken'

export type ClosedSolid = Solid & { capArea: number; skipped: Skipped }

// passes: Loop subdivision passes (0 leaves the surface as it grew). keep: edges kept fully sharp whatever the bevel.
// rounds: loops to round, as edges of the grown surface, with radii in model units; tolerance: how far the rounds'
// facets may stray from a true circle, in model units; sharpAngle: an edge within a round's reach that bends more than
// this, in degrees, leaves the loop sharp; minWall: the thinnest wall a round may leave, in model units, unless the
// shape's own walls beside it are thinner. cut: how far above the lowest point, in model units, the bottom is cut flat
// (0 for none).
export function closedSolid(positions: ArrayLike<number>, indices: ArrayLike<number>, options: { passes: number; creases?: ArrayLike<number>;
  bevel?: number; keep?: ArrayLike<number>; rounds?: Round[]; tolerance?: number; sharpAngle?: number; minWall?: number; cut?: number }): ClosedSolid {
  const passes = Math.max(0, Math.round(options.passes)), rounds = options.rounds ?? []
  // A loop to round stays fully sharp while the surface is smoothed, so the round starts from a crisp edge, and is
  // followed through each pass to the edges it became.
  const keep = [...Array.from(options.keep ?? []), ...rounds.flatMap(round => Array.from(round.edges))]
  const sheet = passes ? smoothSheet(positions, indices, passes, { creases: options.creases, bevel: options.bevel, keep, track: rounds.map(round => round.edges) }) : null
  let P: Float32Array = sheet ? sheet.positions : Float32Array.from(positions)
  let I: Uint32Array = sheet ? sheet.indices : Uint32Array.from(indices)
  let origin: Uint32Array = sheet ? sheet.origin : Uint32Array.from({ length: P.length / 3 }, (_, v) => v)
  let blend: Uint32Array | undefined = sheet ? sheet.origin2 : undefined
  let skipped: Skipped = [], zones: number[][] = []
  if (rounds.length) {
    const edges = sheet ? sheet.tracked : rounds.map(round => round.edges)
    const rounded = roundEdges(P, I, rounds.map((round, k) => ({ edges: edges[k], radius: round.radius })),
      { tolerance: options.tolerance, sharpAngle: options.sharpAngle, minWall: options.minWall, origin, origin2: blend ?? origin })
    P = rounded.positions; I = rounded.indices; origin = rounded.origin; blend = blend ? rounded.origin2 : undefined; skipped = rounded.skipped; zones = rounded.zones
  }
  let capArea = 0
  if (options.cut && options.cut > 0) {
    let low = Infinity
    for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i])
    // A round that lies wholly below the cut is cut away with it.
    zones.forEach((zone, k) => {
      if (!zone.length) return
      let high = -Infinity
      for (const v of zone) high = Math.max(high, P[v * 3 + 1])
      if (high < low + options.cut!) skipped.push({ loop: k, problem: 'cut away' })
    })
    const cut = cutFlat(P, I, low + options.cut, origin, blend ?? origin)
    P = cut.positions; I = cut.indices; origin = cut.origin; blend = blend ? cut.origin2 : undefined; capArea = cut.capArea
  }
  return { positions: P, indices: I, origin, blend, rimEdges: 0, smooth: true, capArea, skipped }
}
