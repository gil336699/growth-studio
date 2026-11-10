// Brain mode: the built-in brain, the growth recipe behind the Instagram reel, and turning an uploaded STL into a
// smooth, closed starting brain. See docs/brain-mode.md.
import { BufferGeometry } from 'three'
import { DISK_DEFAULTS } from '../physics/growingDisk'
import { createLayer, type GrowthLayer } from '../physics/growthLayers'
import type { BrainInfo, GrowthStlSource } from '../physics/growthStl'
import type { StopAt } from './diskProject'
import { parseStl } from './stl'
import { closedRemesh } from './voxel'

export type FoldSize = 'fine' | 'medium' | 'broad'
export type Smoothing = 'light' | 'medium' | 'strong'
type Mechanics = typeof DISK_DEFAULTS

// Fold size sets the starting mesh's spacing and the split length during growth: folds come out about three mesh
// edges wide. Medium is the reel. Changed after growth has begun, only the split length changes, so the brain keeps its
// shape and grows on at the new size.
export const FOLD_SIZES: Record<FoldSize, { label: string; spacing: number; remeshLength: number; tip: string }> = {
  fine: { label: 'Fine', spacing: 0.045, remeshLength: 0.07, tip: 'More, smaller folds. Grows more slowly.' },
  medium: { label: 'Medium', spacing: 0.055, remeshLength: 0.09, tip: 'Folds a little smaller than a real brain’s, as in the reel.' },
  broad: { label: 'Broad', spacing: 0.065, remeshLength: 0.11, tip: 'Fewer, wider folds. Grows fastest.' },
}
// Blur passes on the rebuilt shape. Strong smooths away existing folds, such as those of an adult brain scan.
export const SMOOTHING: Record<Smoothing, { label: string; passes: number; tip: string }> = {
  light: { label: 'Light', passes: 1, tip: 'Keep the shape close to the STL, only softening its facets.' },
  medium: { label: 'Medium', passes: 4, tip: 'Round off small bumps and creases.' },
  strong: { label: 'Strong', passes: 12, tip: 'Smooth it like a fetal brain. Use this for a scan that is already folded.' },
}
export const FOLD_ORDER: FoldSize[] = ['fine', 'medium', 'broad']
export const SMOOTHING_ORDER: Smoothing[] = ['light', 'medium', 'strong']

// The built-in brain's bounding-sphere radius in solver units. Uploads are scaled to match, so one recipe gives the
// same folds on any shape; their own millimeters are kept in the source's scale.
export const BRAIN_RADIUS = 1.173
// The built-in brain is shown and exported 150 mm from front to back, a little smaller than an adult brain.
export const BRAIN_LENGTH_MM = 150
// The recipe's outer layer: 0.02 units out from the surface, a 2.7 mm cortex on the 150 mm brain.
export const BRAIN_LAYER = 0.02
export const BRAIN_STOP: StopAt = { kind: 'step', value: 420 }
// How far Stop at moves when Fold size changes on a brain that has stopped there, so Play growth carries on.
export const BRAIN_CONTINUE = 140
// Starting edge length for brain shapes: large, so the prepared mesh is used as it is, as in the reel's run.
export const BRAIN_START_EDGE = 10

export const BRAIN_CREDIT = {
  text: 'Brain shape based on “Brain Model” by Nevit Dilmen, NIH 3D, CC BY 4.0. Smoothed, cerebellum removed, halves joined.',
  short: 'Shape: Nevit Dilmen, NIH 3D (CC BY 4.0)',
  url: 'https://3d.nih.gov/entries/3dpx-002739',
}

export function brainMechanics(current: Mechanics, size: FoldSize): Mechanics {
  return {
    ...current, growthRate: DISK_DEFAULTS.growthRate, compoundGrowth: 0, bending: 0.2, gravity: 0,
    coreStiffness: 0.005, coreGrowth: 0.1, detailScale: 3.5, remeshLength: FOLD_SIZES[size].remeshLength, budgetScale: 1,
  }
}

// Settings for growing on at another fold size, on a brain whose starting shape was meshed for `prepared`: the new split
// length, and a vertex limit raised for a finer size, since the same area needs (old / new)² as many vertices. A broader
// size keeps the limit: lowering it to the vertices already there would stop splitting at once and warn of a limit
// that growth never reached.
export function foldMechanics(current: Mechanics, size: FoldSize, prepared: FoldSize): Mechanics {
  const remeshLength = FOLD_SIZES[size].remeshLength
  return { ...current, remeshLength, budgetScale: Math.max(1, (FOLD_SIZES[prepared].remeshLength / remeshLength) ** 2) }
}

// The fold size whose split length the settings use, or null for another length set under Advanced.
export function foldSizeOf(remeshLength: number): FoldSize | null {
  return FOLD_ORDER.find(size => Math.abs(FOLD_SIZES[size].remeshLength - remeshLength) < 1e-9) ?? null
}

export function brainLayers(): GrowthLayer[] {
  return [createLayer('surface', { name: 'Cortex' }), createLayer('paint')]
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
// Where the built-in brain doesn't grow, as erase weights: the inner walls between the halves (near z = 0) and the
// middle of the base, as in the paper's simulations.
export function brainErase(rest: ArrayLike<number>) {
  const erase = new Float32Array(rest.length / 3)
  for (let v = 0; v < erase.length; v++) {
    const side = Math.abs(rest[v * 3 + 2]), y = rest[v * 3 + 1]
    const grows = smooth(0.06, 0.16, side) * (1 - (1 - smooth(0.3, 0.5, side)) * (1 - smooth(-0.55, -0.4, y)))
    erase[v] = 1 - grows
  }
  return erase
}

// Reads a packed brain file: "GSB1", vertex and triangle counts, float positions and 16-bit indices.
export function decodeBrainMesh(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'GSB1') throw new Error('The built-in brain file is damaged.')
  const n = view.getUint32(4, true), t = view.getUint32(8, true)
  if (buffer.byteLength !== 16 + n * 12 + t * 6) throw new Error('The built-in brain file is damaged.')
  const positions = new Float32Array(buffer.slice(16, 16 + n * 12))
  const indices = Uint32Array.from(new Uint16Array(buffer.slice(16 + n * 12)))
  return { positions, indices }
}

// The longest side's millimeters per solver unit, so the brain is BRAIN_LENGTH_MM long.
function brainScale(positions: Float32Array) {
  let low = Infinity, high = -Infinity
  for (let i = 0; i < positions.length; i += 3) { low = Math.min(low, positions[i]); high = Math.max(high, positions[i]) }
  return BRAIN_LENGTH_MM / (high - low)
}

export function builtInBrainSource(buffer: ArrayBuffer, size: FoldSize): GrowthStlSource {
  const { positions, indices } = decodeBrainMesh(buffer)
  const brain: BrainInfo = { builtin: true, foldSize: size }
  return { name: 'Built-in brain', scale: brainScale(positions), positions, indices, brain }
}

const BRAIN_FILES: Record<FoldSize, URL> = {
  fine: new URL('../assets/brain/brain-fine.bin', import.meta.url),
  medium: new URL('../assets/brain/brain-medium.bin', import.meta.url),
  broad: new URL('../assets/brain/brain-broad.bin', import.meta.url),
}

export async function loadBuiltInBrain(size: FoldSize) {
  const response = await fetch(BRAIN_FILES[size])
  if (!response.ok) throw new Error('The built-in brain could not be loaded. Check your connection and try again.')
  return builtInBrainSource(await response.arrayBuffer(), size)
}

export class OpenShapeError extends Error {}
// A closed STL whose walls are too thin to survive the rebuild at its fold size.
export class ThinShapeError extends Error {}

// How much of an uploaded STL its rebuild kept. kept is the rebuilt volume over the STL's, or null when the STL isn't
// closed and has no volume to compare. thickness is the STL's mean wall thickness, 2 × volume / area, in mm.
export type RebuildCheck = { kept: number | null; pieces: number; originalPieces: number; shrink: number; thickness: number | null; grid: number }

// Signed volume and area of a triangle soup or an indexed mesh.
function volumeAndArea(P: ArrayLike<number>, I?: ArrayLike<number>) {
  let volume = 0, area = 0
  const count = I ? I.length : P.length / 3
  for (let t = 0; t < count; t += 3) {
    const a = (I ? I[t] : t) * 3, b = (I ? I[t + 1] : t + 1) * 3, c = (I ? I[t + 2] : t + 2) * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    volume += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return { volume, area }
}
function pieceCount(I: ArrayLike<number>, vertices: number) {
  const parent = Int32Array.from({ length: vertices }, (_, i) => i)
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  for (let t = 0; t < I.length; t += 3) { const r = find(I[t]); parent[find(I[t + 1])] = r; parent[find(I[t + 2])] = r }
  const roots = new Set<number>()
  for (let t = 0; t < I.length; t += 3) roots.add(find(I[t]))
  return roots.size
}
const sortedSize = (P: ArrayLike<number>) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]) }
  return hi.map((h, a) => h - lo[a]).sort((a, b) => a - b)
}
// Most of the shape is gone: under a quarter of its volume, or one of its sides under 60 % of its length.
const lost = (check: RebuildCheck) => (check.kept !== null && check.kept < 0.25) || check.shrink < 0.6
// Part of it is gone: under three quarters of its volume, or broken into more pieces than the STL has.
const thinned = (check: RebuildCheck) => (check.kept !== null && check.kept < 0.75) || check.pieces > check.originalPieces
const mm = (value: number) => value < 10 ? value.toFixed(1) : String(Math.round(value))

// An uploaded STL as a brain-mode starting shape: Y-up, scaled to the built-in brain's size, and rebuilt as one smooth,
// closed surface at the fold size's spacing. Walls thinner than about the rebuild's grid don't survive it, so the result
// is checked against the STL: a closed STL that mostly disappeared is refused as too thin, and one that lost part of
// itself loads with a note (rebuildNote) saying what to change.
export function brainFromStl(buffer: ArrayBuffer, name: string, size: FoldSize, smoothing: Smoothing): { source: GrowthStlSource; check: RebuildCheck } {
  const model = parseStl(buffer, name)
  const geometry = new BufferGeometry()
  try {
    const original = Float32Array.from(model.geometry.getAttribute('position').array)
    geometry.setAttribute('position', model.geometry.getAttribute('position').clone())
    geometry.rotateX(-Math.PI / 2)
    const scale = BRAIN_RADIUS / model.radius, mmPerUnit = model.radius / BRAIN_RADIUS
    geometry.scale(scale, scale, scale)
    const soup = Float32Array.from(geometry.getAttribute('position').array)
    const faces = Uint32Array.from({ length: soup.length / 3 }, (_, i) => i)
    // Closed: nearly every edge is shared by two faces. CAD exports can have a few hairline gaps, which the rebuild seals.
    const { topology } = model
    const closed = topology.boundaryEdges <= 0.005 * topology.uniqueEdges
    const before = volumeAndArea(original), sizeBefore = sortedSize(original)
    const rebuild = (fold: FoldSize, level: Smoothing) => {
      const mesh = closedRemesh(soup, faces, { spacing: FOLD_SIZES[fold].spacing, smoothing: SMOOTHING[level].passes })
      const after = mesh.indices.length ? volumeAndArea(mesh.positions, mesh.indices) : { volume: 0, area: 0 }
      const sizeAfter = mesh.positions.length ? sortedSize(mesh.positions).map(s => s * mmPerUnit) : [0, 0, 0]
      const check: RebuildCheck = {
        kept: closed && Math.abs(before.volume) > 0 ? Math.abs(after.volume) * mmPerUnit ** 3 / Math.abs(before.volume) : null,
        pieces: mesh.indices.length ? pieceCount(mesh.indices, mesh.positions.length / 3) : 0,
        originalPieces: topology.components,
        shrink: Math.min(...sizeAfter.map((s, a) => s / Math.max(1e-9, sizeBefore[a]))),
        thickness: closed && before.area > 0 ? 2 * Math.abs(before.volume) / before.area : null,
        grid: FOLD_SIZES[fold].spacing / 2 * mmPerUnit,
      }
      return { mesh, check, empty: mesh.insideShare < 0.3 || mesh.indices.length < 12 }
    }
    const { mesh: rebuilt, check, empty } = rebuild(size, smoothing)
    // A sheet with open edges has no inside to fill: the voxel shell around it is all that's left.
    if (empty && !closed) {
      throw new OpenShapeError('Brain mode needs a closed shape, and this STL is an open surface. Use Sheet mode, and try the Brain folds preset.')
    }
    if (empty || lost(check)) {
      // Suggest a gentler setting only if it really keeps the shape: rebuild with it and see.
      const gentler: [FoldSize, Smoothing, string][] = []
      if (smoothing !== 'light') gentler.push([size, 'light', 'Light smoothing'])
      if (size !== 'fine') gentler.push(['fine', 'light', smoothing === 'light' ? 'Fine folds' : 'Fine folds with Light smoothing'])
      const works = gentler.filter(([fold, level]) => { const tried = rebuild(fold, level); return !tried.empty && !lost(tried.check) }).map(([, , label]) => label)
      const walls = check.thickness ? `Its walls, about ${mm(check.thickness)} mm thick, are` : 'Parts of it are'
      const share = Math.round(100 * (check.kept ?? check.shrink))
      const kept = empty || share < 1 ? 'almost nothing' : `only ${share}% of it`
      const tryFirst = works.length ? `Try ${works.join(', or ')}, or use` : 'Use'
      throw new ThinShapeError(`${walls} too thin for brain mode at ${FOLD_SIZES[size].label.toLowerCase()} folds: its rebuild kept ${kept}. ${tryFirst} Sheet mode with the Brain folds preset, which keeps the walls as they are.`)
    }
    const brain: BrainInfo = { builtin: false, foldSize: size, smoothing }
    return { source: { name, scale: mmPerUnit, sourceCenter: model.sourceCenter, positions: rebuilt.positions, indices: rebuilt.indices, brain }, check }
  } finally {
    geometry.dispose()
    model.geometry.dispose()
  }
}

// What a rebuild that lost part of the STL tells the designer, or '' when it kept the shape.
export function rebuildNote(check: RebuildCheck, size: FoldSize, smoothing: Smoothing) {
  if (!thinned(check)) return ''
  const kept = check.kept !== null ? `${Math.round(100 * check.kept)}% of the shape` : 'the shape'
  const pieces = check.pieces > check.originalPieces ? `, in ${check.pieces} pieces` : ''
  const fix = smoothing !== 'light' ? 'Light smoothing keeps more of it.' : size !== 'fine' ? 'Fine folds keep more of it.'
    : 'Thicken the thinnest parts, or use Sheet mode with the Brain folds preset.'
  return `The rebuild kept ${kept}${pieces}: parts thinner than about ${mm(check.grid * 2)} mm were lost. ${fix}`
}
