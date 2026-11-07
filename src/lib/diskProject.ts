import type { GrowthStlSource } from '../physics/growthStl'
import { DISK_DEFAULTS, type DiskSnapshot } from '../physics/growingDisk'
import { validLayers } from '../physics/growthLayers'

// Kept from Growth Lab so projects saved there still open here.
const SCHEMA = 'growth-lab/disk-project'
const VERSION = 2
export type DiskView = 'smooth' | 'triangles' | 'cells' | 'fans'
export type Overlay = 'field' | 'growth' | 'contact' | 'none'
export type Symmetry = 'off' | 'mirror' | 'radial'
export type BrushSettings = { radius: number; strength: number; hardness: number; symmetry: Symmetry; copies: number }
export type Phase = { mode: 'grow' | 'relax'; steps: number }
export type StopAt = { kind: 'none' | 'size' | 'step' | 'strain'; value: number }

export const BRUSH_DEFAULTS: BrushSettings = { radius: 0.15, strength: 1, hardness: 0, symmetry: 'off', copies: 6 }
export const STOP_DEFAULTS: StopAt = { kind: 'none', value: 2 }

type ProjectSource = Omit<GrowthStlSource, 'positions' | 'indices'> & { positions: number[]; indices: number[] }
export type DiskProject = {
  source: ProjectSource | null
  disk: DiskSnapshot
  mechanics: typeof DISK_DEFAULTS
  revision: number
  centerExport?: boolean
  relaxing: boolean
  view: DiskView
  speed: number
  batch: number
  importSpeed: number
  importBatch: number
  brush?: BrushSettings
  overlay?: Overlay
  ghost?: boolean
  phases?: Phase[]
  stopAt?: StopAt
  // Version 1 fields, converted on open.
  rimWidth?: number
  brushRadius?: number
  ringSelection?: number | null
  showField?: boolean
}

const finite = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
  finite(value, 0, max) && Number.isInteger(value)
const floats = (values: unknown, length?: number, min = -1e30, max = 1e30) =>
  Array.isArray(values) && (length === undefined || values.length === length)
  && values.every(value => finite(value, min, max))
const mesh = (positions: unknown, indices: unknown): positions is number[] =>
  Array.isArray(positions) && positions.length >= 9 && positions.length % 3 === 0 && floats(positions)
  && Array.isArray(indices) && indices.length >= 3 && indices.length % 3 === 0
  && indices.every(index => count(index, positions.length / 3 - 1))
const pairs = (value: unknown, vertices: number) => Array.isArray(value) && value.every(pair =>
  Array.isArray(pair) && pair.length === 2 && count(pair[0], vertices - 1) && finite(pair[1], 0, 1))

const ranges: Record<keyof typeof DISK_DEFAULTS, [number, number]> = {
  growthRate: [0, 0.008], bending: [0, 0.3], damping: [0.02, 0.9], remeshLength: [0.09, 0.25],
  gravity: [0, 1], gravityTilt: [0, 180], gravityHeading: [0, 359],
  compoundGrowth: [0, 1], repelDistance: [0.004, 0.04], repelStrength: [0.1, 1], detailScale: [1, 4],
}

export function serializeDiskProject(project: DiskProject) {
  return JSON.stringify({ schema: SCHEMA, version: VERSION, ...project })
}

const validBrush = (brush: BrushSettings) => finite(brush.radius, 0.01, 0.6) && finite(brush.strength, 0, 1)
  && finite(brush.hardness, 0, 1) && ['off', 'mirror', 'radial'].includes(brush.symmetry) && count(brush.copies, 24) && brush.copies >= 2
const validPhases = (phases: Phase[]) => Array.isArray(phases) && phases.length <= 32
  && phases.every(phase => (phase.mode === 'grow' || phase.mode === 'relax') && count(phase.steps, 100_000) && phase.steps > 0)
const validStop = (stop: StopAt) => ['none', 'size', 'step', 'strain'].includes(stop.kind) && finite(stop.value, 0, 1e6)

export function deserializeDiskProject(json: string) {
  const project = JSON.parse(json) as DiskProject & { schema: unknown; version: unknown }
  if (project?.schema !== SCHEMA || (project.version !== 1 && project.version !== VERSION)) {
    throw new Error('Choose a supported Growth Studio project.')
  }
  const legacy = project.version === 1
  const { disk, source } = project
  // Projects saved before a setting existed open with its default.
  const mechanics = project.mechanics && { ...DISK_DEFAULTS, ...project.mechanics }
  const invalid = () => new Error('This project has missing or invalid design data.')
  if (!disk || !mesh(disk.rest, disk.indices)) throw invalid()
  const vertices = disk.rest.length / 3
  if (!floats(disk.positions, disk.rest.length) || !floats(disk.previous, disk.rest.length)
    || !floats(disk.field, vertices, 0, 1) || !floats(disk.localGrowth, vertices, 0)
    || ![disk.acceptedSteps, disk.rejectedSteps, disk.splits, disk.growthBudget, disk.preparationSplits,
      disk.preparationFlips, disk.preparationPatches, project.revision].every(value => count(value))
    || (disk.baseBudget !== undefined && !count(disk.baseBudget))
    || (disk.growthThrottle !== undefined && !finite(disk.growthThrottle, 1 / 8, 1))
    || !finite(disk.strain, 0, 1e30)
    || (source !== null && (!source || typeof source.name !== 'string' || !finite(source.scale, Number.MIN_VALUE, 1e30)
      || !mesh(source.positions, source.indices)
      || (source.sourceCenter !== undefined && !floats(source.sourceCenter, 3))))
    || (project.centerExport !== undefined && typeof project.centerExport !== 'boolean')
    || !mechanics || !Object.entries(ranges).every(([key, [min, max]]) => finite(mechanics[key as keyof typeof mechanics], min, max))
    || typeof project.relaxing !== 'boolean'
    || !['smooth', 'triangles', 'cells', 'fans'].includes(project.view)
    || ![1, 2, 3, 4, 5].includes(project.speed) || ![1, 2, 3].includes(project.importSpeed)
    || ![10, 20, 30].includes(project.importBatch) || !count(project.batch, 100)
    || project.batch < 10 || project.batch % 10 !== 0) throw invalid()
  if (legacy) {
    if (!pairs(disk.brushOverrides, vertices)
      || (disk.disabledRims !== undefined && (!Array.isArray(disk.disabledRims) || !disk.disabledRims.every(id => count(id, vertices - 1))))
      || ![0, 3, 4, 5, 6].includes(disk.sources ?? -1) || !finite(disk.zone, 0.1, 0.8)
      || !finite(project.rimWidth, 0.03, 0.8) || !finite(project.brushRadius, 0.03, 0.5)
      || typeof project.showField !== 'boolean') throw invalid()
  } else if (!validLayers(disk.layers) || !pairs(disk.paintAdd, vertices) || !pairs(disk.paintErase, vertices)
    || !count(disk.clock)
    || (disk.ignoredOverlaps !== undefined && (!Array.isArray(disk.ignoredOverlaps) || !disk.ignoredOverlaps.every(v => count(v, vertices - 1))))
    || (project.brush !== undefined && !validBrush(project.brush))
    || (project.overlay !== undefined && !['field', 'growth', 'contact', 'none'].includes(project.overlay))
    || (project.ghost !== undefined && typeof project.ghost !== 'boolean')
    || (project.phases !== undefined && !validPhases(project.phases))
    || (project.stopAt !== undefined && !validStop(project.stopAt))) throw invalid()
  return {
    ...project,
    mechanics,
    disk: legacy ? { ...disk, legacyRimWidth: project.rimWidth } : disk,
    brush: project.brush ?? { ...BRUSH_DEFAULTS, radius: project.brushRadius ?? BRUSH_DEFAULTS.radius },
    overlay: project.overlay ?? (project.showField === false ? 'none' : 'field'),
    ghost: project.ghost ?? false,
    phases: project.phases ?? [],
    stopAt: project.stopAt ?? STOP_DEFAULTS,
    source: source && { ...source, positions: Float32Array.from(source.positions), indices: Uint32Array.from(source.indices) },
  }
}
