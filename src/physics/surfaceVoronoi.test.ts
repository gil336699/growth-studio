import { expect, it } from 'vitest'
import { buildSurfaceVoronoi, surfaceVoronoiLines } from './surfaceVoronoi'

it('recomputes cell seams from the current triangle metric after stretching', () => {
  const indices = Uint32Array.of(0, 1, 2)
  const rest = Float32Array.of(0, 0, 0, 1, 0, 0, 0.4, 1, 0)
  const stretched = Float32Array.of(0, 0, 0, 3, 0, 0, 0.4, 1, 0)
  const transported = surfaceVoronoiLines(buildSurfaceVoronoi(rest, indices), stretched, false)
  const refreshed = surfaceVoronoiLines(buildSurfaceVoronoi(stretched, indices), stretched, false)
  expect(refreshed.positions).not.toEqual(transported.positions)
  expect(refreshed.positions.length).toBeGreaterThan(0)
  for (let offset = 0; offset < refreshed.positions.length; offset += 3) {
    const [x, y] = refreshed.positions.subarray(offset, offset + 2)
    const distances = [x ** 2 + y ** 2, (x - 3) ** 2 + y ** 2, (x - 0.4) ** 2 + (y - 1) ** 2]
      .sort((a, b) => a - b)
    expect(distances[0]).toBeCloseTo(distances[1], 5)
  }
})
