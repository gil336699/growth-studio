// The print solid of a closed shape, such as a brain, made without voxels: the grown surface itself, which is already
// closed and never passes through itself while it grows. Smooth rounds it with Loop subdivision (lib/smoothSheet), with
// the starting shape's sharp edges kept unless bevel rounds them, and a flat base cuts its bottom flat (lib/cutFlat).
// Nothing is rebuilt, so thin walls and designed edges stay as they are.
import { cutFlat } from './cutFlat'
import { smoothSheet } from './smoothSheet'
import type { Solid } from './thicken'

export type ClosedSolid = Solid & { capArea: number }

// passes: Loop subdivision passes (0 leaves the surface as it grew). cut: how far above the lowest point, in model units,
// the bottom is cut flat (0 for none).
export function closedSolid(positions: ArrayLike<number>, indices: ArrayLike<number>,
  options: { passes: number; creases?: ArrayLike<number>; bevel?: number; cut?: number }): ClosedSolid {
  const passes = Math.max(0, Math.round(options.passes))
  const sheet = passes ? smoothSheet(positions, indices, passes, { creases: options.creases, bevel: options.bevel }) : null
  let P: Float32Array = sheet ? sheet.positions : Float32Array.from(positions)
  let I: Uint32Array = sheet ? sheet.indices : Uint32Array.from(indices)
  let origin: Uint32Array = sheet ? sheet.origin : Uint32Array.from({ length: P.length / 3 }, (_, v) => v)
  let blend: Uint32Array | undefined = sheet ? sheet.origin2 : undefined
  let capArea = 0
  if (options.cut && options.cut > 0) {
    let low = Infinity
    for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i])
    const cut = cutFlat(P, I, low + options.cut, origin, blend ?? origin)
    P = cut.positions; I = cut.indices; origin = cut.origin; blend = sheet ? cut.origin2 : undefined; capArea = cut.capArea
  }
  return { positions: P, indices: I, origin, blend, rimEdges: 0, smooth: true, capArea }
}
