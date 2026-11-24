import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from '../physics/growingDisk'
import {
  boundingRadius, BRAIN_LENGTH_MM, BRAIN_RADIUS, BRAIN_START_EDGE, brainErase, flatBottomErase, brainLayers, brainMechanics,
  builtInBrainSource, decodeBrainMesh, FOLD_ORDER, FOLD_SIZES, foldLength, foldMechanics, foldSizeOf, MAX_BUDGET_SCALE,
  type FoldSize,
} from './brain'
import { deserializeDiskProject, serializeDiskProject } from './diskProject'
import { edgeProblems, signedVolume } from './meshCheck'
import { ballTriangles, boxTriangles, stl } from './testStl'
import { readUpload } from './upload'

const brainFile = (size: FoldSize) => {
  const bytes = readFileSync(fileURLToPath(new URL(`../assets/brain/brain-${size}.bin`, import.meta.url)))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
const extent = (positions: ArrayLike<number>) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3], positions[i]); hi[i % 3] = Math.max(hi[i % 3], positions[i]) }
  const center = lo.map((l, a) => (l + hi[a]) / 2)
  let radius = 0
  for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, Math.hypot(positions[i] - center[0], positions[i + 1] - center[1], positions[i + 2] - center[2]))
  return { span: hi.map((h, a) => h - lo[a]), radius }
}

it('ships three closed, outward-facing built-in brains, side-on to the starting camera', () => {
  for (const size of FOLD_ORDER) {
    const { positions, indices } = decodeBrainMesh(brainFile(size))
    expect(edgeProblems(indices)).toBe(0)
    expect(signedVolume(positions, indices)).toBeGreaterThan(2.5)
    const { span, radius } = extent(positions)
    // Front to back along x, left to right along z (facing the camera), top to bottom along y.
    expect(span[0]).toBeGreaterThan(span[2])
    expect(span[2]).toBeGreaterThan(span[1])
    expect(radius).toBeCloseTo(BRAIN_RADIUS, 1)
  }
  const fine = decodeBrainMesh(brainFile('fine')), broad = decodeBrainMesh(brainFile('broad'))
  expect(fine.positions.length).toBeGreaterThan(2 * broad.positions.length)
  const medium = builtInBrainSource(brainFile('medium'), 'medium')
  expect(extent(medium.positions).span[0] * medium.scale).toBeCloseTo(BRAIN_LENGTH_MM, 6)
  expect(medium.brain).toEqual({ builtin: true, foldSize: 'medium' })
  expect(() => decodeBrainMesh(new ArrayBuffer(20))).toThrow('damaged')
})

it('keeps the inner walls and the middle of the base from growing on the built-in brain', () => {
  const rest = Float32Array.of(0.3, 0.5, 0.0, 0.3, 0.5, 0.8, 0.0, -0.6, 0.1, 0.0, 0.2, 0.6)
  expect(Array.from(brainErase(rest), e => Number(e.toFixed(3)))).toEqual([1, 0, 1, 0])
})

it('folds the built-in brain with the recipe while its midline stays put', () => {
  const source = builtInBrainSource(brainFile('broad'), 'broad')
  const disk = createGrowingDisk(source, BRAIN_START_EDGE)
  // The starting edge length keeps the packed mesh as it is.
  expect(disk.splits).toBe(0)
  disk.setLayers(brainLayers())
  disk.paint.erase.set(brainErase(disk.rest))
  disk.setLayers(disk.layers)
  disk.setMechanics(brainMechanics(DISK_DEFAULTS, 'broad'))
  const start = disk.positions.slice()
  const midline = [...disk.field.keys()].filter(v => disk.field[v] === 0)
  expect(midline.length).toBeGreaterThan(50)
  for (let i = 0; i < 40; i++) disk.step(true)
  expect(disk.strain).toBeGreaterThan(0.1)
  expect(disk.rejectedSteps).toBeLessThan(5)
  const moved = (vertices: number[]) => vertices.reduce((sum, v) => sum + Math.hypot(
    disk.positions[v * 3] - start[v * 3], disk.positions[v * 3 + 1] - start[v * 3 + 1], disk.positions[v * 3 + 2] - start[v * 3 + 2]), 0) / vertices.length
  const growing = [...disk.field.keys()].filter(v => v < start.length / 3 && disk.field[v] === 1)
  expect(moved(growing)).toBeGreaterThan(3 * moved(midline))
}, 60000)

it('grows a brain on at another fold size from where it is, with room for the finer mesh', () => {
  for (const size of FOLD_ORDER) expect(foldSizeOf(FOLD_SIZES[size].remeshLength)).toBe(size)
  expect(foldSizeOf(0.1)).toBeNull()
  const broadRecipe = brainMechanics(DISK_DEFAULTS, 'broad')
  const toFine = foldMechanics(broadRecipe, 'fine', FOLD_SIZES.broad.remeshLength)
  expect(toFine.remeshLength).toBe(FOLD_SIZES.fine.remeshLength)
  expect(toFine.budgetScale).toBeCloseTo((0.11 / 0.07) ** 2, 9)
  expect(toFine.coreStiffness).toBe(broadRecipe.coreStiffness)
  // Going back to a broader size keeps the raised limit, so growth isn't stopped at the vertices it already has.
  expect(foldMechanics(toFine, 'broad', FOLD_SIZES.broad.remeshLength).budgetScale).toBe(toFine.budgetScale)
  // A broader size keeps the vertex limit, so growth isn't stopped at the vertices it already has.
  expect(foldMechanics(brainMechanics(DISK_DEFAULTS, 'fine'), 'broad', FOLD_SIZES.fine.remeshLength).budgetScale).toBe(1)
  expect(brainMechanics(toFine, 'medium').budgetScale).toBe(1)

  // Grow a broad brain, then carry on from the same state at Broad and at Fine.
  const source = builtInBrainSource(brainFile('broad'), 'broad')
  const disk = createGrowingDisk(source, BRAIN_START_EDGE)
  disk.setLayers(brainLayers())
  disk.paint.erase.set(brainErase(disk.rest))
  disk.setLayers(disk.layers)
  disk.setMechanics(broadRecipe)
  for (let i = 0; i < 60; i++) disk.step(true)
  const snapshot = disk.snapshot()
  const broad = createGrowingDisk(source, BRAIN_START_EDGE, snapshot), fine = createGrowingDisk(source, BRAIN_START_EDGE, snapshot)
  broad.setMechanics(broadRecipe)
  fine.setMechanics(toFine)
  expect(fine.growthBudget).toBeCloseTo(broad.growthBudget * toFine.budgetScale, -1)
  for (let i = 0; i < 40; i++) { broad.step(true); fine.step(true) }
  expect(fine.clock).toBe(100)
  // Nothing starts over: the shape it had is kept, and the finer split length adds vertices as it grows.
  expect(fine.positions.length).toBeGreaterThan(1.2 * broad.positions.length)
  expect(fine.rejectedSteps).toBeLessThan(5)
}, 60000)

it('scales Fold size to the shape, so a size gives folds of the same size compared with any shape', () => {
  // The built-in brain keeps the reel's lengths; an upload, which has radius 1, gets them scaled down.
  const brain = builtInBrainSource(brainFile('medium'), 'medium')
  expect(boundingRadius(brain.positions)).toBeCloseTo(BRAIN_RADIUS, 2)
  expect(foldLength('medium')).toBe(FOLD_SIZES.medium.remeshLength)
  const { source } = readUpload(stl(ballTriangles(3)), 'ball.stl')
  const radius = boundingRadius(source.positions)
  expect(radius).toBeCloseTo(1, 6)
  expect(foldLength('medium', radius)).toBeCloseTo(0.09 / 1.173, 6)
  expect(brainMechanics(DISK_DEFAULTS, 'fine', radius).remeshLength).toBeCloseTo(0.07 / 1.173, 6)
  for (const size of FOLD_ORDER) expect(foldSizeOf(foldLength(size, radius), radius)).toBe(size)
  // A length a little off still matches, as with a shape measured a little differently, but other lengths don't.
  expect(foldSizeOf(0.0706)).toBe('fine')
  expect(foldSizeOf(0.1)).toBeNull()
  // From the sheet's split length to Fine would need about 5.9 times the vertices; the limit stops at 4.
  expect(foldMechanics(DISK_DEFAULTS, 'fine', DISK_DEFAULTS.remeshLength, radius).budgetScale).toBe(MAX_BUDGET_SCALE)
  expect(MAX_BUDGET_SCALE).toBeLessThan((DISK_DEFAULTS.remeshLength / foldLength('fine', radius)) ** 2)
})

it('grows a closed upload as it is with the Brain folds recipe, staying one closed surface', () => {
  // A 40 mm ball: brain mode used to rebuild it on a voxel grid; now its own triangles grow.
  const { source, closed } = readUpload(stl(ballTriangles(3)), 'ball.stl')
  expect(closed).toBe(true)
  const radius = boundingRadius(source.positions)
  const settings = brainMechanics(DISK_DEFAULTS, 'medium', radius)
  const disk = createGrowingDisk(source, settings.remeshLength)
  expect(disk.initialOverlap).toBe(false)
  disk.setLayers(brainLayers())
  disk.setMechanics(settings)
  for (let i = 0; i < 40; i++) disk.step(true)
  expect(disk.strain).toBeGreaterThan(0.1)
  expect(disk.rejectedSteps).toBeLessThan(5)
  expect(edgeProblems(disk.indices)).toBe(0)
  expect(signedVolume(disk.positions, disk.indices)).toBeGreaterThan(signedVolume(source.positions, source.indices))
  // A thin plate grows as itself too: 2 mm walls, as on a pen holder, start intact.
  const plate = readUpload(stl(boxTriangles(60, 40, 2)), 'plate.stl')
  expect(plate.closed).toBe(true)
  expect(createGrowingDisk(plate.source, foldLength('medium', 1)).initialOverlap).toBe(false)
}, 60000)

it('saves and reopens a brain project with its core and brain settings, and opens older projects without them', () => {
  const source = builtInBrainSource(brainFile('broad'), 'broad')
  const mechanics = brainMechanics(DISK_DEFAULTS, 'broad')
  const disk = createGrowingDisk(source, BRAIN_START_EDGE)
  disk.setLayers(brainLayers())
  disk.setMechanics(mechanics)
  disk.step(true)
  const settings = { relaxing: false, view: 'smooth' as const, speed: 3, batch: 100, importSpeed: 1, importBatch: 10 }
  const json = serializeDiskProject({
    source: { ...source, positions: Array.from(source.positions), indices: Array.from(source.indices) },
    disk: disk.snapshot(), mechanics, revision: 1, ...settings,
  })
  const project = deserializeDiskProject(json)
  expect(project.source?.brain).toEqual({ builtin: true, foldSize: 'broad' })
  expect(project.mechanics.coreStiffness).toBe(0.005)
  expect(project.mechanics.budgetScale).toBe(1)
  expect(project.disk.layers?.[0].kind).toBe('surface')
  const old = JSON.parse(json)
  delete old.mechanics.coreStiffness
  delete old.mechanics.coreGrowth
  delete old.mechanics.budgetScale
  delete old.source.brain
  const reopened = deserializeDiskProject(JSON.stringify(old))
  expect(reopened.mechanics.coreStiffness).toBe(0)
  expect(reopened.mechanics.budgetScale).toBe(1)
  expect(reopened.source?.brain).toBeUndefined()
  // An upload that brain mode rebuilt before 0.16.0 opens as an ordinary closed shape.
  const rebuilt = JSON.parse(json)
  rebuilt.source.brain = { builtin: false, foldSize: 'medium', smoothing: 'light' }
  expect(deserializeDiskProject(JSON.stringify(rebuilt)).source?.brain).toBeUndefined()
  const bad = JSON.parse(json)
  bad.source.brain.foldSize = 'huge'
  expect(() => deserializeDiskProject(JSON.stringify(bad))).toThrow('invalid design data')
  // A Fold size changed while growing is saved in the settings; a limit scale out of range is refused.
  const changed = deserializeDiskProject(serializeDiskProject({ ...JSON.parse(json), mechanics: foldMechanics(mechanics, 'fine', FOLD_SIZES.broad.remeshLength) }))
  expect(foldSizeOf(changed.mechanics.remeshLength)).toBe('fine')
  const huge = JSON.parse(json)
  huge.mechanics.budgetScale = 9
  expect(() => deserializeDiskProject(JSON.stringify(huge))).toThrow('invalid design data')
}, 30000)

describe('flatBottomErase', () => {
  // An open pot, Y up: a flat bottom of radius 1 and a wall 2 tall, open on top.
  function pot(flat = true) {
    const positions: number[] = [0, flat ? 0 : -0.3, 0], indices: number[] = [], ring = 24, rows = 10
    for (let j = 0; j <= rows; j++) for (let k = 0; k < ring; k++) {
      const a = 2 * Math.PI * k / ring, y = 2 * j / rows
      positions.push(Math.cos(a), flat ? y : y + 0.3 * (j === 0 ? 0 : 0), Math.sin(a))
    }
    const at = (j: number, k: number) => 1 + j * ring + (k % ring)
    for (let k = 0; k < ring; k++) indices.push(0, at(0, k + 1), at(0, k))
    for (let j = 0; j < rows; j++) for (let k = 0; k < ring; k++) indices.push(at(j, k), at(j, k + 1), at(j + 1, k + 1), at(j, k), at(j + 1, k + 1), at(j + 1, k))
    return { rest: Float32Array.from(positions), indices: Uint32Array.from(indices) }
  }

  it('keeps a flat bottom and the lowest fifth of the wall from growing, and the rest grows', () => {
    const { rest, indices } = pot(), erase = flatBottomErase(rest, indices)!
    expect(erase).not.toBeNull()
    for (let v = 0; v < erase.length; v++) {
      const y = rest[v * 3 + 1] / 2 // as a share of the height
      if (y <= 0.2) expect(erase[v]).toBeCloseTo(1, 6)
      if (y >= 0.3) expect(erase[v]).toBeCloseTo(0, 6)
    }
  })

  it('leaves a shape alone when it doesn\'t stand on a flat bottom', () => {
    // The same pot with its bottom pushed down into a cone: nothing lies flat at the lowest level.
    const { rest, indices } = pot(false)
    expect(flatBottomErase(rest, indices)).toBeNull()
  })
})
