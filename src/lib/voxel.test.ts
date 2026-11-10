import { expect, it } from 'vitest'
import { closedRemesh, edgeProblems, nearestOrigins, outerFace, signedVolume } from './voxel'

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
}, 20000)

it('merges walls that come closer than the layer is thick into one solid', () => {
  // Two spheres 0.06 apart: a 0.05 layer around each closes the gap, a 0.01 layer leaves it open.
  const a = icosphere(3, 0.5, [-0.53, 0, 0]), b = icosphere(3, 0.5, [0.53, 0, 0])
  const positions = Float32Array.from([...a.positions, ...b.positions])
  const indices = Uint32Array.from([...a.indices, ...Array.from(b.indices, i => i + a.positions.length / 3)])
  const thick = outerFace(positions, indices, { h: 0.05 }), thin = outerFace(positions, indices, { h: 0.01 })
  expect(pieces(thick.indices, thick.positions.length / 3)).toBe(1)
  expect(pieces(thin.indices, thin.positions.length / 3)).toBe(2)
  expect(edgeProblems(thick.indices)).toBe(0)
}, 20000)

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
}, 20000)

it('reports an open sheet as having almost nothing inside', () => {
  const sphere = icosphere(3)
  const bowl: number[] = []
  for (let f = 0; f < sphere.indices.length; f += 3) {
    if (sphere.positions[sphere.indices[f] * 3 + 1] > 0) continue
    bowl.push(sphere.indices[f], sphere.indices[f + 1], sphere.indices[f + 2])
  }
  const rebuilt = closedRemesh(sphere.positions, Uint32Array.from(bowl), { spacing: 0.055, smoothing: 2 })
  expect(rebuilt.insideShare).toBeLessThan(0.3)
}, 20000)

it('finds the nearest source vertex for each derived vertex', () => {
  const source = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5)
  const derived = Float32Array.of(0.1, 0, 0, 0.9, 0.05, 0, 0.02, 0.8, 0, 4.2, 4.9, 5.1, -3, -3, -3)
  expect(Array.from(nearestOrigins(derived, source, 0.25))).toEqual([0, 1, 2, 3, 0])
})
