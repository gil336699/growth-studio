import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createGrowingDisk } from './growingDisk'
import { growthExportPositions, readGrowthStl } from './growthStl'
import { exportBinaryStl, exportObj } from '../lib/meshExport'
import { balanceSurfaceTriangles } from './balanceSurfaceTriangles'

it('replaces a poor planar diagonal but preserves that diagonal across a crease', () => {
  const points = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 0.2, 0, 0, -0.2, 0])
  const faces = new Uint32Array([0, 1, 2, 1, 0, 3])
  expect(balanceSurfaceTriangles(points, faces).flips).toBe(1)
  points[11] = 0.2
  expect(balanceSurfaceTriangles(points, faces).indices).toEqual(faces)
})

it('refines the cube without moving original vertices or changing its sharp faces', () => {
  const file = readFileSync('test-fixtures/cube.stl')
  const buffer = Uint8Array.from(file).buffer
  const input = readGrowthStl(buffer, 'cube.stl')
  const shell = createGrowingDisk(input)
  expect(shell.preparationSplits).toBeGreaterThan(0)
  expect(shell.preparationPatches).toBeGreaterThan(0)
  expect(shell.initialOverlap).toBe(false)
  expect(shell.positions.slice(0, input.positions.length)).toEqual(input.positions)
  const prepared = shell.positions.slice()
  shell.step(true)
  expect(shell.positions).toEqual(prepared)
  expect(shell.strain).toBe(0)
  const point = shell.positions.subarray(shell.indices[0] * 3, shell.indices[0] * 3 + 3)
  shell.paintStroke(shell.brushFootprint(0, [...point], 0.15), 'paint')
  expect(shell.hasField).toBe(true)
  expect(shell.field.some(weight => weight === 0)).toBe(true)
  shell.paintStroke(shell.brushFootprint(0, [...point], 0.15), 'erase')
  expect(shell.hasField).toBe(false)
  const extent = Math.max(...input.positions)
  for (let i = 0; i < shell.indices.length; i += 3) {
    const face = shell.indices.subarray(i, i + 3)
    expect([0, 1, 2].some(axis => [-extent, extent].some(plane =>
      face.every(vertex => Math.abs(shell.positions[vertex * 3 + axis] - plane) < 1e-6),
    ))).toBe(true)
  }
})

it('exports an offset STL in its original coordinate frame and can center the export', () => {
  const sourcePoints = Float32Array.of(12, -15, 40, 16, -15, 40, 12, -9, 46)
  const face = Uint32Array.of(0, 1, 2)
  const input = readGrowthStl(exportBinaryStl(sourcePoints, face), 'offset.stl')
  const originalFrame = growthExportPositions(input.positions, input, false)
  expect(Array.from(originalFrame)).toEqual(Array.from(sourcePoints))
  const centeredFrame = growthExportPositions(input.positions, input, true)
  expect(Array.from(centeredFrame)).toEqual([-2, -3, -3, 2, -3, -3, -2, 3, 3])
  expect(exportObj(originalFrame, input.indices)).toContain('v 12.0000000 -40.0000000 -15.0000000')
})

it('undoes a brush stroke on a closed surface without leaving a growth field', () => {
  const buffer = Uint8Array.from(readFileSync('test-fixtures/cube.stl')).buffer
  const shell = createGrowingDisk(readGrowthStl(buffer, 'cube.stl'))
  const before = shell.field.slice()
  const vertex = shell.indices[0] * 3
  const point = Array.from(shell.positions.subarray(vertex, vertex + 3))
  const footprint = shell.brushFootprint(0, point, 0.15)
  expect(footprint.length).toBeGreaterThan(0)
  shell.beginBrushStroke()
  shell.paintStroke(footprint, 'paint')
  expect(shell.hasField).toBe(true)
  shell.beginBrushStroke()
  shell.paintStroke(footprint, 'erase')
  expect(shell.hasField).toBe(false)
  shell.undoBrush()
  expect(shell.hasField).toBe(true)
  shell.undoBrush()
  expect(shell.field).toEqual(before)
  expect(shell.hasPaint).toBe(false)
})
