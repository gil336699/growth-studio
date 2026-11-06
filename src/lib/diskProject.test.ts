import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from '../physics/growingDisk'
import { deserializeDiskProject, serializeDiskProject } from './diskProject'

it('reopens a painted surface and resumes from the same solver state', () => {
  const input = {
    name: 'Sheet.stl', scale: 10,
    positions: Float32Array.of(0, 0, 0, 0.3, 0, 0, 0, 0, 0.3),
    indices: Uint32Array.of(0, 1, 2),
  }
  const mechanics = { ...DISK_DEFAULTS, gravity: 0.15, gravityTilt: 30 }
  const disk = createGrowingDisk(input)
  const ringSelection = disk.selectOpenRings()
  disk.paint(0, [0, 0, 0], 0.03, true)
  disk.setMechanics(mechanics)
  for (let step = 0; step < 19; step++) disk.step(true)

  const json = serializeDiskProject({
    source: { ...input, positions: Array.from(input.positions), indices: Array.from(input.indices) },
    disk: disk.snapshot(), mechanics, revision: 19, rimWidth: 0.16, brushRadius: 0.03, ringSelection,
    relaxing: false, showField: true, view: 'triangles', speed: 3, batch: 100, importSpeed: 1, importBatch: 10,
  })
  const project = deserializeDiskProject(json)
  const reopened = createGrowingDisk(project.source!, mechanics.remeshLength, project.disk)
  reopened.setMechanics(project.mechanics)
  expect(reopened.snapshot()).toEqual(disk.snapshot())
  expect(reopened.hasBrushEdits).toBe(true)
  expect(reopened.field[reopened.indices[0]]).toBe(0)
  disk.step(true)
  reopened.step(true)
  expect(reopened.snapshot()).toEqual(disk.snapshot())

  const invalid = JSON.parse(json)
  invalid.disk.indices[0] = 999_999
  expect(() => deserializeDiskProject(JSON.stringify(invalid))).toThrow('invalid design data')
})

it('keeps the lower opening off after changing width, remeshing, and reopening', () => {
  const positions = Float32Array.of(
    -0.2, 0, -0.2, 0.2, 0, -0.2, 0.2, 0, 0.2, -0.2, 0, 0.2,
    -0.2, 0.3, -0.2, 0.2, 0.3, -0.2, 0.2, 0.3, 0.2, -0.2, 0.3, 0.2,
  )
  const indices = Uint32Array.of(0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7, 3, 7, 0, 0, 7, 4)
  const input = { name: 'Tube.stl', scale: 1, positions, indices }
  const disk = createGrowingDisk(input)
  expect(disk.openRims).toHaveLength(2)
  const [upper, lower] = disk.openRims
  disk.selectOpenRings()
  disk.setRimEnabled(lower.id, false, 0.16)
  const ringSelection = disk.selectOpenRings(0.8)
  expect(ringSelection).toBe(upper.vertices.length)
  expect(upper.vertices.every(vertex => disk.field[vertex] === 1)).toBe(true)
  expect(lower.vertices.every(vertex => disk.field[vertex] === 0)).toBe(true)
  disk.setMechanics({ ...DISK_DEFAULTS, remeshLength: 0.09 })
  for (let i = 0; i < 20; i++) disk.step(true)
  expect(disk.splits).toBeGreaterThan(0)
  expect(disk.openRims.find(rim => rim.id === lower.id)?.enabled).toBe(false)

  const json = serializeDiskProject({
    source: { ...input, positions: Array.from(positions), indices: Array.from(indices) },
    disk: disk.snapshot(), mechanics: DISK_DEFAULTS, revision: 20, rimWidth: 0.8, brushRadius: 0.15, ringSelection,
    relaxing: false, showField: true, view: 'smooth', speed: 3, batch: 100, importSpeed: 1, importBatch: 10,
  })
  const project = deserializeDiskProject(json)
  const reopened = createGrowingDisk(project.source!, DISK_DEFAULTS.remeshLength, project.disk)
  expect(reopened.openRims.map(rim => rim.enabled)).toEqual([true, false])
  reopened.setRimEnabled(upper.id, false, 0.8)
  expect(reopened.hasPaint).toBe(false)

  const legacy = JSON.parse(json)
  delete legacy.disk.disabledRims
  expect(() => deserializeDiskProject(JSON.stringify(legacy))).not.toThrow()
})

it('opens projects saved before the growth curve and contact settings existed', () => {
  const input = {
    name: 'Sheet.stl', scale: 10,
    positions: Float32Array.of(0, 0, 0, 0.3, 0, 0, 0, 0, 0.3),
    indices: Uint32Array.of(0, 1, 2),
  }
  const disk = createGrowingDisk(input)
  const json = serializeDiskProject({
    source: { ...input, positions: Array.from(input.positions), indices: Array.from(input.indices) },
    disk: disk.snapshot(), mechanics: DISK_DEFAULTS, revision: 0, rimWidth: 0.16, brushRadius: 0.15, ringSelection: 3,
    relaxing: false, showField: true, view: 'smooth', speed: 3, batch: 100, importSpeed: 1, importBatch: 10,
  })
  const legacy = JSON.parse(json)
  delete legacy.mechanics.compoundGrowth
  delete legacy.mechanics.repelDistance
  delete legacy.mechanics.repelStrength
  delete legacy.mechanics.detailScale
  delete legacy.disk.baseBudget
  const project = deserializeDiskProject(JSON.stringify(legacy))
  expect(project.mechanics).toEqual(DISK_DEFAULTS)

  delete legacy.disk.growthThrottle
  expect(() => deserializeDiskProject(JSON.stringify(legacy))).not.toThrow()
  legacy.disk.growthThrottle = 0
  expect(() => deserializeDiskProject(JSON.stringify(legacy))).toThrow('invalid design data')
  legacy.disk.growthThrottle = 0.5
  legacy.mechanics.repelStrength = 5
  expect(() => deserializeDiskProject(JSON.stringify(legacy))).toThrow('invalid design data')
})
