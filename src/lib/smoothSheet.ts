// Smooths a grown sheet before its wall is added, so a coarse surface prints without facets: Loop subdivision
// (Charles Loop, 1987). Each pass splits every triangle into four and moves the corners toward a smooth surface; open
// rims follow a smooth curve through their own points, so a rim stays a rim and a flat bottom rim stays flat.
// It softens folds a little, as any smoothing does, and each pass makes four times the triangles.

export type SmoothLevel = 'off' | 'light' | 'strong'
export const SMOOTH_PASSES: Record<SmoothLevel, number> = { off: 0, light: 1, strong: 2 }
// The sheet after smoothing stays under this many triangles, so the solid and its checks stay quick in a browser.
export const SMOOTH_MAX_TRIANGLES = 400_000

export type SmoothSheet = {
  positions: Float32Array
  indices: Uint32Array
  // The original sheet vertices each new vertex came from, so overlay colors carry over to the solid: a point made
  // on an edge takes the average of its two ends' colors.
  origin: Uint32Array
  origin2: Uint32Array
}

// Passes that fit under the triangle limit for a sheet with this many triangles.
export function smoothPassesFor(level: SmoothLevel, triangles: number) {
  let passes = SMOOTH_PASSES[level]
  while (passes > 0 && triangles * 4 ** passes > SMOOTH_MAX_TRIANGLES) passes--
  return passes
}

export function smoothSheet(positions: ArrayLike<number>, indices: ArrayLike<number>, passes: number): SmoothSheet {
  let P: Float32Array = Float32Array.from(positions), I: Uint32Array = Uint32Array.from(indices)
  let origin: Uint32Array = new Uint32Array(P.length / 3).map((_, v) => v), origin2: Uint32Array = origin.slice()
  for (let pass = 0; pass < passes; pass++) {
    const next = loopPass(P, I), n = P.length / 3
    // Old corners keep both of their sources; a new edge point blends the main sources of its two ends.
    const o1 = Uint32Array.from(next.origin, v => origin[v])
    const o2 = Uint32Array.from(next.origin2, (v, i) => (i < n ? origin2[v] : origin[v]))
    origin = o1; origin2 = o2; P = next.positions; I = next.indices
  }
  return { positions: P, indices: I, origin, origin2 }
}

// One Loop pass. Edges used by one face are rim edges; edges used by more than two faces count as rims too, so a
// pinched or non-manifold spot keeps its shape instead of tearing.
function loopPass(P: Float32Array, I: Uint32Array): SmoothSheet {
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
  // Each vertex's neighbours, and its neighbours along rim edges.
  const ringSum = new Float64Array(n * 3), ringCount = new Uint32Array(n), rimSum = new Float64Array(n * 3), rimCount = new Uint32Array(n)
  for (let e = 0; e < edges; e++) {
    const a = edgeA[e], b = edgeB[e]
    for (let k = 0; k < 3; k++) { ringSum[a * 3 + k] += P[b * 3 + k]; ringSum[b * 3 + k] += P[a * 3 + k] }
    ringCount[a]++; ringCount[b]++
    if (rim(e)) { for (let k = 0; k < 3; k++) { rimSum[a * 3 + k] += P[b * 3 + k]; rimSum[b * 3 + k] += P[a * 3 + k] } rimCount[a]++; rimCount[b]++ }
  }
  const out = new Float32Array((n + edges) * 3), origin = new Uint32Array(n + edges), origin2 = new Uint32Array(n + edges)
  // Old corners move toward the smooth surface: Loop's weights inside, the cubic B-spline rule on a rim, and a
  // corner where more than two rim edges meet stays where it is.
  for (let v = 0; v < n; v++) {
    origin[v] = origin2[v] = v
    if (rimCount[v] === 2) { for (let k = 0; k < 3; k++) out[v * 3 + k] = 0.75 * P[v * 3 + k] + 0.125 * rimSum[v * 3 + k]; continue }
    if (rimCount[v] > 0 || ringCount[v] < 3) { for (let k = 0; k < 3; k++) out[v * 3 + k] = P[v * 3 + k]; continue }
    const m = ringCount[v], t = 3 / 8 + Math.cos(2 * Math.PI / m) / 4, beta = (5 / 8 - t * t) / m
    for (let k = 0; k < 3; k++) out[v * 3 + k] = (1 - m * beta) * P[v * 3 + k] + beta * ringSum[v * 3 + k]
  }
  // New points on the edges: 3/8 of each end and 1/8 of each opposite corner inside, the midpoint on a rim.
  for (let e = 0; e < edges; e++) {
    const a = edgeA[e], b = edgeB[e], o = (n + e) * 3
    origin[n + e] = a; origin2[n + e] = b
    if (rim(e) || opp2[e] < 0) { for (let k = 0; k < 3; k++) out[o + k] = 0.5 * (P[a * 3 + k] + P[b * 3 + k]); continue }
    const c = opp1[e], d = opp2[e]
    for (let k = 0; k < 3; k++) out[o + k] = 0.375 * (P[a * 3 + k] + P[b * 3 + k]) + 0.125 * (P[c * 3 + k] + P[d * 3 + k])
  }
  // Four triangles per triangle, turned the same way as the original.
  const J = new Uint32Array(faces * 12)
  for (let f = 0; f < faces; f++) {
    const a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2]
    const ab = n + faceEdges[f * 3], bc = n + faceEdges[f * 3 + 1], ca = n + faceEdges[f * 3 + 2]
    J.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], f * 12)
  }
  return { positions: out, indices: J, origin, origin2 }
}
