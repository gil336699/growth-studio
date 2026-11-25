// The Edges tool's choices: loops of the starting shape's borders (lib/borders), each kept sharp on the print or
// rounded there with a radius in mm (lib/roundEdges). Only parts that haven't grown take them: where the surface grew,
// a designed edge has folded with it.
import { edgesOnLoop, traceLoop, loopPoints, type Borders, type LoopPoints } from './borders'
import { INNER_SHARE, type Round, type RoundProblem, type Skipped } from './roundEdges'
import { GROWN_LIMIT } from './smoothSheet'

export type EdgeAction = 'sharp' | 'round'
// A loop as points of the starting shape, x, y, z one after another, so it stays valid while growth splits its edges,
// and what the print does with it.
export type EdgeChoice = { id: string; points: number[]; closed: boolean; action: EdgeAction; radius: number }
// Rounds in mm. A round smaller than about half the line width prints like a sharp edge (0.2 mm with a 0.4 mm nozzle,
// 0.4 mm with a 0.8 mm one), so every radius here shows on the print.
export const ROUND_RANGE: [number, number] = [0.5, 10]
export const ROUND_DEFAULT = 2
// The smallest round, in mm to a tenth, that the wall on its inner side, in mm, leaves room for on a sheet.
export const smallestRound = (inner: number) => Math.ceil(inner / (1 - INNER_SHARE) * 10 - 1e-6) / 10
// What became of a choice on the print: kept sharp, rounded, or left as it is because its edges grew, it isn't on the
// mesh any more, or the round couldn't be made there (lib/roundEdges says why).
export type EdgeStatus = 'kept' | 'rounded' | 'grown' | 'missing' | RoundProblem

// The border edge nearest a point of the surface as it is now (now), if one is within reach, and its loop, traced along
// the starting shape's borders (rest): as edges of the mesh, and as points of the starting shape.
export function pickLoop(borders: Borders, rest: ArrayLike<number>, now: ArrayLike<number>, point: ArrayLike<number>, reach: number): (LoopPoints & { edges: Uint32Array }) | null {
  let best = -1, bestList: Uint32Array | null = null, bestDistance = reach
  for (const list of [borders.sharp, borders.smooth]) for (let i = 0; i < list.length; i += 2) {
    const a = list[i] * 3, b = list[i + 1] * 3
    const dx = now[b] - now[a], dy = now[b + 1] - now[a + 1], dz = now[b + 2] - now[a + 2], d2 = dx * dx + dy * dy + dz * dz
    const t = Math.max(0, Math.min(1, ((point[0] - now[a]) * dx + (point[1] - now[a + 1]) * dy + (point[2] - now[a + 2]) * dz) / (d2 || 1)))
    const d = Math.hypot(point[0] - now[a] - t * dx, point[1] - now[a + 1] - t * dy, point[2] - now[a + 2] - t * dz)
    if (d < bestDistance) { bestDistance = d; best = i; bestList = list }
  }
  if (!bestList) return null
  const edges = traceLoop(borders, rest, bestList[best], bestList[best + 1])
  return { ...loopPoints(edges, rest), edges }
}

// Whether two loops are the same one: the same points, from any start and either way round.
export function sameLoop(a: { points: ArrayLike<number> }, b: { points: ArrayLike<number> }, tolerance = 1e-6) {
  if (a.points.length !== b.points.length) return false
  const n = a.points.length / 3, near = (i: number, j: number) => Math.hypot(a.points[i * 3] - b.points[j * 3], a.points[i * 3 + 1] - b.points[j * 3 + 1], a.points[i * 3 + 2] - b.points[j * 3 + 2]) <= tolerance
  for (let i = 0; i < n; i++) if (![...Array(n).keys()].some(j => near(i, j))) return false
  return true
}

// The edges of the mesh as it is now that lie on a choice's loop.
export function choiceEdges(choice: EdgeChoice, rest: ArrayLike<number>, indices: ArrayLike<number>) {
  return edgesOnLoop({ points: Float32Array.from(choice.points), closed: choice.closed }, rest, indices)
}

// What the print does with the choices, for the mesh as it is now: edges to keep fully sharp while smoothing, loops to
// round with their radii in model units (and which choice each is), and each choice's status so far.
export function printEdges(choices: EdgeChoice[], rest: ArrayLike<number>, indices: ArrayLike<number>, growth: ArrayLike<number>, mmPerUnit: number) {
  const keep: number[] = [], rounds: Round[] = [], roundIds: string[] = [], status = new Map<string, EdgeStatus>()
  for (const choice of choices) {
    const edges = choiceEdges(choice, rest, indices)
    if (!edges.length) { status.set(choice.id, 'missing'); continue }
    // A designed edge that grew has folded with the surface; keeping it sharp there makes smoothing fold over it.
    if (Array.from(edges).some(v => (growth[v] ?? 0) > GROWN_LIMIT)) { status.set(choice.id, 'grown'); continue }
    if (choice.action === 'sharp') { keep.push(...edges); status.set(choice.id, 'kept'); continue }
    rounds.push({ edges, radius: choice.radius / mmPerUnit }); roundIds.push(choice.id); status.set(choice.id, 'rounded')
  }
  return { keep, rounds, roundIds, status }
}

// Each choice's status once the print is made: a round that couldn't be made says why.
export function finalStatus(status: Map<string, EdgeStatus>, roundIds: string[], skipped: Skipped) {
  const out = new Map(status)
  for (const { loop, problem } of skipped) out.set(roundIds[loop], problem)
  return out
}

const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
export const validChoice = (value: unknown): value is EdgeChoice => {
  const c = value as EdgeChoice
  return typeof c === 'object' && c !== null && typeof c.id === 'string' && Array.isArray(c.points) && c.points.length >= 6
    && c.points.length % 3 === 0 && c.points.every(x => finite(x, -1e6, 1e6)) && typeof c.closed === 'boolean'
    && (c.action === 'sharp' || c.action === 'round') && finite(c.radius, ROUND_RANGE[0], ROUND_RANGE[1])
}
