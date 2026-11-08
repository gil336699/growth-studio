// Owns one growing model inside the simulation worker. It plays at the pace the page asks for, applies edits
// between steps, and sends the page frames of what changed, one at a time, no faster than the page draws them.
import { snapOfDisk, stopReached, type PlayConfig, type Snap } from '../lib/playback'
import { createGrowingDisk, type BrushMode, type DISK_DEFAULTS, type DiskLiveState, type GrowingDisk, type StepStatus, type StrokePoint } from './growingDisk'
import type { GrowthLayer } from './growthLayers'

type Mechanics = typeof DISK_DEFAULTS
export type Rim = GrowingDisk['openRims'][number]
export type FrameStats = {
  clock: number; strain: number; splits: number; growthBudget: number; rejectedSteps: number; growthThrottle: number
  lastContactCorrections: number; stepStatus: StepStatus; canGrow: boolean; canUndoBrush: boolean; phaseIndex: number | null
}
// Arrays are sent only when they changed. A new topology replaces every per-vertex array.
export type Frame = {
  stats: FrameStats
  positions?: Float32Array
  field?: Float32Array
  localGrowth?: Float32Array
  contactHeat?: Float32Array
  topology?: { revision: number; indices: Uint32Array; uv: Float32Array; rest: Float64Array; referencePositions: Float32Array; openRims: Rim[] }
}
export type ToRunner =
  | { kind: 'load'; source: { positions: Float32Array; indices: Uint32Array } | null; remeshLength: number; state: DiskLiveState; mechanics: Mechanics }
  // steps: null plays until stopped; a number runs that many steps, as the Step button does.
  | { kind: 'play'; run: number; steps: number | null; phased: boolean; config: PlayConfig }
  | { kind: 'configure'; config: PlayConfig }
  | { kind: 'stop' }
  | { kind: 'mechanics'; mechanics: Mechanics }
  | { kind: 'layers'; layers: GrowthLayer[] }
  // topology: the page's topology revision when the face was picked, so a face from an older mesh isn't used.
  | { kind: 'brush'; points: StrokePoint[]; radius: number; hardness: number; mode: BrushMode; strength: number; first: boolean; topology: number }
  | { kind: 'undo' }
  | { kind: 'clearPaint' }
  | { kind: 'snap'; id: number }
  // The page drew the last frame and can take another.
  | { kind: 'ack' }
export type FromRunner =
  | { kind: 'frame'; frame: Frame }
  | { kind: 'stopped'; run: number; reason: string; frame: Frame }
  | { kind: 'snapshot'; snap: Snap }
  | { kind: 'snap'; id: number; snap: Snap }
  | { kind: 'error'; message: string }

export const statsOf = (disk: GrowingDisk, phaseIndex: number | null): FrameStats => ({
  clock: disk.clock, strain: disk.strain, splits: disk.splits, growthBudget: disk.growthBudget, rejectedSteps: disk.rejectedSteps,
  growthThrottle: disk.growthThrottle, lastContactCorrections: disk.lastContactCorrections, stepStatus: disk.stepStatus,
  canGrow: disk.canGrow, canUndoBrush: disk.canUndoBrush, phaseIndex,
})

type Run = { id: number; steps: number | null; remaining: number; phase: { index: number; remaining: number } | null; timer?: ReturnType<typeof setTimeout> }

export function createSimulationRunner(post: (message: FromRunner, transfer: Transferable[]) => void) {
  let disk: GrowingDisk | null = null
  let imported = false
  let config: PlayConfig | null = null
  let run: Run | null = null
  // What the page already has, so a frame carries only what changed.
  let sentIndices: Uint32Array | null = null
  let sentGeometry = 0, sentField = 0, topology = 0
  let stepped = false, dirty = false, inFlight = false

  function frame(): [Frame, Transferable[]] {
    const d = disk!
    const transfer: Transferable[] = []
    const copy = <T extends Float32Array | Uint32Array>(array: T) => {
      const out = array.slice() as T
      transfer.push(out.buffer)
      return out
    }
    const reshaped = d.indices !== sentIndices
    const out: Frame = { stats: statsOf(d, run?.phase?.index ?? null) }
    if (reshaped) {
      sentIndices = d.indices
      const rest = Float64Array.from(d.rest)
      transfer.push(rest.buffer)
      out.topology = { revision: ++topology, indices: copy(d.indices), uv: copy(d.uv), rest, referencePositions: copy(d.referencePositions), openRims: d.openRims }
    }
    if (reshaped || d.geometryRevision !== sentGeometry) out.positions = copy(d.positions)
    if (reshaped || d.fieldRevision !== sentField) out.field = copy(d.field)
    if (reshaped || stepped) {
      out.localGrowth = copy(d.localGrowth)
      out.contactHeat = copy(d.contactHeat)
    }
    sentGeometry = d.geometryRevision
    sentField = d.fieldRevision
    stepped = false
    dirty = false
    inFlight = true
    return [out, transfer]
  }
  function flush() {
    if (!disk || !dirty || inFlight) return
    const [out, transfer] = frame()
    post({ kind: 'frame', frame: out }, transfer)
  }
  function end(reason: string) {
    if (!run) return
    clearTimeout(run.timer)
    const id = run.id
    run.phase = null
    const [out, transfer] = frame()
    run = null
    post({ kind: 'stopped', run: id, reason, frame: out }, transfer)
  }
  const period = (current: Run) => current.steps === null ? 40 : 16

  // One batch of steps, as the page used to run between redraws. Imported meshes stop a batch after 12 ms,
  // so edits and Stop are never kept waiting behind more than one slow step.
  function runBatch() {
    const current = run, d = disk
    if (!current || !d || !config) return
    const { stepsPerUpdate, relaxing, every, stopAt, phases } = config
    const started = performance.now()
    const deadline = started + 12
    let limit = current.steps === null ? stepsPerUpdate : current.remaining
    if (stopAt.kind === 'step') limit = Math.min(limit, Math.max(0, stopAt.value - d.clock))
    let attempts = 0
    let stop = ''
    while (!stop && attempts < limit && (attempts === 0 || !imported || performance.now() < deadline)) {
      const phase = current.phase
      const relax = phase ? phases[phase.index]?.mode === 'relax' : relaxing
      const before = d.clock
      d.step(!relax)
      attempts++
      stepped = true
      if (d.clock !== before && d.clock % every === 0) post({ kind: 'snapshot', snap: snapOfDisk(d) }, [])
      if (phase && --phase.remaining <= 0) {
        const next = phase.index + 1
        if (next >= phases.length) stop = 'Phases finished.'
        else { phase.index = next; phase.remaining = phases[next].steps }
      }
    }
    if (!stop && !(current.phase && phases[current.phase.index]?.mode === 'relax') && !relaxing) stop = stopReached(d, stopAt)
    if (!stop && stopAt.kind === 'step' && d.clock >= stopAt.value) stop = `Stopped at step ${d.clock}.`
    dirty = true
    if (stop) return end(stop)
    if (current.steps !== null) {
      current.remaining -= Math.max(1, attempts)
      if (current.remaining <= 0) return end('')
    }
    current.timer = setTimeout(guarded(runBatch), Math.max(0, period(current) - (performance.now() - started)))
    flush()
  }

  function fail(error: unknown) {
    if (run) clearTimeout(run.timer)
    run = null
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) }, [])
  }
  const guarded = (fn: () => void) => () => { try { fn() } catch (error) { fail(error) } }

  function handle(message: ToRunner) {
    if (message.kind === 'load') {
      disk = createGrowingDisk(message.source ?? undefined, message.remeshLength, message.state.snapshot, message.state.live)
      disk.setMechanics(message.mechanics)
      imported = Boolean(message.source)
      // The page starts from the same state, so the first frame carries only what changes after this.
      sentIndices = disk.indices
      sentGeometry = disk.geometryRevision
      sentField = disk.fieldRevision
      return
    }
    if (message.kind === 'ack') { inFlight = false; flush(); return }
    const d = disk
    if (!d) return
    switch (message.kind) {
      case 'play': {
        if (run) clearTimeout(run.timer)
        config = message.config
        const phases = config.phases
        run = {
          id: message.run, steps: message.steps, remaining: message.steps ?? 0,
          phase: message.phased && phases.length ? { index: 0, remaining: phases[0].steps } : null,
        }
        run.timer = setTimeout(guarded(runBatch), period(run))
        return
      }
      case 'configure': config = message.config; return
      case 'stop': end(''); return
      case 'mechanics': d.setMechanics(message.mechanics); break
      case 'layers': d.setLayers(message.layers); break
      case 'brush': {
        const points = message.topology === topology ? message.points : message.points.map(point => ({ ...point, face: -1 }))
        d.brush(points, message.radius, message.hardness, message.mode, message.strength, message.first)
        break
      }
      case 'undo': d.undoBrush(); break
      case 'clearPaint': d.clearPaint(); break
      case 'snap': post({ kind: 'snap', id: message.id, snap: snapOfDisk(d) }, []); return
    }
    dirty = true
    flush()
  }

  return { handle: (message: ToRunner) => guarded(() => handle(message))() }
}
