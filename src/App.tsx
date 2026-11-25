import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { LayersPanel } from './components/LayersPanel'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { NumberField } from './components/NumberField'
import { Timeline } from './components/Timeline'
import { TooltipLayer } from './components/Tooltip'
import { TabPanel, Tabs } from './components/Tabs'
import { Variants } from './components/Variants'
import { Viewport } from './components/Viewport'
import { ViewportBars } from './components/ViewportBars'
import { BRUSH_TOOLS, rimName, type Tool } from './lib/tools'
import { useMediaQuery } from './lib/useMediaQuery'
import { createDiskSession, type DiskSession } from './lib/diskSession'
import type { PlayConfig, Snap } from './lib/playback'
import {
  BRUSH_DEFAULTS, deserializeDiskProject, serializeDiskProject, STOP_DEFAULTS, THICKNESS_DEFAULTS,
  type BrushSettings, type DiskView, type Overlay, type Phase, type StopAt, type Thickness,
} from './lib/diskProject'
import { formSize, rimWaves } from './lib/formReadouts'
import { exportBinaryStl, exportObj } from './lib/meshExport'
import { PRESETS } from './lib/presets'
import { rangeFill } from './lib/rangeFill'
import { saveFile, type SaveResult } from './lib/saveFile'
import { facingSign, printScale, RIM_ROUNDNESS, WALL_SHIFT, type RimProfile, type Solid, type WallSide } from './lib/thicken'
import { SHARP_ANGLE_RANGE, sharpEdges, SMOOTH_MAX_TRIANGLES, smoothPassesFor, ungrownEdges, type SmoothLevel } from './lib/smoothSheet'
import { createGrowingDisk, DISK_DEFAULTS, diskGravityDirection, NO_LIMIT_VERTICES, type BrushMode, type DiskSnapshot, type StrokePoint } from './physics/growingDisk'
import type { GrowthLayer, Vec3 } from './physics/growthLayers'
import { growthExportPositions, type GrowthStlSource } from './physics/growthStl'
import { MAX_TRIANGLES, SLOW_TRIANGLES, stlTriangleCount } from './lib/stl'
import {
  boundingRadius, BRAIN_CONTINUE, BRAIN_CREDIT, BRAIN_RADIUS, BRAIN_START_EDGE, BRAIN_STOP, brainErase, brainLayers, brainMechanics, FOLD_ORDER, FOLD_SIZES,
  flatBottomErase, foldLength, foldMechanics, foldSizeOf, loadBuiltInBrain, MAX_BUDGET_SCALE, type FoldSize,
} from './lib/brain'
import { closedSolid } from './lib/closedSolid'
import { findBorders } from './lib/borders'
import { choiceEdges, finalStatus, pickLoop, printEdges, ROUND_DEFAULT, ROUND_RANGE, sameLoop, smallestRound, type EdgeChoice, type EdgeStatus } from './lib/edgeChoices'
import { printSheet, sheetSolid } from './lib/sheetSolid'
import { readUpload } from './lib/upload'
import { usePrintCheck } from './lib/usePrintCheck'
import { PRINT_ANGLE_DEFAULT } from './lib/printCheck'

type Mechanics = typeof DISK_DEFAULTS
const MAX_SNAPSHOTS = 80
// A surface that already crosses itself can cross in millions of places once thickened, so counting stops here.
const CROSSING_LIMIT = 1000
// Repel distance's ceiling in solver units, the project's range: 12 mm on an STL smaller than 1.2 mm per unit would pass it.
const REPEL_MAX_UNITS = 10
// Labels and tips for where the wall goes, on an STL and on the default disk, which has a top and a bottom instead.
const WALL_SIDES: { side: WallSide; stl: [string, string]; disk: [string, string] }[] = [
  { side: 'both', stl: ['Both', 'Center the wall on the surface, half on each side.'], disk: ['Both', 'Center the wall on the surface, half on each side.'] },
  { side: 'outside', stl: ['Outside', 'Put the whole wall outside. The grown surface becomes the inner face.'],
    disk: ['Top', 'Put the whole wall on top. The grown surface becomes the bottom face.'] },
  { side: 'inside', stl: ['Inside', 'Put the whole wall inside. The grown surface stays the outer face, so the outside size does not change.'],
    disk: ['Bottom', 'Put the whole wall underneath. The grown surface stays the top face.'] },
]
const RIM_PROFILES: [RimProfile, string, string][] = [
  ['round', 'Round', 'A half-round edge, like a leaf or petal.'],
  ['soft', 'Soft', 'A flat edge with rounded corners.'],
  ['square', 'Square', 'A flat edge cut straight across the wall.'],
]
const SMOOTH_LEVELS: [SmoothLevel, string, string][] = [
  ['off', 'Off', 'Use the surface as it grew, triangle for triangle.'],
  ['light', 'Light', 'Smooth the surface once: four times the triangles, and most facets gone.'],
  ['strong', 'Strong', 'Smooth it twice: sixteen times the triangles, smooth even on a coarse sheet. Folds soften a little.'],
]
const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`
// Controls that Space presses when they have keyboard focus.
const PRESSABLE = 'button, a, summary, [role=tab]'
// A number for each model session, so work keyed on a model's geometry revision can tell two models apart.
const sessionIds = new WeakMap<object, number>()
let sessionCount = 0
const sessionId = (session: object) => {
  if (!sessionIds.has(session)) sessionIds.set(session, ++sessionCount)
  return sessionIds.get(session)!
}
// Sharp edges of a starting shape, found once per mesh and angle: a mesh that splits or is replaced gets new index arrays.
const creaseCache = new WeakMap<object, Map<number, Uint32Array>>()
const creasesOf = (referencePositions: Float32Array, indices: Uint32Array, angle: number) => {
  let byAngle = creaseCache.get(indices)
  if (!byAngle) { byAngle = new Map(); creaseCache.set(indices, byAngle) }
  let creases = byAngle.get(angle)
  if (!creases) { creases = sharpEdges(referencePositions, indices, angle); byAngle.set(angle, creases) }
  return creases
}
// The edges that stay sharp when smoothing: sharp in the starting shape, and not grown since (lib/smoothSheet).
const keptCreases = (disk: DiskSession, angle: number) => ungrownEdges(creasesOf(disk.referencePositions, disk.indices, angle), disk.localGrowth)
// How far a round's facets may stray from a true circle, in mm: well under what a printer can show.
const ROUND_TOLERANCE = 0.005
// The thinnest wall a round on a closed shape may leave, in mm, unless the shape's own walls are thinner: two lines of a
// 0.4 mm nozzle, the least the Wall thickness tooltip advises for filament printers.
const ROUND_MIN_WALL = 0.8
// A shape's radius for Fold size: the built-in brain is the reference the lengths are set for, so its three meshes, which
// measure a little differently (1.173 to 1.182), all use its exact lengths; any other shape is measured.
const sourceRadius = (source: GrowthStlSource | null) => source?.brain ? BRAIN_RADIUS : source ? boundingRadius(source.positions) : 1
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

const OVERLAYS: Overlay[] = ['field', 'growth', 'contact', 'print', 'none']
const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or stop'], ['.', 'Step'], ['O', 'Orbit'], ['B', 'Paint'], ['E', 'Erase'], ['S', 'Smooth'], ['D', 'Edges'],
  ['[ and ]', 'Brush size'], ['⌘Z or Ctrl+Z', 'Undo brush stroke'], ['G', 'Next color overlay'], ['P', 'Print check'], ['F', 'Frame the model'],
  ['1 to 4', 'Mesh view'], ['⌘S or Ctrl+S', 'Save project'], ['Esc', 'Back to orbit'], ['?', 'Show shortcuts'],
]

export function App() {
  const [disk, setDisk] = useState<DiskSession>(() => createDiskSession(createGrowingDisk(), { source: null }))
  const [tick, setTick] = useState(0)
  const touchScreen = useMediaQuery('(pointer: coarse)')
  const [running, setRunning] = useState(false)
  const [manualQueue, setManualQueue] = useState(0)
  const [relaxing, setRelaxing] = useState(false)
  const [mechanics, setMechanics] = useState<Mechanics>(DISK_DEFAULTS)
  const [layers, setLayersState] = useState<GrowthLayer[]>(() => disk.layers)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() => disk.layers[0]?.id ?? null)
  const [tool, setTool] = useState<Tool>('orbit')
  const [brush, setBrush] = useState<BrushSettings>(BRUSH_DEFAULTS)
  const [overlay, setOverlay] = useState<Overlay>('field')
  const [printAngle, setPrintAngle] = useState(PRINT_ANGLE_DEFAULT)
  // Each press turns the 3D view to look at the model from below, where supports go.
  const [belowKey, setBelowKey] = useState(0)
  // The color overlay to go back to when P turns the print check off.
  const beforePrint = useRef<Overlay>('field')
  const [ghost, setGhost] = useState(false)
  const [view, setView] = useState<DiskView>('cells')
  const [previewRim, setPreviewRim] = useState<number | null>(null)
  const [cameraKey, setCameraKey] = useState(0)
  const [input, setInput] = useState<GrowthStlSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const showImportError = (text: string) => setImportError(text)
  // An open STL with only hairline gaps, which likely was meant to be closed.
  const [nearlyClosed, setNearlyClosed] = useState(false)
  const [centerExport, setCenterExport] = useState(false)
  const [projectStatus, setProjectStatus] = useState('')
  const [projectError, setProjectError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [thickness, setThickness] = useState<Thickness>(THICKNESS_DEFAULTS)
  // Loops chosen with the Edges tool, and the loop under the pointer while it's on.
  const [edgeChoices, setEdgeChoices] = useState<EdgeChoice[]>([])
  const [hoverLoop, setHoverLoop] = useState<Uint32Array | null>(null)
  const [speed, setSpeed] = useState(3)
  const [batch, setBatch] = useState(100)
  const [importSpeed, setImportSpeed] = useState(1)
  const [importBatch, setImportBatch] = useState(10)
  const [stopAt, setStopAt] = useState<StopAt>(STOP_DEFAULTS)
  const [phases, setPhases] = useState<Phase[]>([])
  const [phaseIndex, setPhaseIndex] = useState<number | null>(null)
  // True while Run phases plays, so playback starts at the first phase.
  const phaseRun = useRef(false)
  const [snapshots, setSnapshots] = useState<Snap[]>(() => [disk.snapNow()])
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
  // The fold size a closed shape starts with, and the last one chosen. Fold size grows folds over a whole surface; a rim's
  // folds have their own control.
  const [foldChoice, setFoldChoice] = useState<FoldSize>('medium')
  // The edge length the current surface was prepared with, so a finer Fold size can raise the vertex limit to match.
  const preparedEdge = useRef(DISK_DEFAULTS.remeshLength)
  const [coreOpen, setCoreOpen] = useState(false)

  const step = disk.clock
  const rims = disk.openRims
  const unsaved = step !== savedPoint.step || edits !== savedPoint.edits
  // Grown at all, including when looking back at an earlier step: changing Fold size then keeps the timeline.
  const grown = step > 0 || snapshots.some(snap => snap.mark.step > 0)
  // Actions that replace the current design ask first in an in-app dialog; browser confirm dialogs can be blocked.
  const [pending, setPending] = useState<{ title: string; confirm: string; run: () => void } | null>(null)
  const guard = (title: string, confirm: string, run: () => void) => {
    if (unsaved) setPending({ title, confirm, run })
    else run()
  }
  const touch = () => setEdits(value => value + 1)
  const manualSteps = input ? importBatch : batch
  const stepsPerUpdate = input ? importSpeed : speed
  // Stop takes effect after the step the worker is on, so the model counts as active until then.
  const stopping = disk.busy && !running && !manualQueue
  const active = running || manualQueue > 0 || disk.busy
  const canSimulate = !loading && !disk.initialOverlap && disk.canGrow
  // The shape's size in solver units, which Fold size's lengths scale to, and the fold size the split length now matches.
  const shapeRadius = useMemo(() => sourceRadius(input), [input])
  const foldNow = foldSizeOf(mechanics.remeshLength, shapeRadius)
  const surfaceGrowth = layers.some(layer => layer.kind === 'surface')
  // Millimeters per solver unit: an STL's own, or the default disk at its print size, for settings shown in mm.
  const mmPerUnit = input ? input.scale : printScale(disk.referencePositions, null, thickness.size)
  const repelMm = mechanics.repelDistance * mmPerUnit
  const selectedLayer = layers.find(layer => layer.id === selectedLayerId) ?? layers[0]

  // Thickness for printing: a wall on one or both sides of the surface, closed along the open rims.
  // The 3D view shows the solid while growth is paused, and Export writes it.
  const canThicken = rims.length > 0
  const solidOn = thickness.on && canThicken
  // A closed shape, such as a brain, is a solid already: it prints as it grew, smoothed like a sheet and cut flat at the
  // bottom if asked (lib/closedSolid). Nothing is rebuilt or merged, so thin walls and designed edges stay.
  const closedShape = !canThicken && Boolean(input)
  const closedOn = thickness.on && closedShape
  // Outside and Inside follow the way the starting surface faces: away from the middle of an STL, or up from the disk.
  // An STL keeps its own millimeters. The default disk is scaled so the solid itself, wall and rims included, has the
  // chosen longest side; scaling the sheet alone made a 100 mm disk with a 5 mm wall export 105 mm long.
  // Smooth first smooths the sheet (Loop subdivision, see lib/smoothSheet), and the wall follows the smoothed surface.
  // Edges that bend more than sharpAngle in the starting shape, such as the edge around a flat bottom, stay sharp unless
  // bevel rounds them.
  // Loops chosen with the Edges tool are kept fully sharp while smoothing, and rounded after it, before the wall
  // (lib/sheetSolid).
  const makeSolid = (wallMm: number, rim: RimProfile, side: WallSide, size: number, smooth: SmoothLevel, bevel: number, sharpAngle: number, choices: EdgeChoice[]) => {
    const shift = side === 'both' ? 0 : WALL_SHIFT[side] * facingSign(disk.referencePositions, disk.indices, input ? 'outward' : 'up')
    const passes = smoothPassesFor(smooth, disk.indices.length / 3)
    const creases = passes && bevel < 1 ? keptCreases(disk, sharpAngle) : undefined
    const plan = input && choices.length ? printEdges(choices, disk.referencePositions, disk.indices, disk.localGrowth, input.scale) : null
    const sheet = printSheet(disk.positions, disk.indices, { passes, creases, bevel, keep: plan?.keep, rounds: plan?.rounds })
    const build = (scale: number) => sheetSolid(sheet, { wall: wallMm / scale, roundness: RIM_ROUNDNESS[rim], shift, tolerance: ROUND_TOLERANCE / scale, sharpAngle })
    if (input) { const solid = build(input.scale); return { solid, mmPerUnit: input.scale, plan, skipped: solid.skipped } }
    // The default disk is scaled so the solid itself has the chosen longest side; it has no Edges choices.
    let mmPerUnit = printScale(disk.positions, null, size), solid = build(mmPerUnit)
    for (let pass = 0; pass < 2; pass++) { mmPerUnit = printScale(solid.positions, null, size); solid = build(mmPerUnit) }
    return { solid, mmPerUnit, plan, skipped: solid.skipped }
  }
  // Deferred, so dragging the wall slider stays smooth on a dense mesh.
  const wall = useDeferredValue(thickness.wall), rimProfile = useDeferredValue(thickness.rim)
  const wallSide = useDeferredValue(thickness.side), printSize = useDeferredValue(thickness.size), smoothLevel = useDeferredValue(thickness.smooth)
  const bevelAmount = useDeferredValue(thickness.bevel), sharpAngle = useDeferredValue(thickness.sharpAngle), choices = useDeferredValue(edgeChoices)
  const sheetPrint = useMemo(() => solidOn && !active ? makeSolid(wall, rimProfile, wallSide, printSize, smoothLevel, bevelAmount, sharpAngle, choices) : null,
  // Positions change in place; the geometry revision tracks them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [solidOn, active, disk, disk.indices, disk.geometryRevision, wall, rimProfile, wallSide, printSize, smoothLevel, bevelAmount, sharpAngle, input, choices])
  // Whether the print shown has caught up with the settings, so export can write it as it is.
  const sheetSettled = wall === thickness.wall && rimProfile === thickness.rim && wallSide === thickness.side && printSize === thickness.size
    && smoothLevel === thickness.smooth && bevelAmount === thickness.bevel && sharpAngle === thickness.sharpAngle && choices === edgeChoices
  const solid = sheetPrint?.solid ?? null
  // How many mesh edges of the starting shape are sharp enough to keep, for the Bevel control: counted while growth is
  // paused (the mesh splits often while it grows), and unknown meanwhile. How many smoothing passes really run.
  const sharpCount = useMemo(() => (solidOn || closedOn) && !active ? keptCreases(disk, sharpAngle).length / 2 : null,
  // Growth so far changes in place; the geometry revision tracks it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [solidOn, closedOn, active, disk, disk.indices, disk.geometryRevision, sharpAngle])
  const smoothPasses = smoothPassesFor(thickness.smooth, disk.indices.length / 3)
  // Whether the solid is closed and where its wall crosses itself, found in a worker since a dense mesh takes seconds.
  type SolidCheck = { leaks: number; pairs: number; capped: boolean; vertices: number[]; failed?: boolean }
  const [solidCheck, setSolidCheck] = useState<SolidCheck & { solid: Solid } | null>(null)
  // The flat base's range follows the starting shape's height: up to a quarter of it, and 5 mm unless that's too much.
  const startHeight = useMemo(() => {
    if (!input) return 0
    let low = Infinity, high = -Infinity
    for (let i = 1; i < input.positions.length; i += 3) { low = Math.min(low, input.positions[i]); high = Math.max(high, input.positions[i]) }
    return (high - low) * input.scale
  }, [input])
  const baseRange: [number, number] = [0.5, Math.max(1, Math.round(0.25 * startHeight * 2) / 2)]
  const baseCut = Math.min(baseRange[1], Math.max(baseRange[0], thickness.baseCut))
  const flatBase = useDeferredValue(thickness.flatBase), deferredCut = useDeferredValue(baseCut)
  const makeClosed = (smooth: SmoothLevel, bevel: number, angle: number, flat: boolean, cutMm: number, choices: EdgeChoice[]) => {
    const passes = smoothPassesFor(smooth, disk.indices.length / 3)
    const creases = passes && bevel < 1 ? keptCreases(disk, angle) : undefined
    const plan = input && choices.length ? printEdges(choices, disk.referencePositions, disk.indices, disk.localGrowth, input.scale) : null
    const solid = closedSolid(disk.positions, disk.indices, { passes, creases, bevel, keep: plan?.keep, rounds: plan?.rounds,
      tolerance: input ? ROUND_TOLERANCE / input.scale : undefined, sharpAngle: angle, minWall: input ? ROUND_MIN_WALL / input.scale : undefined,
      cut: flat && input ? cutMm / input.scale : 0 })
    return { solid, plan, skipped: solid.skipped }
  }
  const closedResult = useMemo(() => closedOn && !active ? makeClosed(smoothLevel, bevelAmount, sharpAngle, flatBase, deferredCut, choices) : null,
  // Positions change in place; the geometry revision tracks them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [closedOn, active, disk, disk.indices, disk.geometryRevision, smoothLevel, bevelAmount, sharpAngle, flatBase, deferredCut, input, choices])
  const closedSettled = smoothLevel === thickness.smooth && bevelAmount === thickness.bevel && sharpAngle === thickness.sharpAngle
    && flatBase === thickness.flatBase && deferredCut === baseCut && choices === edgeChoices
  const closedPrint = closedResult?.solid ?? null
  const printSolid = solid ?? closedPrint
  // What became of each loop chosen with the Edges tool on the print, once it's made.
  const printResult_ = sheetPrint ?? closedResult
  const edgeStatus: Map<string, EdgeStatus> | null = printResult_?.plan ? finalStatus(printResult_.plan.status, printResult_.plan.roundIds, printResult_.skipped) : null
  const roundedCount = edgeStatus ? [...edgeStatus.values()].filter(status => status === 'rounded').length : 0
  const roundedText = roundedCount ? `, ${roundedCount} ${roundedCount === 1 ? 'loop' : 'loops'} rounded` : ''
  // The Edges tool: the starting shape's design borders while it's on, the chosen loops and the one under the pointer.
  const borders = useMemo(() => tool === 'edges' && input ? findBorders(disk.referencePositions, disk.indices, thickness.sharpAngle) : null,
  // The mesh's indices change when it splits; its starting positions only gain points then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tool, input, disk, disk.indices, thickness.sharpAngle])
  const chosenEdges = useMemo(() => tool === 'edges' ? edgeChoices.map(choice => ({ edges: choiceEdges(choice, disk.referencePositions, disk.indices), action: choice.action })) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tool, edgeChoices, disk, disk.indices])
  // A click picks the border within 3% of the model's size.
  const EDGE_REACH = 0.03
  const onEdgeHover = (point: Vec3 | null) => {
    const loop = point && borders ? pickLoop(borders, disk.referencePositions, disk.positions, point, EDGE_REACH) : null
    setHoverLoop(loop?.edges ?? null)
  }
  const onEdgePick = (point: Vec3, mode: 'set' | 'add' | 'remove' | 'toggle') => {
    const loop = borders ? pickLoop(borders, disk.referencePositions, disk.positions, point, EDGE_REACH) : null
    // A click that misses every border changes nothing: the loops chosen keep their settings.
    if (!loop) return
    const known = edgeChoices.find(choice => sameLoop(choice, loop))
    const fresh: EdgeChoice = { id: `edge-${Date.now()}-${edgeChoices.length}`, points: Array.from(loop.points), closed: loop.closed, action: 'sharp', radius: ROUND_DEFAULT }
    const remove = mode === 'remove' || (mode === 'toggle' && known)
    setEdgeChoices(remove ? edgeChoices.filter(choice => choice !== known)
      : mode === 'add' || mode === 'toggle' ? (known ? edgeChoices : [...edgeChoices, fresh])
        : [known ?? fresh])
    touch(); setExportStatus('')
  }
  // A loop's length in mm, and what became of it on the print.
  const loopLength = (choice: EdgeChoice) => {
    const p = choice.points, n = p.length / 3
    let length = 0
    for (let i = 0; i + (choice.closed ? 0 : 1) < n; i++) { const j = (i + 1) % n; length += Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]) }
    return length * (input?.scale ?? 1)
  }
  const edgeText = (choice: EdgeChoice) => {
    const status = edgeStatus?.get(choice.id)
    if (active) return choice.action === 'round' ? 'Rounded on the print, shown when growth pauses.' : 'Kept sharp on the print, shown when growth pauses.'
    if (!status || choices !== edgeChoices) return 'Updating the print…'
    if (status === 'kept') return 'Kept sharp.'
    if (status === 'rounded') return `Rounded with a ${choice.radius.toFixed(1)} mm radius.`
    if (status === 'grown') return 'Left as it grew: this part has grown, so its edges folded with it and are smoothed like the rest.'
    if (status === 'missing') return "Not found on the shape any more. Remove it, or choose the loop again."
    if (status === 'meets an edge') return 'Left sharp: another sharp edge meets this loop, as at a corner, or where a fold of the grown surface reaches it. A round can\'t blend into it.'
    if (status === 'cut away') return 'Cut away: Flat base cuts the print above this loop, so its round isn\'t on the print. Lower Base cut, or turn Flat base off.'
    if (status === 'no room') return 'Left sharp: a round this big has no room here. It would reach another edge or a rim, or meet itself across a narrow face. Try a smaller radius.'
    if (status === 'too sharp') return 'Left sharp: the faces here meet at less than 10°, a knife edge no round fits.'
    if (status === 'turns over') return 'Left sharp: moving the points here would turn faces over, as where long, thin faces cross a tight curve. Try a smaller radius.'
    if (status === 'cuts through') return 'Left sharp: a round this big would cut through to another part of the surface, as through a thin wall into a pot. Try a smaller radius.'
    if (status === 'under the wall') {
      // The wall's part on the round's inner side: half of it on both sides, or all of it, since that side has the wall.
      const inner = thickness.side === 'both' ? thickness.wall / 2 : thickness.wall, least = smallestRound(inner)
      return `Left sharp: on this round's inner side the wall is ${inner.toFixed(1)} mm thick, too close to its radius, so the wall's inner face would fold. Use at least ${least.toFixed(1)} mm, a thinner wall, or Wall side to move the wall off that side.`
    }
    if (status === 'thins the wall') {
      const index = printResult_?.plan?.roundIds.indexOf(choice.id) ?? -1, entry = printResult_?.skipped.find(s => s.loop === index)
      const scale = input?.scale ?? 1, left = (entry?.left ?? 0) * scale, need = (entry?.need ?? 0) * scale
      return `Left sharp: a round this big would leave the wall only ${left.toFixed(2)} mm thick here, ${need < ROUND_MIN_WALL - 1e-3
        ? `thinner than the shape's own ${need.toFixed(2)} mm walls` : `less than the ${ROUND_MIN_WALL} mm most filament printers need`}. Try a smaller radius.`
    }
    if (status === 'folds the wall') return 'Left sharp: with this round, the wall would cross itself, as where the round comes within the wall\'s thickness of another part of the shape, or where facets meet at a crease. Try a smaller radius, a thinner wall, or Wall side to put the wall on the round\'s outer side.'
    return 'Left sharp: a round needs one closed loop with a face on each side.'
  }
  const changeChoice = (id: string, patch: Partial<EdgeChoice>) => { setEdgeChoices(list => list.map(choice => choice.id === id ? { ...choice, ...patch } : choice)); touch(); setExportStatus('') }
  const removeChoice = (id: string) => { setEdgeChoices(list => list.filter(choice => choice.id !== id)); touch(); setExportStatus('') }
  useEffect(() => {
    if (!printSolid) return
    const target = printSolid
    const worker = new Worker(new URL('./lib/solidCheck.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<SolidCheck>) => {
      setSolidCheck({ solid: target, ...data })
      worker.terminate()
    }
    worker.onerror = event => {
      event.preventDefault()
      setSolidCheck({ solid: target, leaks: 0, pairs: 0, capped: false, vertices: [], failed: true })
      worker.terminate()
    }
    // A sheet's rounds count their own points, so folds inside a round are seen (lib/sheetSolid).
    const timer = window.setTimeout(() => worker.postMessage({ positions: target.positions, indices: target.indices, origin: target.groups ?? target.origin, limit: CROSSING_LIMIT }), 200)
    return () => { window.clearTimeout(timer); worker.terminate() }
  }, [printSolid])
  const crossings = solidCheck?.solid === printSolid ? solidCheck : null
  // A change to the solid makes the last export's message out of date.
  const changeThickness = (patch: Partial<Thickness>) => { setThickness(current => ({ ...current, ...patch })); setExportStatus(''); touch() }
  const sideName = thickness.side === 'both' ? '' : (WALL_SIDES.find(s => s.side === thickness.side)![input ? 'stl' : 'disk'][0]).toLowerCase()
  const crossingCount = crossings ? `${crossings.capped ? 'more than ' : ''}${crossings.pairs.toLocaleString()} ${crossings.pairs === 1 && !crossings.capped ? 'place' : 'places'}` : ''
  const showSolid = Boolean(solid && thickness.show)
  const showClosed = Boolean(closedPrint && thickness.show)
  // The print check counts the surface the 3D view shows: the print solid when it's shown, otherwise the sheet, read as
  // a wall with two sides when it's open.
  const shownSolid = showSolid ? solid : showClosed ? closedPrint : null
  const printSurface = useMemo(() => shownSolid ?? { positions: disk.positions, indices: disk.indices },
    [shownSolid, disk.positions, disk.indices])
  const printTwoSided = !shownSolid && canThicken
  const printResult = usePrintCheck(overlay === 'print', printSurface, `${sessionId(disk)}:${disk.geometryRevision}`, printAngle,
    printTwoSided, input ? input.scale : null, thickness.size, active)
  const lowCount = printResult?.lowPoints.length ?? 0
  const printReadout = !printResult ? 'Counting...' : [
    `Needs support ${(100 * printResult.needs).toFixed(1)}%`,
    lowCount ? `${lowCount} low point${lowCount === 1 ? '' : 's'} in the air` : 'No low points in the air',
    `${(printResult.bed / 100).toFixed(1)} cm² on the bed`,
  ].join(' · ')
  const chooseOverlay = (next: Overlay) => {
    if (next === 'print' && overlay !== 'print') beforePrint.current = overlay
    setOverlay(next)
  }

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
  const adopt = (next: DiskSession, keepTimeline = false) => {
    setDisk(next)
    setLayersState(next.layers)
    setSelectedLayerId(current => next.layers.some(layer => layer.id === current) ? current : next.layers[0]?.id ?? null)
    setPreviewRim(null)
    if (!keepTimeline) { setSnapshots([next.snapNow()]); setViewing(null) }
    setTick(value => value + 1)
  }
  // Redraw when the simulation worker sends a frame, and end the worker when the model is replaced.
  useEffect(() => disk.subscribe(() => setTick(value => value + 1)), [disk])
  useEffect(() => () => disk.release(), [disk])
  const stopPlayback = () => {
    setRunning(false)
    setManualQueue(0)
    phaseRun.current = false
    setPhaseIndex(null)
  }
  // The shape's own erase, painted on when it starts and again on Reset: the built-in brain doesn't grow on the inner
  // walls between its halves or the middle of its base, and an upload standing on a flat bottom keeps the bottom and the
  // lowest fifth of its wall from growing whenever the whole surface grows, as with Brain folds, so its print still
  // stands flat on the bed.
  const startingErase = (source: GrowthStlSource, surface: ReturnType<typeof createGrowingDisk>) =>
    source.brain?.builtin ? brainErase(surface.rest)
      : surface.layers.some(layer => layer.kind === 'surface') ? flatBottomErase(surface.rest, surface.indices) : null
  // prepare, if given, works on the new surface before it starts.
  const freshSurface = (source: GrowthStlSource | null, keepLayers: GrowthLayer[] | null, settings = mechanics,
    prepare?: (surface: ReturnType<typeof createGrowingDisk>) => void) => {
    // The built-in brain is already meshed at its fold size, so preparation leaves it as it is.
    const fresh = createGrowingDisk(source ?? undefined, source?.brain ? BRAIN_START_EDGE : settings.remeshLength)
    preparedEdge.current = source?.brain ? foldLength(source.brain.foldSize) : settings.remeshLength
    if (keepLayers) {
      // Keep layers whose rim still exists on the new surface.
      const count = fresh.openRims.length
      fresh.setLayers(keepLayers.filter(layer => layer.kind !== 'rim' || layer.rim === 'all' || layer.rim < count))
    }
    const erase = source ? startingErase(source, fresh) : null
    if (erase) { fresh.paint.erase.set(erase); fresh.setLayers(fresh.layers) }
    prepare?.(fresh)
    return createDiskSession(fresh, { source, mechanics: settings })
  }
  const reset = async () => {
    stopPlayback()
    setRelaxing(false)
    // A built-in brain whose Fold size changed while it grew goes back to a smooth brain meshed for the new size, as a
    // fresh brain of that size starts. Any other shape goes back to itself, prepared at the split length in use.
    let source = input
    const size = input?.brain ? foldSizeOf(mechanics.remeshLength) : null
    if (input?.brain && size && size !== input.brain.foldSize) {
      setLoading(true)
      try {
        source = await loadBuiltInBrain(size)
        setInput(source)
      } catch {
        // Offline, say: reset to the brain it has.
      } finally {
        setLoading(false)
      }
    }
    const prepared = source?.brain ? foldLength(source.brain.foldSize) : mechanics.remeshLength
    const settings = { ...mechanics, budgetScale: Math.min(MAX_BUDGET_SCALE, Math.max(1, (prepared / mechanics.remeshLength) ** 2)) }
    setMechanics(settings)
    adopt(freshSurface(source, layers, settings))
    setSavedPoint({ step: 0, edits })
    setNotice('')
    setExportStatus('')
    setProjectStatus('')
    setProjectError('')
  }
  // An open surface, the default disk or an upload, grows from its rims. Coming from a closed shape, the settings go back
  // to the sheet's defaults, since the Brain folds recipe's core and stiff sheet don't suit a sheet. Otherwise they stay,
  // to reuse on a new file.
  const startOpen = (source: GrowthStlSource | null) => {
    stopPlayback()
    const fromClosed = closedShape
    const settings = fromClosed ? DISK_DEFAULTS : mechanics
    const fresh = freshSurface(source, null, settings)
    setInput(source)
    setMechanics(settings)
    adopt(fresh)
    if (fromClosed) { setThickness(THICKNESS_DEFAULTS); setStopAt(STOP_DEFAULTS); setPhases([]) }
    setCenterExport(false)
    setEdgeChoices([]); setHoverLoop(null)
    // Cell outlines on a very dense mesh are slow and hide the form, so start large meshes on the plain surface.
    setView(current => fresh.indices.length / 3 > SLOW_TRIANGLES ? 'smooth' : !fromClosed && current === 'fans' ? 'fans' : 'cells')
    setTool('orbit')
    setOverlay('field')
    setNotice('')
    setExportStatus('')
    setProjectError('')
    setProjectStatus('')
    setSavedPoint({ step: 0, edits })
  }
  // A closed shape, the built-in brain or an upload, grows over its whole surface with the Brain folds recipe: over a soft
  // core, until step 420, with its print solid shown. A flat bottom doesn't grow and is held still. Layers, growth
  // settings and print settings are replaced; other settings stay. Returns whether a flat bottom is held.
  const startClosed = (source: GrowthStlSource, size: FoldSize) => {
    stopPlayback()
    const settings = { ...brainMechanics(mechanics, size, sourceRadius(source)), holdStill: 0 }
    const fresh = freshSurface(source, brainLayers(), settings, surface => {
      if (!source.brain && surface.paint.erase.some(value => value > 0)) settings.holdStill = 1
    })
    setInput(source)
    setMechanics(settings)
    adopt(fresh)
    setFoldChoice(size)
    setStopAt(BRAIN_STOP)
    setPhases([])
    setRelaxing(false)
    setThickness(current => ({ ...current, on: true, show: true, smooth: 'light', flatBase: false }))
    setView('smooth')
    setOverlay('none')
    setTool('orbit')
    setCoreOpen(true)
    setCenterExport(false)
    setEdgeChoices([]); setHoverLoop(null)
    setNotice('')
    showImportError('')
    setExportStatus('')
    setProjectError('')
    setProjectStatus('')
    setSavedPoint({ step: 0, edits })
    return settings.holdStill > 0
  }
  const HELD = 'Its flat bottom and the lowest fifth of the wall don\'t grow and are held still, so it keeps standing flat on the bed.'
  const importStl = async (file: File) => {
    stopPlayback()
    setLoading(true)
    showImportError('')
    try {
      const buffer = await file.arrayBuffer()
      const triangles = stlTriangleCount(buffer)
      if (triangles > MAX_TRIANGLES) {
        throw new Error(`This STL has about ${triangles.toLocaleString()} triangles, more than Growth Studio can prepare (${MAX_TRIANGLES.toLocaleString()}). Reduce it in your CAD tool, for example Fusion's Mesh › Reduce, to under ${SLOW_TRIANGLES.toLocaleString()} for interactive growth.`)
      }
      const { source, closed, nearlyClosed: gaps } = readUpload(buffer, file.name)
      if (closed) {
        const held = startClosed(source, foldChoice)
        setNotice(`Opened ${file.name} as a closed shape with Brain folds.${held ? ` ${HELD}` : ''} Press Play growth.`)
      } else startOpen(source)
      setNearlyClosed(gaps)
    } catch (error) {
      // Name the file and say nothing was lost, since the previous model stays loaded.
      const reason = error instanceof Error ? error.message : 'It could not be prepared.'
      showImportError(`Couldn't open ${file.name}. ${reason} Your current model is unchanged.`)
    } finally {
      setLoading(false)
    }
  }
  const switchToDefaultDisk = () => {
    startOpen(null)
    setNearlyClosed(false)
    showImportError('')
  }
  const loadBrain = async (size: FoldSize) => {
    stopPlayback()
    setLoading(true)
    showImportError('')
    try {
      startClosed(await loadBuiltInBrain(size), size)
      setNearlyClosed(false)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'It could not be loaded.'
      showImportError(`Couldn't load the built-in brain. ${reason} Your current model is unchanged.`)
    } finally {
      setLoading(false)
    }
  }
  // Fold size changes the split length, at any time: growth carries on at the new size, and what has grown stays. Only
  // the built-in brain, before it grows, is swapped for one meshed at the new size, as a fresh brain of that size starts.
  const changeFold = (size: FoldSize) => {
    if (size === foldNow) return
    const label = FOLD_SIZES[size].label
    if (!grown && input?.brain) {
      guard(`Load the built-in brain with ${label.toLowerCase()} folds?`, 'Load', () => void loadBrain(size))
      return
    }
    setMechanics(current => {
      const settings = foldMechanics(current, size, preparedEdge.current, shapeRadius)
      disk.setMechanics(settings)
      return settings
    })
    setFoldChoice(size)
    // A shape that stopped at Stop at would stop again at once, so move the stop on.
    const moved = !active && stopAt.kind === 'step' && step >= stopAt.value
    if (moved) setStopAt({ kind: 'step', value: step + BRAIN_CONTINUE })
    // Short enough for one line beside the playback buttons, or two balanced lines; the numbers stay with their words.
    if (!active) setNotice(!grown ? `${label} folds as it grows. Press Play growth.`
      : moved ? `${label} folds from step\u00a0${step}. Stop at is now\u00a0${step + BRAIN_CONTINUE}.` : `${label} folds from step\u00a0${step}. Press Play growth.`)
    touch()
  }

  const modelName = (input?.name.replace(/\.stl$/i, '') ?? 'default-disk')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'surface'
  const snapshotName = `${modelName}-step-${step}`
  const describe = (result: SaveResult, filename: string) => result === 'saved' ? `Saved ${filename}.`
    : result === 'downloaded' ? `Download requested for ${filename}. If no file appears, open Growth Studio in Chrome or Safari.`
      : result === 'cancelled' ? 'Save cancelled.' : `Could not save ${filename}.`
  const exportMesh = async (format: 'obj' | 'stl') => {
    // The print shown, once it has caught up with the settings; made afresh otherwise, as while growth runs.
    const made = !solidOn ? null : sheetPrint && sheetSettled ? sheetPrint
      : makeSolid(thickness.wall, thickness.rim, thickness.side, thickness.size, thickness.smooth, thickness.bevel, thickness.sharpAngle, edgeChoices)
    const layer = !closedOn ? null : closedPrint && closedSettled ? closedPrint
      : makeClosed(thickness.smooth, thickness.bevel, thickness.sharpAngle, thickness.flatBase, baseCut, edgeChoices).solid
    const surface = made?.solid.positions ?? layer?.positions ?? disk.positions, indices = made?.solid.indices ?? layer?.indices ?? disk.indices
    // A solid is written in millimeters: the STL's own, or the default disk at its chosen size.
    const positions = input ? growthExportPositions(surface, input, centerExport) : made ? surface.map(value => value * made.mmPerUnit) : surface
    const name = made || layer ? `${snapshotName}-solid` : snapshotName
    const data = format === 'obj' ? exportObj(positions, indices, name) : exportBinaryStl(positions, indices, name)
    const filename = `${name}.${format}`
    const result = await saveFile(filename, data, format === 'obj' ? 'text/plain' : 'model/stl', format === 'obj' ? 'OBJ mesh' : 'STL mesh')
    const written = result === 'saved' || result === 'downloaded'
    setExportStatus(describe(result, filename) + (made && written
      ? ` Solid with a ${thickness.wall} mm wall${sideName ? ` on the ${sideName}` : ''}, ${(indices.length / 3).toLocaleString()} triangles${input ? '' : `, ${thickness.size} mm on its longest side`}.`
      : layer && written ? ` Closed solid, ${(indices.length / 3).toLocaleString()} triangles${thickness.flatBase ? `, the bottom ${baseCut.toFixed(1)} mm cut flat` : ''}.` : ''))
  }
  // Resolves true once the project is written or handed to the browser as a download.
  const saveProject = async () => {
    const source = input && { ...input, positions: Array.from(input.positions), indices: Array.from(input.indices) }
    const { snapshot } = await disk.requestSnap()
    const json = serializeDiskProject({
      source, disk: snapshot, mechanics, revision: step, centerExport, relaxing, view,
      speed, batch, importSpeed, importBatch, brush, overlay, ghost, phases, stopAt, thickness, printAngle, edges: edgeChoices,
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
      const restored = createDiskSession(createGrowingDisk(project.source ?? undefined, project.mechanics.remeshLength, project.disk),
        { source: project.source, mechanics: project.mechanics })
      stopPlayback()
      setInput(project.source)
      adopt(restored)
      setNearlyClosed(false)
      // The fold size growth was using, which differs from the starting shape's if it changed while growing, and the
      // edge length it was prepared at, which a finer fold size raised the vertex limit from.
      const fold = foldSizeOf(project.mechanics.remeshLength, sourceRadius(project.source))
      if (fold) setFoldChoice(fold)
      preparedEdge.current = project.source?.brain ? foldLength(project.source.brain.foldSize)
        : project.mechanics.remeshLength * Math.sqrt(project.mechanics.budgetScale)
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
      setThickness(project.thickness)
      setPrintAngle(project.printAngle ?? PRINT_ANGLE_DEFAULT)
      setEdgeChoices(project.edges)
      setHoverLoop(null)
      setTool('orbit')
      showImportError('')
      setExportStatus('')
      setNotice('')
      setSavedPoint({ step: restored.clock, edits })
      setProjectStatus(`Opened ${file.name}.`)
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'The file could not be read.' : error instanceof Error ? error.message : 'It could not be opened.'
      setProjectError(`Couldn't open ${file.name}. ${reason} Your current model is unchanged.`)
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
  const scrub = async (index: number | null) => {
    // Leaving the live shape keeps it as the newest snapshot, so scrubbing back to the end loses nothing.
    let list = snapshots
    if (viewing === null && snapshots.at(-1)?.mark.step !== step) {
      list = keepSnapshots([...snapshots, await disk.requestSnap()])
      setSnapshots(list)
    }
    const target = index ?? list.length - 1
    const snap = list[target]
    if (!snap) return
    const restored = createDiskSession(createGrowingDisk(input ?? undefined, mechanics.remeshLength, snap.snapshot), { source: input, mechanics })
    adopt(restored, true)
    setViewing(index)
    setNotice('')
  }
  const takeSnapshot = async () => {
    branchIfViewingPast()
    const snap = await disk.requestSnap()
    setSnapshots(current => keepSnapshots([...current.filter(s => s.mark.step !== snap.mark.step), snap]))
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
    phaseRun.current = true
    setPhaseIndex(0)
    setNotice('')
    setRunning(true)
  }

  // Playback runs in the simulation worker, which steps at this pace and reports snapshots, phases and Stop at.
  // Changing a setting mid-run updates the worker without restarting playback.
  const playConfig = useMemo<PlayConfig>(() => ({ stepsPerUpdate, relaxing, every, stopAt, phases }), [stepsPerUpdate, relaxing, every, stopAt, phases])
  useEffect(() => {
    if (!running && !manualQueue) return
    disk.play(running ? null : manualQueue, phaseRun.current, playConfig, {
      onSnapshot: snap => setSnapshots(current => keepSnapshots([...current.filter(s => s.mark.step !== snap.mark.step), snap])),
      onPhase: setPhaseIndex,
      onStopped: reason => {
        stopPlayback()
        if (reason) setNotice(reason)
      },
    })
    return () => disk.stop()
  // Only Play, Step, Stop or a new model start or end a run; playConfig changes go through configure below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, manualQueue, disk])
  useEffect(() => disk.configure(playConfig), [disk, playConfig])

  // Brush strokes: one stroke per drag, merged across symmetric copies.
  const onStroke = (points: StrokePoint[], pressure: number, first: boolean) => {
    if (!BRUSH_TOOLS.includes(tool)) return
    const paintLayer = layers.find(layer => layer.kind === 'paint')
    if (paintLayer && !paintLayer.visible) applyLayers(layers.map(layer => layer.kind === 'paint' ? { ...layer, visible: true } : layer))
    disk.brush(points, brush.radius, brush.hardness, tool as BrushMode, brush.strength * pressure, first)
    touch()
    setTick(value => value + 1)
  }
  const onPlace = (point: Vec3) => {
    const rest = disk.restPointNear(point)
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
    let nextMechanics = { ...mechanics, ...built.mechanics }
    // Brain folds grows at the chosen fold size. A shape standing on a flat bottom keeps the bottom and the lowest fifth
    // of its wall from growing, held still, so it still stands flat on the bed; the built-in brain has its own erase.
    let held = false
    if (id === 'brain') {
      nextMechanics = foldMechanics(nextMechanics, foldChoice, preparedEdge.current, shapeRadius)
      const erase = input && !input.brain ? flatBottomErase(disk.referencePositions, disk.indices) : null
      if (erase) { disk.addErase(erase); nextMechanics.holdStill = 1; held = true }
    }
    disk.setMechanics(nextMechanics)
    setMechanics(nextMechanics)
    applyLayers(built.layers)
    setSelectedLayerId(built.layers[0]?.id ?? null)
    if (built.phases) setPhases(built.phases)
    if (built.stopAt) setStopAt(built.stopAt)
    setNotice(`Applied ${preset.name}.${held ? ` ${HELD}` : ''} Press Play growth${built.phases ? ' or Run phases' : ''}.`)
  }
  const useVariant = (snapshot: DiskSnapshot, variantMechanics: Mechanics, variantLayers: GrowthLayer[]) => {
    stopPlayback()
    branchIfViewingPast()
    const grown = createGrowingDisk(input ?? undefined, variantMechanics.remeshLength, snapshot)
    grown.setLayers(variantLayers)
    const next = createDiskSession(grown, { source: input, mechanics: variantMechanics })
    setMechanics(variantMechanics)
    adopt(next, true)
    const snap = next.snapNow()
    setSnapshots(current => keepSnapshots([...current.filter(s => s.mark.step < snap.mark.step), snap]))
    touch()
    setNotice('Continuing from the chosen variant.')
  }

  // The control a click or tap last focused. Space on it still plays or stops; Space on a control reached another way,
  // such as with Tab, presses that control. :focus-visible can't tell them apart, since a key press turns it on.
  const pointerFocus = useRef<Element | null>(null)
  useEffect(() => {
    const down = (event: PointerEvent) => { pointerFocus.current = event.target instanceof Element ? event.target.closest(PRESSABLE) : null }
    const focus = (event: FocusEvent) => { if (event.target !== pointerFocus.current) pointerFocus.current = null }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('focusin', focus, true)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('focusin', focus, true) }
  }, [])
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
    // Space presses a button reached with the keyboard, as it does everywhere. A button that was clicked keeps focus,
    // and there Space still plays or stops.
    const pressable = target?.closest(PRESSABLE)
    if (key === ' ' && pressable && pressable !== pointerFocus.current) return
    if (key === ' ') { event.preventDefault(); if (active) stopPlayback(); else if (canSimulate) play() }
    else if (key === '.') { if (!active && canSimulate) stepOnce() }
    else if (key === 'o' || key === 'O') setTool('orbit')
    else if (key === 'b' || key === 'B') setTool('paint')
    else if (key === 'e' || key === 'E') setTool('erase')
    else if (key === 's' || key === 'S') setTool('smooth')
    else if (key === 'd' || key === 'D') { if (input) setTool('edges') }
    else if (key === '[') setBrush(b => ({ ...b, radius: Math.max(0.02, +(b.radius / 1.15).toFixed(3)) }))
    else if (key === ']') setBrush(b => ({ ...b, radius: Math.min(0.6, +(b.radius * 1.15).toFixed(3)) }))
    else if (key === 'g' || key === 'G') chooseOverlay(OVERLAYS[(OVERLAYS.indexOf(overlay) + 1) % OVERLAYS.length])
    else if (key === 'p' || key === 'P') { if (overlay === 'print') setOverlay(beforePrint.current); else chooseOverlay('print') }
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
  // Advanced opens by itself when growth reaches the detail limit, so the control that raises it is in view.
  // Only the user closes it: raising the limit ends the limit, and that must not fold the section away mid-drag.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [limitShown, setLimitShown] = useState(false)
  if (detailLimit !== limitShown) {
    setLimitShown(detailLimit)
    if (detailLimit) setAdvancedOpen(true)
  }
  const contactStatus = disk.initialOverlap ? 'Starting mesh overlaps'
    : disk.stepStatus === 'contact' ? 'Contact blocked the last step'
      : disk.lastContactCorrections > 0 ? 'Contact corrected last step' : ''
  const slowed = !relaxing && disk.growthThrottle < 0.995
  const phaseMode = phaseIndex !== null ? phases[phaseIndex]?.mode : null
  // While paused, a stop message explains why playback ended; contact status shows otherwise.
  // While playing, the status says what's happening and how far it is to Stop at. Contact in each step shows in Stats and
  // the Contact overlay; a brain's folds touch in nearly every step, so it used to hide the progress for the whole run.
  const activity = phaseMode ? `Phase ${phaseIndex! + 1}: ${phaseMode === 'relax' ? 'relaxing' : 'growing'}`
    : relaxing ? 'Relaxing' : slowed ? `Growing at ${Math.round(disk.growthThrottle * 100)}% (contact)` : 'Growing'
  const toStop = !relaxing && phaseMode !== 'relax' && stopAt.kind === 'step' && stopAt.value > step ? ` · step ${step} of ${stopAt.value}` : ''
  const playbackStatus = loading ? 'Loading…' : stopping ? 'Stopping…' : !active && notice ? notice
    : active ? (disk.initialOverlap ? contactStatus : `${activity}${toStop}`)
      : contactStatus || notice || (!disk.canGrow ? (rims.length ? 'No growth field. Turn on a layer or paint' : 'No open rims. Paint growth or add a layer') : 'Paused')
  // Touch screens get gesture wording; mice get button and wheel wording.
  const caption = touchScreen
    ? (tool === 'point' ? 'Tap the model to place the point' : tool === 'line' ? 'Tap to add line points'
      : BRUSH_TOOLS.includes(tool) ? 'One finger brushes · Two fingers turn and zoom' : 'Drag to turn · Pinch to zoom · Two fingers to pan')
    : tool === 'point' ? 'Click the model to place the point · Esc to finish'
      : tool === 'line' ? 'Click to add line points · Esc to finish'
        : BRUSH_TOOLS.includes(tool) ? 'Left drag to brush · Right drag to orbit · [ ] size'
          : 'Drag to orbit · Right drag to pan · Scroll to zoom'
  const blockedReason = loading ? 'Preparing the surface…'
    : disk.initialOverlap ? 'The starting surface crosses itself. Choose Grow anyway in the Starting surface card first.'
      : !disk.canGrow ? (rims.length ? 'Nothing grows yet. Turn on a layer, or paint growth onto the model.'
        : 'This surface has no open rims. Paint growth onto the model, add a layer, or apply the Brain folds preset.')
        : ''
  const rimEdges = previewRim === null ? undefined : previewRim === -1 ? rims.flatMap(rim => rim.edges) : rims[previewRim]?.edges

  const transport = <div className="transport" role="group" aria-label="Playback">
    <button className="primary" disabled={stopping || (!active && !canSimulate)} data-key="Space"
      data-tip={stopping ? 'Stopping after the current step.' : active ? 'Stop growing.' : blockedReason || (relaxing ? 'Let the shape settle without adding growth, until you stop it.' : 'Grow continuously until you stop it, or until Stop at is reached.')}
      onClick={() => active ? stopPlayback() : play()}><Icon name={active ? 'stop' : 'play'} />{active ? 'Stop' : relaxing ? 'Play relaxation' : 'Play growth'}</button>
    <button disabled={active || !canSimulate} data-key="."
      data-tip={active ? 'Stop playback first.' : blockedReason || `Run ${manualSteps} steps, then pause. Change the batch size under Simulation › Advanced.`} onClick={stepOnce}><Icon name="step" /><span className="compact-label">Step {manualSteps}</span></button>
    <button disabled={loading} data-tip={input?.brain?.builtin ? 'Go back to the smooth brain at this fold size, and clear the timeline and your paint. Layers and settings stay.'
      : 'Go back to the starting surface and clear the timeline and paint. Your layers and settings stay, and a flat bottom that doesn\'t grow with Brain folds is held again.'}
      onClick={() => guard('Reset to the starting surface?', 'Reset', () => void reset())}><Icon name="reset" /><span className="compact-label">Reset</span></button>
  </div>
  const status = <span className="playback-status" role="status" data-warning={Boolean(disk.initialOverlap || (!active && disk.stepStatus === 'contact') || detailLimit)}>
    {playbackStatus}{detailLimit && <><span aria-hidden="true"> · </span>Mesh detail limit</>}
  </span>

  return <main className="studio">
    <div className="stage">
      <Viewport disk={disk} tick={tick} view={view} overlay={overlay} ghost={ghost} imported={Boolean(input)} running={running}
        tool={tool} canEdit={!loading} brush={brush} rimEdges={rimEdges} layers={layers} selectedLayerId={selectedLayer?.id ?? null}
        onStroke={onStroke} onPlace={onPlace} gravityArrow={gravityArrow} cameraKey={cameraKey} belowKey={belowKey}
        solid={tool === 'edges' ? null : shownSolid} crossings={shownSolid && tool !== 'edges' ? crossings?.vertices ?? null : null}
        borders={borders} chosen={chosenEdges} hoverLoop={tool === 'edges' ? hoverLoop : null} onEdgeHover={onEdgeHover} onEdgePick={onEdgePick}
        print={overlay === 'print' ? { angle: printAngle, low: printResult?.low ?? -Infinity, bedTolerance: printResult?.bedTolerance ?? 0,
          twoSided: printTwoSided, marks: printResult?.marks ?? [] } : null}
        smooth={Boolean(input?.brain)} />
    </div>

    <header className="brand glass">
      <div><p className="app-kicker">Differential growth</p><h1>Growth Studio</h1></div>
      <button className="icon-button" aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts and the quick start" data-key="?" onClick={() => setShowHelp(true)}>?</button>
    </header>

    <aside className="sidebar side-panel glass" aria-label="Design controls">
      <section className="model-card" aria-labelledby="model-name">
        <div className="card-head"><p className="eyebrow">Starting surface</p></div>
        <h2 id="model-name" data-tip={input ? input.name : 'A flat disk with one open rim, ready to grow.'}>{input ? input.name : 'Default disk'}</h2>
        <p className="hint" data-tip={input && !input.brain ? `Prepared with ${disk.preparationSplits} edge splits and ${disk.preparationFlips} balancing flips.` : undefined}>
          {closedShape ? `Closed · ${(input!.indices.length / 3).toLocaleString()} triangles`
            : <>{rims.length} open {rims.length === 1 ? 'rim' : 'rims'}{input ? ` · ${(input.indices.length / 3).toLocaleString()} triangles` : ' · flat sheet'}</>}
        </p>
        <input ref={inputRef} type="file" accept=".stl,model/stl" hidden aria-label="Choose an STL file" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importStl(file)
        }} />
        <div className="button-row start-row">
          <button type="button" disabled={loading || !input} data-tip={input ? 'Go back to the flat default disk, an open sheet that grows from its rim.' : 'You are already using the default disk.'}
            onClick={() => guard('Switch to the default disk?', 'Discard and switch', switchToDefaultDisk)}>Default disk</button>
          <button type="button" disabled={loading} data-tip="Start from the built-in brain: a smooth, unfolded brain made from an MRI scan, ready to fold with Brain folds."
            onClick={() => guard('Load the built-in brain?', 'Discard and load', () => void loadBrain(foldChoice))}>Built-in brain</button>
        </div>
        <div className="button-row one start-row">
          <button type="button" disabled={loading} data-tip="Load an STL, used as it is. An open surface, such as a vase, grows from its rims. A closed shape grows over its whole surface, like a brain, and keeps its walls and edges."
            onClick={() => guard('Load a new STL?', 'Discard and choose STL', () => inputRef.current?.click())}>{loading ? 'Preparing…' : 'Upload STL'}</button>
        </div>
        {input?.brain?.builtin && <p className="hint credit">{BRAIN_CREDIT.short}. <a href={BRAIN_CREDIT.url} target="_blank" rel="noreferrer"
          data-tip={BRAIN_CREDIT.text}>Source</a></p>}
        {importError && <p className="hint" role="alert">{importError}</p>}
        {nearlyClosed && input && rims.length > 0 && <div className="overlap-warning" role="status">
          <p>This STL looks almost closed: its open {rims.length === 1 ? 'edge is' : 'edges are'} short, like a hairline gap, so it grows as an open surface from {rims.length === 1 ? 'that gap' : 'those gaps'}. If it should be closed, close the {rims.length === 1 ? 'gap' : 'gaps'} in your CAD tool and upload it again.</p>
        </div>}
        {/* About dense uploads; a brain's triangles come from growth, which this advice can't reduce. */}
        {!input?.brain && disk.indices.length / 3 > SLOW_TRIANGLES && <div className="overlap-warning" role="status">
          <p>{(disk.indices.length / 3).toLocaleString()} triangles: each step can take seconds. The view stays responsive, but the shape changes slowly. For interactive growth, reduce below {SLOW_TRIANGLES.toLocaleString()} (Fusion: Mesh › Reduce).</p>
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
          {stopAt.kind === 'step' && <label data-tip="Stop when the timeline reaches this step.">Stop at step<NumberField min={1} step="50" value={stopAt.value}
            onValue={value => setStopAt({ kind: 'step', value: value ?? 1 })} /></label>}
        </section>

        <section><details open={coreOpen} onToggle={event => setCoreOpen(event.currentTarget.open)}>
          <summary data-tip="A soft core under the surface holds it in, so growth buckles it into folds instead of inflating it, as in a brain.">Core · {mechanics.coreStiffness > 0 ? percent(mechanics.coreStiffness, 1) : 'off'}</summary>
          <Slider label="Core firmness" value={mechanics.coreStiffness} display={mechanics.coreStiffness > 0 ? percent(mechanics.coreStiffness, 1) : 'Off'} min={0} max={0.02} step={0.0005}
            title="How firmly the core holds each point near its starting place. Off lets a closed shape inflate; a little makes it fold, and firmer gives smaller folds."
            onChange={value => change('coreStiffness', value)} />
          <Slider label="Core growth" value={mechanics.coreGrowth} display={percent(mechanics.coreGrowth)} min={0} max={1} step={0.05} disabled={!mechanics.coreStiffness}
            title={mechanics.coreStiffness ? 'How fast the core grows compared with the surface. Lower folds the surface more deeply.' : 'Turn on Core firmness first.'}
            onChange={value => change('coreGrowth', value)} />
        </details></section>

        <section><details><summary data-tip="Pull the growing area in one direction, so folds droop or lean. The rest of the model stays put.">Gravity{mechanics.gravity > 0 ? ` · ${percent(mechanics.gravity)}` : ''}</summary>
          <Slider label="Strength" value={mechanics.gravity} display={percent(mechanics.gravity)} min={0} max={1} step={0.01}
            title="How hard the pull is. It acts on the growth field only." onChange={value => change('gravity', value)} />
          <Slider label="Tilt from down" value={mechanics.gravityTilt} display={`${mechanics.gravityTilt}°`} min={0} max={180} step={1}
            title="Aims the pull away from straight down." onChange={value => change('gravityTilt', value)} />
          <Slider label="Heading" value={mechanics.gravityHeading} display={`${mechanics.gravityHeading}°`} min={0} max={359} step={1}
            title="Rotates a tilted pull around the vertical axis." onChange={value => change('gravityHeading', value)} />
          <label data-tip={mechanics.gravity > 0 ? 'Gravity already holds the parts that don\'t grow in place.'
            : 'Hold the parts that don\'t grow exactly where they are, so an erased flat bottom stays on the bed while the rest folds.'}>
            <span>Hold parts that don't grow <input type="checkbox" checked={mechanics.gravity > 0 || mechanics.holdStill > 0} disabled={mechanics.gravity > 0}
              onChange={event => change('holdStill', event.currentTarget.checked ? 1 : 0)} /></span></label>
        </details></section>

        <section><details><summary data-tip="How growing folds push apart when they touch, so the surface never passes through itself.">Contact in growth field</summary>
          <Slider label="Repel distance" value={Math.min(12, repelMm)} display={`${repelMm.toFixed(1)} mm`} min={0} max={12} step={0.1}
            title={`How far apart folds in the growth field stay when they meet, in millimeters${input ? '' : ' on the starting disk at its print size; gaps print smaller as it grows'}. For printing: folds closer than your nozzle width, about 0.4 mm, fuse, and on a sheet the wall fills the gap too, so add the wall's thickness.`}
            onChange={mm => change('repelDistance', Math.min(REPEL_MAX_UNITS, mm / mmPerUnit))} />
          <Slider label="Repel strength" value={mechanics.repelStrength} display={percent(mechanics.repelStrength)} min={0.1} max={1} step={0.05}
            title="How quickly touching folds are pushed back each step." onChange={value => change('repelStrength', value)} />
        </details></section>

        <section><details open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary data-tip="Mesh resolution, motion damping, and playback speed.">Advanced</summary>
          <Slider label="Damping" value={mechanics.damping} display={percent(mechanics.damping)} min={0.02} max={0.9} step={0.01}
            title="Calms wobbling after the sheet bends. Higher settles faster but looks stiffer." onChange={value => change('damping', value)} />
          {/* Fine folds split at 0.06 on an upload. */}
          <Slider label="Remesh edge length" value={mechanics.remeshLength} display={mechanics.remeshLength.toFixed(3)} min={0.05} max={0.25} step={0.005}
            title={surfaceGrowth ? 'Split threshold while growing. Fold size sets it; smaller values hold smaller folds.'
              : 'Starting triangle size and split threshold. Smaller values hold smaller folds. Press Reset to apply to an STL.'}
            onChange={value => change('remeshLength', value)} />
          <Slider label="Mesh detail limit" value={mechanics.detailScale}
            display={mechanics.unlimitedDetail ? `No limit · up to ${NO_LIMIT_VERTICES.toLocaleString()} vertices` : `${disk.growthBudget.toLocaleString()} vertices · ${mechanics.detailScale}×`}
            min={1} max={4} step={0.25} disabled={mechanics.unlimitedDetail > 0}
            title={mechanics.unlimitedDetail ? 'Turn off No limit to set a limit.' : 'How many vertices growth can add. Higher limits keep folds refining but run slower.'}
            onChange={value => change('detailScale', value)} />
          <label data-tip={`Let growth keep refining until the mesh has ${NO_LIMIT_VERTICES.toLocaleString()} vertices, about ${(2 * NO_LIMIT_VERTICES).toLocaleString()} triangles: as large a sheet as Growth Studio can open again (a wall doubles it). Each step gets slower as the mesh grows. Without any limit the tab would run out of memory and lose unsaved work.`}>
            <span>No limit <input type="checkbox" checked={mechanics.unlimitedDetail > 0}
              onChange={event => change('unlimitedDetail', event.currentTarget.checked ? 1 : 0)} /></span></label>
          <Slider label="Playback speed" value={stepsPerUpdate} display={`${stepsPerUpdate} ${stepsPerUpdate === 1 ? 'step' : 'steps'} per update`}
            min={1} max={input ? 3 : 5} step={1} title="Steps calculated between shape updates. Higher grows faster, in bigger jumps." disabled={Boolean(manualQueue)}
            onChange={value => (input ? setImportSpeed : setSpeed)(value)} />
          <Slider label="Manual step size" value={manualSteps} display={String(manualSteps)} min={10} max={input ? 30 : 100} step={10}
            title="How many steps the Step button runs." onChange={value => (input ? setImportBatch : setBatch)(value)} />
        </details></section>
      </TabPanel>
    </aside>

    <section className="center" aria-label="3D view">
      <ViewportBars tool={tool} brush={brush} canUndo={disk.canUndoBrush} overlay={overlay} view={view} ghost={ghost}
        placing={tool === 'point' ? `Placing ${selectedLayer?.name ?? 'point'}` : tool === 'line' ? `Drawing ${selectedLayer?.name ?? 'line'}` : null}
        canEdges={Boolean(input)} edgesHint={tool !== 'edges' ? null : borders && !borders.sharp.length && !borders.smooth.length ? 'This shape has no designed edges to choose.'
          : `${edgeChoices.length ? `${edgeChoices.length} ${edgeChoices.length === 1 ? 'loop' : 'loops'} chosen. ` : ''}${touchScreen ? 'Tap an edge to add its loop, or tap it again to remove it' : 'Click an edge to choose its loop · Shift-click adds · Option-click removes'}`}
        onTool={setTool} onBrush={setBrush} onUndo={undoStroke} onOverlay={chooseOverlay} onView={setView} onGhost={setGhost}
        printAngle={printAngle} printReadout={printReadout} onPrintAngle={setPrintAngle} onBelow={() => setBelowKey(k => k + 1)}
        onFrame={() => setCameraKey(k => k + 1)} />
      {showQuickStart && <section className="quick-start glass" aria-labelledby="quick-start-title">
        <h2 id="quick-start-title">Quick start</h2>
        <ol>
          <li><b>Pick a surface:</b> the disk, the built-in brain, or your own STL.</li>
          <li><b>Choose where it grows:</b> layers in Growth field, or Paint on the model.</li>
          <li><b>Press Play growth</b> or Space. Drag the timeline to look back.</li>
        </ol>
        <p>Hover any control to see what it does.</p>
        <button type="button" className="primary" data-tip="Hide this guide. Reopen it from the ? button." onClick={closeQuickStart}>Got it</button>
      </section>}
      <div className="dock">
        <div className="view-caption">
          <span>{caption}</span>
          {overlay === 'print' && <span className="print-legend" data-tip="Faces that need support at the support angle are red, faces up to 10° steeper are yellow, and faces on the bed are blue. Dark dots are low points hanging in the air, which need a support to start on.">
            <i className="printable">Printable</i><i className="marginal">Marginal</i><i className="needs">Needs support</i><i className="bed">Touches the bed</i><i className="low">Low point</i>
          </span>}
          {overlay !== 'none' && overlay !== 'print' && <span className={`field-key key-${overlay}`}>
            {overlay === 'field' ? 'Growth field' : overlay === 'growth' ? 'Growth so far' : 'Recent contact'}
          </span>}
          {showSolid && <span data-tip="The solid that Export writes. Turn it off under File › Export mesh.">Solid · {thickness.wall} mm wall{sideName && ` ${sideName === 'top' ? 'on top' : sideName === 'bottom' ? 'underneath' : sideName}`}</span>}
          {showSolid && crossings && crossings.pairs > 0 && <span className="field-key key-crossing">Wall crosses itself</span>}
          {showClosed && <span data-tip="The print solid that Export writes. Turn it off under File › Export mesh.">
            Print solid{smoothPasses ? ` · smoothed ${smoothPasses === 2 ? 'twice' : 'once'}` : ''}{thickness.flatBase ? ` · flat base ${baseCut.toFixed(1)} mm` : ''}</span>}
          {showClosed && crossings && crossings.pairs > 0 && <span className="field-key key-crossing">Solid crosses itself</span>}
        </div>
        <Timeline marks={snapshots.map(s => s.mark)} viewing={viewing} step={step} strain={disk.strain} every={every} active={active}
          phases={phases} phaseIndex={phaseIndex} onScrub={index => void scrub(index)} onSnapshot={() => void takeSnapshot()} onEvery={setEvery}
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
          {surfaceGrowth && <div className="group-field"><span id="fold-size-label" data-tip="How big the folds grow over the whole surface. Change it any time: what has grown stays, and growth carries on at the new size.">Fold size</span>
            <div className="button-row three" role="group" aria-labelledby="fold-size-label">
              {FOLD_ORDER.map(size => <button key={size} type="button" aria-pressed={foldNow === size} disabled={loading}
                data-tip={`${FOLD_SIZES[size].tip} ${!grown && input?.brain ? 'Loads the built-in brain meshed for this size.' : 'Growth carries on at this size from where it is.'}`}
                onClick={() => changeFold(size)}>{FOLD_SIZES[size].label}</button>)}
            </div>
            {!foldNow && <p className="hint">Remesh edge length is set under Simulation › Advanced. Choose a size to use Fold size again.</p>}
          </div>}
          {rimLayers.length > 0 && rimLayers[0].kind === 'rim' && <>
            <Slider label="Rim fold size" value={foldSize} display={foldSize < 0.33 ? 'Fine' : foldSize < 0.66 ? 'Medium' : 'Broad'} min={0} max={1} step={0.05}
              title="How big a rim's folds grow: sets rim growth width and bend stiffness together. Finer folds need a narrow field and a soft sheet." onChange={setFoldSize} />
            <p className="hint">Rim width {percent(rimLayers[0].width)} · bend {percent(mechanics.bending, 1)}. Smaller folds also need a small Remesh edge length.</p>
          </>}
          {!surfaceGrowth && !rimLayers.length && <p className="hint">Add a rim layer, or apply the Brain folds preset, to set the fold size.</p>}
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
          {detailLimit && <p className="hint">{mechanics.unlimitedDetail
            ? `Reached ${NO_LIMIT_VERTICES.toLocaleString()} vertices, as large a sheet as Growth Studio can open again as an STL.`
            : 'Mesh detail limit reached. Raise it, or turn on No limit, under Simulation › Advanced to keep refining.'}</p>}
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
            <p className="hint">{input.brain?.builtin ? 'The built-in brain has no file coordinates of its own. Center it to put it on the origin.'
              : input.sourceCenter ? 'Exports keep the STL coordinates unless you center the mesh.'
                : 'This project predates coordinate preservation. Reimport the original STL to use its coordinates.'}</p>
          </>}
          <label data-tip={canThicken ? 'Give the sheet a wall and close its open rims, so Export writes a solid ready for slicing.'
            : 'A closed shape is a solid already. Turn this on to smooth it and cut a flat base, so Export writes a solid ready for slicing.'}><span>{canThicken ? 'Add thickness' : 'Print solid'} <input type="checkbox" checked={thickness.on}
            onChange={event => changeThickness({ on: event.currentTarget.checked })} /></span></label>
          {(solidOn || closedOn) && <>
            <div className="group-field"><span id="smooth-label">Smooth surface</span>
              <div className="button-row three" role="group" aria-labelledby="smooth-label">
                {SMOOTH_LEVELS.map(([level, label, tip]) => {
                  const sheetTriangles = disk.indices.length / 3, fits = smoothPassesFor(level, sheetTriangles) === (level === 'strong' ? 2 : level === 'light' ? 1 : 0)
                  return <button key={level} type="button" aria-pressed={thickness.smooth === level} disabled={!fits}
                    data-tip={fits ? tip : `This surface has ${sheetTriangles.toLocaleString()} triangles: ${label} smoothing would make more than ${SMOOTH_MAX_TRIANGLES.toLocaleString()}.${level === 'strong' ? ' Use Light.' : ''}`}
                    onClick={() => changeThickness({ smooth: level })}>{label}</button>
                })}
              </div>
            </div>
            <Slider label="Sharp edge angle" value={thickness.sharpAngle} display={`${thickness.sharpAngle}°`} min={SHARP_ANGLE_RANGE[0]} max={SHARP_ANGLE_RANGE[1]} step={1}
              disabled={thickness.smooth === 'off' || !smoothPasses}
              title={thickness.smooth === 'off' ? 'Choose Light or Strong first. Without smoothing, every edge stays as it is.'
                : !smoothPasses ? `This surface has grown too large to smooth, so its edges stay as they are.`
                  : `Edges that bend more than this in the starting shape, where it hasn't grown, stay sharp when smoothing${sharpCount === null ? '' : `: ${sharpCount.toLocaleString()} mesh ${sharpCount === 1 ? 'edge' : 'edges'} at ${thickness.sharpAngle}°`}. Where it grew, they fold with the surface and are smoothed like the rest. Lower it to catch softer edges, such as a shallow chamfer; raise it to smooth the facets of a coarse mesh. 30° suits most CAD exports.`}
              onChange={sharpAngle => changeThickness({ sharpAngle })} />
            <Slider label="Bevel sharp edges" value={thickness.bevel} display={percent(thickness.bevel)} min={0} max={1} step={0.05}
              disabled={thickness.smooth === 'off' || !smoothPasses || sharpCount === 0}
              title={thickness.smooth === 'off' ? 'Choose Light or Strong first. Without smoothing, sharp edges stay as they are.'
                : !smoothPasses ? `This surface has grown too large to smooth, so its edges stay as they are.`
                  : sharpCount === 0 ? `This shape has no edges that bend more than ${thickness.sharpAngle}° where it hasn't grown, so there is nothing to bevel. Lower Sharp edge angle to find softer ones.`
                    : `${sharpCount === null ? 'Some edges may bend' : `${sharpCount.toLocaleString()} mesh ${sharpCount === 1 ? 'edge bends' : 'edges bend'}`} more than ${thickness.sharpAngle}° in the starting shape where it hasn't grown, such as the edge around a flat bottom. At 0% they stay sharp, so a print sits flat on the bed. Higher values round them more; 100% is as smooth as the rest of the surface.${sharpCount === null ? ' The count shows when growth pauses.' : ''}`}
              onChange={bevel => changeThickness({ bevel })} />
            {input && <div className="group-field edge-choices"><span>Edges</span>
              {!edgeChoices.length && <p className="hint">Choose loops of the starting shape's edges with the Edges tool (D) above the 3D view, to keep them sharp or round them on the print.</p>}
              {edgeChoices.map((choice, i) => <div className="edge-choice" key={choice.id}>
                <div className="edge-choice-head"><span>Loop {i + 1}, {loopLength(choice).toFixed(0)} mm{choice.closed ? '' : ', with ends'}</span>
                  <button type="button" aria-label={`Remove loop ${i + 1}`} data-tip="Stop treating this loop on its own: the settings above smooth it like the rest."
                    onClick={() => removeChoice(choice.id)}>Remove</button></div>
                <div className="button-row" role="group" aria-label={`Loop ${i + 1} on the print`}>
                  <button type="button" aria-pressed={choice.action === 'sharp'} data-tip={choice.closed ? 'Keep this loop fully sharp on the print, whatever the smoothing and bevel.'
                      : 'Keep this loop sharp on the print, whatever the smoothing and bevel. It has ends, so at its ends it is only as sharp as the edges it meets there: with Bevel above 0%, it fades out toward them.'}
                    onClick={() => changeChoice(choice.id, { action: 'sharp' })}>Keep sharp</button>
                  <button type="button" aria-pressed={choice.action === 'round'} disabled={!choice.closed}
                    data-tip={choice.closed ? 'Round this loop on the print, with a true round of the radius below.' : 'Rounds need a loop that goes all the way round. This one ends at corners.'}
                    onClick={() => changeChoice(choice.id, { action: 'round' })}>Round</button>
                </div>
                {choice.action === 'round' && <Slider label="Radius" value={choice.radius} display={`${choice.radius.toFixed(1)} mm`} min={ROUND_RANGE[0]} max={ROUND_RANGE[1]} step={0.1}
                  title="The round's radius, in mm. A round smaller than about half the line width (0.2 mm with a 0.4 mm nozzle) prints like a sharp edge; along the bed, the layer height decides instead." onChange={radius => changeChoice(choice.id, { radius })} />}
                <p className="hint" role="status">{edgeText(choice)}</p>
              </div>)}
            </div>}
          </>}
          {solidOn && <>
            <Slider label="Wall thickness" value={thickness.wall} display={`${thickness.wall.toFixed(1)} mm`} min={0.2} max={5} step={0.1}
              title={`Total wall${input ? ", in the STL's millimeters" : ''}. Most filament printers need at least 0.8 mm, resin printers about 0.5 mm.`}
              onChange={wall => changeThickness({ wall })} />
            <div className="group-field"><span id="wall-side-label">Wall side</span>
              <div className="button-row three" role="group" aria-labelledby="wall-side-label">
                {WALL_SIDES.map(({ side, stl, disk: onDisk }) => {
                  const [label, tip] = input ? stl : onDisk
                  return <button key={side} type="button" aria-pressed={thickness.side === side} data-tip={tip}
                    onClick={() => changeThickness({ side })}>{label}</button>
                })}
              </div>
            </div>
            <div className="group-field"><span id="rim-edge-label">Rim edge</span>
              <div className="button-row three" role="group" aria-labelledby="rim-edge-label">
                {RIM_PROFILES.map(([rim, label, tip]) => <button key={rim} type="button" aria-pressed={thickness.rim === rim} data-tip={tip}
                  onClick={() => changeThickness({ rim })}>{label}</button>)}
              </div>
            </div>
            {!input && <label data-tip="The default disk has no units. Export scales the solid so its longest side is this long.">Longest side (mm)
              <NumberField min={10} max={1000} step="5" value={thickness.size} onValue={size => changeThickness({ size: size ?? 100 })} /></label>}
            <label data-tip="Show the solid in the 3D view while growth is paused. Growth itself always uses the thin sheet."><span>Show in 3D view <input type="checkbox" checked={thickness.show}
              onChange={event => { const show = event.currentTarget.checked; setThickness(current => ({ ...current, show })) }} /></span></label>
            <p className="hint" role="status">{active ? 'The wall is checked when growth pauses.'
              : !crossings ? 'Checking the wall…'
                : crossings.failed ? "The wall couldn't be checked in this browser. The solid still exports."
                : crossings.leaks ? `The solid isn't closed along ${crossings.leaks.toLocaleString()} ${crossings.leaks === 1 ? 'edge' : 'edges'}, where the surface pinches to a point or its faces are turned inconsistently. Repair the STL in your CAD tool before printing.`
                : crossings.pairs ? (disk.initialOverlap || disk.ignoringOverlaps
                  ? `The surface already crosses itself, so the wall does too, in ${crossingCount}${thickness.show ? ', shown in pink' : ''}. Combine the bodies in your CAD tool before printing.`
                  : `The wall crosses itself in ${crossingCount}${thickness.show ? ', shown in pink' : ''}, where folds come closer together, or bend more tightly, than the wall is thick. Most slicers merge these. For a clean solid, use a thinner wall.`)
                  : `Closed solid with no crossings, ${(solid!.indices.length / 3).toLocaleString()} triangles${smoothPasses ? `, smoothed ${smoothPasses === 2 ? 'twice' : 'once'} before the wall` : ''}${smoothPasses && sharpCount
                    ? thickness.bevel <= 0 ? ', sharp edges kept' : thickness.bevel >= 1 ? ', sharp edges rounded' : `, sharp edges beveled ${percent(thickness.bevel)}` : ''}${roundedText}.`}</p>
          </>}
          {closedOn && <>
            <label data-tip="Cut the bottom flat, so a print sits on the bed without supports under it."><span>Flat base <input type="checkbox" checked={thickness.flatBase}
              onChange={event => changeThickness({ flatBase: event.currentTarget.checked })} /></span></label>
            {thickness.flatBase && <Slider label="Base cut" value={baseCut} display={`${baseCut.toFixed(1)} mm`} min={baseRange[0]} max={baseRange[1]} step={0.5}
              title="How much is cut off the bottom. A deeper cut gives a wider base to stand on." onChange={cut => changeThickness({ baseCut: cut })} />}
            <label data-tip="Show the print solid in the 3D view while growth is paused. Growth itself always uses the grown surface."><span>Show in 3D view <input type="checkbox" checked={thickness.show}
              onChange={event => { const show = event.currentTarget.checked; setThickness(current => ({ ...current, show })) }} /></span></label>
            <p className="hint" role="status">{active ? 'The solid is checked when growth pauses.'
              : !crossings ? 'Checking the solid…'
                : crossings.failed ? "The solid couldn't be checked in this browser. It still exports."
                : crossings.leaks ? `The solid isn't closed along ${crossings.leaks.toLocaleString()} ${crossings.leaks === 1 ? 'edge' : 'edges'}, where the surface pinches to a point. Repair the STL in your CAD tool before printing.`
                : crossings.pairs && (disk.initialOverlap || disk.ignoringOverlaps) ? `The surface already crosses itself, so the solid does too, in ${crossingCount}${thickness.show ? ', shown in pink' : ''}. Combine the bodies in your CAD tool before printing.`
                : crossings.pairs ? (smoothPasses
                  ? `The smoothed surface crosses itself in ${crossingCount}${thickness.show ? ', shown in pink' : ''}, where folds bend more tightly than smoothing can follow. Most slicers merge these. For a clean solid, use less smoothing: with Smooth surface off, the solid is the grown surface, which growth keeps from crossing${roundedCount ? ', and its rounds, which are left sharp where they would cut through it' : ''}.`
                  : `The solid crosses itself in ${crossingCount}${thickness.show ? ', shown in pink' : ''}. Most slicers merge these.`)
                  : `Closed solid with no crossings, ${(closedPrint!.indices.length / 3).toLocaleString()} triangles${smoothPasses ? `, smoothed ${smoothPasses === 2 ? 'twice' : 'once'}` : ''}${smoothPasses && sharpCount
                    ? thickness.bevel <= 0 ? ', sharp edges kept' : thickness.bevel >= 1 ? ', sharp edges rounded' : `, sharp edges beveled ${percent(thickness.bevel)}` : ''}${roundedText}${thickness.flatBase ? `. The bottom ${baseCut.toFixed(1)} mm is cut flat` : ''}.`}</p>
          </>}
          <div className="button-row">
            <button disabled={active} data-tip={active ? 'Stop the simulation to export.' : solidOn ? 'Save the solid as an OBJ mesh, in millimeters.' : 'Save the current surface as an OBJ mesh.'} onClick={() => void exportMesh('obj')}>Export OBJ</button>
            <button disabled={active} data-tip={active ? 'Stop the simulation to export.' : solidOn || closedOn ? 'Save the solid as a binary STL for slicing, in millimeters.'
              : canThicken ? 'Save the current surface as a binary STL for CAD or slicing. It is an open sheet, so add thickness before printing.' : 'Save the current surface as a binary STL for CAD or slicing.'}
              onClick={() => void exportMesh('stl')}>Export STL</button>
          </div>
          <p className="hint" role="status">{exportStatus || (solidOn ? 'Exports the solid.' : canThicken ? 'The surface is an open sheet. Add thickness to print it.'
            : closedOn ? 'Exports the print solid.' : 'The surface is closed, a solid already. Turn on Print solid to smooth it or cut a flat base.')}</p>
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
    brain: 'M6 22 c-4 -10 4 -18 12 -15 c4 -5 14 -4 16 3 c6 1 7 10 2 13 c-1 4 -6 5 -9 3 c-3 3 -9 3 -11 -1 c-4 1 -8 0 -10 -3 M14 10 q3 4 0 8 M24 9 q-2 5 2 9 M30 15 q-4 2 -3 6',
  }
  return <svg viewBox="0 0 44 30" className="preset-glyph" aria-hidden="true"><path d={paths[id]} fill="none" stroke="currentColor" strokeWidth="2" /></svg>
}
