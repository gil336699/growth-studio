// Builds a closed surface's outer layer off the page's thread: on a folded brain it takes about two seconds. Each
// vertex also gets the nearest sheet vertex, so the layer can show the sheet's overlay colors.
import { nearestOrigins, outerFace } from './voxel'

export type OuterLayerRequest = { id: number; positions: Float32Array; indices: Uint32Array; h: number }
export type OuterLayerResult = { id: number; positions: Float32Array; indices: Uint32Array; origin: Uint32Array } | { id: number; error: string }

self.onmessage = ({ data }: MessageEvent<OuterLayerRequest>) => {
  try {
    const face = outerFace(data.positions, data.indices, { h: data.h })
    // A cell about the sheet's edge length keeps the nearest-vertex search to a cell or two.
    let length = 0, samples = 0
    for (let f = 0; f < data.indices.length && samples < 2000; f += 3 * Math.max(1, Math.floor(data.indices.length / 6000)), samples++) {
      const a = data.indices[f] * 3, b = data.indices[f + 1] * 3
      length += Math.hypot(data.positions[b] - data.positions[a], data.positions[b + 1] - data.positions[a + 1], data.positions[b + 2] - data.positions[a + 2])
    }
    const origin = nearestOrigins(face.positions, data.positions, Math.max(2 * data.h, 1.2 * length / Math.max(1, samples)))
    const result: OuterLayerResult = { id: data.id, positions: face.positions, indices: face.indices, origin }
    self.postMessage(result, { transfer: [face.positions.buffer, face.indices.buffer, origin.buffer] })
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'The outer layer could not be built.' } satisfies OuterLayerResult)
  }
}
