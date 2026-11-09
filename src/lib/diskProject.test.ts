import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from '../physics/growingDisk'
import { createLayer } from '../physics/growthLayers'
import { deserializeDiskProject, serializeDiskProject, THICKNESS_DEFAULTS, type DiskProject } from './diskProject'

const settings = { relaxing: false, view: 'triangles' as const, speed: 3, batch: 100, importSpeed: 1, importBatch: 10 }
const sheet = () => ({
  name: 'Sheet.stl', scale: 10,
  positions: Float32Array.of(0, 0, 0, 0.3, 0, 0, 0, 0, 0.3),
  indices: Uint32Array.of(0, 1, 2),
})
const source = (input: ReturnType<typeof sheet>) => ({ ...input, positions: Array.from(input.positions), indices: Array.from(input.indices) })

it('reopens a painted surface with its layers and resumes from the same solver state', () => {
  const input = sheet()
  const mechanics = { ...DISK_DEFAULTS, gravity: 0.15, gravityTilt: 30 }
  const disk = createGrowingDisk(input)
  disk.paintStroke(disk.brushFootprint(0, [0, 0, 0], 0.03), 'erase')
  disk.setMechanics(mechanics)
  for (let step = 0; step < 19; step++) disk.step(true)

  const json = serializeDiskProject({ source: source(input), disk: disk.snapshot(), mechanics, revision: 19, ...settings })
  const project = deserializeDiskProject(json)
  const reopened = createGrowingDisk(project.source!, mechanics.remeshLength, project.disk)
  reopened.setMechanics(project.mechanics)
  expect(reopened.snapshot()).toEqual(disk.snapshot())
  expect(reopened.layers).toEqual(disk.layers)
  expect(reopened.hasPaint).toBe(true)
  expect(reopened.field[reopened.nearestVertex([0, 0, 0])]).toBe(0)
  disk.step(true)
  reopened.step(true)
  expect(reopened.snapshot()).toEqual(disk.snapshot())

  const invalid = JSON.parse(json)
  invalid.disk.indices[0] = 999_999
  expect(() => deserializeDiskProject(JSON.stringify(invalid))).toThrow('invalid design data')
  const badLayer = JSON.parse(json)
  badLayer.disk.layers[0].width = -1
  expect(() => deserializeDiskProject(JSON.stringify(badLayer))).toThrow('invalid design data')
})

// An open tube with an upper and a lower rim.
const tube = () => {
  const positions = Float32Array.of(
    -0.2, 0, -0.2, 0.2, 0, -0.2, 0.2, 0, 0.2, -0.2, 0, 0.2,
    -0.2, 0.3, -0.2, 0.2, 0.3, -0.2, 0.2, 0.3, 0.2, -0.2, 0.3, 0.2,
  )
  const indices = Uint32Array.of(0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7, 3, 7, 0, 0, 7, 4)
  return { name: 'Tube.stl', scale: 1, positions, indices }
}

it('grows only the upper rim layer through splits and reopening', () => {
  const input = tube()
  const disk = createGrowingDisk(input)
  expect(disk.openRims).toHaveLength(2)
  const [upper, lower] = disk.openRims
  disk.setLayers([createLayer('rim', { rim: 0, width: 0.2 }), createLayer('paint')])
  expect(upper.vertices.every(vertex => disk.field[vertex] === 1)).toBe(true)
  expect(lower.vertices.every(vertex => disk.field[vertex] === 0)).toBe(true)
  disk.setMechanics({ ...DISK_DEFAULTS, remeshLength: 0.09 })
  for (let i = 0; i < 20; i++) disk.step(true)
  expect(disk.splits).toBeGreaterThan(0)
  expect(lower.vertices.every(vertex => disk.field[vertex] === 0)).toBe(true)

  const json = serializeDiskProject({ source: source(input), disk: disk.snapshot(), mechanics: DISK_DEFAULTS, revision: 20, ...settings })
  const reopened = createGrowingDisk(deserializeDiskProject(json).source!, DISK_DEFAULTS.remeshLength, deserializeDiskProject(json).disk)
  expect(reopened.layers).toEqual(disk.layers)
  expect(reopened.field).toEqual(disk.field)
})

it('converts version 1 projects: disabled openings, rim width, and brush overrides', () => {
  const input = tube()
  const disk = createGrowingDisk(input)
  const [upper, lower] = disk.openRims
  const snapshot = disk.snapshot()
  const { layers: _layers, paintAdd: _add, paintErase: _erase, clock: _clock, ...rest } = snapshot
  void _layers; void _add; void _erase; void _clock
  const legacy = {
    schema: 'growth-lab/disk-project', version: 1, source: source(input), mechanics: DISK_DEFAULTS, revision: 0,
    rimWidth: 0.2, brushRadius: 0.2, ringSelection: upper.vertices.length, showField: true, ...settings,
    disk: { ...rest, brushOverrides: [[lower.vertices[0], 0.6]], disabledRims: [lower.id], sources: 0, zone: 0.3 },
  }
  const project = deserializeDiskProject(JSON.stringify(legacy))
  expect(project.brush.radius).toBe(0.2)
  const reopened = createGrowingDisk(project.source!, DISK_DEFAULTS.remeshLength, project.disk)
  const rimLayers = reopened.layers.filter(layer => layer.kind === 'rim')
  expect(rimLayers).toHaveLength(1)
  expect(rimLayers[0]).toMatchObject({ rim: 0, width: 0.2 })
  expect(upper.vertices.every(vertex => reopened.field[vertex] === 1)).toBe(true)
  expect(reopened.field[lower.vertices[0]]).toBeCloseTo(0.6, 6)
  expect(reopened.field[lower.vertices[1]]).toBe(0)
})

it('opens projects saved before newer mechanics settings existed', () => {
  const input = sheet()
  const disk = createGrowingDisk(input)
  const project: DiskProject = { source: source(input), disk: disk.snapshot(), mechanics: DISK_DEFAULTS, revision: 0, ...settings }
  const legacy = JSON.parse(serializeDiskProject(project))
  delete legacy.mechanics.compoundGrowth
  delete legacy.mechanics.repelDistance
  delete legacy.mechanics.repelStrength
  delete legacy.mechanics.detailScale
  delete legacy.disk.baseBudget
  delete legacy.disk.growthThrottle
  expect(deserializeDiskProject(JSON.stringify(legacy)).mechanics).toEqual(DISK_DEFAULTS)
  legacy.disk.growthThrottle = 0
  expect(() => deserializeDiskProject(JSON.stringify(legacy))).toThrow('invalid design data')
  legacy.disk.growthThrottle = 0.5
  legacy.mechanics.repelStrength = 5
  expect(() => deserializeDiskProject(JSON.stringify(legacy))).toThrow('invalid design data')
})

it('keeps the print thickness settings, and opens older projects with thickness off', () => {
  const disk = createGrowingDisk()
  const base = { source: null, disk: disk.snapshot(), mechanics: DISK_DEFAULTS, revision: 0, ...settings }
  const thickness = { on: true, wall: 0.8, side: 'inside' as const, rim: 'soft' as const, size: 140, show: false }
  expect(deserializeDiskProject(serializeDiskProject({ ...base, thickness })).thickness).toEqual(thickness)
  expect(deserializeDiskProject(serializeDiskProject(base)).thickness).toEqual(THICKNESS_DEFAULTS)
  expect(() => deserializeDiskProject(serializeDiskProject({ ...base, thickness: { ...thickness, rim: 'chamfer' as never } }))).toThrow('invalid design data')
  expect(() => deserializeDiskProject(serializeDiskProject({ ...base, thickness: { ...thickness, wall: 0 } }))).toThrow('invalid design data')
  expect(() => deserializeDiskProject(serializeDiskProject({ ...base, thickness: { ...thickness, side: 'middle' as never } }))).toThrow('invalid design data')
  // Lists where names belong, which once passed and then blanked the page.
  expect(() => deserializeDiskProject(serializeDiskProject({ ...base, thickness: { ...thickness, side: ['outside'] as never } }))).toThrow('invalid design data')
  expect(() => deserializeDiskProject(serializeDiskProject({ ...base, thickness: { ...thickness, rim: ['round'] as never } }))).toThrow('invalid design data')
  // Saved by 0.7.0, before the wall could go on one side.
  const older: Partial<typeof thickness> = { ...thickness }
  delete older.side
  expect(deserializeDiskProject(serializeDiskProject({ ...base, thickness: older as never })).thickness).toEqual({ ...thickness, side: 'both' })
})
