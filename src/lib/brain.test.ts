import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from '../physics/growingDisk'
import {
  BRAIN_LENGTH_MM, BRAIN_RADIUS, BRAIN_START_EDGE, brainErase, brainFromStl, brainLayers, brainMechanics,
  builtInBrainSource, decodeBrainMesh, FOLD_ORDER, OpenShapeError, type FoldSize,
} from './brain'
import { deserializeDiskProject, serializeDiskProject } from './diskProject'
import { edgeProblems, signedVolume } from './voxel'

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

// A binary STL of a closed, Z-up shape: an octahedron stretched 40 × 30 × 20 mm, or its upper half as an open sheet.
function octahedronStl(open = false) {
  const p = [[20, 0, 0], [-20, 0, 0], [0, 15, 0], [0, -15, 0], [0, 0, 10], [0, 0, -10]]
  const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]].slice(0, open ? 4 : 8)
  const buffer = new ArrayBuffer(84 + faces.length * 50), view = new DataView(buffer)
  view.setUint32(80, faces.length, true)
  faces.forEach((face, f) => face.forEach((vertex, k) => p[vertex].forEach((c, a) => view.setFloat32(84 + f * 50 + 12 + k * 12 + a * 4, c, true))))
  return buffer
}

it('rebuilds an uploaded STL as a closed brain-sized shape that keeps its millimeters', () => {
  const source = brainFromStl(octahedronStl(), 'diamond.stl', 'medium', 'light')
  expect(edgeProblems(source.indices)).toBe(0)
  expect(signedVolume(source.positions, source.indices)).toBeGreaterThan(0)
  // Scaled to the built-in brain's size; the rebuild rounds off the sharp tips a little.
  expect(extent(source.positions).radius).toBeGreaterThan(0.9 * BRAIN_RADIUS)
  expect(extent(source.positions).radius).toBeLessThan(1.02 * BRAIN_RADIUS)
  // 20 mm from the center to the tip, so export sizes stay in the STL's millimeters.
  expect(source.scale * BRAIN_RADIUS).toBeCloseTo(20, 0)
  // Z-up in the STL becomes Y-up in the app: the 10 mm half-height is now along y.
  const { span } = extent(source.positions)
  expect(span[1]).toBeLessThan(span[2])
  expect(source.brain).toEqual({ builtin: false, foldSize: 'medium', smoothing: 'light' })
  expect(() => brainFromStl(octahedronStl(true), 'tent.stl', 'medium', 'light')).toThrow(OpenShapeError)
})

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
  expect(project.disk.layers?.[0].kind).toBe('surface')
  const old = JSON.parse(json)
  delete old.mechanics.coreStiffness
  delete old.mechanics.coreGrowth
  delete old.source.brain
  const reopened = deserializeDiskProject(JSON.stringify(old))
  expect(reopened.mechanics.coreStiffness).toBe(0)
  expect(reopened.source?.brain).toBeUndefined()
  const bad = JSON.parse(json)
  bad.source.brain.foldSize = 'huge'
  expect(() => deserializeDiskProject(JSON.stringify(bad))).toThrow('invalid design data')
}, 30000)
