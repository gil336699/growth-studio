// Runs one design variant off the main thread and returns its final snapshot.
import { createGrowingDisk, DISK_DEFAULTS, type DiskSnapshot } from '../physics/growingDisk'
import type { GrowthLayer } from '../physics/growthLayers'

export type VariantRequest = {
  id: number
  source: { positions: Float32Array; indices: Uint32Array } | null
  snapshot: DiskSnapshot
  mechanics: typeof DISK_DEFAULTS
  layers: GrowthLayer[]
  steps: number
}
export type VariantMessage =
  | { id: number; kind: 'progress'; done: number }
  | { id: number; kind: 'done'; snapshot: DiskSnapshot; strain: number; rejected: number }
  | { id: number; kind: 'error'; message: string }

self.onmessage = ({ data }: MessageEvent<VariantRequest>) => {
  const { id, source, snapshot, mechanics, layers, steps } = data
  try {
    const disk = createGrowingDisk(source ?? undefined, mechanics.remeshLength, snapshot)
    disk.setMechanics(mechanics)
    disk.setLayers(layers)
    for (let step = 1; step <= steps; step++) {
      disk.step(true)
      if (step % 20 === 0) self.postMessage({ id, kind: 'progress', done: step } satisfies VariantMessage)
    }
    self.postMessage({ id, kind: 'done', snapshot: disk.snapshot(), strain: disk.strain, rejected: disk.rejectedSteps } satisfies VariantMessage)
  } catch (error) {
    self.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : 'Variant failed.' } satisfies VariantMessage)
  }
}
