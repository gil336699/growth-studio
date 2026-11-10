// Voxel tools for closed shapes, free of React and three.js:
// - outerFace: the outer face of a layer around a closed surface, for brain mode's outer layer. Walls that touch merge,
//   so the result is watertight and never crosses itself.
// - closedRemesh: rebuilds any STL as a smooth, closed surface at a chosen spacing, for brain mode's starting shape.
// Both mark the surface on a grid, measure the distance to it (Felzenszwalb–Huttenlocher), fill the outside from the
// grid's edge, and extract a surface from a signed field with surface nets.

export type MeshData = { positions: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer> }
type Grid = { nx: number; ny: number; nz: number; origin: [number, number, number]; v: number }

// Above this many voxels a grid takes too much memory and time in a browser tab, so the spacing grows to fit.
export const VOXEL_BUDGET = 9_000_000

function bounds(P: ArrayLike<number>) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]) }
  return { lo, hi }
}

function makeGrid(P: ArrayLike<number>, v: number, pad: number): Grid {
  const { lo, hi } = bounds(P)
  const origin = lo.map(x => x - pad) as [number, number, number]
  const [nx, ny, nz] = lo.map((x, a) => Math.ceil((hi[a] - x + 2 * pad) / v) + 1)
  return { nx, ny, nz, origin, v }
}

// Squared distance, in voxels, from every voxel to the nearest voxel the surface passes through.
function surfaceDistance(P: ArrayLike<number>, I: ArrayLike<number>, grid: Grid) {
  const { nx, ny, nz, origin, v } = grid
  const D = new Float32Array(nx * ny * nz).fill(1e20)
  const mark = (x: number, y: number, z: number) => {
    const i = Math.round((x - origin[0]) / v), j = Math.round((y - origin[1]) / v), k = Math.round((z - origin[2]) / v)
    D[i + nx * (j + ny * k)] = 0
  }
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3
    const longest = Math.max(
      Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]),
      Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]),
      Math.hypot(P[c] - P[b], P[c + 1] - P[b + 1], P[c + 2] - P[b + 2]))
    // Samples half a voxel apart, so no voxel the triangle passes through is missed.
    const n = Math.max(1, Math.ceil(longest / (0.5 * v)))
    for (let s = 0; s <= n; s++) for (let t = 0; t <= n - s; t++) {
      const u = s / n, w = t / n, r = 1 - u - w
      mark(r * P[a] + u * P[b] + w * P[c], r * P[a + 1] + u * P[b + 1] + w * P[c + 1], r * P[a + 2] + u * P[b + 2] + w * P[c + 2])
    }
  }
  edt3(D, nx, ny, nz)
  return D
}

// Felzenszwalb–Huttenlocher squared distance transform along one line.
function edt1(f: Float64Array, n: number, z: Float64Array, v: Int32Array, d: Float64Array) {
  let k = 0
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let p = v[k]
    let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p)
    while (s <= z[k]) { k--; p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p) }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p] }
}

// Exact squared Euclidean distance transform in place: zero cells are the sources, 1e20 means far.
export function edt3(D: Float32Array, nx: number, ny: number, nz: number) {
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1)
  const BIG = 1e12
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const o = nx * (j + ny * k)
    for (let i = 0; i < nx; i++) f[i] = D[o + i] > 1e19 ? BIG : D[o + i]
    edt1(f, nx, z, v, d); for (let i = 0; i < nx; i++) D[o + i] = d[i]
  }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = D[i + nx * (j + ny * k)]
    edt1(f, ny, z, v, d); for (let j = 0; j < ny; j++) D[i + nx * (j + ny * k)] = d[j]
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) f[k] = D[i + nx * (j + ny * k)]
    edt1(f, nz, z, v, d); for (let k = 0; k < nz; k++) D[i + nx * (j + ny * k)] = d[k]
  }
}

// Marks every voxel reachable from the grid's edge through voxels where open() holds.
function floodOutside(nx: number, ny: number, nz: number, open: (q: number) => boolean) {
  const N = nx * ny * nz, out = new Uint8Array(N), queue = new Int32Array(N)
  let head = 0, tail = 0
  const push = (q: number) => { if (!out[q] && open(q)) { out[q] = 1; queue[tail++] = q } }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) push(i + nx * (j + ny * k))
  while (head < tail) {
    const q = queue[head++], i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0
    if (i > 0) push(q - 1); if (i < nx - 1) push(q + 1)
    if (j > 0) push(q - nx); if (j < ny - 1) push(q + nx)
    if (k > 0) push(q - nx * ny); if (k < nz - 1) push(q + nx * ny)
  }
  return out
}

// Separable [1 4 6 4 1] / 16 blur along x, y and z.
export function blur3(F: Float32Array, nx: number, ny: number, nz: number) {
  const m = Math.max(nx, ny, nz), line = new Float32Array(m), w = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
  const pass = (n: number, at: (i: number) => number) => {
    for (let i = 0; i < n; i++) line[i] = F[at(i)]
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let o = -2; o <= 2; o++) s += w[o + 2] * line[Math.min(n - 1, Math.max(0, i + o))]
      F[at(i)] = s
    }
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) pass(nx, i => i + nx * (j + ny * k))
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(ny, j => i + nx * (j + ny * k))
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(nz, k => i + nx * (j + ny * k))
}

// Surface nets: one vertex per cell the surface F = 0 passes through, one quad per crossing grid edge.
// Negative values are inside. Triangles face outward.
export function surfaceNets(F: Float32Array, grid: Grid): MeshData {
  const { nx, ny, nz, origin, v } = grid
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k)
  const cells = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const cidx = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k)
  const pos: number[] = []
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  const val = new Float32Array(8)
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0
    for (let c = 0; c < 8; c++) { const [a, b, d] = corner[c]; val[c] = F[idx(i + a, j + b, k + d)]; if (val[c] < 0) neg++ }
    if (neg === 0 || neg === 8) continue
    let x = 0, y = 0, z = 0, n = 0
    for (const [p, q] of edges) {
      const fp = val[p], fq = val[q]
      if ((fp < 0) === (fq < 0)) continue
      const t = fp / (fp - fq), A = corner[p], B = corner[q]
      x += A[0] + t * (B[0] - A[0]); y += A[1] + t * (B[1] - A[1]); z += A[2] + t * (B[2] - A[2]); n++
    }
    cells[cidx(i, j, k)] = pos.length / 3
    pos.push(origin[0] + (i + x / n) * v, origin[1] + (j + y / n) * v, origin[2] + (k + z / n) * v)
  }
  const tri: number[] = []
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const f0 = F[idx(i, j, k)], f1 = F[idx(i + 1, j, k)]
    if ((f0 < 0) === (f1 < 0)) continue
    quad(cells[cidx(i, j - 1, k - 1)], cells[cidx(i, j, k - 1)], cells[cidx(i, j, k)], cells[cidx(i, j - 1, k)], !(f0 < 0))
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const f0 = F[idx(i, j, k)], f1 = F[idx(i, j + 1, k)]
    if ((f0 < 0) === (f1 < 0)) continue
    quad(cells[cidx(i - 1, j, k - 1)], cells[cidx(i - 1, j, k)], cells[cidx(i, j, k)], cells[cidx(i, j, k - 1)], !(f0 < 0))
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const f0 = F[idx(i, j, k)], f1 = F[idx(i, j, k + 1)]
    if ((f0 < 0) === (f1 < 0)) continue
    quad(cells[cidx(i - 1, j - 1, k)], cells[cidx(i, j - 1, k)], cells[cidx(i, j, k)], cells[cidx(i - 1, j, k)], !(f0 < 0))
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tri) }
}

// A square of four voxels whose corners alternate inside, outside, inside, outside is ambiguous: surface nets would
// join four quads along one edge there, where two walls pinch. The outside corner nearest the surface moves just
// inside, joining the walls along the pinch, as the layer joins walls that touch. Repeats until no square is left.
export function joinPinches(F: Float32Array, nx: number, ny: number, nz: number, epsilon = 1e-6) {
  const sx = 1, sy = nx, sz = nx * ny
  // The two axes of each square, for squares facing x, y and z.
  const planes: [number, number, number, number, number][] = [
    [sy, sz, ny - 1, nz - 1, 0], [sx, sz, nx - 1, nz - 1, 1], [sx, sy, nx - 1, ny - 1, 2],
  ]
  let joined = 0
  for (let pass = 0; pass < 16; pass++) {
    let changed = 0
    for (const [du, dv] of planes) {
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const q = i * sx + j * sy + k * sz
        // Skip squares that would run off the grid along either axis.
        if ((du === sx && i >= nx - 1) || (du === sy && j >= ny - 1) || (dv === sy && j >= ny - 1) || (dv === sz && k >= nz - 1)) continue
        const a = F[q] < 0, b = F[q + du] < 0, c = F[q + du + dv] < 0, d = F[q + dv] < 0
        if (a !== c || b !== d || a === b) continue
        const [p1, p2] = a ? [q + du, q + dv] : [q, q + du + dv]
        const pick = F[p1] <= F[p2] ? p1 : p2
        F[pick] = -epsilon
        changed++
      }
    }
    joined += changed
    if (!changed) break
  }
  return joined
}

// Surface nets gives each cell one vertex, so two cones of the surface can meet at a single vertex (joinPinches has
// already removed edges shared by four faces). Each such vertex is split into one copy per fan of faces around it,
// and the copies are nudged a little toward their own fan, so the surface stays manifold even after an STL reader
// welds vertices by position.
export function makeManifold(mesh: MeshData): MeshData {
  const { positions, indices } = mesh
  const count = positions.length / 3
  // Faces around each vertex.
  const offsets = new Uint32Array(count + 1)
  for (let i = 0; i < indices.length; i++) offsets[indices[i] + 1]++
  for (let v = 0; v < count; v++) offsets[v + 1] += offsets[v]
  const around = new Uint32Array(indices.length), fill = offsets.slice(0, count)
  for (let i = 0; i < indices.length; i++) around[fill[indices[i]]++] = Math.floor(i / 3)
  const out = Array.from(indices)
  const extra: number[] = []
  let next = count
  for (let v = 0; v < count; v++) {
    const faces = Array.from(around.subarray(offsets[v], offsets[v + 1]))
    if (faces.length < 2) continue
    // Join faces that share an edge through this vertex. Every edge has two faces by now, so each group is one fan.
    const parent = faces.map((_, i) => i)
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]))
    const other = (f: number) => [0, 1, 2].map(j => indices[f * 3 + j]).filter(u => u !== v)
    const corners = faces.map(other)
    for (let i = 0; i < faces.length; i++) for (let k = i + 1; k < faces.length; k++) {
      if (corners[i].some(u => corners[k].includes(u))) parent[find(i)] = find(k)
    }
    const fans = new Map<number, number[]>()
    faces.forEach((f, i) => { const r = find(i); fans.set(r, [...(fans.get(r) ?? []), f]) })
    if (fans.size < 2) continue
    let first = true
    for (const fan of fans.values()) {
      // Toward the middle of the fan's other corners, a twentieth of the way.
      let cx = 0, cy = 0, cz = 0, n = 0
      for (const f of fan) for (const u of corners[faces.indexOf(f)]) { cx += positions[u * 3]; cy += positions[u * 3 + 1]; cz += positions[u * 3 + 2]; n++ }
      const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
      const moved = [p[0] + 0.05 * (cx / n - p[0]), p[1] + 0.05 * (cy / n - p[1]), p[2] + 0.05 * (cz / n - p[2])]
      const id = first ? v : next++
      if (first) { positions[v * 3] = moved[0]; positions[v * 3 + 1] = moved[1]; positions[v * 3 + 2] = moved[2] } else extra.push(...moved)
      if (!first) for (const f of fan) for (let j = 0; j < 3; j++) if (out[f * 3 + j] === v) out[f * 3 + j] = id
      first = false
    }
  }
  if (!extra.length) return mesh
  const grown = new Float32Array(positions.length + extra.length)
  grown.set(positions)
  grown.set(extra, positions.length)
  return { positions: grown, indices: Uint32Array.from(out) }
}

export function meshNeighbors(indices: ArrayLike<number>, count: number) {
  const sets = Array.from({ length: count }, () => new Set<number>())
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f], b = indices[f + 1], c = indices[f + 2]
    sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b)
  }
  const off = new Uint32Array(count + 1)
  for (let i = 0; i < count; i++) off[i + 1] = off[i] + sets[i].size
  const list = new Uint32Array(off[count])
  for (let i = 0; i < count; i++) { let k = off[i]; for (const u of sets[i]) list[k++] = u }
  return { off, list }
}

// Taubin smoothing: alternating shrink and inflate steps smooth the voxel stair-steps without shrinking the shape.
export function taubin(P: ArrayLike<number>, nb: ReturnType<typeof meshNeighbors>, iterations: number, lambda = 0.5, mu = -0.53): Float32Array<ArrayBuffer> {
  let A = Float32Array.from(P)
  const n = A.length / 3
  for (let it = 0; it < iterations; it++) for (const f of [lambda, mu]) {
    const B = new Float32Array(A.length)
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, z = 0
      const c = nb.off[i + 1] - nb.off[i]
      if (!c) { B[i * 3] = A[i * 3]; B[i * 3 + 1] = A[i * 3 + 1]; B[i * 3 + 2] = A[i * 3 + 2]; continue }
      for (let k = nb.off[i]; k < nb.off[i + 1]; k++) { const u = nb.list[k] * 3; x += A[u]; y += A[u + 1]; z += A[u + 2] }
      B[i * 3] = A[i * 3] + f * (x / c - A[i * 3]); B[i * 3 + 1] = A[i * 3 + 1] + f * (y / c - A[i * 3 + 1]); B[i * 3 + 2] = A[i * 3 + 2] + f * (z / c - A[i * 3 + 2])
    }
    A = B
  }
  return A
}

// Voxel spacing for an outer layer h out from the surface: fine enough to resolve the layer, within the budget.
export function outerVoxel(P: ArrayLike<number>, h: number) {
  const { lo, hi } = bounds(P)
  const span = hi.map((x, a) => x - lo[a])
  const radius = Math.hypot(...span) / 2 || 1
  // Never finer than a thousandth of the model, so a zero or tiny layer still gets a grid that fits.
  let v = Math.max(radius / 1000, Math.min(h / 1.6, radius / 94))
  const cells = (spacing: number) => span.reduce((product, s) => product * ((s + 2 * (h + 4 * spacing)) / spacing + 1), 1)
  while (cells(v) > VOXEL_BUDGET) v *= 1.1
  return v
}

// The outer face of everything inside the closed surface (P, I) or within h of it. Walls closer than 2h merge.
export function outerFace(P: ArrayLike<number>, I: ArrayLike<number>, options: { h: number; v?: number; blur?: number; smooth?: number }): MeshData {
  const h = Math.max(0, options.h), { v = outerVoxel(P, h), blur = 2, smooth = 12 } = options
  if (!(v > 0)) throw new Error('The voxel spacing must be positive.')
  const grid = makeGrid(P, v, h + 4 * v)
  const { nx, ny, nz } = grid, N = nx * ny * nz
  const D = surfaceDistance(P, I, grid)
  const hv2 = (h / v) ** 2
  const out = floodOutside(nx, ny, nz, q => D[q] > hv2)
  const F = new Float32Array(N)
  for (let q = 0; q < N; q++) { const d = Math.sqrt(D[q]) * v - h; F[q] = out[q] ? d : (d < 0 ? d : -v) }
  // The distances are measured to voxel centers, and that rounding shows as bumps without a little blur.
  for (let pass = 0; pass < blur; pass++) blur3(F, nx, ny, nz)
  joinPinches(F, nx, ny, nz)
  const face = makeManifold(surfaceNets(F, grid))
  if (smooth) face.positions = taubin(face.positions, meshNeighbors(face.indices, face.positions.length / 3), smooth)
  return face
}

// Rebuilds a surface as one smooth, closed shape on a grid with the given spacing. Gaps narrower than about a spacing
// are sealed, the shape is smoothed by `smoothing` blur passes, and the result is outward-facing. insideShare is the
// filled volume as a share of the volume near the surface: an open sheet, such as a vase, has almost nothing inside.
export function closedRemesh(P: ArrayLike<number>, I: ArrayLike<number>, { spacing, smoothing }: { spacing: number; smoothing: number }) {
  // Work at half the output spacing, then sample every other voxel for the output.
  const v = spacing / 2
  const close = 1.5 * v
  const pad = close + 8 * v + smoothing * v
  const grid = makeGrid(P, v, pad)
  const { nx, ny, nz } = grid, N = nx * ny * nz
  const D = surfaceDistance(P, I, grid)
  const closeV2 = (close / v) ** 2
  // Fill the outside, kept a closing radius away from the surface so it can't leak through small gaps.
  const far = floodOutside(nx, ny, nz, q => D[q] > closeV2)
  // Then grow it back by that radius, so the shape keeps its size.
  const G = new Float32Array(N)
  for (let q = 0; q < N; q++) G[q] = far[q] ? 0 : 1e20
  edt3(G, nx, ny, nz)
  let inside = 0, near = 0
  const F = new Float32Array(N)
  for (let q = 0; q < N; q++) {
    const outside = G[q] <= closeV2 + 1e-6
    const d = Math.sqrt(D[q]) * v
    F[q] = outside ? d : -d
    if (!outside && d > close) inside++
    if (d <= close) near++
  }
  for (let pass = 0; pass < smoothing; pass++) blur3(F, nx, ny, nz)
  // Sample every other voxel: the output grid at the requested spacing.
  const mx = Math.ceil(nx / 2), my = Math.ceil(ny / 2), mz = Math.ceil(nz / 2)
  const S = new Float32Array(mx * my * mz)
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++)
    S[i + mx * (j + my * k)] = F[Math.min(nx - 1, 2 * i) + nx * (Math.min(ny - 1, 2 * j) + ny * Math.min(nz - 1, 2 * k))]
  joinPinches(S, mx, my, mz)
  const mesh = makeManifold(surfaceNets(S, { nx: mx, ny: my, nz: mz, origin: grid.origin, v: spacing }))
  mesh.positions = taubin(mesh.positions, meshNeighbors(mesh.indices, mesh.positions.length / 3), 4)
  return { ...mesh, insideShare: near ? inside / near : 0 }
}

// For each vertex of a derived mesh, the nearest vertex of the source mesh, found on a hash grid of the given cell
// size. The outer layer uses it to carry the sheet's overlay colors.
export function nearestOrigins(derived: ArrayLike<number>, source: ArrayLike<number>, cell: number) {
  // Cells are packed into one number, exact below 2^53: 2^16 cells per axis, far more than any model here needs.
  const R = 1 << 16, H = R / 2
  const cellOf = (x: number) => Math.floor(x / cell) + H
  const key = (i: number, j: number, k: number) => (k * R + j) * R + i
  const buckets = new Map<number, number[]>()
  for (let v = 0; v < source.length / 3; v++) {
    const k = key(cellOf(source[v * 3]), cellOf(source[v * 3 + 1]), cellOf(source[v * 3 + 2]))
    const list = buckets.get(k)
    if (list) list.push(v); else buckets.set(k, [v])
  }
  const origin = new Uint32Array(derived.length / 3)
  for (let v = 0; v < origin.length; v++) {
    const x = derived[v * 3], y = derived[v * 3 + 1], z = derived[v * 3 + 2]
    const cx = cellOf(x), cy = cellOf(y), cz = cellOf(z)
    let best = 0, bestDistance = Infinity
    // Search outward shell by shell until one finds a point; one more shell catches a closer point just across.
    for (let ring = 0, found = -1; ring < 64 && (found < 0 || ring <= found + 1); ring++) {
      for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) for (let k = -ring; k <= ring; k++) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== ring) continue
        const list = buckets.get(key(cx + i, cy + j, cz + k))
        if (!list) continue
        for (const s of list) {
          const d = (source[s * 3] - x) ** 2 + (source[s * 3 + 1] - y) ** 2 + (source[s * 3 + 2] - z) ** 2
          if (d < bestDistance) { bestDistance = d; best = s; if (found < 0) found = ring }
        }
      }
    }
    origin[v] = best
  }
  return origin
}

// How the edges of a triangle mesh are used: a closed, consistently turned surface uses each edge exactly once in each
// direction, so open and badly turned edges both count as problems.
export function edgeProblems(indices: ArrayLike<number>) {
  const directed = new Map<number, number>()
  let n = 0
  for (let i = 0; i < indices.length; i++) n = Math.max(n, indices[i] + 1)
  for (let f = 0; f < indices.length; f += 3) for (let j = 0; j < 3; j++) {
    const a = indices[f + j], b = indices[f + (j + 1) % 3]
    directed.set(a * n + b, (directed.get(a * n + b) ?? 0) + 1)
  }
  let problems = 0
  for (const [key, count] of directed) {
    const a = Math.floor(key / n), b = key % n
    if (count !== 1 || directed.get(b * n + a) !== 1) problems++
  }
  return problems
}

// Volume enclosed by a closed mesh: positive when its triangles face outward.
export function signedVolume(P: ArrayLike<number>, I: ArrayLike<number>) {
  let volume = 0
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3
    volume += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
      + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
  }
  return volume
}
