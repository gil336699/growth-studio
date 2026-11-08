// The app's handle on one growing model. Until the first playback the model lives on the page, as it always did.
// Playback moves it into a Web Worker for good: steps run there, the page keeps a mirror of what the view and
// readouts need, and edits are forwarded, so drawing and orbiting stay smooth however long a step takes.
import { DISK_DEFAULTS, type BrushMode, type GrowingDisk, type StrokePoint } from '../physics/growingDisk'
import { createLayer, type GrowthLayer, type Vec3 } from '../physics/growthLayers'
import { statsOf, type Frame, type FrameStats, type FromRunner, type Rim, type ToRunner } from '../physics/simulationRunner'
import { snapOfDisk, type PlayConfig, type Snap } from './playback'

type Mechanics = typeof DISK_DEFAULTS
export type WorkerLike = {
  postMessage(message: ToRunner, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<FromRunner>) => void) | null
  onerror?: ((event: ErrorEvent) => void) | null
  terminate(): void
}
export type PlayHandlers = {
  onSnapshot(snap: Snap): void
  onPhase(index: number): void
  // reason is the Stop at or phase message, or '' when the run finished or was stopped.
  onStopped(reason: string): void
}

const simulationWorker = (): WorkerLike => new Worker(new URL('../physics/simulation.worker.ts', import.meta.url), { type: 'module' })
const nextFrame = (callback: () => void) => typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(callback) : setTimeout(callback, 16)

type Mirror = {
  positions: Float32Array; field: Float32Array; localGrowth: Float32Array; contactHeat: Float32Array
  indices: Uint32Array; uv: Float32Array; rest: Float64Array; referencePositions: Float32Array
  openRims: Rim[]; topology: number; stats: FrameStats; layers: GrowthLayer[]
  geometryRevision: number; fieldRevision: number
  // Fixed once the model has left the page.
  initialOverlap: boolean; ignoringOverlaps: boolean; preparationSplits: number; preparationFlips: number
}

export type DiskSession = ReturnType<typeof createDiskSession>

export function createDiskSession(disk: GrowingDisk, options: {
  source: { positions: Float32Array; indices: Uint32Array } | null
  mechanics?: Mechanics
  createWorker?: () => WorkerLike
}) {
  const { source, createWorker = simulationWorker } = options
  let core: GrowingDisk | null = disk
  let mechanics = { ...(options.mechanics ?? DISK_DEFAULTS) }
  disk.setMechanics(mechanics)
  let worker: WorkerLike | null = null
  let mirror: Mirror | null = null
  let busy = false
  let runId = 0
  let handlers: PlayHandlers | null = null
  let released = false
  let acking = false
  let requestId = 0
  const pending = new Map<number, (snap: Snap) => void>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(listener => listener())

  function goRemote() {
    const local = core!
    mirror = {
      positions: local.positions, field: local.field, localGrowth: local.localGrowth, contactHeat: local.contactHeat,
      indices: local.indices, uv: local.uv, rest: Float64Array.from(local.rest), referencePositions: local.referencePositions,
      openRims: local.openRims, topology: 0, stats: statsOf(local, null), layers: local.layers,
      geometryRevision: local.geometryRevision, fieldRevision: local.fieldRevision,
      initialOverlap: local.initialOverlap, ignoringOverlaps: local.ignoringOverlaps,
      preparationSplits: local.preparationSplits, preparationFlips: local.preparationFlips,
    }
    worker = createWorker()
    worker.onmessage = receive
    // A worker script that fails to load would otherwise leave playback waiting forever.
    worker.onerror = event => {
      event.preventDefault?.()
      if (!released && busy) { finishRun('Growth stopped: the simulation could not start in this browser.'); emit() }
    }
    worker.postMessage({
      kind: 'load', source: source && { positions: source.positions, indices: source.indices },
      remeshLength: mechanics.remeshLength, state: local.liveState(), mechanics,
    })
    core = null
  }

  function apply(frame: Frame) {
    const m = mirror!
    const t = frame.topology
    if (t) {
      m.indices = t.indices
      m.uv = t.uv
      m.rest = t.rest
      m.referencePositions = t.referencePositions
      m.openRims = t.openRims
      m.topology = t.revision
    }
    // Same mesh: copy into the arrays the view already holds. New mesh: take the new arrays.
    const take = (current: Float32Array, next?: Float32Array) => !next ? current : t ? next : (current.set(next), current)
    if (frame.positions) { m.positions = take(m.positions, frame.positions); m.geometryRevision++ }
    if (frame.field) { m.field = take(m.field, frame.field); m.fieldRevision++ }
    m.localGrowth = take(m.localGrowth, frame.localGrowth)
    m.contactHeat = take(m.contactHeat, frame.contactHeat)
    const phase = frame.stats.phaseIndex
    if (phase !== null && phase !== m.stats.phaseIndex) handlers?.onPhase(phase)
    m.stats = frame.stats
  }

  // Ask for the next frame once this one has had a chance to be drawn. A covered window draws nothing,
  // so a timer keeps readouts current there.
  function acknowledge() {
    if (acking) return
    acking = true
    let sent = false
    const send = () => {
      if (sent) return
      sent = true
      acking = false
      worker?.postMessage({ kind: 'ack' })
    }
    nextFrame(send)
    setTimeout(send, 100)
  }

  function finishRun(reason: string) {
    busy = false
    const done = handlers
    handlers = null
    done?.onStopped(reason)
  }

  function receive({ data }: MessageEvent<FromRunner>) {
    if (data.kind === 'snap') {
      pending.get(data.id)?.(data.snap)
      pending.delete(data.id)
      if (released && !pending.size) terminate()
      return
    }
    if (released) return
    switch (data.kind) {
      case 'snapshot': handlers?.onSnapshot(data.snap); return
      case 'frame': apply(data.frame); break
      case 'stopped':
        apply(data.frame)
        if (data.run === runId) finishRun(data.reason)
        break
      case 'error': finishRun(`Growth stopped because of an error: ${data.message}`); break
    }
    emit()
    if (data.kind !== 'error') acknowledge()
  }

  function terminate() {
    worker?.terminate()
    worker = null
  }
  const send = (message: ToRunner) => worker?.postMessage(message)

  return {
    // Geometry and overlays for the view.
    get positions() { return core ? core.positions : mirror!.positions },
    get indices() { return core ? core.indices : mirror!.indices },
    get uv() { return core ? core.uv : mirror!.uv },
    get referencePositions() { return core ? core.referencePositions : mirror!.referencePositions },
    get field() { return core ? core.field : mirror!.field },
    get localGrowth() { return core ? core.localGrowth : mirror!.localGrowth },
    get contactHeat() { return core ? core.contactHeat : mirror!.contactHeat },
    get geometryRevision() { return core ? core.geometryRevision : mirror!.geometryRevision },
    get fieldRevision() { return core ? core.fieldRevision : mirror!.fieldRevision },
    // Readouts.
    get clock() { return core ? core.clock : mirror!.stats.clock },
    get strain() { return core ? core.strain : mirror!.stats.strain },
    get splits() { return core ? core.splits : mirror!.stats.splits },
    get growthBudget() { return core ? core.growthBudget : mirror!.stats.growthBudget },
    get rejectedSteps() { return core ? core.rejectedSteps : mirror!.stats.rejectedSteps },
    get growthThrottle() { return core ? core.growthThrottle : mirror!.stats.growthThrottle },
    get lastContactCorrections() { return core ? core.lastContactCorrections : mirror!.stats.lastContactCorrections },
    get stepStatus() { return core ? core.stepStatus : mirror!.stats.stepStatus },
    get canGrow() { return core ? core.canGrow : mirror!.stats.canGrow },
    get canUndoBrush() { return core ? core.canUndoBrush : mirror!.stats.canUndoBrush },
    get openRims() { return core ? core.openRims : mirror!.openRims },
    get layers(): GrowthLayer[] { return core ? core.layers : structuredClone(mirror!.layers) },
    get initialOverlap() { return core ? core.initialOverlap : mirror!.initialOverlap },
    // Counted on request, and only needed while the starting surface still blocks playback.
    get startingCrossings() { return core ? core.startingCrossings : 0 },
    get ignoringOverlaps() { return core ? core.ignoringOverlaps : mirror!.ignoringOverlaps },
    get preparationSplits() { return core ? core.preparationSplits : mirror!.preparationSplits },
    get preparationFlips() { return core ? core.preparationFlips : mirror!.preparationFlips },
    // True from Play until the worker has finished its last step.
    get busy() { return busy },

    // Edits. On the page they apply at once; in the worker they show in the next frame.
    setLayers(next: GrowthLayer[]) {
      if (core) return core.setLayers(next)
      const layers = structuredClone(next)
      if (!layers.some(layer => layer.kind === 'paint')) layers.push(createLayer('paint'))
      mirror!.layers = layers
      send({ kind: 'layers', layers })
    },
    setMechanics(next: Mechanics) {
      mechanics = { ...next }
      if (core) core.setMechanics(mechanics)
      else send({ kind: 'mechanics', mechanics })
    },
    brush(points: StrokePoint[], radius: number, hardness: number, mode: BrushMode, strength: number, first: boolean) {
      if (core) core.brush(points, radius, hardness, mode, strength, first)
      else send({ kind: 'brush', points, radius, hardness, mode, strength, first, topology: mirror!.topology })
    },
    undoBrush() { if (core) core.undoBrush(); else send({ kind: 'undo' }) },
    clearPaint() { if (core) core.clearPaint(); else send({ kind: 'clearPaint' }) },
    // Grow anyway. Only offered before the first playback, while the crossings still block it.
    ignoreStartingOverlaps() { core?.ignoreStartingOverlaps() },
    // The starting-shape point under a click on the grown surface, for placing point and line layers.
    restPointNear(point: Vec3): Vec3 {
      if (core) return core.restPoint(core.nearestVertex(point))
      const { positions, rest } = mirror!
      let best = 0, bestDistance = Infinity
      for (let v = 0; v < positions.length / 3; v++) {
        const d = (positions[v * 3] - point[0]) ** 2 + (positions[v * 3 + 1] - point[1]) ** 2 + (positions[v * 3 + 2] - point[2]) ** 2
        if (d < bestDistance) { bestDistance = d; best = v }
      }
      return [rest[best * 3], rest[best * 3 + 1], rest[best * 3 + 2]]
    },

    // Timeline snapshot of a model that hasn't played yet, such as one just opened.
    snapNow(): Snap {
      if (!core) throw new Error('This model is in the simulation worker. Use requestSnap.')
      return snapOfDisk(core)
    },
    // A snapshot that includes every edit made before the request.
    requestSnap(): Promise<Snap> {
      if (core) return Promise.resolve(snapOfDisk(core))
      const id = ++requestId
      return new Promise(resolve => {
        pending.set(id, resolve)
        send({ kind: 'snap', id })
      })
    },

    play(steps: number | null, phased: boolean, config: PlayConfig, next: PlayHandlers) {
      if (released) return
      if (core) goRemote()
      handlers = next
      busy = true
      send({ kind: 'play', run: ++runId, steps, phased, config })
    },
    configure(config: PlayConfig) { if (busy) send({ kind: 'configure', config }) },
    // The worker stops after the step it is on; busy stays true until then.
    stop() { if (busy) send({ kind: 'stop' }) },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    // The app moved on to another model. Answer outstanding snapshot requests, then end the worker.
    release() {
      released = true
      handlers = null
      listeners.clear()
      if (!pending.size) terminate()
    },
  }
}
