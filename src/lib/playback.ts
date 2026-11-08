// Playback rules shared by the page and the simulation worker: timeline snapshots and when playback stops.
import type { GrowingDisk, DiskSnapshot } from '../physics/growingDisk'
import type { Phase, StopAt } from './diskProject'
import { formSize } from './formReadouts'

export type SnapshotMark = { step: number; strain: number; size: number }
export type Snap = { mark: SnapshotMark; snapshot: DiskSnapshot }
// Settings that can change while playback runs.
export type PlayConfig = { stepsPerUpdate: number; relaxing: boolean; every: number; stopAt: StopAt; phases: Phase[] }

const percent = (value: number) => `${(value * 100).toFixed(0)}%`

export const snapOfDisk = (disk: GrowingDisk): Snap => ({
  mark: { step: disk.clock, strain: disk.strain, size: formSize(disk.positions, disk.referencePositions).multiple },
  snapshot: disk.snapshot(),
})

// The message shown when Stop at is reached, or '' to keep going.
export function stopReached(disk: GrowingDisk, stopAt: StopAt): string {
  if (stopAt.kind === 'step' && disk.clock >= stopAt.value) return `Stopped at step ${disk.clock}.`
  if (stopAt.kind === 'strain' && disk.strain >= stopAt.value) return `Stopped at ${percent(disk.strain)} target strain.`
  if (stopAt.kind === 'size') {
    const size = formSize(disk.positions, disk.referencePositions).multiple
    if (size >= stopAt.value) return `Stopped at ${size.toFixed(2)}× the starting size.`
  }
  return ''
}
