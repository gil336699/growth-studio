import { expect, it } from 'vitest'
import { createFlatShellBending } from './flatShellBending'

it('reduces a fold of either sign across a shared triangle edge', () => {
  const project = createFlatShellBending(new Uint32Array([0, 1, 2, 1, 0, 3]))
  for (const sign of [-1, 1]) {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, sign * 0.2])
    project(positions, 1)
    const angle = Math.atan2(positions[8] - positions[2], positions[7] - positions[1])
      + Math.atan2(positions[11] - positions[2], positions[1] - positions[10])
    expect(Math.abs(angle)).toBeLessThan(0.03)
  }
})
