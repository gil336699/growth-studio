// Rounds in mm for the print: a sharp edge that loops all the way round, such as the edge around a flat bottom, becomes a
// true round of the chosen radius, the surface a ball of that radius leaves when it rolls along the loop touching the
// faces on both sides (a rolling-ball fillet, as CAD tools make). Only closed loops are rounded, so no round has an end to
// blend into a corner. A loop that can't take the round is left sharp, and the result says why.
//   1. At each point of the loop, the faces on its two sides leave it in two directions at right angles to the loop,
//      averaged over the two loop edges that meet there. Where those directions meet at an angle α, the round's circle
//      touches each side t = r / tan(α/2) from the loop. The same holds for an edge that turns in, where the round adds
//      material, and on an open sheet.
//   2. The faces within t of the loop are cut along rows at even shares of t, as cutFlat cuts at a floor, so the round
//      has points all along it, however long and thin the faces there are (CAD meshes have long thin triangles).
//   3. Every point closer than t moves onto the circle: a point at a share s of t from the loop goes to the arc point
//      that share of the way from the arc's middle to where the circle touches its side. The move is worked out at the
//      loop's points and blended along each loop edge, so it changes smoothly along the loop, and a point t or more away
//      stays exactly where it was.
import { SHARP_ANGLE } from './smoothSheet'
import { rayDepths, zoneCrossings } from './thicken'

// A loop to round: its edges, as pairs of vertex indices [a, b, a, b, …], and the round's radius in model units.
export type Round = { edges: ArrayLike<number>; radius: number }
// Why a loop was left sharp. 'not a loop': its edges don't make one closed loop with a face on each side. 'meets an
// edge': another sharp edge meets the loop, as at a box's corner or where a fold of the grown surface reaches it; no
// round can blend into it. 'no room': the round would reach another sharp edge, an open rim or another round, or meet
// itself across a narrow face; a smaller radius may fit. 'too sharp': its faces meet at less than 10°, too sharp for any
// round. 'turns over': moving the points would turn faces over. 'cuts through': the round would pass through another
// part of the surface, as through a thin wall to the inside of a pot. 'under the wall': on a sheet, the round is smaller
// than the wall on its inner side, so the wall's inner face would fold. 'folds the wall': on a sheet, the wall would
// cross itself along the round, as where it comes close to another part of the sheet (lib/sheetSolid). 'thins the
// wall': on a closed shape, the round would leave a wall thinner than the thinnest allowed (minWall), or than the
// shape's own walls beside it if they're thinner. 'cut away': the print's flat base cuts it off (lib/closedSolid).
export type RoundProblem = 'not a loop' | 'meets an edge' | 'no room' | 'too sharp' | 'turns over' | 'cuts through' | 'under the wall' | 'folds the wall'
  | 'thins the wall' | 'cut away'
// The loops left sharp, by their place in the list of rounds, and why. For 'thins the wall', the wall the round would
// leave and the thinnest allowed there, in model units.
export type Skipped = { loop: number; problem: RoundProblem; left?: number; need?: number }[]
export type RoundedMesh = {
  positions: Float32Array
  indices: Uint32Array
  // Each point's source points, carried through as cutFlat does: a point made on an edge takes the end farther from the loop.
  origin: Uint32Array
  origin2: Uint32Array
  skipped: Skipped
  // For each loop, the points of its round: those it moved and those it made. Empty for a loop left sharp.
  zones: number[][]
  // For each face, the face of the mesh as given that it is, or was cut from.
  faceOrigin: Uint32Array
  // For each point of a round and its edge, the round's own normal there, facing the way the faces do; zero for other
  // points. A wall built on the round follows it (lib/sheetSolid): the faces' average there can be skewed by thin faces.
  normals: Float32Array
}
export type RoundOptions = {
  // How far the round's facets may stray from the true circle, in model units; a 400th of the radius unless given.
  tolerance?: number
  origin?: ArrayLike<number>
  origin2?: ArrayLike<number>
  // An edge within reach of the round that bends more than this, in degrees, leaves the loop sharp.
  sharpAngle?: number
  // On a sheet that gets a wall: how far the wall reaches on the side its faces point to (front) and on the other side
  // (back), in model units. A round has to be larger than the wall on its inner side, or that face folds.
  wall?: { front: number; back: number }
  // On a closed shape, whose faces face out: the thinnest wall a round may leave, in model units, unless the shape's own
  // walls beside it are thinner already.
  minWall?: number
}

// Where the faces meet at less than this, a knife edge, the round would reach too far along them.
const MIN_ANGLE = 10 * Math.PI / 180
// On a sheet, the share of a round's radius the wall's face on its inner side must keep: a round smaller than
// wall / (1 - INNER_SHARE) is under the wall there.
export const INNER_SHARE = 0.1
// The most rows on each side of the loop.
const MAX_ROWS = 24
// How much of a loop edge's length the line where the circle touches a side may lose where the loop turns toward it.
const FOLD = 0.85
// Faces whose normals are this close (cos 0.5°) lie in one plane.
const FLAT = Math.cos(0.5 * Math.PI / 180)
// Room for vertex numbers in an edge's key.
const KEY = 2 ** 26

type Mesh = { P: number[]; I: number[]; O: number[]; O2: number[]; FO: number[]; N: number[] }
type V = [number, number, number]

export function roundEdges(positions: ArrayLike<number>, indices: ArrayLike<number>, rounds: Round[], options: RoundOptions = {}): RoundedMesh {
  const n = positions.length / 3
  const own = options.origin ? Array.from(options.origin) : Array.from({ length: n }, (_, v) => v)
  const mesh: Mesh = { P: Array.from(positions), I: Array.from(indices), O: own, O2: options.origin2 ? Array.from(options.origin2) : own.slice(),
    FO: Array.from({ length: indices.length / 3 }, (_, f) => f), N: new Array<number>(positions.length).fill(0) }
  const sharpCos = Math.cos((options.sharpAngle ?? SHARP_ANGLE) * Math.PI / 180)
  const skipped: Skipped = [], moved = new Set<number>()
  // Loops are checked on the mesh as given, so a loop that a round before it cut through says 'no room', not 'not a loop'.
  const faces = faceLists(mesh.I, n)
  const valid = rounds.map(round => loopSides(round.edges, mesh.I, n, faces) !== null)
  const zones: number[][] = rounds.map(() => [])
  rounds.forEach((round, loop) => {
    if (!valid[loop]) { skipped.push({ loop, problem: 'not a loop' }); return }
    if (!(round.radius > 0)) return
    const made = roundLoop(mesh, round.edges, round.radius, options.tolerance ?? round.radius / 400, sharpCos, moved, options.wall, options.minWall)
    if (typeof made === 'string') skipped.push({ loop, problem: made })
    else if (!Array.isArray(made)) skipped.push({ loop, ...made })
    else zones[loop] = made
  })
  return { positions: Float32Array.from(mesh.P), indices: Uint32Array.from(mesh.I), origin: Uint32Array.from(mesh.O), origin2: Uint32Array.from(mesh.O2),
    skipped, zones, faceOrigin: Uint32Array.from(mesh.FO), normals: Float32Array.from(mesh.N) }
}

// The faces around each point, as one list cut into runs.
function faceLists(I: ArrayLike<number>, n: number) {
  const start = new Uint32Array(n + 1), list = new Uint32Array(I.length)
  for (let i = 0; i < I.length; i++) start[I[i] + 1]++
  for (let v = 0; v < n; v++) start[v + 1] += start[v]
  const fill = start.slice(0, n)
  for (let i = 0; i < I.length; i++) list[fill[I[i]]++] = (i / 3) | 0
  // The faces that use edge a–b.
  const on = (a: number, b: number) => {
    const out: number[] = []
    for (let j = start[a]; j < start[a + 1]; j++) { const f = list[j]; if (I[f * 3] === b || I[f * 3 + 1] === b || I[f * 3 + 2] === b) out.push(f) }
    return out
  }
  return { start, list, on }
}

// The loop's points in order, and for each loop edge, from point i to point i + 1, the face on its left (the face that
// runs it that way) and the face on its right. Null unless the edges make one closed loop with one face on each side.
function loopSides(edges: ArrayLike<number>, I: ArrayLike<number>, n: number, faces: ReturnType<typeof faceLists>) {
  const next = new Map<number, number[]>(), seen = new Set<number>()
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1]
    if (a === b || !(a < n) || !(b < n)) return null
    const key = a < b ? a * n + b : b * n + a
    if (seen.has(key)) continue
    seen.add(key)
    for (const [p, q] of [[a, b], [b, a]]) { let list = next.get(p); if (!list) next.set(p, list = []); list.push(q) }
  }
  if (seen.size < 3) return null
  for (const list of next.values()) if (list.length !== 2) return null
  const first = edges[0], loop = [first]
  let prev = first, v = next.get(first)![0]
  while (v !== first) {
    if (loop.length >= seen.size) return null
    loop.push(v)
    const [p, q] = next.get(v)!, w = p === prev ? q : p
    prev = v; v = w
  }
  if (loop.length !== seen.size) return null
  const runs = (f: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (I[f * 3 + k] === a && I[f * 3 + (k + 1) % 3] === b) return true
    return false
  }
  const left = new Int32Array(loop.length), right = new Int32Array(loop.length)
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], on = faces.on(a, b)
    if (on.length !== 2 || runs(on[0], a, b) === runs(on[1], a, b)) return null
    left[i] = runs(on[0], a, b) ? on[0] : on[1]; right[i] = runs(on[0], a, b) ? on[1] : on[0]
  }
  return { loop, left, right }
}

// A loop point's frame: the directions into the faces on each side, the circle's center from the point, and the
// directions from the center to where it touches each side (unit vectors); t is how far from the loop it touches them.
type Frame = { u: [V, V]; t: number; phi: number; c: V; d: [V, V] }

// Rounds one loop in place, and returns the points of its round, or why it couldn't.
function roundLoop(mesh: Mesh, edges: ArrayLike<number>, r: number, tolerance: number, sharpCos: number, moved: Set<number>,
  wall?: { front: number; back: number }, minWall?: number): RoundProblem | { problem: 'thins the wall'; left: number; need: number } | number[] {
  const { P, I } = mesh, n = P.length / 3, F = I.length / 3
  const faces = faceLists(I, n), sides = loopSides(edges, I, n, faces)
  // The loop was checked on the mesh as given: here it fails only where a round before it cut through it.
  if (!sides) return 'no room'
  const { loop, left, right } = sides, N = loop.length
  for (const v of loop) if (moved.has(v)) return 'no room'
  const LP = new Float64Array(N * 3)
  loop.forEach((v, i) => { LP[i * 3] = P[v * 3]; LP[i * 3 + 1] = P[v * 3 + 1]; LP[i * 3 + 2] = P[v * 3 + 2] })

  // 1. Each loop edge's direction and length, and the directions from it into the faces on its two sides.
  const E: V[] = [], U: [V, V][] = [], L: number[] = []
  const third = (f: number, a: number, b: number) => { for (let k = 0; k < 3; k++) { const v = I[f * 3 + k]; if (v !== a && v !== b) return v } return a }
  let longest = 0
  for (let i = 0; i < N; i++) {
    const a = loop[i], b = loop[(i + 1) % N], e = sub(at(P, b), at(P, a)), length = norm(e)
    if (!(length > 0)) return 'not a loop'
    longest = Math.max(longest, length)
    const unitE = scale(e, 1 / length), into = (f: number): V | null => {
      const w = sub(at(P, third(f, a, b)), at(P, a)), across = sub(w, scale(unitE, dot(w, unitE))), l = norm(across)
      return l > 1e-9 * length ? scale(across, 1 / l) : null
    }
    const uL = into(left[i]), uR = into(right[i])
    if (!uL || !uR) return 'not a loop'
    E.push(unitE); U.push([uL, uR]); L.push(length)
  }
  // Each loop point's frame, from the two loop edges that meet there, and how much the loop turns toward each side there,
  // as the tangent of half the turn.
  const frames: Frame[] = [], turn: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const j = (i + N - 1) % N, sum = add(E[j], E[i])
    if (norm(sum) < 1e-6) return 'not a loop'
    const e = scale(sum, 1 / norm(sum))
    const flat = (k: 0 | 1): V | null => { const s = add(U[j][k], U[i][k]), across = sub(s, scale(e, dot(s, e))), l = norm(across); return l > 1e-9 ? scale(across, 1 / l) : null }
    const uL = flat(0), uR = flat(1)
    if (!uL || !uR) return 'not a loop'
    const bend = sub(E[i], E[j]), half = dot(e, E[i])
    turn.push([Math.max(0, dot(bend, uL) / 2 / half), Math.max(0, dot(bend, uR) / 2 / half)])
    const alpha = Math.acos(Math.max(-1, Math.min(1, dot(uL, uR)))), phi = Math.PI - alpha
    if (alpha < MIN_ANGLE) return 'too sharp'
    if (phi < 1e-6) { frames.push({ u: [uL, uR], t: 0, phi: 0, c: [0, 0, 0], d: [[0, 0, 0], [0, 0, 0]] }); continue }
    const t = r / Math.tan(alpha / 2), c = scale(add(uL, uR), r / Math.sin(alpha))
    frames.push({ u: [uL, uR], t, phi, c, d: [scale(sub(scale(uL, t), c), 1 / r), scale(sub(scale(uR, t), c), 1 / r)] })
  }
  const tAt = frames.map(f => f.t), tMax = Math.max(...tAt)
  if (!(tMax > 0)) return []
  // Where the loop turns toward a side, the line where the circle touches that side is shorter than the loop, by t times
  // the tangent of half the turn at each end of a loop edge. If an edge's share runs out, that line folds over itself: the
  // curve there is tighter than the round, as at the tip of a narrow oval. Each edge keeps at least 15% of its length,
  // so on a smooth curve t is at most 0.85 of the curve's radius: a round that nearly folds leaves faces too small and
  // thin to move cleanly, and hardly any of the face.
  for (let i = 0; i < N; i++) for (const k of [0, 1]) if (tAt[i] * turn[i][k] + tAt[(i + 1) % N] * turn[(i + 1) % N][k] >= FOLD * L[i]) return 'no room'

  // Loop edges in a grid of cells, each listed in every cell within tMax of it, to find a point's nearest loop point.
  const cell = Math.max(2 * tMax, longest / 2), grid = new Map<number, number[]>()
  const hash = (x: number, y: number, z: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791)
  for (let i = 0; i < N; i++) {
    const a = i * 3, b = ((i + 1) % N) * 3, lo = [0, 1, 2].map(k => Math.floor((Math.min(LP[a + k], LP[b + k]) - tMax) / cell))
    const hi = [0, 1, 2].map(k => Math.floor((Math.max(LP[a + k], LP[b + k]) + tMax) / cell))
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const key = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
      let list = grid.get(key)
      if (!list) grid.set(key, list = [])
      if (list[list.length - 1] !== i) list.push(i)
    }
  }
  // Each loop edge's step from its start to its end, and that step's length squared, worked out once: the nearest
  // loop point is looked for many times over.
  const SD = new Float64Array(N * 4)
  for (let i = 0; i < N; i++) {
    const a = i * 3, b = ((i + 1) % N) * 3, dx = LP[b] - LP[a], dy = LP[b + 1] - LP[a + 1], dz = LP[b + 2] - LP[a + 2]
    SD[i * 4] = dx; SD[i * 4 + 1] = dy; SD[i * 4 + 2] = dz; SD[i * 4 + 3] = dx * dx + dy * dy + dz * dz
  }
  // Where along loop edge i (0 to 1) the point nearest x is, and how far away squared, without making arrays.
  let hitU = 0
  const onEdge2 = (i: number, x: V) => {
    const a = i * 3, dx = SD[i * 4], dy = SD[i * 4 + 1], dz = SD[i * 4 + 2]
    const wx = x[0] - LP[a], wy = x[1] - LP[a + 1], wz = x[2] - LP[a + 2]
    let u = (wx * dx + wy * dy + wz * dz) / SD[i * 4 + 3]
    u = u < 0 ? 0 : u > 1 ? 1 : u
    const ex = wx - u * dx, ey = wy - u * dy, ez = wz - u * dz
    hitU = u
    return ex * ex + ey * ey + ez * ez
  }
  const footOn = (i: number, u: number): V => [LP[i * 3] + u * SD[i * 4], LP[i * 3 + 1] + u * SD[i * 4 + 1], LP[i * 3 + 2] + u * SD[i * 4 + 2]]
  const tOn = (i: number, u: number) => (1 - u) * tAt[i] + u * tAt[(i + 1) % N]
  // A point's nearest loop point, and how far it is as a share of t there: below 1 means the round moves it.
  // The grid lists every loop edge within tMax of x, so a point it finds none for, or none within tMax of, is beyond
  // the round's reach, and that's all that matters about it: its share counts as infinite.
  const tMax2 = tMax * tMax
  const nearest = (x: V) => {
    let bi = -1, bu = 0, bd2 = Infinity
    const ids = grid.get(hash(...x))
    if (ids) for (let k = 0; k < ids.length; k++) { const d2 = onEdge2(ids[k], x); if (d2 < bd2) { bd2 = d2; bi = ids[k]; bu = hitU } }
    if (!(bd2 <= tMax2)) return { i: -1, u: 0, d: Infinity, foot: x, s: Infinity }
    const d = Math.sqrt(bd2), t = tOn(bi, bu)
    return { i: bi, u: bu, d, foot: footOn(bi, bu), s: d === 0 ? 0 : t > 0 ? d / t : Infinity }
  }
  // Whether the round reaches a point from two loop points on opposite sides of it, more than 120° apart as seen from
  // the point, as across a narrow face. Loop points nearby along the loop reach a point beside it at about 90°.
  const meetsItself = (x: V, near: ReturnType<typeof nearest>) => {
    if (!(near.d > 0)) return false
    const fx = (x[0] - near.foot[0]) / near.d, fy = (x[1] - near.foot[1]) / near.d, fz = (x[2] - near.foot[2]) / near.d
    const ids = grid.get(hash(...x))
    if (ids) for (let k = 0; k < ids.length; k++) {
      const i = ids[k], d2 = onEdge2(i, x), u = hitU
      if (!(d2 > 0)) continue
      const d = Math.sqrt(d2), t = tOn(i, u)
      if (d >= t) continue
      const a = i * 3, gx = x[0] - LP[a] - u * SD[i * 4], gy = x[1] - LP[a + 1] - u * SD[i * 4 + 1], gz = x[2] - LP[a + 2] - u * SD[i * 4 + 2]
      if (gx * fx + gy * fy + gz * fz < -0.5 * d) return true
    }
    return false
  }
  const share = new Float64Array(n).fill(NaN), footEdge = new Int32Array(n), footAt = new Float64Array(n)
  const shareOf = (v: number) => {
    if (Number.isNaN(share[v])) { const q = nearest(at(P, v)); share[v] = q.s; footEdge[v] = q.i; footAt[v] = q.u }
    return share[v]
  }
  // The share at the middle of an edge of the mesh as given: an edge can cross the round's reach with both ends outside
  // it, or run across a narrow face from the loop back to the loop.
  const middles = new Map<number, number>()
  const midShare = (a: number, b: number) => {
    const key = a < b ? a * KEY + b : b * KEY + a
    let s = middles.get(key)
    if (s === undefined) { s = nearest(scale(add(at(P, a), at(P, b)), 0.5)).s; middles.set(key, s) }
    return s
  }
  const reaches = (a: number, b: number) => shareOf(a) < 1 || shareOf(b) < 1 || midShare(a, b) < 1

  // 2. The faces the round reaches, found from the loop's faces outward without crossing the loop, and their side: 1 on
  // the loop's left, 2 on its right.
  const side = new Int8Array(F), queue: number[] = []
  for (let i = 0; i < N; i++) for (const [f, s] of [[left[i], 1], [right[i], 2]]) {
    if (side[f] && side[f] !== s) return 'not a loop'
    if (!side[f]) { side[f] = s; queue.push(f) }
  }
  const loopEdge = new Set<number>()
  for (let i = 0; i < N; i++) { const a = loop[i], b = loop[(i + 1) % N]; loopEdge.add(a < b ? a * KEY + b : b * KEY + a) }
  const normalOf = (f: number) => { const m = cross(sub(at(P, I[f * 3 + 1]), at(P, I[f * 3])), sub(at(P, I[f * 3 + 2]), at(P, I[f * 3]))), l = norm(m); return l > 0 ? scale(m, 1 / l) : m }
  // Which way the faces face, against the circle: +1 when they face away from its centre, as the outside of a solid does
  // at an edge that turns out.
  let way = 0
  for (let i = 0; i < N && !way; i++) if (frames[i].t) way = Math.sign(dot(normalOf(left[i]), frames[i].d[0]))
  // On a sheet, the wall's face on the round's inner side gets the radius less the wall there: it must keep at least a
  // tenth of the round.
  if (wall) {
    const inner = way > 0 ? wall.back : wall.front
    // A round of exactly the smallest size fits, whatever the rounding.
    if (r - inner < INNER_SHARE * r - 1e-6 * r) return 'under the wall'
  }
  // An open rim, an edge with more than two faces, or another sharp edge within reach leaves no room, though a smaller
  // round may fit; a sharp edge that meets the loop itself rules out any round, so the search goes on to look for one.
  let crowded = false
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q], s = side[f]
    for (let k = 0; k < 3; k++) {
      const a = I[f * 3 + k], b = I[f * 3 + (k + 1) % 3]
      if (loopEdge.has(a < b ? a * KEY + b : b * KEY + a)) continue
      const reach = reaches(a, b), across = faces.on(a, b)
      if (reach && across.length !== 2) { crowded = true; continue }
      for (const g of across) {
        if (g === f || side[g] === s) continue
        if (side[g]) return 'no room'
        if (!(reaches(I[g * 3], I[g * 3 + 1]) || reaches(I[g * 3 + 1], I[g * 3 + 2]) || reaches(I[g * 3 + 2], I[g * 3]))) continue
        if (reach && dot(normalOf(f), normalOf(g)) < sharpCos) {
          if (shareOf(a) === 0 || shareOf(b) === 0) return 'meets an edge'
          crowded = true
          continue
        }
        side[g] = s; queue.push(g)
      }
    }
  }
  if (crowded) return 'no room'
  for (const f of queue) for (let k = 0; k < 3; k++) {
    const v = I[f * 3 + k]
    if (!(shareOf(v) < 1)) continue
    if (moved.has(v)) return 'no room'
    // Every face around a point the round moves must be one it reaches, or that face would bend.
    for (let j = faces.start[v]; j < faces.start[v + 1]; j++) if (!side[faces.list[j]]) return 'no room'
  }

  // Rows at even shares of t on each side, enough that no facet strays from the circle by more than the tolerance.
  let phiMax = 0
  for (const frame of frames) phiMax = Math.max(phiMax, frame.phi)
  const step = 2 * Math.acos(1 - Math.min(tolerance, r) / r)
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.ceil(phiMax / 2 / step)))
  let T: number[] = [], TS: number[] = [], TF: number[] = []
  for (const f of queue) { T.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]); TS.push(side[f]); TF.push(f) }
  // New points: where they are, their sources, their share, and the row they were cut on (0 for none).
  const NP: number[] = [], NO: number[] = [], NO2: number[] = [], NS: number[] = [], NR: number[] = []
  const pointShare = (v: number) => v < n ? share[v] : NS[v - n]
  const point = (v: number): V => v < n ? at(P, v) : [NP[(v - n) * 3], NP[(v - n) * 3 + 1], NP[(v - n) * 3 + 2]]
  // A new point between a and b, its share, and its sources: those of the end farther from the loop.
  const addPoint = (x: V, s: number, a: number, b: number, row = 0) => {
    const far = pointShare(b) > pointShare(a) ? b : a
    NP.push(...x); NS.push(s); NR.push(row); NO.push(far < n ? mesh.O[far] : NO[far - n]); NO2.push(far < n ? mesh.O2[far] : NO2[far - n])
    return n + NS.length - 1
  }
  // Edges whose share doesn't rise or fall evenly from end to end within the round's reach, such as an edge from the
  // loop across a narrow face and back to the loop, are split at their middles until it does, so the rows below cut
  // them wherever they cross.
  // Splits the zone's faces where newPoint gives an edge a new point (or -1 for none), each into two, three or four
  // faces turned the same way; returns whether any were split. newPoint sees each edge once, with a face of its side.
  const splitFaces = (newPoint: (a: number, b: number, side: number) => number) => {
    const made = new Map<number, number>()
    const middle = (a: number, b: number, side: number) => {
      const key = a < b ? a * KEY + b : b * KEY + a
      let m = made.get(key)
      if (m === undefined) { m = newPoint(a, b, side); made.set(key, m) }
      return m
    }
    const T2: number[] = [], TS2: number[] = [], TF2: number[] = []
    const emit = (x: number, y: number, z: number, f: number) => { T2.push(x, y, z); TS2.push(TS[f]); TF2.push(TF[f]) }
    for (let f = 0; f < T.length / 3; f++) {
      const c = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]], m = [middle(c[0], c[1], TS[f]), middle(c[1], c[2], TS[f]), middle(c[2], c[0], TS[f])]
      const count = m.filter(x => x >= 0).length
      if (count === 0) { emit(c[0], c[1], c[2], f); continue }
      if (count === 3) { emit(c[0], m[0], m[2], f); emit(m[0], c[1], m[1], f); emit(m[2], m[1], c[2], f); emit(m[0], m[1], m[2], f); continue }
      // Turn the triangle so its split edges come first: one split, from x to y; two, from x to y and y to z.
      const k = count === 1 ? m.findIndex(x => x >= 0) : m.findIndex((x, j) => x >= 0 && m[(j + 1) % 3] >= 0)
      const [x, y, z] = [c[k], c[(k + 1) % 3], c[(k + 2) % 3]], m1 = m[k], m2 = m[(k + 1) % 3]
      if (count === 1) { emit(x, m1, z, f); emit(m1, y, z, f) } else { emit(m1, y, m2, f); emit(x, m1, m2, f); emit(x, m2, z, f) }
    }
    const grew = T2.length !== T.length
    T = T2; TS = TS2; TF = TF2
    return grew
  }
  for (let pass = 0; pass < 12; pass++) {
    const grew = splitFaces((a, b) => {
      const x = scale(add(point(a), point(b)), 0.5), s = a < n && b < n ? midShare(a, b) : nearest(x).s
      const sa = pointShare(a), sb = pointShare(b), reach = Math.min(sa, sb, s) < 1
      const uneven = reach && (s > Math.max(sa, sb) + 1e-3 || s < Math.min(sa, sb) - 1e-3)
      return uneven ? addPoint(x, s, a, b) : -1
    })
    if (!grew) break
  }
  for (let row = 1; row <= rows; row++) {
    const level = row / rows, made = new Map<number, number>()
    // A point within a fifth of a row's spacing of the row counts as on it, so no row is cut a hair's breadth from a
    // point, which would leave a sliver that the smallest move turns over.
    const near = 0.2 / rows
    const level3 = (v: number) => { const s = pointShare(v); return s < level - near ? -1 : s > level + near ? 1 : 0 }
    const cut = (a: number, b: number) => {
      const key = a < b ? a * KEY + b : b * KEY + a
      let m = made.get(key)
      if (m === undefined) {
        const sa = pointShare(a), sb = pointShare(b), pa = point(a), pb = point(b)
        // Where along the edge the share reaches the row. The share isn't even along an edge that runs slantwise to the
        // loop, as the long fan triangles of a CAD face do near a tight curve, so it is searched for: by false position
        // (Illinois) while both ends of the bracket have a share, which takes a few steps on a smooth share, and by
        // halving while one end is beyond the round's reach.
        const along = (w: number): V => [pa[0] + w * (pb[0] - pa[0]), pa[1] + w * (pb[1] - pa[1]), pa[2] + w * (pb[2] - pa[2])]
        let lo = 0, hi = 1, flo = sa - level, fhi = sb - level, kept = 0, best = 0.5, bestF = Infinity
        let byFalse = Number.isFinite(flo) && Number.isFinite(fhi), w = byFalse ? -flo / (fhi - flo) : 0.5
        for (let tries = 0; tries < 50; tries++) {
          const f = nearest(along(w)).s - level
          if (Math.abs(f) < bestF) { bestF = Math.abs(f); best = w }
          if (Math.abs(f) < 1e-7) break
          // Illinois: an end kept twice in a row after false position steps has its value halved, so the next guess moves.
          if ((f < 0) === (flo < 0)) { lo = w; flo = f; if (byFalse && kept === -1) fhi /= 2; kept = -1 }
          else { hi = w; fhi = f; if (byFalse && kept === 1) flo /= 2; kept = 1 }
          byFalse = Number.isFinite(flo) && Number.isFinite(fhi)
          w = byFalse ? lo + (hi - lo) * (-flo / (fhi - flo)) : (lo + hi) / 2
        }
        m = addPoint(along(best), level, a, b, row)
        made.set(key, m)
      }
      return m
    }
    const T2: number[] = [], TS2: number[] = [], TF2: number[] = []
    for (let f = 0; f < T.length / 3; f++) {
      const c = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]], k = c.map(level3)
      if (k.every(x => x <= 0) || k.every(x => x >= 0)) { T2.push(...c); TS2.push(TS[f]); TF2.push(TF[f]); continue }
      // Crosses the row: the part below it and the part above, each a triangle or a quadrilateral, turned the same way.
      const below: number[] = [], above: number[] = []
      for (let j = 0; j < 3; j++) {
        const a = c[j], b = c[(j + 1) % 3]
        if (k[j] <= 0) below.push(a)
        if (k[j] >= 0) above.push(a)
        if (k[j] * k[(j + 1) % 3] < 0) { const m = cut(a, b); below.push(m); above.push(m) }
      }
      for (const part of [below, above]) for (let j = 1; j + 1 < part.length; j++) { T2.push(part[0], part[j], part[j + 1]); TS2.push(TS[f]); TF2.push(TF[f]) }
    }
    T = T2; TS = TS2; TF = TF2
  }

  // New points closer together than a tenth of a row's spacing merge, as where the rows cut a fan's edges near its
  // apex: each would move by a slightly different amount, and the thin faces between them turn over. A point merges
  // into a neighbour only when its faces all lie in one plane, so the surface keeps its shape (a point on a crease
  // between facets stays), and when the two share no neighbours but the far corners of the two faces on their edge, so
  // the surface stays one sheet. The loop's points and the zone's edge are never merged away.
  {
    const close = 0.1 * tMax / rows
    const close2 = close * close
    for (let pass = 0; pass < 20; pass++) {
      // The short edges with a new point, and only their points' neighbours and faces.
      const focus = new Set<number>()
      for (let f = 0; f < T.length / 3; f++) for (let k = 0; k < 3; k++) {
        const a = T[f * 3 + k], b = T[f * 3 + (k + 1) % 3]
        if (a < n && b < n) continue
        const pa = point(a), pb = point(b), dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2]
        if (dx * dx + dy * dy + dz * dz < close2) { focus.add(a); focus.add(b) }
      }
      if (!focus.size) break
      const around = new Map<number, Set<number>>(), facesAt = new Map<number, number[]>()
      const link = (a: number, b: number) => { let s = around.get(a); if (!s) around.set(a, s = new Set()); s.add(b) }
      for (let f = 0; f < T.length / 3; f++) for (let k = 0; k < 3; k++) {
        const a = T[f * 3 + k], b = T[f * 3 + (k + 1) % 3]
        if (focus.has(a)) {
          link(a, b)
          let list = facesAt.get(a)
          if (!list) facesAt.set(a, list = [])
          list.push(f)
        }
        if (focus.has(b)) link(b, a)
      }
      const flat = (v: number) => {
        let first: V | null = null
        for (const f of facesAt.get(v) ?? []) {
          const m = cross(sub(point(T[f * 3 + 1]), point(T[f * 3])), sub(point(T[f * 3 + 2]), point(T[f * 3]))), l = norm(m)
          if (!(l > 0)) continue
          const u = scale(m, 1 / l)
          if (!first) first = u
          else if (dot(first, u) < FLAT) return false
        }
        return true
      }
      // Whether moving b onto a keeps every face around b that stays facing the way it did: one that would turn over, a
      // sliver across an edge of b's faces, would be a fold of the surface too thin to see.
      const keepsFacing = (b: number, a: number) => {
        for (const f of facesAt.get(b) ?? []) {
          const c = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]]
          if (c.includes(a)) continue
          const before = cross(sub(point(c[1]), point(c[0])), sub(point(c[2]), point(c[0])))
          const moved = c.map(v => v === b ? a : v), after = cross(sub(point(moved[1]), point(moved[0])), sub(point(moved[2]), point(moved[0])))
          if (!(dot(before, after) > 0.25 * norm(before) * norm(after))) return false
        }
        return true
      }
      const into = new Map<number, number>(), touched = new Set<number>()
      for (const [b, nb] of around) {
        if (b < n || touched.has(b) || !flat(b)) continue
        for (const a of nb) {
          if (touched.has(a) || norm(sub(point(a), point(b))) >= close) continue
          const na = around.get(a)!
          let common = 0
          for (const x of nb) if (na.has(x)) common++
          if (common !== 2 || !keepsFacing(b, a)) continue
          into.set(b, a)
          for (const x of [a, b, ...nb, ...na]) touched.add(x)
          break
        }
      }
      if (!into.size) break
      const T2: number[] = [], TS2: number[] = [], TF2: number[] = []
      for (let f = 0; f < T.length / 3; f++) {
        const c = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]].map(v => into.get(v) ?? v)
        if (c[0] === c[1] || c[1] === c[2] || c[2] === c[0]) continue
        T2.push(...c); TS2.push(TS[f]); TF2.push(TF[f])
      }
      T = T2; TS = TS2; TF = TF2
    }
  }
  // Before anything moves, thin faces on a flat part of the zone are turned toward the Delaunay shape: where the two
  // faces on an edge make a quadrilateral whose other diagonal makes fatter faces, the edge is turned. That changes
  // nothing on a flat face, and a thin face, such as one cut from a long CAD triangle across a narrow letter stroke,
  // turns over when its corners move a little differently. The loop, the rows and the zone's edge stay as they are.
  {
    const edgeFaces = new Map<number, number>()
    const note = (f: number) => { for (let k = 0; k < 3; k++) edgeFaces.set(T[f * 3 + k] * KEY + T[f * 3 + (k + 1) % 3], f) }
    const forget = (f: number) => { for (let k = 0; k < 3; k++) edgeFaces.delete(T[f * 3 + k] * KEY + T[f * 3 + (k + 1) % 3]) }
    for (let f = 0; f < T.length / 3; f++) note(f)
    const rowOf = (v: number) => v >= n ? NR[v - n] : 0
    const unitNormal = (x: number, y: number, z: number) => { const m = cross(sub(point(y), point(x)), sub(point(z), point(x))), l = norm(m); return l > 0 ? scale(m, 1 / l) : m }
    // The angle at z in the triangle x, y, z.
    const angle = (x: number, y: number, z: number) => { const a = sub(point(x), point(z)), b = sub(point(y), point(z)); return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b) || 1)))) }
    for (let pass = 0; pass < 6; pass++) {
      let turnedAny = false
      for (let f = 0; f < T.length / 3; f++) for (let k = 0; k < 3; k++) {
        const x = T[f * 3 + k], y = T[f * 3 + (k + 1) % 3], z = T[f * 3 + (k + 2) % 3], g = edgeFaces.get(y * KEY + x)
        if (g === undefined || TS[g] !== TS[f] || loopEdge.has(x < y ? x * KEY + y : y * KEY + x)) continue
        // A row's own edges stay, so each row keeps its points in a line along the loop.
        if (rowOf(x) && rowOf(x) === rowOf(y)) continue
        const w = [T[g * 3], T[g * 3 + 1], T[g * 3 + 2]].find(v => v !== x && v !== y)!
        if (edgeFaces.has(z * KEY + w) || edgeFaces.has(w * KEY + z)) continue
        if (angle(x, y, z) + angle(x, y, w) <= Math.PI + 1e-6) continue
        // Only on a flat part, and only if both new faces face the same way as the old ones.
        const nf = unitNormal(x, y, z)
        if (dot(nf, unitNormal(y, x, w)) < 0.99995) continue
        if (dot(unitNormal(x, w, z), nf) < 0.99 || dot(unitNormal(w, y, z), nf) < 0.99) continue
        forget(f); forget(g)
        T[f * 3] = x; T[f * 3 + 1] = w; T[f * 3 + 2] = z
        T[g * 3] = w; T[g * 3 + 1] = y; T[g * 3 + 2] = z
        note(f); note(g)
        turnedAny = true
        break
      }
      if (!turnedAny) break
    }
  }
  // Points the round reaches from two loop points on opposite sides of them, across a narrow face, leave no room for it.
  // The rows' points are tested too, since CAD fills a narrow face with long triangles whose corners all lie on the loop.
  {
    const checked = new Set<number>()
    for (const v of T) {
      if (checked.has(v) || !(pointShare(v) < 1)) continue
      checked.add(v)
      if (meetsItself(point(v), nearest(point(v)))) return 'no room'
    }
  }

  // 3. Move every point closer than t onto the circle.
  const sideOf = new Map<number, number>()
  for (let f = 0; f < T.length / 3; f++) for (let k = 0; k < 3; k++) { const v = T[f * 3 + k]; sideOf.set(v, (sideOf.get(v) ?? 0) | TS[f]) }
  // Points on the touching line, or snapped to the row there from just past it, don't move, but take the circle's
  // direction where it touches their side: for a flat side, their faces' own normal. A wall built on the round then
  // follows one smooth field of normals across its edge (lib/sheetSolid).
  const target = new Map<number, V>(), arcNormal = new Map<number, V>(), edgeNormal = new Map<number, V>(), band = 1 + 0.25 / rows
  for (const [v, mask] of sideOf) {
    let s: number, i: number, u: number
    if (v < n) { s = share[v]; i = footEdge[v]; u = footAt[v] } else { const q = nearest(point(v)); s = q.s; i = q.i; u = q.u }
    if (!(s < band) || i < 0) continue
    // A point on the loop itself, on both sides, goes to the middle of the arc.
    const k = mask === 3 ? 0 : mask - 1, share3 = mask === 3 ? 0 : Math.min(1, s), move: V = [0, 0, 0], dir: V = [0, 0, 0]
    for (const [frame, w] of [[frames[i], 1 - u], [frames[(i + 1) % N], u]] as [Frame, number][]) {
      if (!frame.t || !w) continue
      // The arc runs from where the circle touches the left side (angle 0) to the right side (angle phi).
      const theta = k === 0 ? (1 - share3) * frame.phi / 2 : frame.phi - (1 - share3) * frame.phi / 2
      const wa = Math.sin(frame.phi - theta) / Math.sin(frame.phi), wb = Math.sin(theta) / Math.sin(frame.phi)
      for (let j = 0; j < 3; j++) {
        const along = wa * frame.d[0][j] + wb * frame.d[1][j]
        move[j] += w * (frame.c[j] + r * along - share3 * frame.t * frame.u[k][j])
        dir[j] += w * along
      }
    }
    if (!(s < 1)) { if (mask !== 3 && norm(dir) > 0) edgeNormal.set(v, scale(dir, 1 / norm(dir))); continue }
    const p = point(v)
    target.set(v, [p[0] + move[0], p[1] + move[1], p[2] + move[2]])
    arcNormal.set(v, scale(dir, 1 / (norm(dir) || 1)))
  }
  // Faces must not turn over: each face of the round should face the way the circle does at its points, and a face's
  // own normal stands in for points that don't move. The circle's directions face out of the surface or into it, as the
  // loop's faces do. A face none of whose points move is a piece of the face it was cut from and must face its way: a
  // cut can leave a sliver a fraction of a micrometre wide turned over there, which a wall built on it would blow up.
  const placed = (v: number) => target.get(v) ?? point(v)
  const facing = (x: number, y: number, z: number) => cross(sub(placed(y), placed(x)), sub(placed(z), placed(x)))
  const turned = (x: number, y: number, z: number, source: number) => {
    const m = facing(x, y, z)
    // Too small to tell which way it faces.
    if (norm(m) < 1e-12 * r * r) return false
    let expected: V = [0, 0, 0]
    for (const v of [x, y, z]) expected = add(expected, arcNormal.has(v) ? scale(arcNormal.get(v)!, way) : normalOf(source))
    return dot(m, expected) <= 0
  }
  // A thin face cut from a long CAD triangle can turn over though every point moves where it should, when its far corner
  // lies close to the line through the other two and those two move along the loop by different amounts, as across the
  // round end of a narrow letter stroke. Turning the edge between it and its neighbour, so the two faces share the
  // other diagonal of the four points, fixes that; any face still turned over leaves the loop sharp.
  const runs = new Map<number, number>()
  const note = (f: number) => { for (let k = 0; k < 3; k++) runs.set(T[f * 3 + k] * KEY + T[f * 3 + (k + 1) % 3], f) }
  const forget = (f: number) => { for (let k = 0; k < 3; k++) runs.delete(T[f * 3 + k] * KEY + T[f * 3 + (k + 1) % 3]) }
  for (let f = 0; f < T.length / 3; f++) note(f)
  for (let pass = 0; pass < 8; pass++) {
    let bad = 0, fixed = 0
    for (let f = 0; f < T.length / 3; f++) {
      const c = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]]
      if (!turned(c[0], c[1], c[2], TF[f])) continue
      bad++
      const length = (k: number) => norm(sub(placed(c[(k + 1) % 3]), placed(c[k])))
      for (const k of [0, 1, 2].sort((i, j) => length(j) - length(i))) {
        const x = c[k], y = c[(k + 1) % 3], z = c[(k + 2) % 3], g = runs.get(y * KEY + x)
        if (g === undefined || TS[g] !== TS[f] || loopEdge.has(x < y ? x * KEY + y : y * KEY + x)) continue
        const w = [T[g * 3], T[g * 3 + 1], T[g * 3 + 2]].find(v => v !== x && v !== y)!
        if (runs.has(z * KEY + w) || runs.has(w * KEY + z)) continue
        if (norm(facing(x, w, z)) < 1e-12 * r * r || norm(facing(w, y, z)) < 1e-12 * r * r) continue
        if (turned(x, w, z, TF[f]) || turned(w, y, z, TF[g])) continue
        forget(f); forget(g)
        T[f * 3] = x; T[f * 3 + 1] = w; T[f * 3 + 2] = z
        T[g * 3] = w; T[g * 3 + 1] = y; T[g * 3 + 2] = z
        note(f); note(g)
        fixed++
        break
      }
    }
    if (!bad) break
    if (!fixed) return 'turns over'
  }
  for (let f = 0; f < T.length / 3; f++) if (turned(T[f * 3], T[f * 3 + 1], T[f * 3 + 2], TF[f])) return 'turns over'

  // The round must not pass through another part of the surface, as a large round on a thin wall would, into the inside
  // of a pot: its faces are tested against everything near them, by how long the lines are where faces cross. Cutting
  // a face into pieces keeps that length, so a shape that crossed itself already, as one with a doubled layer of faces,
  // isn't blamed on the round; a round that crosses something new adds to it.
  const total = n + NS.length, Q = new Float32Array(total * 3)
  for (let v = 0; v < total; v++) { const p = target.get(v) ?? point(v); Q[v * 3] = p[0]; Q[v * 3 + 1] = p[1]; Q[v * 3 + 2] = p[2] }
  const rest: number[] = []
  for (let f = 0; f < F; f++) if (!side[f]) rest.push(f)
  const J = new Uint32Array(T.length + rest.length * 3)
  J.set(T)
  rest.forEach((f, k) => { J[T.length + k * 3] = I[f * 3]; J[T.length + k * 3 + 1] = I[f * 3 + 1]; J[T.length + k * 3 + 2] = I[f * 3 + 2] })
  let before: Float32Array | null = null
  const surfaceBefore = () => before ??= Float32Array.from(P)
  {
    const length = (pairs: [number, number, number][]) => pairs.reduce((sum, pair) => sum + pair[2], 0)
    // The surface as it was is measured only when the round crosses something.
    const after = length(zoneCrossings(Q, J, Array.from({ length: T.length / 3 }, (_, f) => f)))
    if (after > 0.01 * r && after > length(zoneCrossings(surfaceBefore(), I, queue)) + 0.01 * r) return 'cuts through'
  }
  // On a closed shape, a round on an edge that turns out cuts into the wall behind it, and can leave it too thin to print
  // without cutting through, as a large round on a pot's thin wall does at its corner. The wall it leaves is measured
  // into the solid from each point it moves, along the round's normal; the shape's own walls beside it, into the solid
  // from the middle of each face it reaches and from its touching lines, as they were. Both only as far as minWall. A
  // ray from the middle of a face that leaves through the other side within the round's reach crosses the edge's own
  // wedge, which the round cuts away, so those faces don't count: at an edge sharper than a right angle they would make
  // the shape's own walls seem as thin as the wedge. At the touching lines the wedge is as thick as the shape's wall
  // there, as at a knife edge, so everything counts.
  if (minWall && way > 0) {
    const otherSide = (raySide: number, faceSide: number) => raySide !== 3 && faceSide !== 0 && faceSide !== raySide
    const designStarts: number[] = [], designWays: number[] = [], designSide: number[] = []
    for (const f of queue) {
      const m = normalOf(f)
      for (let k = 0; k < 3; k++) designStarts.push((P[I[f * 3] * 3 + k] + P[I[f * 3 + 1] * 3 + k] + P[I[f * 3 + 2] * 3 + k]) / 3)
      designWays.push(-m[0], -m[1], -m[2]); designSide.push(side[f])
    }
    let need = minWall
    for (const d of rayDepths(surfaceBefore(), I, designStarts, designWays, new Int32Array(queue.length).fill(-1), minWall,
      (k, f) => f >= 0 && otherSide(designSide[k], side[f]))) need = Math.min(need, d)
    // The touching lines: points on or snapped to the last row, which rounding leaves a hair either side of it.
    const lineStarts: number[] = [], lineWays: number[] = [], lineOwn: number[] = []
    for (const [v, mask] of sideOf) {
      const a = edgeNormal.get(v) ?? (v >= n && NR[v - n] === rows ? arcNormal.get(v) : undefined)
      if (!a || mask === 3) continue
      lineStarts.push(...point(v)); lineWays.push(-a[0], -a[1], -a[2]); lineOwn.push(v < n ? v : -1)
    }
    for (const d of rayDepths(surfaceBefore(), I, lineStarts, lineWays, lineOwn, minWall)) need = Math.min(need, d)
    const starts: number[] = [], ways: number[] = [], own: number[] = []
    for (const [v, p] of target) { const a = arcNormal.get(v)!; starts.push(...p); ways.push(-a[0], -a[1], -a[2]); own.push(v) }
    let left = minWall
    for (const d of rayDepths(Q, J, starts, ways, own, minWall)) left = Math.min(left, d)
    if (left < 0.98 * need) return { problem: 'thins the wall', left, need }
  }

  const zone: number[] = []
  // The round's normal at a point it moved or that lies on its edge, facing the way the faces do.
  const setNormal = (id: number, v: number) => {
    const a = arcNormal.get(v) ?? edgeNormal.get(v)
    if (a && norm(a) > 0) for (let k = 0; k < 3; k++) mesh.N[id * 3 + k] = way * a[k]
  }
  for (const [v, p] of target) if (v < n) { P[v * 3] = p[0]; P[v * 3 + 1] = p[1]; P[v * 3 + 2] = p[2]; moved.add(v); zone.push(v); setNormal(v, v) }
  for (const v of edgeNormal.keys()) if (v < n) setNormal(v, v)
  // New points the faces still use, numbered after the mesh's own: points merged away are left out.
  const kept = new Map<number, number>()
  for (const v of T) if (v >= n && !kept.has(v)) {
    const id = n + kept.size, p = target.get(v)
    kept.set(v, id)
    P.push(...(p ?? point(v))); mesh.O.push(NO[v - n]); mesh.O2.push(NO2[v - n]); mesh.N.push(0, 0, 0)
    if (p) moved.add(id)
    setNormal(id, v)
    zone.push(id)
  }
  const out: number[] = [], from: number[] = []
  for (let f = 0; f < F; f++) if (!side[f]) { out.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]); from.push(mesh.FO[f]) }
  for (const v of T) out.push(v >= n ? kept.get(v)! : v)
  for (const f of TF) from.push(mesh.FO[f])
  mesh.I = out; mesh.FO = from
  return zone
}

const at = (P: ArrayLike<number>, v: number): V => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V) => Math.hypot(a[0], a[1], a[2])
