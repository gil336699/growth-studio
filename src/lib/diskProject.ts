import type { GrowthStlSource } from '../physics/growthStl'
import { DISK_DEFAULTS, type DiskSnapshot } from '../physics/growingDisk'

// Kept from Growth Lab so projects saved there still open here.
const SCHEMA = 'growth-lab/disk-project'
export type DiskView = 'smooth' | 'triangles' | 'cells' | 'fans'

type ProjectSource = Omit<GrowthStlSource, 'positions' | 'indices'> & { positions: number[]; indices: number[] }
type DiskProject = {
  source: ProjectSource | null
  disk: DiskSnapshot
  mechanics: typeof DISK_DEFAULTS
  revision: number
  rimWidth: number
  brushRadius: number
  ringSelection: number | null
  centerExport?: boolean
  relaxing: boolean
  showField: boolean
  view: DiskView
  speed: number
  batch: number
  importSpeed: number
  importBatch: number
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

const ranges: Record<keyof typeof DISK_DEFAULTS, [number, number]> = {
  growthRate: [0, 0.008], bending: [0, 0.3], damping: [0.02, 0.9], remeshLength: [0.09, 0.25],
  gravity: [0, 1], gravityTilt: [0, 180], gravityHeading: [0, 359],
  compoundGrowth: [0, 1], repelDistance: [0.004, 0.04], repelStrength: [0.1, 1], detailScale: [1, 4],
}

export function serializeDiskProject(project: DiskProject) {
  return JSON.stringify({ schema: SCHEMA, version: 1, ...project })
}

export function deserializeDiskProject(json: string) {
  const project = JSON.parse(json) as DiskProject & { schema: unknown; version: unknown }
  if (project?.schema !== SCHEMA || project.version !== 1) {
    throw new Error('Choose a supported Growth Studio project.')
  }
  const { disk, source } = project
  // Projects saved before a setting existed open with its default.
  const mechanics = project.mechanics && { ...DISK_DEFAULTS, ...project.mechanics }
  const invalid = () => new Error('This project has missing or invalid design data.')
  if (!disk || !mesh(disk.rest, disk.indices)) throw invalid()
  const vertices = disk.rest.length / 3
  if (!floats(disk.positions, disk.rest.length) || !floats(disk.previous, disk.rest.length)
    || !floats(disk.field, vertices, 0, 1) || !floats(disk.localGrowth, vertices, 0)
    || !Array.isArray(disk.brushOverrides) || disk.brushOverrides.some(pair =>
      !Array.isArray(pair) || pair.length !== 2 || !count(pair[0], vertices - 1) || !finite(pair[1], 0, 1))
    || (disk.disabledRims !== undefined && (!Array.isArray(disk.disabledRims)
      || !disk.disabledRims.every(id => count(id, vertices - 1))))
    || ![disk.acceptedSteps, disk.rejectedSteps, disk.splits, disk.growthBudget, disk.preparationSplits,
      disk.preparationFlips, disk.preparationPatches, project.revision].every(value => count(value))
    || (disk.baseBudget !== undefined && !count(disk.baseBudget))
    || (disk.growthThrottle !== undefined && !finite(disk.growthThrottle, 1 / 8, 1))
    || ![0, 3, 4, 5, 6].includes(disk.sources) || !finite(disk.zone, 0.1, 0.8)
    || !finite(disk.strain, 0, 1e30)
    || (source !== null && (!source || typeof source.name !== 'string' || !finite(source.scale, Number.MIN_VALUE, 1e30)
      || !mesh(source.positions, source.indices)
      || (source.sourceCenter !== undefined && !floats(source.sourceCenter, 3))))
    || (project.centerExport !== undefined && typeof project.centerExport !== 'boolean')
    || !mechanics || !Object.entries(ranges).every(([key, [min, max]]) => finite(mechanics[key as keyof typeof mechanics], min, max))
    || !finite(project.rimWidth, 0.03, 0.8) || !finite(project.brushRadius, 0.03, 0.5)
    || (project.ringSelection !== null && !count(project.ringSelection, vertices))
    || typeof project.relaxing !== 'boolean' || typeof project.showField !== 'boolean'
    || !['smooth', 'triangles', 'cells', 'fans'].includes(project.view)
    || ![1, 2, 3, 4, 5].includes(project.speed) || ![1, 2, 3].includes(project.importSpeed)
    || ![10, 20, 30].includes(project.importBatch) || !count(project.batch, 100)
    || project.batch < 10 || project.batch % 10 !== 0) throw invalid()
  return {
    ...project,
    mechanics,
    source: source && { ...source, positions: Float32Array.from(source.positions), indices: Uint32Array.from(source.indices) },
  }
}
