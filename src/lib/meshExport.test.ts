import { expect, it } from 'vitest'
import { exportBinaryStl, exportObj } from './meshExport'

// Two triangles in the solver's Y-up frame.
const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1)
const indices = Uint32Array.of(0, 1, 2, 1, 3, 2)

it('writes one OBJ vertex and face per mesh vertex and triangle in Z-up coordinates', () => {
  const lines = exportObj(positions, indices, 'sample').split('\n')
  expect(lines.filter(line => line.startsWith('v '))).toHaveLength(4)
  expect(lines.filter(line => line.startsWith('f '))).toEqual(['f 1 2 3', 'f 2 4 3'])
  // Solver (x, y, z) becomes CAD (x, -z, y).
  expect(lines.filter(line => line.startsWith('v '))[2]).toBe('v 0.0000000 -1.0000000 0.0000000')
})

it('writes a binary STL with a matching triangle count and unit normals', () => {
  const buffer = exportBinaryStl(positions, indices, 'sample')
  const view = new DataView(buffer)
  expect(view.getUint32(80, true)).toBe(2)
  expect(buffer.byteLength).toBe(84 + 2 * 50)
  for (let triangle = 0; triangle < 2; triangle++) {
    const record = 84 + triangle * 50
    const normal = [0, 1, 2].map(axis => view.getFloat32(record + axis * 4, true))
    expect(Math.hypot(...normal)).toBeCloseTo(1, 6)
  }
})
