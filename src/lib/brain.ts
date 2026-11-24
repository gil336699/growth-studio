// The built-in brain, the growth recipe behind the Instagram reel (the Brain folds preset), and Fold size, which sets
// how big folds grow over a whole surface on any shape. See docs/brain-mode.md.
import { DISK_DEFAULTS } from '../physics/growingDisk'
import { createLayer, type GrowthLayer } from '../physics/growthLayers'
import type { BrainInfo, GrowthStlSource } from '../physics/growthStl'
import type { StopAt } from './diskProject'

export type FoldSize = 'fine' | 'medium' | 'broad'
type Mechanics = typeof DISK_DEFAULTS

// Fold size sets the split length during growth: folds come out about three mesh edges wide. Medium is the reel. The
// built-in brain also comes meshed at each size's spacing. The lengths are for the built-in brain's size; foldLength
// scales them to any shape. Changing it only changes the split length, so a shape keeps what it has grown and grows on
// at the new size.
export const FOLD_SIZES: Record<FoldSize, { label: string; spacing: number; remeshLength: number; tip: string }> = {
  fine: { label: 'Fine', spacing: 0.045, remeshLength: 0.07, tip: 'More, smaller folds. Grows more slowly.' },
  medium: { label: 'Medium', spacing: 0.055, remeshLength: 0.09, tip: 'Folds a little smaller than a real brain’s, as in the reel.' },
  broad: { label: 'Broad', spacing: 0.065, remeshLength: 0.11, tip: 'Fewer, wider folds. Grows fastest.' },
}
export const FOLD_ORDER: FoldSize[] = ['fine', 'medium', 'broad']

// The built-in brain's bounding-sphere radius in solver units. Uploads have radius 1, so Fold size's lengths are scaled
// by the shape's radius over this, and one recipe gives folds of the same size compared with any shape.
export const BRAIN_RADIUS = 1.173
// The built-in brain is shown and exported 150 mm from front to back, a little smaller than an adult brain.
export const BRAIN_LENGTH_MM = 150
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

// A shape's bounding-sphere radius, measured as three.js measures an STL's: from the middle of its bounding box.
export function boundingRadius(positions: ArrayLike<number>) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3], positions[i]); hi[i % 3] = Math.max(hi[i % 3], positions[i]) }
  const c = lo.map((l, a) => (l + hi[a]) / 2)
  let radius = 0
  for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, Math.hypot(positions[i] - c[0], positions[i + 1] - c[1], positions[i + 2] - c[2]))
  return radius || 1
}

// The split length for a fold size on a shape of this radius.
export function foldLength(size: FoldSize, radius = BRAIN_RADIUS) {
  return FOLD_SIZES[size].remeshLength * radius / BRAIN_RADIUS
}

// The Brain folds recipe at a fold size, for a shape of this radius.
export function brainMechanics(current: Mechanics, size: FoldSize, radius = BRAIN_RADIUS): Mechanics {
  return {
    ...current, growthRate: DISK_DEFAULTS.growthRate, compoundGrowth: 0, bending: 0.2, gravity: 0,
    coreStiffness: 0.005, coreGrowth: 0.1, detailScale: 3.5, remeshLength: foldLength(size, radius), budgetScale: 1,
  }
}

// The most a finer fold size raises the vertex limit: from the sheet's 0.145 split length to Fine on an upload would be
// (0.145 / 0.060)² ≈ 5.9, more than a browser tab grows comfortably.
export const MAX_BUDGET_SCALE = 4

// Settings for growing on at another fold size, on a surface prepared with edges up to `preparedLength`: the new split
// length, and a vertex limit raised for a finer size, since the same area needs (old / new)² as many vertices. The limit
// never drops while the shape grows: going broader after a finer size keeps it, since lowering it to the vertices
// already there would stop splitting at once and warn of a limit that growth never reached.
export function foldMechanics(current: Mechanics, size: FoldSize, preparedLength: number, radius = BRAIN_RADIUS): Mechanics {
  const remeshLength = foldLength(size, radius)
  const needed = (preparedLength / remeshLength) ** 2
  return { ...current, remeshLength, budgetScale: Math.min(MAX_BUDGET_SCALE, Math.max(1, current.budgetScale ?? 1, needed)) }
}

// The fold size whose split length the settings use on a shape of this radius, or null for another length set under
// Advanced.
// Within 1%, so a shape measured a little differently, such as a project saved by an older version, still matches.
export function foldSizeOf(remeshLength: number, radius = BRAIN_RADIUS): FoldSize | null {
  return FOLD_ORDER.find(size => Math.abs(foldLength(size, radius) - remeshLength) <= 0.01 * remeshLength) ?? null
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

// Growth to erase on an uploaded sheet that stands on a flat bottom, so Brain folds leave the bottom flat and its edge on
// the bed. Full erase on the bottom and the lowest fifth of the wall, fading out by 30% of the height; above that it grows
// as usual. With Hold still on, the erased part then stays put: on a pen holder grown 300 steps, its bottom moved 0.00 mm
// and stayed the lowest point, where erasing only up to 8% let folds sag 12.5 mm below it. It is ordinary painted
// erase, so the brush can change it. Returns null when the shape doesn't stand on a flat
// bottom: downward faces at its lowest level must cover at least 1% of its footprint. Y is up, as in the app.
export function flatBottomErase(rest: ArrayLike<number>, indices: ArrayLike<number>): Float32Array | null {
  const n = rest.length / 3
  let low = Infinity, high = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let v = 0; v < n; v++) {
    const x = rest[v * 3], y = rest[v * 3 + 1], z = rest[v * 3 + 2]
    low = Math.min(low, y); high = Math.max(high, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  const height = high - low, level = height * 0.002
  if (!(height > 0)) return null
  let bottom = 0
  for (let f = 0; f < indices.length / 3; f++) {
    const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3
    if (rest[a + 1] - low > level || rest[b + 1] - low > level || rest[c + 1] - low > level) continue
    const ux = rest[b] - rest[a], uz = rest[b + 2] - rest[a + 2], wx = rest[c] - rest[a], wz = rest[c + 2] - rest[a + 2]
    bottom += Math.abs(ux * wz - uz * wx) / 2 // its area seen from below; flat at the lowest level, so all of it faces down
  }
  if (bottom < 0.01 * (x1 - x0) * (z1 - z0)) return null
  const erase = new Float32Array(n)
  for (let v = 0; v < n; v++) erase[v] = 1 - smooth(0.2, 0.3, (rest[v * 3 + 1] - low) / height)
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
