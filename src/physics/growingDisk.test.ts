import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from './growingDisk'
import { createDiskSelfContact } from './diskSelfContact'

it('moves an unsettled disk in Relax only without adding strain', () => {
  const disk = createGrowingDisk()
  for (let i = 0; i < 40; i++) disk.step(true)
  const strain = disk.strain
  const before = disk.positions.slice()
  disk.step(false)
  expect(disk.strain).toBe(strain)
  expect(disk.positions).not.toEqual(before)
  expect(disk.lastMotion).toBeGreaterThan(0)
})

it('detects a crossing between separate faces after their positions change', () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 1, 0, 2, 1, 1, 2, 1, 0, 3])
  const intersects = createDiskSelfContact(positions, new Uint32Array([0, 1, 2, 3, 4, 5]))
  expect(intersects()).toBe(false)
  positions[11] = -1
  expect(intersects()).toBe(true)
})

it('buckles the expanding rim while the matched control remains nearly flat', () => {
  const grown = createGrowingDisk(), control = createGrowingDisk()
  const initialVertices = grown.positions.length / 3
  for (let i = 0; i < 360; i++) {
    grown.step(true)
    control.step(false)
  }
  const heightRange = (positions: Float32Array) => {
    const heights = positions.filter((_, i) => i % 3 === 1)
    return Math.max(...heights) - Math.min(...heights)
  }
  expect(grown.positions.every(Number.isFinite)).toBe(true)
  expect(grown.strain).toBeGreaterThan(0.9)
  expect(grown.splits).toBeGreaterThan(0)
  expect(grown.positions.length / 3).toBe(initialVertices + grown.splits)
  expect(grown.indices.every(index => index < grown.positions.length / 3)).toBe(true)
  expect(control.splits).toBe(0)
  const strain = grown.strain, splits = grown.splits
  for (let i = 0; i < 10; i++) grown.step(false)
  expect(grown.strain).toBe(strain)
  expect(grown.splits).toBe(splits)
  expect(createDiskSelfContact(grown.positions, grown.indices)()).toBe(false)
  expect(heightRange(grown.positions)).toBeGreaterThan(0.2)
  expect(heightRange(control.positions)).toBeLessThan(0.01)
}, 15000)

it('pulls the sheet in the selected direction during relaxation without adding strain', () => {
  const down = createGrowingDisk()
  const up = createGrowingDisk()
  down.setMechanics({ ...DISK_DEFAULTS, gravity: 0.5 })
  up.setMechanics({ ...DISK_DEFAULTS, gravity: 0.5, gravityTilt: 180 })
  const meanHeight = (disk: ReturnType<typeof createGrowingDisk>) =>
    disk.positions.reduce((sum, y, i) => sum + (i % 3 === 1 ? y : 0), 0) / (disk.positions.length / 3)
  const start = meanHeight(down)
  for (let i = 0; i < 5; i++) {
    down.step(false)
    up.step(false)
  }
  expect(meanHeight(down)).toBeLessThan(start - 0.001)
  expect(meanHeight(up)).toBeGreaterThan(start + 0.001)
  expect(down.strain).toBe(0)
  expect(up.strain).toBe(0)
})

it('compounds growth on the current size when Compounding is selected', () => {
  const linear = createGrowingDisk(), compound = createGrowingDisk()
  compound.setMechanics({ ...DISK_DEFAULTS, compoundGrowth: 1 })
  for (let i = 0; i < 100; i++) {
    linear.step(true)
    compound.step(true)
  }
  expect(linear.rejectedSteps + compound.rejectedSteps).toBe(0)
  expect(linear.strain).toBeCloseTo(100 * DISK_DEFAULTS.growthRate, 9)
  expect(compound.strain).toBeCloseTo((1 + DISK_DEFAULTS.growthRate) ** 100 - 1, 9)
})

it('scales the mesh detail limit and keeps it through a saved snapshot', () => {
  const disk = createGrowingDisk()
  const base = disk.growthBudget
  disk.setMechanics({ ...DISK_DEFAULTS, detailScale: 2 })
  expect(disk.growthBudget).toBe(base * 2)
  const reopened = createGrowingDisk(undefined, DISK_DEFAULTS.remeshLength, disk.snapshot())
  reopened.setMechanics({ ...DISK_DEFAULTS, detailScale: 2 })
  expect(reopened.growthBudget).toBe(base * 2)
  reopened.setMechanics({ ...DISK_DEFAULTS, detailScale: 1 })
  expect(reopened.growthBudget).toBe(base)
})

it('scales the vertex limit by budgetScale on top of the detail limit, never below the current count', () => {
  const disk = createGrowingDisk()
  const base = disk.growthBudget
  disk.setMechanics({ ...DISK_DEFAULTS, detailScale: 2, budgetScale: 1.5 })
  expect(disk.growthBudget).toBe(Math.round(base * 3))
  disk.setMechanics({ ...DISK_DEFAULTS, budgetScale: 0.25 })
  expect(disk.growthBudget).toBe(Math.max(disk.positions.length / 3, Math.round(base * 0.25)))
})

it('grows past the default vertex limit when the detail limit is raised', () => {
  const capped = createGrowingDisk(), raised = createGrowingDisk()
  capped.setMechanics({ ...DISK_DEFAULTS, growthRate: 0.008 })
  raised.setMechanics({ ...DISK_DEFAULTS, growthRate: 0.008, detailScale: 2 })
  for (let i = 0; i < 400; i++) {
    capped.step(true)
    raised.step(true)
  }
  const vertices = (disk: ReturnType<typeof createGrowingDisk>) => disk.positions.length / 3
  expect(vertices(capped)).toBeLessThanOrEqual(capped.growthBudget)
  expect(vertices(raised)).toBeGreaterThan(capped.growthBudget)
  // Lowering the limit below the current count stops further splits without removing vertices.
  raised.setMechanics({ ...DISK_DEFAULTS, growthRate: 0.008, detailScale: 1 })
  expect(raised.growthBudget).toBe(vertices(raised))
}, 60000)

it('holds the model outside the growth field in place under sideways gravity', () => {
  const disk = createGrowingDisk()
  disk.setMechanics({ ...DISK_DEFAULTS, gravity: 1, gravityTilt: 90 })
  const start = disk.positions.slice()
  for (let i = 0; i < 40; i++) disk.step(true)
  const fixed = [...disk.field.keys()].filter(vertex => disk.field[vertex] === 0)
  const loaded = [...disk.field.keys()].filter(vertex => disk.field[vertex] > 0.5)
  const shiftX = (vertices: number[]) =>
    vertices.reduce((sum, vertex) => sum + disk.positions[vertex * 3] - start[vertex * 3], 0) / vertices.length
  expect(fixed.length).toBeGreaterThan(0)
  expect(fixed.every(vertex => [0, 1, 2].every(axis => disk.positions[vertex * 3 + axis] === start[vertex * 3 + axis]))).toBe(true)
  expect(shiftX(loaded)).toBeGreaterThan(0.001)
})

it('repels a vertex from a nearby face even when all three face vertices are far away', () => {
  const positions = Float32Array.of(
    -1, 0, -1, 1, 0, -1, 0, 0, 1,
    0, 0.004, 0, -0.1, 0.1, 0, 0.1, 0.1, 0,
  )
  const indices = Uint32Array.of(0, 1, 2, 3, 4, 5)
  const contact = createDiskSelfContact(positions, indices)
  expect(contact.repel(positions.slice())).toBe(1)
  expect(positions[10]).toBeGreaterThan(0.004)
  expect(positions[7]).toBeLessThan(0)
  expect(contact()).toBe(false)
})
