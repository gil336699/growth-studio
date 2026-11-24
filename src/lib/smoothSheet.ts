// Smooths a grown sheet before its wall is added, so a coarse surface prints without facets: Loop subdivision
// (Charles Loop, 1987). Each pass splits every triangle into four and moves the corners toward a smooth surface; open
// rims follow a smooth curve through their own points, so a rim stays a rim and a flat bottom rim stays flat.
// Sharp edges of the starting shape, such as the edge around a flat bottom, can stay sharp: they follow the rim rule
// too (Hoppe et al. 1994). A bevel rounds them partly, as semi-sharp creases do (DeRose, Kass and Truong 1998).
// It softens folds a little, as any smoothing does, and each pass makes four times the triangles.

export type SmoothLevel = 'off' | 'light' | 'strong'
export const SMOOTH_PASSES: Record<SmoothLevel, number> = { off: 0, light: 1, strong: 2 }
// The sheet after smoothing stays under this many triangles, so the solid and its checks stay quick in a browser.
export const SMOOTH_MAX_TRIANGLES = 400_000
// By default, an edge where the starting shape bends more than this is a designed sharp edge (Blender's auto-smooth
// default is 30° too). On curved surfaces, CAD exports bend less from face to face: the weave vase at most 22.5°, a pen
// holder from Fusion at most 13°. Designed edges bend more: a flat bottom meets its wall at about 90°, and that pen
// holder's bottom chamfer bends 33–37° and 43–47°. The app lets the user change it, for softer edges or coarser meshes.
export const SHARP_ANGLE = 30
// The range the app offers for that angle, in degrees.
export const SHARP_ANGLE_RANGE: [number, number] = [10, 60]

export type SmoothSheet = {
  positions: Float32Array
  indices: Uint32Array
  // The original sheet vertices each new vertex came from, so overlay colors carry over to the solid: a point made
  // on an edge takes the average of its two ends' colors.
  origin: Uint32Array
  origin2: Uint32Array
}

export type SmoothOptions = {
  // Edges to keep sharp, as pairs of vertex indices [a, b, a, b, …]; sharpEdges finds them.
  creases?: ArrayLike<number>
  // 0 keeps the creases sharp, 1 rounds them like the rest of the surface, and values between round them partly.
  bevel?: number
}

// Passes that fit under the triangle limit for a sheet with this many triangles.
export function smoothPassesFor(level: SmoothLevel, triangles: number) {
  let passes = SMOOTH_PASSES[level]
  while (passes > 0 && triangles * 4 ** passes > SMOOTH_MAX_TRIANGLES) passes--
  return passes
}

// Edges where the surface bends more than angleDeg between its two faces, as pairs of vertex indices. Pass the starting
// shape, not the grown one: there a designed edge is sharp and the folds that grow later are not. Rims and edges with
// more than two faces are left out (smoothing keeps them anyway), and so are edges of faces with no area. Two faces that
// run the edge the same way are turned inconsistently, so one of them is turned back before they are compared.
export function sharpEdges(positions: ArrayLike<number>, indices: ArrayLike<number>, angleDeg = SHARP_ANGLE): Uint32Array {
  const n = positions.length / 3, faces = indices.length / 3, limit = Math.cos(angleDeg * Math.PI / 180)
  const normals = new Float64Array(faces * 3)
  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2]
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, length = Math.hypot(nx, ny, nz)
    // A sliver, whose corner is nearly straight, has no reliable normal: it is left out like a face with no area.
    if (length > 1e-9 * Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz)) { normals[f * 3] = nx / length; normals[f * 3 + 1] = ny / length; normals[f * 3 + 2] = nz / length }
  }
  // For each edge: the first face that uses it and the way that face runs it, then whether a second, matching face exists.
  const first = new Map<number, number>(), second = new Map<number, number>()
  for (let f = 0; f < faces; f++) for (let k = 0; k < 3; k++) {
    const a = indices[f * 3 + k], b = indices[f * 3 + (k + 1) % 3], key = a < b ? a * n + b : b * n + a
    const use = a < b ? f * 2 : f * 2 + 1
    if (!first.has(key)) first.set(key, use)
    else second.set(key, second.has(key) ? -1 : use)
  }
  const out: number[] = []
  for (const [key, use] of second) {
    if (use < 0) continue
    const f = first.get(key)! >> 1, g = use >> 1, same = (first.get(key)! & 1) === (use & 1)
    const lf = normals[f * 3] || normals[f * 3 + 1] || normals[f * 3 + 2], lg = normals[g * 3] || normals[g * 3 + 1] || normals[g * 3 + 2]
    if (!lf || !lg) continue
    const dot = (normals[f * 3] * normals[g * 3] + normals[f * 3 + 1] * normals[g * 3 + 1] + normals[f * 3 + 2] * normals[g * 3 + 2]) * (same ? -1 : 1)
    if (dot < limit) out.push(Math.floor(key / n), key % n)
  }
  return Uint32Array.from(out)
}

// How much a crease's ends may have grown, as a share of their starting length, and still be a designed edge.
export const GROWN_LIMIT = 0.1
// The sharp edges that are still designed edges after growth: those whose two ends grew at most `limit`. Where the
// surface grew, a designed edge has folded with it, and keeping it sharp makes smoothing fold the surface over it (a pen
// holder grown 160 steps with Brain folds crossed itself in 18 places when Light-smoothed). An edge that doesn't grow,
// such as one around a flat bottom that is held still, stays sharp.
export function ungrownEdges(creases: ArrayLike<number>, growth: ArrayLike<number>, limit = GROWN_LIMIT): Uint32Array {
  const out: number[] = []
  for (let i = 0; i + 1 < creases.length; i += 2) {
    const a = creases[i], b = creases[i + 1]
    if ((growth[a] ?? 0) <= limit && (growth[b] ?? 0) <= limit) out.push(a, b)
  }
  return Uint32Array.from(out)
}

export function smoothSheet(positions: ArrayLike<number>, indices: ArrayLike<number>, passes: number, options: SmoothOptions = {}): SmoothSheet {
  let P: Float32Array = Float32Array.from(positions), I: Uint32Array = Uint32Array.from(indices)
  let origin: Uint32Array = new Uint32Array(P.length / 3).map((_, v) => v), origin2: Uint32Array = origin.slice()
  // Each crease starts with a sharpness in passes: it stays sharp for that many passes, then rounds like the surface.
  // With no bevel it outlasts every pass; a full bevel gives it none, which is smoothing as if it weren't there.
  const bevel = Math.min(1, Math.max(0, options.bevel ?? 0))
  let sharp: Map<number, number> | null = null
  if (options.creases?.length && bevel < 1 && passes > 0) {
    const n = P.length / 3, start = passes * (1 - bevel), creases = options.creases
    sharp = new Map()
    for (let i = 0; i + 1 < creases.length; i += 2) {
      const a = creases[i], b = creases[i + 1]
      sharp.set(a < b ? a * n + b : b * n + a, start)
    }
  }
  for (let pass = 0; pass < passes; pass++) {
    const { next, nextSharp } = loopPass(P, I, sharp), n = P.length / 3
    // Old corners keep both of their sources; a new edge point blends the main sources of its two ends.
    const o1 = Uint32Array.from(next.origin, v => origin[v])
    const o2 = Uint32Array.from(next.origin2, (v, i) => (i < n ? origin2[v] : origin[v]))
    origin = o1; origin2 = o2; P = next.positions; I = next.indices; sharp = nextSharp
  }
  return { positions: P, indices: I, origin, origin2 }
}

// One Loop pass. Edges used by one face are rim edges; edges used by more than two faces count as rims too, so a
// pinched or non-manifold spot keeps its shape instead of tearing. sharp holds each crease's sharpness, keyed by its two
// ends; the two halves of a crease carry what is left of it into the next pass.
function loopPass(P: Float32Array, I: Uint32Array, sharp: Map<number, number> | null) {
  const n = P.length / 3, faces = I.length / 3
  // Edges: both ends, how many faces use the edge, and the corners opposite it.
  const edgeOf = new Map<number, number>(), edgeA: number[] = [], edgeB: number[] = [], uses: number[] = [], opp1: number[] = [], opp2: number[] = []
  const faceEdges = new Uint32Array(faces * 3)
  for (let f = 0; f < faces; f++) for (let k = 0; k < 3; k++) {
    const a = I[f * 3 + k], b = I[f * 3 + (k + 1) % 3], c = I[f * 3 + (k + 2) % 3]
    const key = a < b ? a * n + b : b * n + a
    let e = edgeOf.get(key)
    if (e === undefined) { e = edgeA.length; edgeOf.set(key, e); edgeA.push(Math.min(a, b)); edgeB.push(Math.max(a, b)); uses.push(0); opp1.push(c); opp2.push(-1) }
    else if (uses[e] === 1) opp2[e] = c
    uses[e]++
    faceEdges[f * 3 + k] = e
  }
  const edges = edgeA.length, rim = (e: number) => uses[e] !== 2
  // A crease's sharpness this pass; rims follow their own rule.
  const sharpness = new Float64Array(edges)
  if (sharp) for (let e = 0; e < edges; e++) if (!rim(e)) sharpness[e] = sharp.get(edgeA[e] * n + edgeB[e]) ?? 0
  // Each vertex's neighbours, its neighbours along rim edges, and along creases with their summed sharpness.
  const ringSum = new Float64Array(n * 3), ringCount = new Uint32Array(n), rimSum = new Float64Array(n * 3), rimCount = new Uint32Array(n)
  const creaseSum = new Float64Array(n * 3), creaseCount = new Uint32Array(n), creaseSharp = new Float64Array(n)
  for (let e = 0; e < edges; e++) {
    const a = edgeA[e], b = edgeB[e]
    for (let k = 0; k < 3; k++) { ringSum[a * 3 + k] += P[b * 3 + k]; ringSum[b * 3 + k] += P[a * 3 + k] }
    ringCount[a]++; ringCount[b]++
    if (rim(e)) { for (let k = 0; k < 3; k++) { rimSum[a * 3 + k] += P[b * 3 + k]; rimSum[b * 3 + k] += P[a * 3 + k] } rimCount[a]++; rimCount[b]++ }
    else if (sharpness[e] > 0) {
      for (let k = 0; k < 3; k++) { creaseSum[a * 3 + k] += P[b * 3 + k]; creaseSum[b * 3 + k] += P[a * 3 + k] }
      creaseCount[a]++; creaseCount[b]++; creaseSharp[a] += sharpness[e]; creaseSharp[b] += sharpness[e]
    }
  }
  const out = new Float32Array((n + edges) * 3), origin = new Uint32Array(n + edges), origin2 = new Uint32Array(n + edges)
  // Old corners move toward the smooth surface: Loop's weights inside, the cubic B-spline rule on a rim, and a
  // corner where more than two rim edges meet stays where it is. A vertex on two creases follows the rim rule along
  // them, one on three or more stays put, and one where a crease meets a rim is such a corner too. A crease with less
  // than one pass of sharpness left mixes its rule with the smooth one in proportion, so the bevel eases in everywhere.
  for (let v = 0; v < n; v++) {
    origin[v] = origin2[v] = v
    if (rimCount[v] === 2) {
      for (let k = 0; k < 3; k++) out[v * 3 + k] = 0.75 * P[v * 3 + k] + 0.125 * rimSum[v * 3 + k]
      if (creaseCount[v]) {
        const s = Math.min(1, creaseSharp[v] / creaseCount[v])
        for (let k = 0; k < 3; k++) out[v * 3 + k] = s * P[v * 3 + k] + (1 - s) * out[v * 3 + k]
      }
      continue
    }
    if (rimCount[v] > 0 || ringCount[v] < 3) { for (let k = 0; k < 3; k++) out[v * 3 + k] = P[v * 3 + k]; continue }
    const m = ringCount[v], t = 3 / 8 + Math.cos(2 * Math.PI / m) / 4, beta = (5 / 8 - t * t) / m
    for (let k = 0; k < 3; k++) out[v * 3 + k] = (1 - m * beta) * P[v * 3 + k] + beta * ringSum[v * 3 + k]
    const c = creaseCount[v]
    if (c < 2) continue // one crease ending here: a smooth point
    const s = Math.min(1, creaseSharp[v] / c)
    for (let k = 0; k < 3; k++) {
      const sharpPoint = c === 2 ? 0.75 * P[v * 3 + k] + 0.125 * creaseSum[v * 3 + k] : P[v * 3 + k]
      out[v * 3 + k] = s * sharpPoint + (1 - s) * out[v * 3 + k]
    }
  }
  // New points on the edges: 3/8 of each end and 1/8 of each opposite corner inside, the midpoint on a rim or a crease.
  for (let e = 0; e < edges; e++) {
    const a = edgeA[e], b = edgeB[e], o = (n + e) * 3
    origin[n + e] = a; origin2[n + e] = b
    if (rim(e) || opp2[e] < 0) { for (let k = 0; k < 3; k++) out[o + k] = 0.5 * (P[a * 3 + k] + P[b * 3 + k]); continue }
    const c = opp1[e], d = opp2[e]
    for (let k = 0; k < 3; k++) out[o + k] = 0.375 * (P[a * 3 + k] + P[b * 3 + k]) + 0.125 * (P[c * 3 + k] + P[d * 3 + k])
    const s = Math.min(1, sharpness[e])
    if (s > 0) for (let k = 0; k < 3; k++) out[o + k] = s * 0.5 * (P[a * 3 + k] + P[b * 3 + k]) + (1 - s) * out[o + k]
  }
  // Four triangles per triangle, turned the same way as the original.
  const J = new Uint32Array(faces * 12)
  for (let f = 0; f < faces; f++) {
    const a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2]
    const ab = n + faceEdges[f * 3], bc = n + faceEdges[f * 3 + 1], ca = n + faceEdges[f * 3 + 2]
    J.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], f * 12)
  }
  // The two halves of each crease keep what is left of its sharpness.
  let nextSharp: Map<number, number> | null = null
  const total = n + edges
  for (let e = 0; e < edges; e++) {
    if (!(sharpness[e] > 1)) continue
    nextSharp ??= new Map()
    const mid = n + e, rest = sharpness[e] - 1
    nextSharp.set(edgeA[e] * total + mid, rest)
    nextSharp.set(edgeB[e] * total + mid, rest)
  }
  return { next: { positions: out, indices: J, origin, origin2 } as SmoothSheet, nextSharp }
}
