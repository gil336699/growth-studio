import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from './growingDisk'
import { combineField, createLayer, layerWeights, startsLater, timeFactor, validLayers, valueNoise, type LayerMesh } from './growthLayers'

// A straight strip of five vertices along x; vertex 0 is the "rim".
const strip: LayerMesh = {
  rest: Float32Array.of(0, 0, 0, 0.1, 0, 0, 0.2, 0, 0, 0.3, 0, 0, 0.4, 1, 0),
  neighbors: [[1], [0, 2], [1, 3], [2, 4], [3]],
  rims: [{ vertices: [0] }],
}
const paint = (count: number) => ({ add: new Float32Array(count), erase: new Float32Array(count) })

it('fades rim growth inward over the field width', () => {
  const weights = layerWeights(createLayer('rim', { width: 0.25, falloff: 'linear' }), strip)
  expect(Array.from(weights.slice(0, 4)).map(w => +w.toFixed(3))).toEqual([1, 0.6, 0.2, 0])
})

it('places lobes evenly around a rim and fades between them', () => {
  const disk = createGrowingDisk()
  disk.setLayers([createLayer('rim', { width: 0.3, lobes: 4, falloff: 'linear' }), createLayer('paint')])
  const [rim] = disk.openRims
  const growing = rim.vertices.filter(vertex => disk.field[vertex] > 0.5).length
  // Four lobes cover part of the rim, not all of it.
  expect(growing).toBeGreaterThan(0)
  expect(growing).toBeLessThan(rim.vertices.length * 0.6)
})

it('weights points, lines, and height ramps from the rest shape', () => {
  const point = layerWeights(createLayer('point', { center: [0.2, 0, 0], radius: 0.15, falloff: 'linear' }), strip)
  expect(point[2]).toBe(1)
  expect(point[0]).toBe(0)
  const line = layerWeights(createLayer('line', { points: [[0, 0.05, 0], [0.3, 0.05, 0]], radius: 0.1, falloff: 'linear' }), strip)
  expect(line[1]).toBeCloseTo(0.5, 6)
  expect(line[4]).toBe(0)
  const top = layerWeights(createLayer('height', { low: 0.5, high: 1 }), strip)
  expect(top[4]).toBe(1)
  expect(top[0]).toBe(0)
})

it('combines layers with paint, erase, and noise', () => {
  const layers = [createLayer('rim', { width: 0.25, falloff: 'linear' }), createLayer('paint'), createLayer('noise', { strength: 0 })]
  const spatial = new Map(layers.map(layer => [layer.id, layerWeights(layer, strip)]))
  const maps = paint(5)
  maps.add[3] = 0.7
  maps.erase[0] = 1
  const field = combineField(new Float32Array(5), layers, spatial, maps, 0)
  expect(field[0]).toBe(0)
  expect(field[1]).toBeCloseTo(0.6, 6)
  expect(field[3]).toBeCloseTo(0.7, 6)
  layers[0].visible = false
  expect(combineField(new Float32Array(5), layers, spatial, maps, 0)[1]).toBe(0)
})

it('switches layers on and off over the timeline and interpolates intensity keys', () => {
  const timing = { start: 100, end: 300, keys: [{ step: 100, value: 0 }, { step: 200, value: 1 }] }
  expect(timeFactor(timing, 50)).toBe(0)
  expect(timeFactor(timing, 150)).toBeCloseTo(0.5, 6)
  expect(timeFactor(timing, 250)).toBe(1)
  expect(timeFactor(timing, 300)).toBe(0)
  const later = createLayer('rim', { timing })
  expect(startsLater([later], 50)).toBe(true)
  expect(startsLater([later], 250)).toBe(false)
})

it('waits for a layer that starts later and then grows it', () => {
  const disk = createGrowingDisk()
  const layer = createLayer('rim', { width: 0.3, falloff: 'soft', timing: { start: 10, end: null, keys: [] } })
  disk.setLayers([layer, createLayer('paint')])
  expect(disk.hasField).toBe(false)
  expect(disk.canGrow).toBe(true)
  for (let i = 0; i < 10; i++) disk.step(true)
  expect(disk.strain).toBe(0)
  for (let i = 0; i < 10; i++) disk.step(true)
  expect(disk.strain).toBeCloseTo(10 * DISK_DEFAULTS.growthRate, 9)
  expect(disk.clock).toBe(20)
})

it('paints growth on the default disk, mirrors undo, and keeps paint through splits', () => {
  const disk = createGrowingDisk()
  disk.setLayers([createLayer('paint')])
  expect(disk.hasField).toBe(false)
  disk.beginBrushStroke()
  disk.paintStroke(disk.brushFootprint(-1, [0, 0, 0], 0.4, 0.5), 'paint')
  expect(disk.field[0]).toBe(1)
  disk.setMechanics({ ...DISK_DEFAULTS, growthRate: 0.008 })
  for (let i = 0; i < 60; i++) disk.step(true)
  expect(disk.splits).toBeGreaterThan(0)
  expect(disk.paint.add.length).toBe(disk.positions.length / 3)
  disk.undoBrush()
  expect(disk.field[0]).toBe(0)
})

it('produces repeatable noise in the unit range', () => {
  const samples = Array.from({ length: 50 }, (_, i) => valueNoise(i * 0.37, i * 0.11, -i * 0.23, 7))
  expect(samples.every(value => value >= 0 && value <= 1)).toBe(true)
  expect(valueNoise(1.3, 2.1, 0.4, 7)).toBe(valueNoise(1.3, 2.1, 0.4, 7))
  expect(new Set(samples.map(v => v.toFixed(3))).size).toBeGreaterThan(20)
})

it('accepts valid layers and rejects malformed ones', () => {
  const layers = [createLayer('rim'), createLayer('point'), createLayer('line'), createLayer('height'), createLayer('noise'), createLayer('paint')]
  expect(validLayers(JSON.parse(JSON.stringify(layers)))).toBe(true)
  expect(validLayers([{ ...createLayer('rim'), lobes: 1.5 }])).toBe(false)
  expect(validLayers([{ ...createLayer('paint'), kind: 'magic' }])).toBe(false)
})
