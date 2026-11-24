// An uploaded STL as a starting surface, used as it is: nothing is rebuilt, so thin walls and designed edges stay.
// An open surface grows from its rims. A closed one grows over its whole surface and prints as it grew, so it must be
// one clean solid: every edge shared by two faces, all of them facing outward. CAD exports sometimes turn a few faces
// the wrong way, and those are turned back.
import { readGrowthStl, type GrowthStlSource } from '../physics/growthStl'
import { edgeUse, orientClosed, splitTouching } from './meshCheck'

// A closed STL that can't be made of clean solids, such as bodies exported together whose shared edges close into a loop.
export class BrokenShapeError extends Error {}

// An open surface whose open edges add up to at most this share of its bounding sphere's circumference is almost closed:
// likely a CAD export with a hairline gap rather than a real opening, such as a vase's. Measured by length, so it doesn't
// depend on how finely the STL is meshed.
export const NEARLY_CLOSED = 0.1

export function readUpload(buffer: ArrayBuffer, name: string): { source: GrowthStlSource; closed: boolean; nearlyClosed: boolean; touching: number } {
  const source = readGrowthStl(buffer, name)
  const { faces, open, crowded } = edgeUse(source.indices, source.positions.length / 3)
  if (open) {
    const P = source.positions, n = P.length / 3
    let gaps = 0
    for (const [key, list] of faces) {
      if (list.length !== 1) continue
      const a = Math.floor(key / n) * 3, b = (key % n) * 3
      gaps += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])
    }
    // The STL is scaled to radius 1, so its bounding sphere's circumference is 2π.
    return { source, closed: false, nearlyClosed: gaps <= NEARLY_CLOSED * 2 * Math.PI, touching: 0 }
  }
  // Bodies exported together that touch along an edge open as separate closed bodies.
  let mesh = source
  if (crowded) {
    const split = splitTouching(source.positions, source.indices)
    if (!split) {
      throw new BrokenShapeError(`It is closed, but ${crowded.toLocaleString()} ${crowded === 1 ? 'edge is' : 'edges are'} shared by more than two faces, where bodies meet along a closed loop of edges. Combine the bodies in your CAD tool (Fusion: Modify › Combine) and export it again.`)
    }
    mesh = { ...source, positions: split.positions, indices: split.indices }
  }
  const turned = orientClosed(mesh.positions, mesh.indices)
  if (!turned) throw new BrokenShapeError('It is closed, but its faces can’t all face outward, as on a one-sided surface. Export it again from your CAD tool.')
  return { source: { ...mesh, indices: turned }, closed: true, nearlyClosed: false, touching: crowded }
}
