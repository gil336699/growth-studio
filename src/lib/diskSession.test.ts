import { expect, it } from 'vitest'
import { createGrowingDisk, DISK_DEFAULTS } from '../physics/growingDisk'
import { createLayer } from '../physics/growthLayers'
import { createSimulationRunner, type FromRunner, type ToRunner } from '../physics/simulationRunner'
import { createDiskSession, type PlayHandlers, type WorkerLike } from './diskSession'
import { STOP_DEFAULTS } from './diskProject'
import type { PlayConfig, Snap } from './playback'

// A stand-in for the simulation worker: the same runner, with messages copied and delivered asynchronously.
// busy drops the page's acknowledgements, as if it never got to draw, so only the first frame is ever sent.
function inProcessWorker(busy = false): WorkerLike {
  let terminated = false
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message: ToRunner, transfer: Transferable[] = []) {
      if (busy && message.kind === 'ack') return
      const copy = structuredClone(message, { transfer })
      setTimeout(() => { if (!terminated) runner.handle(copy) }, 0)
    },
    terminate() { terminated = true },
  }
  const runner = createSimulationRunner((message: FromRunner, transfer) => {
    const copy = structuredClone(message, { transfer })
    setTimeout(() => { if (!terminated) worker.onmessage?.({ data: copy } as MessageEvent<FromRunner>) }, 0)
  })
  return worker
}

const CONFIG: PlayConfig = { stepsPerUpdate: 5, relaxing: false, every: 20, stopAt: STOP_DEFAULTS, phases: [] }

// Plays until the worker reports the run finished, and collects what it reported on the way.
function playToEnd(session: ReturnType<typeof createDiskSession>, steps: number | null, config: PlayConfig, phased = false) {
  const snaps: Snap[] = [], phases: number[] = []
  return new Promise<{ reason: string; snaps: Snap[]; phases: number[] }>(resolve => {
    const handlers: PlayHandlers = {
      onSnapshot: snap => snaps.push(snap),
      onPhase: index => phases.push(index),
      onStopped: reason => resolve({ reason, snaps, phases }),
    }
    session.play(steps, phased, config, handlers)
  })
}
const settle = () => new Promise(resolve => setTimeout(resolve, 150))

it('continues exactly after the solver is handed to another thread mid-contact', () => {
  // A narrow rim on a soft sheet with a wide repel distance touches itself from about step 226.
  const folding = () => {
    const disk = createGrowingDisk()
    disk.setMechanics({ ...DISK_DEFAULTS, growthRate: 0.008, bending: 0.005, repelDistance: 0.04 })
    disk.setLayers([createLayer('rim', { width: 0.08, falloff: 'soft' }), createLayer('paint')])
    return disk
  }
  const straight = folding(), first = folding()
  for (let i = 0; i < 300; i++) straight.step(true)
  for (let i = 0; i < 251; i++) first.step(true)
  expect(first.contactHeat.some(heat => heat > 0)).toBe(true)
  const { snapshot, live } = structuredClone(first.liveState())
  const second = createGrowingDisk(undefined, DISK_DEFAULTS.remeshLength, snapshot, live)
  second.setMechanics({ ...DISK_DEFAULTS, growthRate: 0.008, bending: 0.005, repelDistance: 0.04 })
  for (let i = 251; i < 300; i++) second.step(true)
  expect(second.positions).toEqual(straight.positions)
  expect(second.contactHeat).toEqual(straight.contactHeat)
  expect(second.indices).toEqual(straight.indices)
  expect([second.clock, second.strain, second.splits, second.rejectedSteps, second.growthThrottle, second.lastContactCorrections])
    .toEqual([straight.clock, straight.strain, straight.splits, straight.rejectedSteps, straight.growthThrottle, straight.lastContactCorrections])
}, 60000)

it('steps in the worker and mirrors the same shape the page would have grown', async () => {
  const local = createGrowingDisk()
  for (let i = 0; i < 60; i++) local.step(true)
  const session = createDiskSession(createGrowingDisk(), { source: null, createWorker: inProcessWorker })
  const run = await playToEnd(session, 60, CONFIG)
  expect(run.reason).toBe('')
  expect(session.busy).toBe(false)
  expect(session.clock).toBe(60)
  expect(session.positions).toEqual(local.positions)
  expect(session.indices).toEqual(local.indices)
  expect(session.localGrowth).toEqual(local.localGrowth)
  expect(run.snaps.map(snap => snap.mark.step)).toEqual([20, 40, 60])
  const { snapshot } = await session.requestSnap()
  expect(snapshot.positions).toEqual(Array.from(local.positions))
  session.release()
}, 30000)

it('forwards edits to the worker and includes them in later snapshots', async () => {
  const session = createDiskSession(createGrowingDisk(), { source: null, createWorker: inProcessWorker })
  await playToEnd(session, 5, CONFIG)
  const height = createLayer('height', { low: 0.2, high: 0.4 })
  session.setLayers([height])
  // The page adds the paint layer itself, so both sides keep the same layer ids.
  expect(session.layers.map(layer => layer.kind)).toEqual(['height', 'paint'])
  session.brush([{ face: 0, point: [0, 0, 0] }], 0.3, 0, 'paint', 1, true)
  await settle()
  expect(session.canUndoBrush).toBe(true)
  const { snapshot } = await session.requestSnap()
  expect(snapshot.layers?.map(layer => layer.id)).toEqual(session.layers.map(layer => layer.id))
  expect(snapshot.paintAdd?.length).toBeGreaterThan(0)
  session.undoBrush()
  const undone = await session.requestSnap()
  expect(undone.snapshot.paintAdd).toEqual([])
  session.release()
}, 30000)

it('stops at the Stop at step and when the phases finish', async () => {
  const session = createDiskSession(createGrowingDisk(), { source: null, createWorker: inProcessWorker })
  const stopped = await playToEnd(session, null, { ...CONFIG, stopAt: { kind: 'step', value: 30 } })
  expect(stopped.reason).toBe('Stopped at step 30.')
  expect(session.clock).toBe(30)
  const phased = await playToEnd(session, null, { ...CONFIG, phases: [{ mode: 'grow', steps: 10 }, { mode: 'relax', steps: 6 }] }, true)
  expect(phased.reason).toBe('Phases finished.')
  expect(phased.phases).toContain(1)
  expect(session.clock).toBe(46)
  session.release()
}, 30000)

it('reports every phase even when the page is too busy to take frames', async () => {
  const session = createDiskSession(createGrowingDisk(), { source: null, createWorker: () => inProcessWorker(true) })
  const phases = [{ mode: 'grow' as const, steps: 10 }, { mode: 'relax' as const, steps: 6 }, { mode: 'grow' as const, steps: 4 }]
  const run = await playToEnd(session, null, { ...CONFIG, phases }, true)
  expect(run.reason).toBe('Phases finished.')
  expect(run.phases).toEqual([1, 2])
  expect(session.clock).toBe(20)
  session.release()
}, 30000)

it('keeps the worker running when Stop is pressed until the current step finishes', async () => {
  const session = createDiskSession(createGrowingDisk(), { source: null, createWorker: inProcessWorker })
  const run = playToEnd(session, null, CONFIG)
  await settle()
  session.stop()
  expect(session.busy).toBe(true)
  expect((await run).reason).toBe('')
  expect(session.busy).toBe(false)
  const clock = session.clock
  expect(clock).toBeGreaterThan(0)
  await settle()
  expect(session.clock).toBe(clock)
  session.release()
}, 30000)
