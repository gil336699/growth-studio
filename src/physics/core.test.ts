import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from './growingDisk'
import { combineField, createLayer, layerWeights, validLayers } from './growthLayers'

// A closed unit sphere: 642 vertices after three subdivisions of an icosahedron.
function icosphere(levels = 3) {
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
  return { positions: Float32Array.from(v.flat()), indices: Uint32Array.from(f.flat()) }
}

const sphereGrowth = (core: number, coreGrowth = 0.1) => {
  const disk = createGrowingDisk(icosphere(), 1)
  disk.setMechanics({ ...DISK_DEFAULTS, bending: 0.2, remeshLength: 0.2, coreStiffness: core, coreGrowth })
  disk.setLayers([createLayer('surface'), createLayer('paint')])
  return disk
}
// Mean distance from the center, and how much it varies: a smooth balloon varies little, a folded surface a lot.
const radii = (positions: Float32Array) => {
  const r: number[] = []
  for (let i = 0; i < positions.length; i += 3) r.push(Math.hypot(positions[i], positions[i + 1], positions[i + 2]))
  const mean = r.reduce((a, b) => a + b, 0) / r.length
  return { mean, spread: Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length) }
}

it('folds a growing closed shape over a core instead of inflating it', () => {
  const balloon = sphereGrowth(0), brain = sphereGrowth(0.005)
  for (let i = 0; i < 150; i++) { balloon.step(true); brain.step(true) }
  expect(balloon.strain).toBeCloseTo(brain.strain, 6)
  const inflated = radii(balloon.positions), folded = radii(brain.positions)
  // Without a core the sphere swells smoothly; with one it stays near its size and buckles.
  expect(inflated.mean).toBeGreaterThan(1.35)
  expect(inflated.spread).toBeLessThan(0.02)
  expect(folded.mean).toBeLessThan(1.25)
  expect(folded.spread).toBeGreaterThan(0.08)
}, 60000)

it('lets the core grow with the surface by Core growth', () => {
  const slow = sphereGrowth(0.005, 0.1), fast = sphereGrowth(0.005, 0.5)
  for (let i = 0; i < 150; i++) { slow.step(true); fast.step(true) }
  expect(radii(fast.positions).mean).toBeGreaterThan(radii(slow.positions).mean + 0.1)
}, 60000)

it('continues a reopened model with a core exactly as an uninterrupted run', () => {
  const steady = sphereGrowth(0.005), first = sphereGrowth(0.005)
  for (let i = 0; i < 100; i++) { steady.step(true); first.step(true) }
  // Splits have added midpoints to the starting shape by now, which must not move the core's center.
  expect(first.splits).toBeGreaterThan(0)
  const reopened = createGrowingDisk(icosphere(), 1, first.snapshot())
  reopened.setMechanics({ ...DISK_DEFAULTS, bending: 0.2, remeshLength: 0.2, coreStiffness: 0.005, coreGrowth: 0.1 })
  for (let i = 0; i < 40; i++) { steady.step(true); reopened.step(true) }
  expect(Array.from(reopened.positions)).toEqual(Array.from(steady.positions))
}, 60000)

it('grows every vertex with a Whole surface layer, and erase still masks it', () => {
  const { positions, indices } = icosphere(1)
  const neighbors: number[][] = Array.from({ length: positions.length / 3 }, () => [])
  for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) neighbors[indices[i + j]].push(indices[i + (j + 1) % 3])
  const surface = createLayer('surface')
  const weights = layerWeights(surface, { rest: positions, neighbors, rims: [] })
  expect(weights.every(w => w === 1)).toBe(true)
  const count = positions.length / 3
  const erase = new Float32Array(count)
  erase[0] = 1
  const field = combineField(new Float32Array(count), [surface, createLayer('paint')], new Map([[surface.id, weights]]),
    { add: new Float32Array(count), erase }, 0)
  expect(field[0]).toBe(0)
  expect(field.slice(1).every(w => w === 1)).toBe(true)
  expect(validLayers([surface, createLayer('paint')])).toBe(true)
})
