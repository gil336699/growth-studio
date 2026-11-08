import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { LayersPanel } from './components/LayersPanel'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { Timeline, type SnapshotMark } from './components/Timeline'
import { TooltipLayer } from './components/Tooltip'
import { TabPanel, Tabs } from './components/Tabs'
import { Variants } from './components/Variants'
import { Viewport, type Disk, type StrokePoint } from './components/Viewport'
import { ViewportBars } from './components/ViewportBars'
import { BRUSH_TOOLS, rimName, type Tool } from './lib/tools'
import {
  BRUSH_DEFAULTS, deserializeDiskProject, serializeDiskProject, STOP_DEFAULTS,
  type BrushSettings, type DiskView, type Overlay, type Phase, type StopAt,
} from './lib/diskProject'
import { formSize, rimWaves } from './lib/formReadouts'
import { exportBinaryStl, exportObj } from './lib/meshExport'
import { PRESETS } from './lib/presets'
import { rangeFill } from './lib/rangeFill'
import { saveFile, type SaveResult } from './lib/saveFile'
import { createGrowingDisk, DISK_DEFAULTS, diskGravityDirection, type BrushMode, type DiskSnapshot } from './physics/growingDisk'
import type { GrowthLayer, Vec3 } from './physics/growthLayers'
import { growthExportPositions, readGrowthStl, type GrowthStlSource } from './physics/growthStl'
import { MAX_TRIANGLES, SLOW_TRIANGLES, stlTriangleCount } from './lib/stl'

type Mechanics = typeof DISK_DEFAULTS
type Snap = { mark: SnapshotMark; snapshot: DiskSnapshot }
const MAX_SNAPSHOTS = 80
const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`

const markOf = (disk: Disk): SnapshotMark => ({
  step: disk.clock, strain: disk.strain, size: formSize(disk.positions, disk.referencePositions).multiple,
})
const snapOf = (disk: Disk): Snap => ({ mark: markOf(disk), snapshot: disk.snapshot() })
// Keep the newest snapshots; thin out older ones when the list is full.
const keepSnapshots = (snaps: Snap[]) => snaps.length <= MAX_SNAPSHOTS ? snaps
  : snaps.filter((_, i) => i === 0 || i >= snaps.length / 2 || i % 2 === 0)

function Slider({ label, value, display, min, max, step, title, onChange, disabled }: {
  label: string; value: number; display: string; min: number; max: number; step: number; title: string
  onChange: (value: number) => void; disabled?: boolean
}) {
  return <label data-tip={title}><span>{label} <b>{display}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={rangeFill(value, min, max)}
      onChange={event => onChange(event.currentTarget.valueAsNumber)} />
  </label>
}

const QUICK_START_KEY = 'growth-studio:quick-start-dismissed'
const quickStartDismissed = () => { try { return localStorage.getItem(QUICK_START_KEY) === '1' } catch { return false } }

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or stop'], ['.', 'Step'], ['O', 'Orbit'], ['B', 'Paint'], ['E', 'Erase'], ['S', 'Smooth'],
  ['[ and ]', 'Brush size'], ['⌘Z or Ctrl+Z', 'Undo brush stroke'], ['G', 'Next color overlay'], ['F', 'Frame the model'],
  ['1 to 4', 'Mesh view'], ['⌘S or Ctrl+S', 'Save project'], ['Esc', 'Back to orbit'], ['?', 'Show shortcuts'],
]

export function App() {
  const [disk, setDisk] = useState<Disk>(() => createGrowingDisk())
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const [manualQueue, setManualQueue] = useState(0)
  const [relaxing, setRelaxing] = useState(false)
  const [mechanics, setMechanics] = useState<Mechanics>(DISK_DEFAULTS)
  const [layers, setLayersState] = useState<GrowthLayer[]>(() => disk.layers)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() => disk.layers[0]?.id ?? null)
  const [tool, setTool] = useState<Tool>('orbit')
  const [brush, setBrush] = useState<BrushSettings>(BRUSH_DEFAULTS)
  const [overlay, setOverlay] = useState<Overlay>('field')
  const [ghost, setGhost] = useState(false)
  const [view, setView] = useState<DiskView>('cells')
  const [previewRim, setPreviewRim] = useState<number | null>(null)
  const [cameraKey, setCameraKey] = useState(0)
  const [input, setInput] = useState<GrowthStlSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const [centerExport, setCenterExport] = useState(false)
  const [projectStatus, setProjectStatus] = useState('')
  const [projectError, setProjectError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [speed, setSpeed] = useState(3)
  const [batch, setBatch] = useState(100)
  const [importSpeed, setImportSpeed] = useState(1)
  const [importBatch, setImportBatch] = useState(10)
  const [stopAt, setStopAt] = useState<StopAt>(STOP_DEFAULTS)
  const [phases, setPhases] = useState<Phase[]>([])
  const [phaseIndex, setPhaseIndex] = useState<number | null>(null)
  const phaseRun = useRef<{ index: number; remaining: number } | null>(null)
  const [snapshots, setSnapshots] = useState<Snap[]>(() => [snapOf(disk)])
  const [viewing, setViewing] = useState<number | null>(null)
  const [every, setEvery] = useState(50)
  const [edits, setEdits] = useState(0)
  const [savedPoint, setSavedPoint] = useState({ step: 0, edits: 0 })
  const [notice, setNotice] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState(() => !quickStartDismissed())
  const closeQuickStart = () => {
    setShowQuickStart(false)
    try { localStorage.setItem(QUICK_START_KEY, '1') } catch { /* Private windows may block storage. */ }
  }
  const [leftTab, setLeftTab] = useState<'field' | 'simulation'>('field')
  const [rightTab, setRightTab] = useState<'form' | 'explore' | 'file'>('form')
  const inputRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef<HTMLInputElement>(null)

  const step = disk.clock
  const rims = disk.openRims
  const unsaved = step !== savedPoint.step || edits !== savedPoint.edits
  // Actions that replace the current design ask first in an in-app dialog; browser confirm dialogs can be blocked.
  const [pending, setPending] = useState<{ title: string; confirm: string; run: () => void } | null>(null)
  const guard = (title: string, confirm: string, run: () => void) => {
    if (unsaved) setPending({ title, confirm, run })
    else run()
  }
  const touch = () => setEdits(value => value + 1)
  const manualSteps = input ? importBatch : batch
  const stepsPerUpdate = input ? importSpeed : speed
  const active = running || manualQueue > 0
  const canSimulate = !loading && !disk.initialOverlap && disk.canGrow
  const selectedLayer = layers.find(layer => layer.id === selectedLayerId) ?? layers[0]

  const applyLayers = useCallback((next: GrowthLayer[], target = disk) => {
    target.setLayers(next)
    setLayersState(target.layers)
    touch()
  }, [disk])
  // Build on the latest settings so two quick changes in a row both apply.
  const change = (key: keyof Mechanics, value: number) => setMechanics(current => {
    const settings = { ...current, [key]: value }
    disk.setMechanics(settings)
    return settings
  })
  // Swap in a new solver state and the controls that describe it.
  const adopt = (next: Disk, keepTimeline = false) => {
    setDisk(next)
    setLayersState(next.layers)
    setSelectedLayerId(current => next.layers.some(layer => layer.id === current) ? current : next.layers[0]?.id ?? null)
    setPreviewRim(null)
    if (!keepTimeline) { setSnapshots([snapOf(next)]); setViewing(null) }
    setTick(value => value + 1)
  }
  const stopPlayback = () => {
    setRunning(false)
    setManualQueue(0)
    phaseRun.current = null
    setPhaseIndex(null)
  }
  const freshSurface = (source: GrowthStlSource | null, keepLayers: GrowthLayer[] | null) => {
    const fresh = createGrowingDisk(source ?? undefined, mechanics.remeshLength)
    fresh.setMechanics(mechanics)
    if (keepLayers) {
      // Keep layers whose rim still exists on the new surface.
      const count = fresh.openRims.length
      fresh.setLayers(keepLayers.filter(layer => layer.kind !== 'rim' || layer.rim === 'all' || layer.rim < count))
    }
    return fresh
  }
  const reset = () => {
    stopPlayback()
    setRelaxing(false)
    adopt(freshSurface(input, layers))
    setSavedPoint({ step: 0, edits })
    setNotice('')
    setExportStatus('')
    setProjectStatus('')
    setProjectError('')
  }
  const importStl = async (file: File) => {
    stopPlayback()
    setLoading(true)
    setImportError('')
    try {
      const buffer = await file.arrayBuffer()
      const triangles = stlTriangleCount(buffer)
      if (triangles > MAX_TRIANGLES) {
        throw new Error(`This STL has about ${triangles.toLocaleString()} triangles, more than Growth Studio can prepare (${MAX_TRIANGLES.toLocaleString()}). Reduce it in your CAD tool, for example Fusion's Mesh › Reduce, to under ${SLOW_TRIANGLES.toLocaleString()} for interactive growth.`)
      }
      const source = readGrowthStl(buffer, file.name)
      const fresh = freshSurface(source, null)
      setInput(source)
      adopt(fresh)
      setCenterExport(false)
      // Cell outlines on a very dense mesh are slow and hide the form, so start large meshes on the plain surface.
      setView(current => fresh.indices.length / 3 > SLOW_TRIANGLES ? 'smooth' : current === 'fans' ? 'fans' : 'cells')
      setTool('orbit')
      setOverlay('field')
      setSavedPoint({ step: 0, edits })
      setNotice('')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not prepare this STL.')
    } finally {
      setLoading(false)
    }
  }
  const switchToDefaultDisk = () => {
    stopPlayback()
    setInput(null)
    adopt(freshSurface(null, null))
    setImportError('')
    setSavedPoint({ step: 0, edits })
  }

  const modelName = (input?.name.replace(/\.stl$/i, '') ?? 'default-disk')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'surface'
  const snapshotName = `${modelName}-step-${step}`
  const describe = (result: SaveResult, filename: string) => result === 'saved' ? `Saved ${filename}.`
    : result === 'downloaded' ? `Download requested for ${filename}. If no file appears, open Growth Studio in Chrome or Safari.`
      : result === 'cancelled' ? 'Save cancelled.' : `Could not save ${filename}.`
  const exportMesh = async (format: 'obj' | 'stl') => {
    const positions = input ? growthExportPositions(disk.positions, input, centerExport) : disk.positions
    const data = format === 'obj' ? exportObj(positions, disk.indices, snapshotName) : exportBinaryStl(positions, disk.indices, snapshotName)
    const filename = `${snapshotName}.${format}`
    const result = await saveFile(filename, data, format === 'obj' ? 'text/plain' : 'model/stl', format === 'obj' ? 'OBJ mesh' : 'STL mesh')
    setExportStatus(describe(result, filename))
  }
  // Resolves true once the project is written or handed to the browser as a download.
  const saveProject = async () => {
    const source = input && { ...input, positions: Array.from(input.positions), indices: Array.from(input.indices) }
    const json = serializeDiskProject({
      source, disk: disk.snapshot(), mechanics, revision: step, centerExport, relaxing, view,
      speed, batch, importSpeed, importBatch, brush, overlay, ghost, phases, stopAt,
    })
    const filename = `${snapshotName}.growthstudio.json`
    const saved = { step, edits }
    const result = await saveFile(filename, json, 'application/json', 'Growth Studio project')
    setProjectError('')
    setProjectStatus(describe(result, filename))
    // Shown in the header too, since the File tab may be hidden when saving with ⌘S.
    setNotice(describe(result, filename))
    if (result === 'saved' || result === 'downloaded') { setSavedPoint(saved); return true }
    return false
  }
  const openProject = async (file: File) => {
    setLoading(true)
    setProjectError('')
    setProjectStatus('')
    try {
      const project = deserializeDiskProject(await file.text())
      const restored = createGrowingDisk(project.source ?? undefined, project.mechanics.remeshLength, project.disk)
      restored.setMechanics(project.mechanics)
      stopPlayback()
      setInput(project.source)
      adopt(restored)
      setCenterExport(project.centerExport ?? false)
      setMechanics(project.mechanics)
      setRelaxing(project.relaxing)
      setView(project.view)
      setSpeed(project.speed)
      setBatch(project.batch)
      setImportSpeed(project.importSpeed)
      setImportBatch(project.importBatch)
      setBrush(project.brush)
      setOverlay(project.overlay)
      setGhost(project.ghost)
      setPhases(project.phases)
      setStopAt(project.stopAt)
      setTool('orbit')
      setImportError('')
      setExportStatus('')
      setNotice('')
      setSavedPoint({ step: restored.clock, edits })
      setProjectStatus(`Opened ${file.name}.`)
    } catch (error) {
      setProjectError(error instanceof SyntaxError ? 'This project file could not be read.'
        : error instanceof Error ? error.message : 'Could not open this project.')
    } finally {
      setLoading(false)
    }
  }

  // Continuing from an earlier snapshot replaces the snapshots after it.
  const branchIfViewingPast = () => {
    if (viewing === null) return
    setSnapshots(current => current.slice(0, viewing + 1))
    setViewing(null)
  }
  const scrub = (index: number | null) => {
    // Leaving the live shape keeps it as the newest snapshot, so scrubbing back to the end loses nothing.
    let list = snapshots
    if (viewing === null && snapshots.at(-1)?.mark.step !== step) {
      list = keepSnapshots([...snapshots, snapOf(disk)])
      setSnapshots(list)
    }
    const target = index ?? list.length - 1
    const snap = list[target]
    if (!snap) return
    const restored = createGrowingDisk(input ?? undefined, mechanics.remeshLength, snap.snapshot)
    restored.setMechanics(mechanics)
    adopt(restored, true)
    setViewing(index)
    setNotice('')
  }
  const takeSnapshot = () => {
    branchIfViewingPast()
    setSnapshots(current => keepSnapshots([...current.filter(s => s.mark.step !== step), snapOf(disk)]))
  }
  const play = () => {
    branchIfViewingPast()
    setNotice('')
    setRunning(true)
  }
  const stepOnce = () => {
    branchIfViewingPast()
    setNotice('')
    setManualQueue(manualSteps)
  }
  const runPhases = () => {
    if (!phases.length) return
    branchIfViewingPast()
    phaseRun.current = { index: 0, remaining: phases[0].steps }
    setPhaseIndex(0)
    setNotice('')
    setRunning(true)
  }

  const stopReached = (target: Disk): string => {
    if (stopAt.kind === 'step' && target.clock >= stopAt.value) return `Stopped at step ${target.clock}.`
    if (stopAt.kind === 'strain' && target.strain >= stopAt.value) return `Stopped at ${percent(target.strain)} target strain.`
    if (stopAt.kind === 'size') {
      const size = formSize(target.positions, target.referencePositions).multiple
      if (size >= stopAt.value) return `Stopped at ${size.toFixed(2)}× the starting size.`
    }
    return ''
  }

  // Runs growth in batches. After each batch it waits for the browser to draw a frame before starting the
  // next one, so the view and orbiting stay responsive even when a single step takes longer than a frame.
  useEffect(() => {
    if (!running && !manualQueue) return
    let remaining = manualQueue
    const period = running ? 40 : 16
    let timer = 0, frame = 0, fallback = 0, cancelled = false
    const runBatch = () => {
      if (cancelled) return
      const started = performance.now()
      const deadline = started + 12
      let limit = running ? stepsPerUpdate : remaining
      if (stopAt.kind === 'step') limit = Math.min(limit, Math.max(0, stopAt.value - disk.clock))
      let attempts = 0
      let stop = ''
      while (!stop && attempts < limit && (attempts === 0 || !input || performance.now() < deadline)) {
        const phase = phaseRun.current
        const relax = phase ? phases[phase.index]?.mode === 'relax' : relaxing
        const before = disk.clock
        disk.step(!relax)
        attempts++
        if (disk.clock !== before && disk.clock % every === 0) {
          const snap = snapOf(disk)
          setSnapshots(current => keepSnapshots([...current.filter(s => s.mark.step !== snap.mark.step), snap]))
        }
        if (phase && --phase.remaining <= 0) {
          const next = phase.index + 1
          if (next >= phases.length) stop = 'Phases finished.'
          else { phase.index = next; phase.remaining = phases[next].steps; setPhaseIndex(next) }
        }
      }
      if (!stop && !(phaseRun.current && phases[phaseRun.current.index]?.mode === 'relax') && !relaxing) stop = stopReached(disk)
      if (!stop && stopAt.kind === 'step' && disk.clock >= stopAt.value) stop = `Stopped at step ${disk.clock}.`
      setTick(value => value + 1)
      if (stop) {
        stopPlayback()
        setNotice(stop)
        return
      }
      if (!running) {
        remaining -= Math.max(1, attempts)
        if (remaining <= 0) {
          setManualQueue(0)
          return
        }
      }
      // Keep the usual pace between batches, but never start one before a frame has been drawn. When the
      // browser draws no frames, as in a covered window, the fallback keeps growth going at a slower pace.
      const next = () => {
        cancelAnimationFrame(frame)
        window.clearTimeout(fallback)
        timer = window.setTimeout(runBatch, Math.max(0, period - (performance.now() - started)))
      }
      frame = requestAnimationFrame(next)
      fallback = window.setTimeout(next, 100)
    }
    timer = window.setTimeout(runBatch, period)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(fallback)
      cancelAnimationFrame(frame)
    }
  // stopReached reads stopAt, which is a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, manualQueue, disk, stepsPerUpdate, relaxing, input, every, phases, stopAt])

  // Brush strokes: one stroke per drag, merged across symmetric copies.
  const onStroke = (points: StrokePoint[], pressure: number, first: boolean) => {
    if (!BRUSH_TOOLS.includes(tool)) return
    const paintLayer = layers.find(layer => layer.kind === 'paint')
    if (paintLayer && !paintLayer.visible) applyLayers(layers.map(layer => layer.kind === 'paint' ? { ...layer, visible: true } : layer))
    if (first) disk.beginBrushStroke()
    const merged = new Map<number, number>()
    for (const { face, point } of points) {
      for (const { vertex, amount } of disk.brushFootprint(face, point, brush.radius, brush.hardness)) {
        merged.set(vertex, Math.max(merged.get(vertex) ?? 0, amount))
      }
    }
    disk.paintStroke([...merged].map(([vertex, amount]) => ({ vertex, amount })), tool as BrushMode, brush.strength * pressure)
    touch()
    setTick(value => value + 1)
  }
  const onPlace = (point: Vec3) => {
    const rest = disk.restPoint(disk.nearestVertex(point))
    if (tool === 'point' && selectedLayer?.kind === 'point') {
      applyLayers(layers.map(layer => layer.id === selectedLayer.id ? { ...layer, center: rest } as GrowthLayer : layer))
    } else if (tool === 'line' && selectedLayer?.kind === 'line') {
      applyLayers(layers.map(layer => layer.id === selectedLayer.id && layer.kind === 'line' ? { ...layer, points: [...layer.points, rest] } : layer))
    } else {
      setNotice(tool === 'point' ? 'Select a point layer to place it.' : 'Select a line layer to draw it.')
    }
  }
  const undoStroke = () => {
    disk.undoBrush()
    touch()
    setTick(value => value + 1)
  }

  // Form goals: one control for fold size that sets rim width and bend together.
  const rimLayers = layers.filter(layer => layer.kind === 'rim')
  const foldSize = rimLayers.length && rimLayers[0].kind === 'rim' ? Math.min(1, Math.max(0, (rimLayers[0].width - 0.05) / 0.3)) : 0.35
  const setFoldSize = (t: number) => {
    const width = 0.05 + 0.3 * t, bending = 0.02 + 0.12 * t
    applyLayers(layers.map(layer => layer.kind === 'rim' ? { ...layer, width } : layer))
    change('bending', Number(bending.toFixed(3)))
  }
  const applyPreset = (id: string) => {
    const preset = PRESETS.find(p => p.id === id)
    if (!preset) return
    const built = preset.build(rims.length)
    const nextMechanics = { ...mechanics, ...built.mechanics }
    disk.setMechanics(nextMechanics)
    setMechanics(nextMechanics)
    applyLayers(built.layers)
    setSelectedLayerId(built.layers[0]?.id ?? null)
    if (built.phases) setPhases(built.phases)
    if (built.stopAt) setStopAt(built.stopAt)
    setNotice(`Applied ${preset.name}. Press Play growth${built.phases ? ' or Run phases' : ''}.`)
  }
  const useVariant = (snapshot: DiskSnapshot, variantMechanics: Mechanics, variantLayers: GrowthLayer[]) => {
    stopPlayback()
    branchIfViewingPast()
    const next = createGrowingDisk(input ?? undefined, variantMechanics.remeshLength, snapshot)
    next.setMechanics(variantMechanics)
    next.setLayers(variantLayers)
    setMechanics(variantMechanics)
    adopt(next, true)
    setSnapshots(current => keepSnapshots([...current.filter(s => s.mark.step < next.clock), snapOf(next)]))
    touch()
    setNotice('Continuing from the chosen variant.')
  }

  // Keyboard shortcuts, ignored while typing in a field. Re-registered each render so handlers see current state.
  useEffect(() => {
  const onKey = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input, select, textarea') && event.key !== 'Escape') return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); if (!active) void saveProject(); return }
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (disk.canUndoBrush) undoStroke(); return }
    if (mod || event.altKey) return
    const key = event.key
    if (key === ' ') { event.preventDefault(); if (active) stopPlayback(); else if (canSimulate) play() }
    else if (key === '.') { if (!active && canSimulate) stepOnce() }
    else if (key === 'o' || key === 'O') setTool('orbit')
    else if (key === 'b' || key === 'B') setTool('paint')
    else if (key === 'e' || key === 'E') setTool('erase')
    else if (key === 's' || key === 'S') setTool('smooth')
    else if (key === '[') setBrush(b => ({ ...b, radius: Math.max(0.02, +(b.radius / 1.15).toFixed(3)) }))
    else if (key === ']') setBrush(b => ({ ...b, radius: Math.min(0.6, +(b.radius * 1.15).toFixed(3)) }))
    else if (key === 'g' || key === 'G') setOverlay(o => (['field', 'growth', 'contact', 'none'] as Overlay[])[(['field', 'growth', 'contact', 'none'].indexOf(o) + 1) % 4])
    else if (key === 'f' || key === 'F') setCameraKey(k => k + 1)
    else if (['1', '2', '3', '4'].includes(key)) setView((['smooth', 'triangles', 'cells', 'fans'] as DiskView[])[Number(key) - 1])
    else if (key === 'Escape') { setTool('orbit'); setShowHelp(false); setPending(null) }
    else if (key === '?') setShowHelp(show => !show)
  }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const gravityArrow = useMemo(() => mechanics.gravity > 0
    ? [new Vector3(...diskGravityDirection(mechanics)), new Vector3(), 0.25 + 0.55 * mechanics.gravity, '#ffda68', 0.13, 0.075] satisfies [Vector3, Vector3, number, string, number, number]
    : null, [mechanics])
  const size = formSize(disk.positions, disk.referencePositions, input?.scale)
  const growingRims = rims.filter(rim => layers.some(layer => layer.visible && layer.kind === 'rim' && (layer.rim === 'all' || layer.rim === rim.index)))
  const waves = growingRims.map(rim => ({
    name: rimName(rims, rim.index), count: rimWaves(rim, disk.referencePositions, disk.positions),
  }))
  const detailLimit = disk.positions.length / 3 >= disk.growthBudget
  const contactStatus = disk.initialOverlap ? 'Starting mesh overlaps'
    : disk.stepStatus === 'contact' ? 'Contact blocked the last step'
      : disk.lastContactCorrections > 0 ? 'Contact corrected last step' : ''
  const slowed = !relaxing && disk.growthThrottle < 0.995
  const phaseMode = phaseIndex !== null ? phases[phaseIndex]?.mode : null
  // While paused, a stop message explains why playback ended; contact status shows otherwise.
  const playbackStatus = loading ? 'Loading…' : !active && notice ? notice : contactStatus || (active
    ? (phaseMode ? `Phase ${phaseIndex! + 1}: ${phaseMode === 'relax' ? 'relaxing' : 'growing'}`
      : relaxing ? 'Relaxing' : slowed ? `Growing at ${Math.round(disk.growthThrottle * 100)}% (contact)` : 'Growing')
    : notice || (!disk.canGrow ? (rims.length ? 'No growth field. Turn on a layer or paint' : 'No open rims. Paint growth or add a layer') : 'Paused'))
  const caption = tool === 'point' ? 'Click the model to place the point · Esc to finish'
    : tool === 'line' ? 'Click to add line points · Esc to finish'
      : BRUSH_TOOLS.includes(tool) ? 'Left drag to brush · Right drag to orbit · [ ] size'
        : 'Drag to orbit · Right drag to pan · Scroll to zoom'
  const blockedReason = loading ? 'Preparing the surface…'
    : disk.initialOverlap ? 'The starting surface crosses itself. Choose Grow anyway in the Starting surface card first.'
      : !disk.canGrow ? (rims.length ? 'Nothing grows yet. Turn on a layer, or paint growth onto the model.'
        : 'This surface has no open rims. Paint growth onto the model, or add a point, line, height, or noise layer.')
        : ''
  const rimEdges = previewRim === null ? undefined : previewRim === -1 ? rims.flatMap(rim => rim.edges) : rims[previewRim]?.edges

  const transport = <div className="transport" role="group" aria-label="Playback">
    <button className="primary" disabled={!active && !canSimulate} data-key="Space"
      data-tip={active ? 'Stop growing.' : blockedReason || (relaxing ? 'Let the shape settle without adding growth, until you stop it.' : 'Grow continuously until you stop it, or until Stop at is reached.')}
      onClick={() => active ? stopPlayback() : play()}><Icon name={active ? 'stop' : 'play'} />{active ? 'Stop' : relaxing ? 'Play relaxation' : 'Play growth'}</button>
    <button disabled={active || !canSimulate} data-key="."
      data-tip={active ? 'Stop playback first.' : blockedReason || `Run ${manualSteps} steps, then pause. Change the batch size under Simulation › Advanced.`} onClick={stepOnce}><Icon name="step" /><span className="compact-label">Step {manualSteps}</span></button>
    <button disabled={loading} data-tip="Go back to the starting surface and clear the timeline and paint. Your layers and settings stay."
      onClick={() => guard('Reset to the starting surface?', 'Reset', reset)}><Icon name="reset" /><span className="compact-label">Reset</span></button>
  </div>
  const status = <span className="playback-status" role="status" data-warning={Boolean(disk.initialOverlap || disk.stepStatus === 'contact' || detailLimit)}>
    {playbackStatus}{detailLimit && <><span aria-hidden="true"> · </span>Mesh detail limit</>}
  </span>

  return <main className="studio">
    <div className="stage">
      <Viewport disk={disk} tick={tick} view={view} overlay={overlay} ghost={ghost} imported={Boolean(input)} running={running}
        tool={tool} canEdit={!loading} brush={brush} rimEdges={rimEdges} layers={layers} selectedLayerId={selectedLayer?.id ?? null}
        onStroke={onStroke} onPlace={onPlace} gravityArrow={gravityArrow} cameraKey={cameraKey} />
    </div>

    <header className="brand glass">
      <div><p className="app-kicker">Differential growth</p><h1>Growth Studio</h1></div>
      <button className="icon-button" aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts and the quick start" data-key="?" onClick={() => setShowHelp(true)}>?</button>
    </header>

    <aside className="sidebar side-panel glass" aria-label="Design controls">
      <section className="model-card" aria-labelledby="model-name">
        <p className="eyebrow">Starting surface</p>
        <h2 id="model-name" data-tip={input ? input.name : 'A flat disk with one open rim, ready to grow.'}>{input ? input.name : 'Default disk'}</h2>
        <p className="hint" data-tip={input ? `Prepared with ${disk.preparationSplits} edge splits and ${disk.preparationFlips} balancing flips.` : undefined}>
          {rims.length} open {rims.length === 1 ? 'rim' : 'rims'}{input ? ` · ${(input.indices.length / 3).toLocaleString()} triangles` : ' · flat sheet'}
        </p>
        <input ref={inputRef} type="file" accept=".stl,model/stl" hidden aria-label="Choose an STL file" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importStl(file)
        }} />
        <div className="button-row">
          <button disabled={loading} data-tip="Load an open surface from an STL file, such as a vase base from Fusion. Open rims are found automatically."
            onClick={() => guard('Load a new STL?', 'Discard and choose STL', () => inputRef.current?.click())}>{loading ? 'Preparing…' : 'Upload STL'}</button>
          <button disabled={loading || !input} data-tip={input ? 'Go back to the flat default disk.' : 'You are already using the default disk.'} onClick={() => guard('Switch to the default disk?', 'Discard and switch', switchToDefaultDisk)}>Default disk</button>
        </div>
        {importError && <p className="hint" role="alert">{importError}</p>}
        {disk.indices.length / 3 > SLOW_TRIANGLES && <div className="overlap-warning" role="status">
          <p>{(disk.indices.length / 3).toLocaleString()} triangles: each step can take seconds, and the app pauses while it runs. For interactive growth, reduce below {SLOW_TRIANGLES.toLocaleString()} (Fusion: Mesh › Reduce).</p>
        </div>}
        {disk.initialOverlap && <div className="overlap-warning" role="alert">
          <p>The surface crosses itself in {disk.startingCrossings.toLocaleString()} {disk.startingCrossings === 1 ? 'place' : 'places'}, usually because several bodies were exported together.</p>
          <p>Combine the bodies in Fusion (Modify › Combine), or grow anyway: existing crossings are left alone and new ones are blocked.</p>
          <button type="button" className="wide" data-tip="Grow without fixing the mesh. Existing crossings are left alone, and new ones are still blocked."
            onClick={() => { disk.ignoreStartingOverlaps(); touch(); setTick(value => value + 1) }}>Grow anyway</button>
        </div>}
        {disk.ignoringOverlaps && <p className="hint">Existing crossings are ignored. New crossings are still blocked.</p>}
      </section>

      <Tabs label="Design controls" idBase="design" value={leftTab} onChange={setLeftTab} tabs={[
        { id: 'field', label: 'Growth field', title: 'Where the surface grows: rim, point, line, height, noise, and painted layers.' },
        { id: 'simulation', label: 'Simulation', title: 'How fast it grows, when it stops, and how the sheet bends, falls, and avoids itself.' },
      ]} />
      <TabPanel idBase="design" id="field" value={leftTab}>
        <LayersPanel layers={layers} selectedId={selectedLayer?.id ?? null} rims={rims} tool={tool} timelineEnd={Math.max(step, 600)}
          onSelect={setSelectedLayerId} onChange={next => applyLayers(next)} onTool={setTool} onPreviewRim={setPreviewRim}
          onClearPaint={() => { disk.clearPaint(); touch(); setTick(value => value + 1) }} />
      </TabPanel>
      <TabPanel idBase="design" id="simulation" value={leftTab}>
        <section><h2>Growth</h2>
          <div className="button-row" role="group" aria-label="Simulation mode">
            <button type="button" aria-pressed={!relaxing} disabled={Boolean(manualQueue)} data-tip="Add growth every step." onClick={() => setRelaxing(false)}>Grow</button>
            <button type="button" aria-pressed={relaxing} disabled={Boolean(manualQueue)} data-tip="Let the shape settle and smooth out without adding growth." onClick={() => setRelaxing(true)}>Relax only</button>
          </div>
          <Slider label="Growth rate" value={mechanics.growthRate} display={`${(mechanics.growthRate * 100).toFixed(2)}% ${mechanics.compoundGrowth ? 'of size ' : ''}/ step`}
            min={0} max={0.008} step={0.0005} title="How much the growth field expands each step. Higher grows faster; lower folds more evenly. Zero pauses growth." onChange={value => change('growthRate', value)} />
          <div className="button-row" role="group" aria-label="Growth curve">
            <button type="button" aria-pressed={!mechanics.compoundGrowth} data-tip="Each step adds the same amount of growth." onClick={() => change('compoundGrowth', 0)}>Linear</button>
            <button type="button" aria-pressed={Boolean(mechanics.compoundGrowth)} data-tip="Each step adds a share of the current size, so growth speeds up over time, as in living tissue." onClick={() => change('compoundGrowth', 1)}>Compounding</button>
          </div>
          <Slider label="Bend stiffness" value={mechanics.bending} display={percent(mechanics.bending, 1)} min={0} max={0.3} step={0.005}
            title="How much the sheet resists bending. Higher gives broad, smooth waves; lower allows tight ruffles when the mesh is fine enough." onChange={value => change('bending', value)} />
          <label data-tip="Pause playback automatically when the form reaches a size, a strain, or a timeline step.">Stop at
            <select value={stopAt.kind} onChange={event => {
              const kind = event.currentTarget.value as StopAt['kind']
              setStopAt({ kind, value: kind === 'size' ? 2 : kind === 'step' ? Math.max(100, step + 500) : kind === 'strain' ? 3 : 0 })
            }}>
              <option value="none">Never</option><option value="size">Size</option><option value="strain">Target strain</option><option value="step">Step</option>
            </select>
          </label>
          {stopAt.kind === 'size' && <Slider label="Stop at size" value={stopAt.value} display={`${stopAt.value.toFixed(2)}×`} min={1.05} max={5} step={0.05}
            title="Stop when the form is this many times its starting size." onChange={value => setStopAt({ kind: 'size', value })} />}
          {stopAt.kind === 'strain' && <Slider label="Stop at strain" value={stopAt.value} display={percent(stopAt.value)} min={0.1} max={10} step={0.1}
            title="Stop when the most-grown area reaches this strain." onChange={value => setStopAt({ kind: 'strain', value })} />}
          {stopAt.kind === 'step' && <label data-tip="Stop when the timeline reaches this step.">Stop at step<input className="number-input" type="number" min="1" step="50" value={stopAt.value}
            onChange={event => setStopAt({ kind: 'step', value: Math.max(1, Math.round(Number(event.currentTarget.value) || 1)) })} /></label>}
        </section>

        <section><details><summary data-tip="Pull the growing area in one direction, so folds droop or lean. The rest of the model stays put.">Gravity{mechanics.gravity > 0 ? ` · ${percent(mechanics.gravity)}` : ''}</summary>
          <Slider label="Strength" value={mechanics.gravity} display={percent(mechanics.gravity)} min={0} max={1} step={0.01}
            title="How hard the pull is. It acts on the growth field only." onChange={value => change('gravity', value)} />
          <Slider label="Tilt from down" value={mechanics.gravityTilt} display={`${mechanics.gravityTilt}°`} min={0} max={180} step={1}
            title="Aims the pull away from straight down." onChange={value => change('gravityTilt', value)} />
          <Slider label="Heading" value={mechanics.gravityHeading} display={`${mechanics.gravityHeading}°`} min={0} max={359} step={1}
            title="Rotates a tilted pull around the vertical axis." onChange={value => change('gravityHeading', value)} />
        </details></section>

        <section><details><summary data-tip="How growing folds push apart when they touch, so the surface never passes through itself.">Contact in growth field</summary>
          <Slider label="Repel distance" value={mechanics.repelDistance}
            display={input ? `${(mechanics.repelDistance * input.scale).toFixed(1)} mm` : percent(mechanics.repelDistance, 1)}
            min={0.004} max={0.04} step={0.001} title="How far apart folds in the growth field stay when they meet."
            onChange={value => change('repelDistance', value)} />
          <Slider label="Repel strength" value={mechanics.repelStrength} display={percent(mechanics.repelStrength)} min={0.1} max={1} step={0.05}
            title="How quickly touching folds are pushed back each step." onChange={value => change('repelStrength', value)} />
        </details></section>

        <section><details open={detailLimit || undefined}><summary data-tip="Mesh resolution, motion damping, and playback speed.">Advanced</summary>
          <Slider label="Damping" value={mechanics.damping} display={percent(mechanics.damping)} min={0.02} max={0.9} step={0.01}
            title="Calms wobbling after the sheet bends. Higher settles faster but looks stiffer." onChange={value => change('damping', value)} />
          <Slider label="Remesh edge length" value={mechanics.remeshLength} display={mechanics.remeshLength.toFixed(3)} min={0.09} max={0.25} step={0.005}
            title="Starting triangle size and split threshold. Smaller values hold smaller folds. Press Reset to apply to an STL."
            onChange={value => change('remeshLength', value)} />
          <Slider label="Mesh detail limit" value={mechanics.detailScale} display={`${disk.growthBudget.toLocaleString()} vertices · ${mechanics.detailScale}×`}
            min={1} max={4} step={0.25} title="How many vertices growth can add. Higher limits keep folds refining but run slower."
            onChange={value => change('detailScale', value)} />
          <Slider label="Playback speed" value={stepsPerUpdate} display={`${stepsPerUpdate} ${stepsPerUpdate === 1 ? 'step' : 'steps'} per update`}
            min={1} max={input ? 3 : 5} step={1} title="Steps calculated before each redraw. Higher plays faster but less smoothly." disabled={Boolean(manualQueue)}
            onChange={value => (input ? setImportSpeed : setSpeed)(value)} />
          <Slider label="Manual step size" value={manualSteps} display={String(manualSteps)} min={10} max={input ? 30 : 100} step={10}
            title="How many steps the Step button runs." onChange={value => (input ? setImportBatch : setBatch)(value)} />
        </details></section>
      </TabPanel>
    </aside>

    <section className="center" aria-label="3D view">
      <ViewportBars tool={tool} brush={brush} canUndo={disk.canUndoBrush} overlay={overlay} view={view} ghost={ghost}
        placing={tool === 'point' ? `Placing ${selectedLayer?.name ?? 'point'}` : tool === 'line' ? `Drawing ${selectedLayer?.name ?? 'line'}` : null}
        onTool={setTool} onBrush={setBrush} onUndo={undoStroke} onOverlay={setOverlay} onView={setView} onGhost={setGhost}
        onFrame={() => setCameraKey(k => k + 1)} />
      {showQuickStart && <section className="quick-start glass" aria-labelledby="quick-start-title">
        <h2 id="quick-start-title">Quick start</h2>
        <ol>
          <li><b>Pick a surface:</b> the disk, or Upload STL.</li>
          <li><b>Choose where it grows:</b> layers in Growth field, or Paint on the model.</li>
          <li><b>Press Play growth</b> or Space. Drag the timeline to look back.</li>
        </ol>
        <p>Hover any control to see what it does.</p>
        <button type="button" className="primary" data-tip="Hide this guide. Reopen it from the ? button." onClick={closeQuickStart}>Got it</button>
      </section>}
      <div className="dock">
        <div className="view-caption">
          <span>{caption}</span>
          {overlay !== 'none' && <span className={`field-key key-${overlay}`}>
            {overlay === 'field' ? 'Growth field' : overlay === 'growth' ? 'Growth so far' : 'Recent contact'}
          </span>}
        </div>
        <Timeline marks={snapshots.map(s => s.mark)} viewing={viewing} step={step} strain={disk.strain} every={every} active={active}
          phases={phases} phaseIndex={phaseIndex} onScrub={scrub} onSnapshot={takeSnapshot} onEvery={setEvery}
          onPhases={next => { setPhases(next); touch() }} onRunPhases={runPhases} transport={transport} status={status} />
      </div>
    </section>

    <aside className="inspector side-panel glass" aria-label="Form and output">
      <Tabs label="Form and output" idBase="output" value={rightTab} onChange={setRightTab} tabs={[
        { id: 'form', label: 'Form', title: 'Measurements of the current shape, Fold size, and solver stats.' },
        { id: 'explore', label: 'Explore', title: 'Start from a preset, or grow four variants and keep the one you like.' },
        { id: 'file', label: 'File', title: 'Save or open a project, and export OBJ or STL.', badge: unsaved ? 'unsaved changes' : undefined },
      ]} />
      <TabPanel idBase="output" id="form" value={rightTab}>
        <section><h2>Form</h2>
          <dl className="readouts">
            {waves.map(wave => <div key={wave.name}><dt data-tip="How many waves run around this rim, counted from its ups and downs.">Waves · {wave.name.toLowerCase()}</dt><dd>{wave.count}</dd></div>)}
            <div><dt data-tip="Bounding size compared with the starting surface.">Size</dt><dd>{size.multiple.toFixed(2)}×</dd></div>
            {size.millimeters && <div><dt data-tip="Bounding box of the current shape, in the STL's millimeters.">Dimensions</dt><dd>{size.millimeters.map(v => Math.round(v)).join(' × ')} mm</dd></div>}
            <div><dt data-tip="How far the most-grown area has been told to expand. 100% means its edges want to be twice their starting length.">Target strain</dt><dd>{percent(disk.strain)}</dd></div>
          </dl>
          <Slider label="Fold size" value={foldSize} display={foldSize < 0.33 ? 'Fine' : foldSize < 0.66 ? 'Medium' : 'Broad'} min={0} max={1} step={0.05}
            title={rimLayers.length ? 'Sets rim growth width and bend stiffness together. Finer folds need a narrow field and a soft sheet.' : 'Add a rim layer to use Fold size.'} disabled={!rimLayers.length}
            onChange={setFoldSize} />
          <p className="hint">{rimLayers.length && rimLayers[0].kind === 'rim'
            ? `Rim width ${percent(rimLayers[0].width)} · bend ${percent(mechanics.bending, 1)}. Smaller folds also need a small Remesh edge length.`
            : 'Add a rim layer to use Fold size.'}</p>
        </section>
        <section><h2>Stats</h2>
          <dl>
            <div><dt data-tip="Steps run so far, including blocked ones.">Timeline step</dt><dd>{step}</dd></div>
            <div><dt data-tip="Edges split to add detail as the surface grows.">Edge splits</dt><dd>{disk.splits}</dd></div>
            <div><dt data-tip="Triangles in the surface now.">Triangles</dt><dd>{(disk.indices.length / 3).toLocaleString()}</dd></div>
            <div><dt data-tip="Vertices now, and the most growth can add. Raise the limit under Simulation › Advanced.">Vertices</dt><dd>{(disk.positions.length / 3).toLocaleString()} / {disk.growthBudget.toLocaleString()}</dd></div>
            <div><dt data-tip="Places where touching folds were pushed apart in the last step.">Contact corrections · last step</dt><dd>{disk.lastContactCorrections}</dd></div>
            <div><dt data-tip="Steps undone because folds would have passed through each other.">Blocked steps</dt><dd>{disk.rejectedSteps}</dd></div>
            <div><dt data-tip="Growth slows after a blocked step, then recovers. 100% is full speed.">Growth speed after contact</dt><dd>{Math.round(disk.growthThrottle * 100)}%</dd></div>
          </dl>
          {slowed && <p className="hint">Blocked steps slowed growth so folds don't pass through each other. A larger Repel distance usually means fewer blocked steps.</p>}
          {detailLimit && <p className="hint">Mesh detail limit reached. Raise it under Simulation › Advanced to keep refining.</p>}
        </section>
      </TabPanel>
      <TabPanel idBase="output" id="explore" value={rightTab}>
        <section><h2>Presets</h2>
          <div className="preset-list-compact">
            {PRESETS.map(preset => <button key={preset.id} type="button" className="preset-row" data-tip={`${preset.description} Replaces your layers and growth settings; the shape is kept.`} onClick={() => applyPreset(preset.id)}>
              <PresetGlyph id={preset.id} />
              <span><b>{preset.name}</b><small>{preset.description}</small></span>
            </button>)}
          </div>
          <p className="hint">Presets replace layers and growth settings. The current shape is kept.</p>
        </section>
        <Variants disk={disk} source={input} mechanics={mechanics} layers={layers} onUse={useVariant} />
      </TabPanel>
      <TabPanel idBase="output" id="file" value={rightTab}>
        <section><h2>Project</h2>
          <input ref={projectRef} type="file" accept=".json,application/json" hidden aria-label="Choose a Growth Studio project file" onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void openProject(file)
          }} />
          <p className="hint">{unsaved ? 'Unsaved changes since the last save.' : 'All changes saved.'}</p>
          <div className="button-row">
            <button disabled={loading || active} data-key="⌘S" onClick={() => void saveProject()}
              data-tip={active ? 'Stop the simulation to save.' : 'Save the shape, layers, and settings as an editable project file.'}>Save project</button>
            <button disabled={loading || active} data-tip={active ? 'Stop the simulation to open a project.' : 'Open a saved .growthstudio.json project. Growth Lab projects open too.'}
              onClick={() => guard('Open another project?', 'Discard and open', () => projectRef.current?.click())}>Open project</button>
          </div>
          {active && <p className="hint">Stop the simulation to save, open, or export.</p>}
          {projectStatus && <p className="hint" role="status">{projectStatus}</p>}
          {projectError && <p className="hint" role="alert">{projectError}</p>}
        </section>
        <section><h2>Export mesh</h2>
          {input && <>
            <label data-tip="Move the exported mesh to the origin instead of keeping its position from the STL."><span>Center exported mesh <input type="checkbox" checked={centerExport}
              onChange={event => { setCenterExport(event.currentTarget.checked); setExportStatus('') }} /></span></label>
            <p className="hint">{input.sourceCenter ? 'Exports keep the STL coordinates unless you center the mesh.'
              : 'This project predates coordinate preservation. Reimport the original STL to use its coordinates.'}</p>
          </>}
          <div className="button-row">
            <button disabled={active} data-tip={active ? 'Stop the simulation to export.' : 'Save the current surface as an OBJ mesh.'} onClick={() => void exportMesh('obj')}>Export OBJ</button>
            <button disabled={active} data-tip={active ? 'Stop the simulation to export.' : 'Save the current surface as a binary STL for CAD or slicing. It is an open sheet, so add thickness before printing.'}
              onClick={() => void exportMesh('stl')}>Export STL</button>
          </div>
          <p className="hint" role="status">{exportStatus || 'The surface is an open sheet and may need thickness before printing.'}</p>
        </section>
      </TabPanel>
    </aside>

    {pending && <Modal role="alertdialog" labelledBy="confirm-title" describedBy="confirm-body" onClose={() => setPending(null)}>
        <h2 id="confirm-title">{pending.title}</h2>
        <p id="confirm-body" className="hint">Unsaved growth and edits in the current design will be lost.</p>
        <div className="confirm-actions">
          <button type="button" data-autofocus data-tip="Keep working on the current design." onClick={() => setPending(null)}>Cancel</button>
          <button type="button" data-tip="Save the project file, then continue." onClick={() => { const { run } = pending; setPending(null); void saveProject().then(saved => { if (saved) run() }) }}>Save project first</button>
          <button type="button" className="primary" data-tip="Discard unsaved changes and continue." onClick={() => { const { run } = pending; setPending(null); run() }}>{pending.confirm}</button>
        </div>
    </Modal>}

    {showHelp && <Modal label="Keyboard shortcuts" onClose={() => setShowHelp(false)}>
        <h2>Keyboard shortcuts</h2>
        <dl>{SHORTCUTS.map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></div>)}</dl>
        <p className="hint">Hover any control, or move to it with Tab, to see what it does.</p>
        <div className="confirm-actions">
          <button type="button" data-tip="Show the three-step guide over the 3D view again." onClick={() => { setShowHelp(false); setShowQuickStart(true) }}>Show quick start</button>
          <button type="button" className="primary" data-autofocus onClick={() => setShowHelp(false)}>Close</button>
        </div>
    </Modal>}
    <TooltipLayer />
  </main>
}

// Small sketches of each preset's characteristic edge.
function PresetGlyph({ id }: { id: string }) {
  const paths: Record<string, string> = {
    lettuce: 'M4 22 q3 -8 6 0 t6 0 t6 0 t6 0 t6 0 t6 0',
    petal: 'M4 22 q8 -18 16 0 q8 -18 16 0',
    coral: 'M4 22 q4 -10 7 -2 q3 -12 8 -1 q4 -6 6 1 q3 -14 9 -2 q3 -5 6 4',
    collar: 'M4 12 q18 22 36 0',
    bloom: 'M4 22 q5 -14 10 0 q5 -14 10 0 q5 -14 10 0 M4 26 q2 -3 4 0 t4 0 t4 0 t4 0 t4 0 t4 0 t4 0 t4 0',
  }
  return <svg viewBox="0 0 44 30" className="preset-glyph" aria-hidden="true"><path d={paths[id]} fill="none" stroke="currentColor" strokeWidth="2" /></svg>
}
