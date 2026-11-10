import { expect, it } from 'vitest'
import { closedRemesh, edgeProblems, fillCavities, joinPinches, makeManifold, nearestOrigins, outerFace, outerVoxel, signedVolume, surfaceNets } from './voxel'

function icosphere(levels: number, radius = 1, center = [0, 0, 0]) {
  const t = (1 + Math.sqrt(5)) / 2
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  const unit = (p: number[]) => { const l = Math.hypot(...p); return p.map(c => c / l) }
  v = v.map(unit)
  for (let level = 0; level < levels; level++) {
    const cache = new Map<string, number>()
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      let i = cache.get(key)
      if (i === undefined) { i = v.length; v.push(unit(v[a].map((c, j) => (c + v[b][j]) / 2))); cache.set(key, i) }
      return i
    }
    f = f.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] })
  }
  return { positions: Float32Array.from(v.flatMap(p => p.map((c, j) => c * radius + center[j]))), indices: Uint32Array.from(f.flat()) }
}

// Number of separate pieces in a mesh, by joining triangles that share a vertex.
function pieces(indices: Uint32Array, count: number) {
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (a: number): number => parent[a] === a ? a : (parent[a] = find(parent[a]))
  for (let f = 0; f < indices.length; f += 3) { parent[find(indices[f])] = find(indices[f + 1]); parent[find(indices[f + 1])] = find(indices[f + 2]) }
  return new Set(Array.from(indices, i => find(i))).size
}

it('builds a watertight, outward-facing outer layer at the requested distance', () => {
  const sphere = icosphere(3)
  const face = outerFace(sphere.positions, sphere.indices, { h: 0.05 })
  expect(edgeProblems(face.indices)).toBe(0)
  // A sphere of radius 1.05, within the faceting of the input and the voxel rounding.
  expect(signedVolume(face.positions, face.indices) / (4 / 3 * Math.PI * 1.05 ** 3)).toBeGreaterThan(0.95)
  expect(signedVolume(face.positions, face.indices) / (4 / 3 * Math.PI * 1.05 ** 3)).toBeLessThan(1.03)
  let mean = 0
  for (let i = 0; i < face.positions.length; i += 3) mean += Math.hypot(face.positions[i], face.positions[i + 1], face.positions[i + 2])
  expect(mean / (face.positions.length / 3)).toBeCloseTo(1.05, 1)
}, 60000)

it('cuts a flat base: the bottom is one plane at the cut, and the solid stays watertight', () => {
  const sphere = icosphere(3)
  const h = 0.05, cut = 0.3
  const face = outerFace(sphere.positions, sphere.indices, { h, cut })
  expect(edgeProblems(face.indices)).toBe(0)
  // The layer's lowest point was at y = -1.05, so the base is at -0.75: a disk about 0.73 across in radius.
  const floor = -1 - h + cut, P = face.positions
  let low = Infinity, area = 0
  for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i])
  for (let f = 0; f < face.indices.length; f += 3) {
    const [a, b, c] = [0, 1, 2].map(k => face.indices[f + k] * 3)
    if (![a, b, c].every(v => Math.abs(P[v + 1] - floor) < 1e-5)) continue
    area += Math.abs((P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2])) / 2
  }
  expect(low).toBeCloseTo(floor, 5)
  // Smoothing rounds the base's edge a little, so a bit less than the full disk lies flat.
  expect(area).toBeGreaterThan(0.75 * Math.PI * (1.05 ** 2 - 0.75 ** 2))
  expect(area).toBeLessThan(Math.PI * (1.05 ** 2 - 0.75 ** 2))
  // The cut takes off a cap of the sphere and nothing else.
  const whole = signedVolume(outerFace(sphere.positions, sphere.indices, { h }).positions, outerFace(sphere.positions, sphere.indices, { h }).indices)
  const capVolume = Math.PI * cut ** 2 * (3 * 1.05 - cut) / 3
  expect(signedVolume(P, face.indices)).toBeCloseTo(whole - capVolume, 1)
}, 60000)

it('fills a bubble sealed inside the solid, and leaves the outside and open pockets alone', () => {
  // A 12³ grid: a solid block with a sealed bubble in it, and a pocket open to the outside along +x.
  const n = 12, F = new Float32Array(n ** 3).fill(1)
  const at = (i: number, j: number, k: number) => i + n * (j + n * k)
  for (let k = 2; k < 10; k++) for (let j = 2; j < 10; j++) for (let i = 2; i < 10; i++) F[at(i, j, k)] = -1
  F[at(4, 4, 4)] = F[at(5, 4, 4)] = 0.5
  for (let i = 7; i < 10; i++) F[at(i, 7, 7)] = 0.5
  expect(fillCavities(F, n, n, n)).toBe(2)
  expect(F[at(4, 4, 4)]).toBeLessThan(0)
  expect(F[at(5, 4, 4)]).toBeLessThan(0)
  expect(F[at(8, 7, 7)]).toBeGreaterThan(0)
  expect(F[at(0, 0, 0)]).toBeGreaterThan(0)
})

it('merges walls that come closer than the layer is thick into one solid', () => {
  // Two spheres 0.06 apart: a 0.05 layer around each closes the gap, a 0.01 layer leaves it open.
  const a = icosphere(3, 0.5, [-0.53, 0, 0]), b = icosphere(3, 0.5, [0.53, 0, 0])
  const positions = Float32Array.from([...a.positions, ...b.positions])
  const indices = Uint32Array.from([...a.indices, ...Array.from(b.indices, i => i + a.positions.length / 3)])
  const thick = outerFace(positions, indices, { h: 0.05 }), thin = outerFace(positions, indices, { h: 0.01 })
  expect(pieces(thick.indices, thick.positions.length / 3)).toBe(1)
  expect(pieces(thin.indices, thin.positions.length / 3)).toBe(2)
  expect(edgeProblems(thick.indices)).toBe(0)
}, 60000)

it('rebuilds a sphere with a hole as a closed, smooth surface at the chosen spacing', () => {
  const sphere = icosphere(4)
  // Cut out one triangle at the top, about 0.075 on a side: a crack the closing radius seals.
  const kept: number[] = []
  let cut = false
  for (let f = 0; f < sphere.indices.length; f += 3) {
    if (!cut && sphere.positions[sphere.indices[f] * 3 + 1] > 0.9995) { cut = true; continue }
    kept.push(sphere.indices[f], sphere.indices[f + 1], sphere.indices[f + 2])
  }
  expect(kept.length).toBeLessThan(sphere.indices.length)
  const rebuilt = closedRemesh(sphere.positions, Uint32Array.from(kept), { spacing: 0.055, smoothing: 2 })
  expect(edgeProblems(rebuilt.indices)).toBe(0)
  expect(rebuilt.insideShare).toBeGreaterThan(1)
  expect(signedVolume(rebuilt.positions, rebuilt.indices) / (4 / 3 * Math.PI)).toBeGreaterThan(0.94)
  expect(signedVolume(rebuilt.positions, rebuilt.indices) / (4 / 3 * Math.PI)).toBeLessThan(1.04)
  // Spacing sets the mesh size: a unit sphere has about 4π / (0.055² × 0.5) ≈ 8,000 vertices at this spacing.
  expect(rebuilt.positions.length / 3).toBeGreaterThan(3000)
  expect(rebuilt.positions.length / 3).toBeLessThan(9000)
}, 60000)

it('reports an open sheet as having almost nothing inside', () => {
  const sphere = icosphere(3)
  const bowl: number[] = []
  for (let f = 0; f < sphere.indices.length; f += 3) {
    if (sphere.positions[sphere.indices[f] * 3 + 1] > 0) continue
    bowl.push(sphere.indices[f], sphere.indices[f + 1], sphere.indices[f + 2])
  }
  const rebuilt = closedRemesh(sphere.positions, Uint32Array.from(bowl), { spacing: 0.055, smoothing: 2 })
  expect(rebuilt.insideShare).toBeLessThan(0.3)
}, 60000)

it('finds the nearest source vertex for each derived vertex', () => {
  const source = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5)
  const derived = Float32Array.of(0.1, 0, 0, 0.9, 0.05, 0, 0.02, 0.8, 0, 4.2, 4.9, 5.1, -3, -3, -3)
  expect(Array.from(nearestOrigins(derived, source, 0.25))).toEqual([0, 1, 2, 3, 0])
})

it('finishes with a layer of zero thickness instead of searching for a spacing forever', () => {
  const sphere = icosphere(2)
  expect(outerVoxel(sphere.positions, 0)).toBeGreaterThan(0)
  const face = outerFace(sphere.positions, sphere.indices, { h: 0 })
  expect(edgeProblems(face.indices)).toBe(0)
}, 10000)

it('splits a vertex where two parts of the surface meet at a point, so it stays apart even welded by position', () => {
  // Two closed tetrahedra that share only vertex 0, as surface nets makes where two cones of the surface meet in one cell.
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0.5, 1, 0.3, 0.5, 0.2, 1, -1, 0, 0, -0.5, -1, 0.3, -0.5, -0.2, -1)
  const indices = Uint32Array.of(0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2, 0, 4, 5, 0, 5, 6, 0, 6, 4, 4, 6, 5)
  const fixed = makeManifold({ positions: positions.slice(), indices })
  expect(fixed.positions.length).toBe(positions.length + 3)
  const firstUses = new Set(Array.from(fixed.indices.subarray(0, 12))), secondUses = new Set(Array.from(fixed.indices.subarray(12)))
  expect([...firstUses].some(v => secondUses.has(v))).toBe(false)
  const copy = Array.from(fixed.indices.subarray(12)).find(v => v >= 7)!
  expect(Math.hypot(fixed.positions[0] - fixed.positions[copy * 3], fixed.positions[1] - fixed.positions[copy * 3 + 1], fixed.positions[2] - fixed.positions[copy * 3 + 2])).toBeGreaterThan(0)
  expect(edgeProblems(fixed.indices)).toBe(0)
})

it('joins two walls that pinch along a line, so no edge is shared by four faces', () => {
  // Two columns of inside voxels that touch only along an edge, diagonally: the squares between them alternate signs.
  const n = 6, F = new Float32Array(n * n * n).fill(1)
  for (let k = 1; k <= 4; k++) { F[1 + n * (1 + n * k)] = -1; F[2 + n * (2 + n * k)] = -1 }
  const grid = { nx: n, ny: n, nz: n, origin: [0, 0, 0] as [number, number, number], v: 1 }
  expect(edgeProblems(surfaceNets(F, grid).indices)).toBeGreaterThan(0)
  expect(joinPinches(F, n, n, n)).toBeGreaterThan(0)
  expect(edgeProblems(surfaceNets(F, grid).indices)).toBe(0)
})

it('keeps a smooth surface smooth: the layer around a sphere has no voxel terraces', () => {
  // Measured to voxel centers, the layer's normals tilted 1.8° RMS from radial in rings a voxel apart; measured to the
  // surface itself they tilt under 1°.
  const sphere = icosphere(5)
  const face = outerFace(sphere.positions, sphere.indices, { h: 0.02 })
  const P = face.positions, I = face.indices, N = new Float64Array(P.length)
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    for (const o of [a, b, c]) { N[o] += uy * vz - uz * vy; N[o + 1] += uz * vx - ux * vz; N[o + 2] += ux * vy - uy * vx }
  }
  let sum = 0
  for (let i = 0; i < P.length; i += 3) {
    const cos = (N[i] * P[i] + N[i + 1] * P[i + 1] + N[i + 2] * P[i + 2]) / (Math.hypot(N[i], N[i + 1], N[i + 2]) * Math.hypot(P[i], P[i + 1], P[i + 2]))
    sum += Math.acos(Math.min(1, cos)) ** 2
  }
  expect(Math.sqrt(sum / (P.length / 3)) * 180 / Math.PI).toBeLessThan(1.2)
}, 60000)

it('counts a thin closed plate as closed, not as an open sheet', () => {
  // A box 2 × 0.09 × 1.2 units, like a tag: barely anything inside is deeper than the closing radius.
  const [x, y, z] = [1, 0.045, 0.6]
  const positions = Float32Array.of(-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z)
  const indices = Uint32Array.of(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3)
  expect(closedRemesh(positions, indices, { spacing: 0.055, smoothing: 1 }).insideShare).toBeGreaterThan(0.3)
}, 60000)
