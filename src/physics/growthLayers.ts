// Growth layers describe where and when the sheet grows. Each source layer gives every vertex a
// weight from 0 to 1; the combined growth field is the largest source weight, raised by paint,
// cut by erase, and varied by noise. Weights are computed on the rest (starting) shape.

export type Vec3 = [number, number, number]
export type Falloff = 'linear' | 'soft'
// Intensity keyframes: values from 0 to 1 at timeline steps, interpolated linearly and held at the ends.
export type LayerTiming = { start: number; end: number | null; keys: { step: number; value: number }[] }

type LayerBase = { id: string; name: string; visible: boolean; strength: number; timing: LayerTiming }
export type RimLayer = LayerBase & { kind: 'rim'; rim: number | 'all'; width: number; lobes: number; phase: number; falloff: Falloff }
export type PointLayer = LayerBase & { kind: 'point'; center: Vec3; radius: number; falloff: Falloff }
export type LineLayer = LayerBase & { kind: 'line'; points: Vec3[]; radius: number; falloff: Falloff }
export type HeightLayer = LayerBase & { kind: 'height'; low: number; high: number }
export type NoiseLayer = LayerBase & { kind: 'noise'; scale: number; seed: number }
export type PaintLayer = LayerBase & { kind: 'paint' }
export type GrowthLayer = RimLayer | PointLayer | LineLayer | HeightLayer | NoiseLayer | PaintLayer
export type LayerKind = GrowthLayer['kind']

export type LayerMesh = {
  rest: ArrayLike<number>
  neighbors: number[][]
  rims: { vertices: number[] }[]
}

export const LAYER_LABELS: Record<LayerKind, string> = {
  rim: 'Rim', paint: 'Painted', point: 'Point', line: 'Line', height: 'Height ramp', noise: 'Noise',
}

let nextId = 0
export const layerId = (kind: LayerKind) => `${kind}-${Date.now().toString(36)}-${(nextId++).toString(36)}`
const timing = (): LayerTiming => ({ start: 0, end: null, keys: [] })

export function createLayer(kind: LayerKind, options: Partial<GrowthLayer> = {}): GrowthLayer {
  const base = { id: layerId(kind), name: LAYER_LABELS[kind], visible: true, strength: 1, timing: timing() }
  const layer: GrowthLayer = kind === 'rim' ? { ...base, kind, rim: 'all', width: 0.16, lobes: 0, phase: 0, falloff: 'linear' }
    : kind === 'point' ? { ...base, kind, center: [0, 0, 0], radius: 0.2, falloff: 'soft' }
      : kind === 'line' ? { ...base, kind, points: [], radius: 0.08, falloff: 'soft' }
        : kind === 'height' ? { ...base, kind, low: 0.7, high: 1 }
          : kind === 'noise' ? { ...base, kind, strength: 0.5, scale: 0.25, seed: 1 }
            : { ...base, kind }
  return { ...layer, ...options } as GrowthLayer
}

export function defaultLayers(imported: boolean): GrowthLayer[] {
  return [
    createLayer('rim', imported ? { name: 'All rims' } : { name: 'Rim', width: 0.3, falloff: 'soft' }),
    createLayer('paint'),
  ]
}

export const isSource = (layer: GrowthLayer) => layer.kind === 'rim' || layer.kind === 'point'
  || layer.kind === 'line' || layer.kind === 'height'
export const isTimed = (layer: GrowthLayer) => layer.timing.start > 0 || layer.timing.end !== null || layer.timing.keys.length > 0

export function timeFactor({ start, end, keys }: LayerTiming, step: number) {
  if (step < start || (end !== null && step >= end)) return 0
  if (!keys.length) return 1
  const sorted = [...keys].sort((a, b) => a.step - b.step)
  if (step <= sorted[0].step) return sorted[0].value
  for (let i = 1; i < sorted.length; i++) {
    if (step <= sorted[i].step) {
      const a = sorted[i - 1], b = sorted[i]
      return a.value + (b.value - a.value) * (step - a.step) / Math.max(1, b.step - a.step)
    }
  }
  return sorted[sorted.length - 1].value
}

// True when a visible source or paint layer will switch on after this step.
export function startsLater(layers: GrowthLayer[], step: number) {
  return layers.some(layer => layer.visible && layer.kind !== 'noise'
    && (layer.timing.start > step || layer.timing.keys.some(key => key.step > step && key.value > 0)))
}

const profile = (distance: number, width: number, falloff: Falloff) => {
  if (width <= 0 || distance >= width) return 0
  if (falloff === 'linear') return 1 - distance / width
  const softness = Math.max(0.02, width * 0.45)
  const floor = Math.exp(-width / softness)
  return (Math.exp(-distance / softness) - floor) / (1 - floor)
}

const restPoint = (rest: ArrayLike<number>, vertex: number): Vec3 => [rest[vertex * 3], rest[vertex * 3 + 1], rest[vertex * 3 + 2]]
const distance3 = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function segmentDistance(p: Vec3, a: Vec3, b: Vec3) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const length = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const t = length ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / length)) : 0
  return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1], p[2] - a[2] - t * ab[2])
}

// Graph distance along rest edges from a set of start vertices, up to a cutoff.
function edgeDistance(mesh: LayerMesh, starts: number[], cutoff: number) {
  const { rest, neighbors } = mesh
  const distance = new Float64Array(neighbors.length).fill(Infinity)
  const queue = [...starts]
  for (const vertex of starts) distance[vertex] = 0
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head]
    for (const next of neighbors[vertex]) {
      const nextDistance = distance[vertex] + distance3(restPoint(rest, vertex), restPoint(rest, next))
      if (nextDistance >= cutoff || nextDistance >= distance[next]) continue
      distance[next] = nextDistance
      queue.push(next)
    }
  }
  return distance
}

// Lobe centers: rim vertices nearest to evenly spaced angles around the rim's vertical axis.
export function lobeCenters(mesh: LayerMesh, rim: { vertices: number[] }, lobes: number, phase: number) {
  const { rest } = mesh
  const cx = rim.vertices.reduce((sum, v) => sum + rest[v * 3], 0) / rim.vertices.length
  const cz = rim.vertices.reduce((sum, v) => sum + rest[v * 3 + 2], 0) / rim.vertices.length
  const angle = (v: number) => Math.atan2(rest[v * 3 + 2] - cz, rest[v * 3] - cx)
  const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
  return Array.from({ length: lobes }, (_, k) => {
    const target = phase * Math.PI / 180 + 2 * Math.PI * k / lobes
    return rim.vertices.reduce((best, v) => gap(angle(v), target) < gap(angle(best), target) ? v : best, rim.vertices[0])
  })
}

export function targetRims(mesh: LayerMesh, rim: number | 'all') {
  return rim === 'all' ? mesh.rims : mesh.rims[rim] ? [mesh.rims[rim]] : []
}

// Spatial weight of a source or noise layer at each vertex, before strength and timing.
export function layerWeights(layer: GrowthLayer, mesh: LayerMesh): Float32Array {
  const count = mesh.neighbors.length
  const weights = new Float32Array(count)
  const { rest } = mesh
  if (layer.kind === 'rim') {
    const rims = targetRims(mesh, layer.rim)
    if (!rims.length) return weights
    if (layer.lobes > 0) {
      const centers = rims.flatMap(rim => lobeCenters(mesh, rim, layer.lobes, layer.phase)).map(v => restPoint(rest, v))
      for (let v = 0; v < count; v++) {
        const p = restPoint(rest, v)
        weights[v] = profile(Math.min(...centers.map(c => distance3(p, c))), layer.width, layer.falloff)
      }
    } else {
      const distance = edgeDistance(mesh, rims.flatMap(rim => rim.vertices), layer.width)
      for (let v = 0; v < count; v++) weights[v] = profile(distance[v], layer.width, layer.falloff)
    }
  } else if (layer.kind === 'point') {
    for (let v = 0; v < count; v++) weights[v] = profile(distance3(restPoint(rest, v), layer.center), layer.radius, layer.falloff)
  } else if (layer.kind === 'line') {
    const { points } = layer
    if (!points.length) return weights
    for (let v = 0; v < count; v++) {
      const p = restPoint(rest, v)
      let best = distance3(p, points[0])
      for (let i = 1; i < points.length; i++) best = Math.min(best, segmentDistance(p, points[i - 1], points[i]))
      weights[v] = profile(best, layer.radius, layer.falloff)
    }
  } else if (layer.kind === 'height') {
    let low = Infinity, high = -Infinity
    for (let v = 0; v < count; v++) { low = Math.min(low, rest[v * 3 + 1]); high = Math.max(high, rest[v * 3 + 1]) }
    const span = high - low || 1
    for (let v = 0; v < count; v++) {
      const h = (rest[v * 3 + 1] - low) / span
      weights[v] = layer.high === layer.low ? Number(h >= layer.low)
        : Math.min(1, Math.max(0, (h - layer.low) / (layer.high - layer.low)))
    }
  } else if (layer.kind === 'noise') {
    for (let v = 0; v < count; v++) {
      const p = restPoint(rest, v)
      weights[v] = valueNoise(p[0] / layer.scale, p[1] / layer.scale, p[2] / layer.scale, layer.seed)
    }
  }
  return weights
}

export type PaintMaps = { add: Float32Array; erase: Float32Array }

// Combine cached spatial weights into the growth field at a timeline step.
export function combineField(out: Float32Array, layers: GrowthLayer[], spatial: Map<string, Float32Array>, paint: PaintMaps, step: number) {
  out.fill(0)
  for (const layer of layers) {
    if (!layer.visible || !isSource(layer)) continue
    const scale = layer.strength * timeFactor(layer.timing, step)
    const weights = spatial.get(layer.id)
    if (!scale || !weights) continue
    for (let v = 0; v < out.length; v++) out[v] = Math.max(out[v], scale * weights[v])
  }
  const painted = layers.find(layer => layer.kind === 'paint')
  if (painted?.visible) {
    const scale = painted.strength * timeFactor(painted.timing, step)
    for (let v = 0; v < out.length; v++) out[v] = Math.max(out[v], scale * paint.add[v]) * (1 - paint.erase[v])
  }
  for (const layer of layers) {
    if (!layer.visible || layer.kind !== 'noise') continue
    const amount = Math.min(1, layer.strength * timeFactor(layer.timing, step))
    const weights = spatial.get(layer.id)
    if (!amount || !weights) continue
    for (let v = 0; v < out.length; v++) out[v] *= 1 - amount + amount * weights[v]
  }
  for (let v = 0; v < out.length; v++) out[v] = Math.min(1, Math.max(0, out[v]))
  return out
}

// Smooth seeded value noise in the range 0 to 1.
export function valueNoise(x: number, y: number, z: number, seed: number) {
  const hash = (i: number, j: number, k: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ Math.imul(seed + 1, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
  }
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fade = (t: number) => t * t * (3 - 2 * t)
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const plane = (k: number) => lerp(
    lerp(hash(ix, iy, k), hash(ix + 1, iy, k), fx),
    lerp(hash(ix, iy + 1, k), hash(ix + 1, iy + 1, k), fx), fy)
  return lerp(plane(iz), plane(iz + 1), fz)
}

const finite = (value: unknown, min = -1e9, max = 1e9) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const vec = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(c => finite(c))

// Validate layers read from a project file.
export function validLayers(value: unknown): value is GrowthLayer[] {
  if (!Array.isArray(value) || value.length > 32) return false
  return value.every(layer => {
    if (!layer || typeof layer.id !== 'string' || typeof layer.name !== 'string' || typeof layer.visible !== 'boolean'
      || !finite(layer.strength, 0, 1) || !layer.timing || !finite(layer.timing.start, 0)
      || !(layer.timing.end === null || finite(layer.timing.end, 0))
      || !Array.isArray(layer.timing.keys) || !layer.timing.keys.every((key: { step: unknown; value: unknown }) => finite(key.step, 0) && finite(key.value, 0, 1))) return false
    const falloff = (f: unknown) => f === 'linear' || f === 'soft'
    switch (layer.kind) {
      case 'rim': return (layer.rim === 'all' || (Number.isInteger(layer.rim) && layer.rim >= 0)) && finite(layer.width, 0.01, 2)
        && Number.isInteger(layer.lobes) && layer.lobes >= 0 && layer.lobes <= 24 && finite(layer.phase, -360, 360) && falloff(layer.falloff)
      case 'point': return vec(layer.center) && finite(layer.radius, 0.005, 2) && falloff(layer.falloff)
      case 'line': return Array.isArray(layer.points) && layer.points.length <= 256 && layer.points.every(vec) && finite(layer.radius, 0.005, 2) && falloff(layer.falloff)
      case 'height': return finite(layer.low, 0, 1) && finite(layer.high, 0, 1)
      case 'noise': return finite(layer.scale, 0.01, 10) && finite(layer.seed, 0, 1e6)
      case 'paint': return true
      default: return false
    }
  })
}
