import { createFlatShellBending } from './flatShellBending'
import { CONTACT_DEFAULTS, createDiskSelfContact } from './diskSelfContact'
import { remeshPlanarPatches } from './remeshPlanarPatches'
import { balanceSurfaceTriangles } from './balanceSurfaceTriangles'
import {
  combineField, createLayer, defaultLayers, isTimed, layerWeights, startsLater,
  type GrowthLayer, type LayerMesh, type PaintMaps, type Vec3,
} from './growthLayers'

export type BrushMode = 'paint' | 'erase' | 'smooth'
// One brush dab: the face under the pointer (or -1 for a symmetric copy) and the surface point.
export type StrokePoint = { face: number; point: Vec3 }
export type StepStatus = 'ready' | 'moving' | 'settled' | 'contact'

export const DISK_DEFAULTS = {
  growthRate: 0.003, bending: 0.065, damping: 0.18, remeshLength: 0.145, gravity: 0, gravityTilt: 0, gravityHeading: 0,
  // 0 adds the same amount each step. 1 adds a share of the current size, so growth speeds up.
  compoundGrowth: 0,
  // Contact response inside the growth field. The rest of the model keeps the defaults.
  repelDistance: CONTACT_DEFAULTS.distance, repelStrength: CONTACT_DEFAULTS.strength,
  // Multiplies the default vertex limit so growth can keep adding triangles.
  detailScale: 1,
  // A soft core under the surface, as in a brain: each solver pass pulls every vertex this share of the way back
  // toward its place on the starting shape, so growth buckles into folds instead of inflating the model. 0 is off.
  coreStiffness: 0,
  // How much the core itself grows, as a share of the surface's growth. The anchors scale about the starting
  // shape's center by 1 + coreGrowth × strain.
  coreGrowth: 0.1,
}

export function diskGravityDirection({ gravityTilt, gravityHeading }: typeof DISK_DEFAULTS): [number, number, number] {
  const tilt = gravityTilt * Math.PI / 180
  const heading = gravityHeading * Math.PI / 180
  return [Math.sin(tilt) * Math.cos(heading), -Math.cos(tilt), Math.sin(tilt) * Math.sin(heading)]
}

export type DiskSnapshot = {
  rest: number[]
  indices: number[]
  positions: number[]
  previous: number[]
  field: number[]
  localGrowth: number[]
  // Growth layers and sparse paint and erase weights. Projects saved before layers omit them.
  layers?: GrowthLayer[]
  paintAdd?: [number, number][]
  paintErase?: [number, number][]
  // Timeline step: every attempted step, grow or relax.
  clock?: number
  // Vertices where the starting surface already crossed itself and the designer chose to grow anyway.
  ignoredOverlaps?: number[]
  // Legacy field settings, converted to layers when opened.
  brushOverrides?: [number, number][]
  disabledRims?: number[]
  sources?: number
  zone?: number
  legacyRimWidth?: number
  strain: number
  acceptedSteps: number
  rejectedSteps: number
  splits: number
  growthBudget: number
  // Default vertex limit before Mesh detail limit scaling. Older projects omit it.
  baseBudget?: number
  // Share of the growth rate in use after contact slowed growth. Older projects omit it.
  growthThrottle?: number
  preparationSplits: number
  preparationFlips: number
  preparationPatches: number
}

// What a snapshot leaves out but a model handed to another thread needs to carry on exactly as it would have:
// recent contact (it decides where contact is searched), brush undo, the last step's status, and whether the
// starting surface crossed itself (so it isn't tested again).
export type DiskLive = {
  contactHeat: number[]
  brushHistory: [number, number, number][][]
  stepStatus: StepStatus
  lastMotion: number
  lastContactCorrections: number
  startOverlap: boolean
}
export type DiskLiveState = { snapshot: DiskSnapshot; live: DiskLive }

export type GrowingDisk = ReturnType<typeof createGrowingDisk>

export function createGrowingDisk(input?: { positions: Float32Array; indices: Uint32Array }, startingEdgeLength = DISK_DEFAULTS.remeshLength,
  snapshot?: DiskSnapshot, live?: DiskLive) {
  const rings = 12
  let rest = snapshot ? [...snapshot.rest] : input ? Array.from(input.positions) : [0, 0, 0]
  const faces: number[] = snapshot?.indices ?? (input ? Array.from(input.indices) : [])
  let inner = [0]
  for (let ring = 1; !snapshot && !input && ring <= rings; ring++) {
    const radius = ring / rings
    const outer = Array.from({ length: ring * 6 }, (_, i) => {
      const angle = 2 * Math.PI * i / (ring * 6)
      const index = rest.length / 3
      rest.push(radius * Math.cos(angle), 0, radius * Math.sin(angle))
      return index
    })
    if (ring === 1) {
      outer.forEach((vertex, i) => faces.push(0, outer[(i + 1) % outer.length], vertex))
    } else {
      let a = 0, b = 0
      while (a < inner.length || b < outer.length) {
        const u = inner[a % inner.length], v = outer[b % outer.length]
        if (b === outer.length || (a < inner.length && (a + 1) / inner.length <= (b + 1) / outer.length)) {
          faces.push(u, inner[(a + 1) % inner.length], v)
          a++
        } else {
          faces.push(u, outer[(b + 1) % outer.length], v)
          b++
        }
      }
    }
    inner = outer
  }
  let indices = Uint32Array.from(faces)
  let positions = Float32Array.from(snapshot?.positions ?? rest)
  let referencePositions = Float32Array.from(rest)
  let field = snapshot ? Float32Array.from(snapshot.field) : new Float32Array(rest.length / 3)
  let localGrowth = snapshot ? Float32Array.from(snapshot.localGrowth) : new Float32Array(field.length)
  const legacy = Boolean(snapshot && !snapshot.layers)
  let layers: GrowthLayer[] = snapshot?.layers ? structuredClone(snapshot.layers) : defaultLayers(Boolean(input))
  const sparse = (pairs: [number, number][] | undefined, length: number) => {
    const values = new Float32Array(length)
    for (const [vertex, weight] of pairs ?? []) if (vertex < length) values[vertex] = weight
    return values
  }
  let paint: PaintMaps = { add: sparse(snapshot?.paintAdd, field.length), erase: sparse(snapshot?.paintErase, field.length) }
  let contactHeat = live && live.contactHeat.length === field.length ? Float32Array.from(live.contactHeat) : new Float32Array(field.length)
  let ignoredOverlaps: Uint8Array | null = null
  if (snapshot?.ignoredOverlaps) {
    ignoredOverlaps = new Uint8Array(field.length)
    for (const vertex of snapshot.ignoredOverlaps) if (vertex < field.length) ignoredOverlaps[vertex] = 1
  }
  let clock = snapshot?.clock ?? (snapshot ? snapshot.acceptedSteps + snapshot.rejectedSteps : 0)
  const spatial = new Map<string, Float32Array>()
  let fieldActive = false
  let fieldRevision = 0
  let neighbors: number[][] = []
  // Open rims are found from boundary edges and cached until the mesh changes.
  let rimIndices: Uint32Array | undefined
  let rims: { id: number; vertices: number[]; edges: number[]; height: number }[] = []
  let bend = createFlatShellBending(indices, input ? Float32Array.from(rest) : undefined)
  type Adjacent = { offset: number; u: number; v: number; other: number }
  const links = new Map<string, { a: number; b: number; length: number; weight: number; adjacent: Adjacent[] }>()
  function rebuildLinks() {
    const count = rest.length / 3
    if (field.length !== count) field = new Float32Array(count)
    links.clear()
    neighbors = Array.from({ length: count }, () => [])
    for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const face = { offset: i, u: a, v: b, other: indices[i + (j + 2) % 3] }
      const existing = links.get(key)
      if (existing) { existing.adjacent.push(face); continue }
      neighbors[a].push(b)
      neighbors[b].push(a)
      links.set(key, { a: a * 3, b: b * 3, length: Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]), weight: 0, adjacent: [face] })
    }
  }
    refreshSpatial()
    refreshField()
  }
  const layerMesh = (): LayerMesh => ({ rest, neighbors, rims: openRims() })
  function refreshSpatial() {
    spatial.clear()
    const mesh = layerMesh()
    for (const layer of layers) if (layer.kind !== 'paint') spatial.set(layer.id, layerWeights(layer, mesh))
  }
  // Recompute the growth field for the current timeline step and the edge weights that use it.
  function refreshField() {
    combineField(field, layers, spatial, paint, clock)
    fieldActive = field.some(weight => weight > 0)
    for (const edge of links.values()) edge.weight = (field[edge.a / 3] + field[edge.b / 3]) / 2
    fieldRevision++
  }
  rebuildLinks()
  for (let i = 0; !snapshot && !input && i < field.length; i++) {
    positions[i * 3 + 1] = 0.003 * field[i] * Math.cos(5 * Math.atan2(rest[i * 3 + 2], rest[i * 3]))
  }
  let previous = snapshot ? Float32Array.from(snapshot.previous) : positions.slice()
  let accepted = positions.slice()
  let intersects = createDiskSelfContact(positions, indices, referencePositions)
  let uv = Float32Array.from(pointsToUV())
  function pointsToUV() {
    const coordinates: number[] = []
    for (let i = 0; i < rest.length; i += 3) coordinates.push((rest[i] + 1) / 2, (rest[i + 2] + 1) / 2)
    return coordinates
  }
  let acceptedGrowth = snapshot?.strain ?? 0
  let rejectedSteps = snapshot?.rejectedSteps ?? 0
  // Blocked steps halve the growth added per step; accepted steps restore it gradually.
  let growthThrottle = snapshot?.growthThrottle ?? 1
  let lastMotion = live?.lastMotion ?? 0
  let lastContactCorrections = live?.lastContactCorrections ?? 0
  let geometryRevision = 0
  let stepStatus: StepStatus = live?.stepStatus ?? 'ready'
  let splits = 0
  let mechanics = { ...DISK_DEFAULTS }
  let gravityDirection = diskGravityDirection(mechanics)
  // Center of the starting shape's bounding box, found on the first step with a core.
  let coreCenter: [number, number, number] | null = null
  const contactSettings = () => ({ distance: mechanics.repelDistance, strength: mechanics.repelStrength, field })
  let touched = new Uint8Array(0)
  let active = new Uint8Array(0)
  let acceptedSteps = snapshot?.acceptedSteps ?? 0
  const preparationBudget = Math.max(900, rest.length / 3 + (input ? 300 : 0))
  let growthBudget = snapshot?.growthBudget ?? preparationBudget
  // Each stroke records the paint and erase values it replaced, so undo still works after the mesh splits.
  const brushHistory: Map<number, [number, number]>[] = (live?.brushHistory ?? [])
    .map(entries => new Map(entries.map(([vertex, add, erase]) => [vertex, [add, erase]])))
  let stroke: Map<number, [number, number]> | null = null
  function subdivide(preparing = false) {
    const vertexBudget = preparing ? preparationBudget : growthBudget
    if (positions.length / 3 >= vertexBudget) return
    const distance = (a: number, b: number) => Math.hypot(
      positions[3 * a] - positions[3 * b],
      positions[3 * a + 1] - positions[3 * b + 1],
      positions[3 * a + 2] - positions[3 * b + 2],
    )
    const threshold = preparing ? startingEdgeLength : mechanics.remeshLength
    const candidates = []
    for (const edge of links.values()) {
      if (!preparing && edge.weight <= 0) continue
      const a = edge.a / 3, b = edge.b / 3
      const actual = distance(a, b)
      const expansion = (localGrowth[a] + localGrowth[b]) / 2
      // Compressed folds can need more material even when the edge stays short.
      const size = preparing ? actual : Math.max(actual, edge.length * (1 + expansion))
      if (size > threshold) candidates.push({ edge, size })
    }
    candidates.sort((a, b) => b.size - a.size)
    const usedFaces = new Set<number>()
    const replacement = new Map<number, number[]>()
    const splitEnds = new Map<number, [number, number]>()
    const nextPositions = Array.from(positions), nextPrevious = Array.from(previous)
    const nextGrowth = Array.from(localGrowth), nextAdd = Array.from(paint.add), nextErase = Array.from(paint.erase)
    const nextHeat = Array.from(contactHeat)
    for (const { edge, size } of candidates) {
      if (nextPositions.length / 3 >= vertexBudget) break
      const a = edge.a / 3, b = edge.b / 3
      const { adjacent } = edge
      if (adjacent.some(({ offset, other }) => usedFaces.has(offset)
        || (preparing && Math.max(distance(a, other), distance(b, other)) > size))) continue
      const middle = nextPositions.length / 3
      splitEnds.set(middle, [a, b])
      nextGrowth.push((localGrowth[a] + localGrowth[b]) / 2)
      nextAdd.push((paint.add[a] + paint.add[b]) / 2)
      nextErase.push((paint.erase[a] + paint.erase[b]) / 2)
      nextHeat.push(Math.max(contactHeat[a], contactHeat[b]))
      for (let axis = 0; axis < 3; axis++) {
        rest.push((rest[a * 3 + axis] + rest[b * 3 + axis]) / 2)
        nextPositions.push((positions[a * 3 + axis] + positions[b * 3 + axis]) / 2)
        nextPrevious.push((previous[a * 3 + axis] + previous[b * 3 + axis]) / 2)
      }
      for (const { offset, u, v, other } of adjacent) {
        usedFaces.add(offset)
        replacement.set(offset, [u, middle, other, middle, v, other])
      }
      splits++
    }
    if (!replacement.size) return
    const newFaces: number[] = []
    for (let i = 0; i < indices.length; i += 3) newFaces.push(...(replacement.get(i) ?? indices.subarray(i, i + 3)))
    indices = Uint32Array.from(newFaces)
    localGrowth = Float32Array.from(nextGrowth)
    paint = { add: Float32Array.from(nextAdd), erase: Float32Array.from(nextErase) }
    contactHeat = Float32Array.from(nextHeat)
    positions = Float32Array.from(nextPositions)
    referencePositions = Float32Array.from(rest)
    previous = Float32Array.from(nextPrevious)
    accepted = positions.slice()
    uv = Float32Array.from(pointsToUV())
    bend = createFlatShellBending(indices, input ? Float32Array.from(rest) : undefined)
    if (ignoredOverlaps) {
      // Split vertices inherit the exemption of either end of their edge.
      const next = new Uint8Array(positions.length / 3)
      next.set(ignoredOverlaps)
      for (let v = ignoredOverlaps.length; v < next.length; v++) next[v] = 0
      ignoredOverlaps = next
      for (const [middle, [a, b]] of splitEnds) if (ignoredOverlaps[a] || ignoredOverlaps[b]) ignoredOverlaps[middle] = 1
    }
    intersects = createDiskSelfContact(positions, indices, referencePositions)
    intersects.setExempt(ignoredOverlaps)
    rebuildLinks()
  }
  if (input && !snapshot) {
    for (let pass = 0; pass < 12; pass++) {
      const before = splits
      subdivide(true)
      if (before === splits) break
    }
  }
  let preparationFlips = snapshot?.preparationFlips ?? 0
  let preparationPatches = snapshot?.preparationPatches ?? 0
  if (input && !snapshot) {
    const remeshed = remeshPlanarPatches(referencePositions, indices, startingEdgeLength)
    preparationPatches = remeshed.patches
    if (preparationPatches) {
      indices = remeshed.indices
      positions = remeshed.positions
      referencePositions = positions.slice()
      rest = Array.from(positions)
      previous = positions.slice()
      accepted = positions.slice()
      field = new Float32Array(rest.length / 3)
      localGrowth = new Float32Array(field.length)
      paint = { add: new Float32Array(field.length), erase: new Float32Array(field.length) }
      contactHeat = new Float32Array(field.length)
      uv = Float32Array.from(pointsToUV())
    }
    const balanced = balanceSurfaceTriangles(referencePositions, indices)
    preparationFlips = balanced.flips
    if (preparationFlips || preparationPatches) {
      indices = balanced.indices
      bend = createFlatShellBending(indices, referencePositions)
      intersects = createDiskSelfContact(positions, indices, referencePositions)
      rebuildLinks()
    }
  }
  if (input) {
    const preparedVertices = positions.length / 3 - (snapshot?.splits ?? 0)
    growthBudget = Math.max(growthBudget, preparedVertices + Math.min(1200, Math.max(600, preparedVertices)))
  }
  const baseBudget = snapshot?.baseBudget ?? growthBudget
  const preparationSplits = snapshot?.preparationSplits ?? splits
  intersects.setExempt(ignoredOverlaps)
  const startOverlap = live ? live.startOverlap : Boolean((input || snapshot) && intersects())
  let startingCrossings: number | null = null
  splits = snapshot?.splits ?? 0
  function openRims() {
    if (rimIndices === indices && rims.length) return rims
    rimIndices = indices
    const boundary = new Map<number, number[]>()
    for (const { a, b, adjacent } of links.values()) {
      if (adjacent.length !== 1) continue
      const u = a / 3, v = b / 3
      if (!boundary.has(u)) boundary.set(u, [])
      if (!boundary.has(v)) boundary.set(v, [])
      boundary.get(u)!.push(v)
      boundary.get(v)!.push(u)
    }
    const visited = new Set<number>()
    rims = []
    for (const start of boundary.keys()) {
      if (visited.has(start)) continue
      const vertices = [start], edges: number[] = []
      visited.add(start)
      let id = start, minHeight = Infinity, maxHeight = -Infinity
      for (const vertex of vertices) {
        id = Math.min(id, vertex)
        minHeight = Math.min(minHeight, rest[vertex * 3 + 1])
        maxHeight = Math.max(maxHeight, rest[vertex * 3 + 1])
        for (const next of boundary.get(vertex)!) {
          if (vertex < next) edges.push(vertex, next)
          if (visited.has(next)) continue
          visited.add(next)
          vertices.push(next)
        }
      }
      rims.push({ id, vertices, edges, height: (minHeight + maxHeight) / 2 })
    }
    rims.sort((a, b) => b.height - a.height || a.id - b.id)
    return rims
  }

  // Convert projects saved before layers: rim openings, width, disk sources, and brush overrides.
  if (snapshot && legacy) {
    if (!input) {
      layers = [createLayer('rim', { name: 'Rim', width: snapshot.zone ?? 0.3, lobes: snapshot.sources ?? 0, falloff: 'soft' }), createLayer('paint')]
    } else {
      const disabled = new Set(snapshot.disabledRims)
      const enabled = openRims().map((rim, index) => disabled.has(rim.id) ? -1 : index).filter(index => index >= 0)
      const width = snapshot.legacyRimWidth ?? 0.16
      const rimLayers = enabled.length === openRims().length
        ? [createLayer('rim', { name: 'All rims', width })]
        : enabled.map(index => createLayer('rim', { name: `Rim ${index + 1}`, rim: index, width }))
      layers = [...rimLayers, createLayer('paint')]
    }
    for (const [vertex, weight] of snapshot.brushOverrides ?? []) {
      if (vertex >= field.length) continue
      if (weight > 0) paint.add[vertex] = weight
      else paint.erase[vertex] = 1
    }
    if (!input && snapshot.strain > 0 && localGrowth.every(value => value === 0)) {
      for (let v = 0; v < localGrowth.length; v++) localGrowth[v] = snapshot.strain * (snapshot.field[v] ?? 0)
    }
  }
  refreshSpatial()
  refreshField()

  function nearestVertex(point: readonly number[]) {
    let best = 0, bestDistance = Infinity
    for (let v = 0; v < positions.length / 3; v++) {
      const d = (positions[v * 3] - point[0]) ** 2 + (positions[v * 3 + 1] - point[1]) ** 2 + (positions[v * 3 + 2] - point[2]) ** 2
      if (d < bestDistance) { bestDistance = d; best = v }
    }
    return best
  }

  // Vertices within the brush radius of a surface point, with a falloff set by hardness (0 soft, 1 hard).
  function brushFootprint(face: number, point: readonly number[], radius: number, hardness = 0) {
    const footprint: { vertex: number; amount: number }[] = []
    if (radius <= 0) return footprint
    const distance = (vertex: number) => Math.hypot(
      positions[3 * vertex] - point[0], positions[3 * vertex + 1] - point[1], positions[3 * vertex + 2] - point[2],
    )
    const starts = face >= 0 && face * 3 + 2 < indices.length ? [...indices.subarray(face * 3, face * 3 + 3)] : [nearestVertex(point)]
    const queue = [...starts]
    const visited = new Set(queue)
    for (const vertex of queue) {
      const d = distance(vertex)
      if (d <= radius) {
        const t = 1 - d / radius
        footprint.push({ vertex, amount: Math.max(0.05, hardness >= 1 ? 1 : Math.min(1, t / (1 - hardness))) })
      }
      for (const next of neighbors[vertex]) {
        if (visited.has(next) || distance(next) > radius) continue
        visited.add(next)
        queue.push(next)
      }
    }
    // A brush smaller than the triangles still marks the closest vertex.
    if (!footprint.length) footprint.push({ vertex: starts.reduce((a, b) => distance(a) <= distance(b) ? a : b), amount: 1 })
    return footprint
  }

  function paintStroke(footprint: ReturnType<typeof brushFootprint>, mode: BrushMode, strength = 1) {
    if (!footprint.length) return
    if (!stroke) {
      stroke = new Map()
      brushHistory.push(stroke)
      if (brushHistory.length > 30) brushHistory.shift()
    }
    const smoothed = mode === 'smooth' ? footprint.map(({ vertex }) => {
      const around = [vertex, ...neighbors[vertex]]
      return [around.reduce((sum, v) => sum + paint.add[v], 0) / around.length,
        around.reduce((sum, v) => sum + paint.erase[v], 0) / around.length]
    }) : []
    footprint.forEach(({ vertex, amount }, i) => {
      if (!stroke!.has(vertex)) stroke!.set(vertex, [paint.add[vertex], paint.erase[vertex]])
      const a = Math.min(1, amount * strength)
      // Paint and erase cancel each other first, so erasing a fresh stroke with the same brush clears it.
      // Weights are stored in single precision, so snap tiny remainders to zero.
      const clean = (value: number) => value < 1e-6 ? 0 : value
      if (mode === 'paint') {
        paint.add[vertex] = Math.max(paint.add[vertex], a)
        paint.erase[vertex] = clean(paint.erase[vertex] - a)
      } else if (mode === 'erase') {
        paint.add[vertex] = clean(paint.add[vertex] - a)
        paint.erase[vertex] = Math.max(paint.erase[vertex], a)
      } else {
        paint.add[vertex] += (smoothed[i][0] - paint.add[vertex]) * a
        paint.erase[vertex] += (smoothed[i][1] - paint.erase[vertex]) * a
      }
    })
    refreshField()
  }

  function saveSnapshot(): DiskSnapshot {
    const pairs = (values: Float32Array) => {
      const out: [number, number][] = []
      values.forEach((value, vertex) => { if (value > 0) out.push([vertex, value]) })
      return out
    }
    return {
      rest: [...rest],
      indices: Array.from(indices),
      positions: Array.from(positions),
      previous: Array.from(previous),
      field: Array.from(field),
      localGrowth: Array.from(localGrowth),
      layers: structuredClone(layers),
      ...(ignoredOverlaps ? { ignoredOverlaps: [...ignoredOverlaps.keys()].filter(v => ignoredOverlaps![v]) } : {}),
      paintAdd: pairs(paint.add),
      paintErase: pairs(paint.erase),
      clock,
      strain: acceptedGrowth, acceptedSteps, rejectedSteps, splits, growthBudget, baseBudget, growthThrottle,
      preparationSplits, preparationFlips, preparationPatches,
    }
  }

  return {
    preparationSplits,
    preparationFlips,
    preparationPatches,
    // True while the starting surface crosses itself and the crossings are not yet ignored.
    get initialOverlap() { return startOverlap && !ignoredOverlaps },
    // Number of crossing face pairs in the starting surface, counted on first request.
    get startingCrossings() { return startingCrossings ??= startOverlap ? intersects.crossings().pairs : 0 },
    get ignoringOverlaps() { return Boolean(ignoredOverlaps) },
    // Grow anyway: leave existing crossings alone and block only new ones.
    ignoreStartingOverlaps(rings = 2) {
      const { vertices } = intersects.crossings()
      ignoredOverlaps = new Uint8Array(positions.length / 3)
      for (const vertex of vertices) ignoredOverlaps[vertex] = 1
      // Include a margin around each crossing, since faces next to it can cross as soon as anything moves.
      for (let ring = 0; ring < rings; ring++) {
        const grown = ignoredOverlaps.slice()
        ignoredOverlaps.forEach((flag, vertex) => { if (flag) for (const next of neighbors[vertex]) grown[next] = 1 })
        ignoredOverlaps = grown
      }
      intersects.setExempt(ignoredOverlaps)
      return ignoredOverlaps.reduce((total, flag) => total + flag, 0)
    },
    snapshot: saveSnapshot,
    liveState(): DiskLiveState {
      return {
        snapshot: saveSnapshot(),
        live: {
          contactHeat: Array.from(contactHeat),
          brushHistory: brushHistory.map(entries => [...entries].map(([vertex, [add, erase]]) => [vertex, add, erase])),
          stepStatus, lastMotion, lastContactCorrections, startOverlap,
        },
      }
    },
    get positions() { return positions },
    get referencePositions() { return referencePositions },
    get indices() { return indices },
    get field() { return field },
    get uv() { return uv },
    get splits() { return splits },
    get growthBudget() { return growthBudget },
    setMechanics(settings: typeof DISK_DEFAULTS) {
      mechanics = { ...settings }
      gravityDirection = diskGravityDirection(settings)
      // Never drop below the current vertex count: lowering the limit only stops further splits.
      growthBudget = Math.max(positions.length / 3, Math.round(baseBudget * settings.detailScale))
    },
    get strain() { return acceptedGrowth },
    get layers(): GrowthLayer[] { return structuredClone(layers) },
    setLayers(next: GrowthLayer[]) {
      layers = structuredClone(next)
      if (!layers.some(layer => layer.kind === 'paint')) layers.push(createLayer('paint'))
      refreshSpatial()
      refreshField()
    },
    get clock() { return clock },
    get fieldRevision() { return fieldRevision },
    get localGrowth() { return localGrowth },
    get contactHeat() { return contactHeat },
    get paint() { return paint },
    get hasPaint() { return paint.add.some(value => value > 0) || paint.erase.some(value => value > 0) },
    // Growth can happen now, later in the timeline, or has happened already.
    get canGrow() { return fieldActive || acceptedGrowth > 0 || startsLater(layers, clock) },
    get hasField() { return fieldActive },
    get openRims() { return openRims().map((rim, index) => ({ ...rim, index })) },
    brushFootprint,
    beginBrushStroke() { stroke = null },
    paintStroke,
    // One drag event of a brush stroke: dabs at each point, merged across symmetric copies.
    brush(points: StrokePoint[], radius: number, hardness: number, mode: BrushMode, strength: number, first: boolean) {
      if (first) stroke = null
      const merged = new Map<number, number>()
      for (const { face, point } of points) {
        for (const { vertex, amount } of brushFootprint(face, point, radius, hardness)) merged.set(vertex, Math.max(merged.get(vertex) ?? 0, amount))
      }
      paintStroke([...merged].map(([vertex, amount]) => ({ vertex, amount })), mode, strength)
    },
    get canUndoBrush() { return brushHistory.length > 0 },
    undoBrush() {
      const last = brushHistory.pop()
      if (!last) return
      for (const [vertex, [add, erase]] of last) {
        if (vertex >= paint.add.length) continue
        paint.add[vertex] = add
        paint.erase[vertex] = erase
      }
      stroke = null
      refreshField()
    },
    clearPaint() {
      paint.add.fill(0)
      paint.erase.fill(0)
      brushHistory.length = 0
      stroke = null
      refreshField()
    },
    restPoint(vertex: number): Vec3 { return [rest[vertex * 3], rest[vertex * 3 + 1], rest[vertex * 3 + 2]] },
    // Starting-shape coordinates in full precision; layer centers placed on the model come from here.
    get rest(): readonly number[] { return rest },
    nearestVertex,
    get geometryRevision() { return geometryRevision },
    get rejectedSteps() { return rejectedSteps },
    get growthThrottle() { return growthThrottle },
    get lastMotion() { return lastMotion },
    get lastContactCorrections() { return lastContactCorrections },
    get stepStatus() { return stepStatus },
    step(grow: boolean) {
      if (layers.some(isTimed)) refreshField()
      if (!fieldActive && acceptedGrowth === 0 && !startsLater(layers, clock)) return
      clock++
      if (touched.length !== field.length) touched = new Uint8Array(field.length)
      else touched.fill(0)
      // Compounding scales each step by the current target size. Edges at full field weight grow exactly
      // by (1 + rate) per step; edges with partial weight follow the same curve scaled by their weight.
      const increment = grow && fieldActive
        ? mechanics.growthRate * (mechanics.compoundGrowth ? 1 + acceptedGrowth : 1) * growthThrottle : 0
      let strain = acceptedGrowth + increment
      accepted.set(positions)
      for (let i = 0; i < positions.length; i++) {
        const velocity = (positions[i] - previous[i]) * (1 - mechanics.damping)
        previous[i] = positions[i]
        positions[i] += velocity
      }
      // Gravity loads only the growth field. Hold the rest of the model in place so the load
      // bends the growing region instead of dragging the whole model along the pull.
      const anchored: number[] = []
      if (mechanics.gravity > 0) {
        for (let vertex = 0; vertex < field.length; vertex++) {
          const weight = field[vertex]
          if (weight === 0) {
            anchored.push(vertex * 3)
            continue
          }
          const load = 0.004 * mechanics.gravity * weight
          for (let axis = 0; axis < 3; axis++) {
            positions[vertex * 3 + axis] += load * gravityDirection[axis]
          }
        }
      }
      const holdAnchors = () => {
        for (const p of anchored) {
          positions[p] = accepted[p]
          positions[p + 1] = accepted[p + 1]
          positions[p + 2] = accepted[p + 2]
        }
      }
      holdAnchors()
      // The core's anchors: the starting shape, scaled about its bounding-box center as the core grows. Edge splits
      // add midpoints inside that box, so the center never moves and a reopened model continues exactly.
      const core = mechanics.coreStiffness
      const coreScale = 1 + mechanics.coreGrowth * strain
      if (core > 0 && !coreCenter) {
        const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < rest.length; i++) {
          low[i % 3] = Math.min(low[i % 3], rest[i])
          high[i % 3] = Math.max(high[i % 3], rest[i])
        }
        coreCenter = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2]
      }
      const holdCore = () => {
        if (!(core > 0) || !coreCenter) return
        const [cx, cy, cz] = coreCenter
        for (let p = 0; p < positions.length; p += 3) {
          positions[p] += core * (cx + (rest[p] - cx) * coreScale - positions[p])
          positions[p + 1] += core * (cy + (rest[p + 1] - cy) * coreScale - positions[p + 1])
          positions[p + 2] += core * (cz + (rest[p + 2] - cz) * coreScale - positions[p + 2])
        }
      }
      for (let pass = 0; pass < 5; pass++) {
        for (const { a, b, length, weight } of links.values()) {
          const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2]
          const distance = Math.sqrt(x * x + y * y + z * z)
          if (distance < 1e-8) continue
          const expansion = (localGrowth[a / 3] + localGrowth[b / 3]) / 2 + increment * weight
          const correction = 0.36 * (distance - length * (1 + expansion)) / distance
          positions[a] += x * correction
          positions[a + 1] += y * correction
          positions[a + 2] += z * correction
          positions[b] -= x * correction
          positions[b + 1] -= y * correction
          positions[b + 2] -= z * correction
        }
        bend(positions, mechanics.bending)
        holdCore()
        holdAnchors()
      }
      // Search for contact only where the sheet grows, moved this step, or touched recently.
      if (active.length !== field.length) active = new Uint8Array(field.length)
      for (let v = 0; v < field.length; v++) {
        const p = v * 3
        active[v] = field[v] > 0 || contactHeat[v] > 0.05 || Math.abs(positions[p] - accepted[p]) + Math.abs(positions[p + 1] - accepted[p + 1])
          + Math.abs(positions[p + 2] - accepted[p + 2]) > 1e-6 ? 1 : 0
      }
      lastContactCorrections = intersects.repel(accepted, contactSettings(), touched, active)
      let overlaps = intersects(lastContactCorrections > 0)
      // Backtrack displacement and target growth together when contact is detected.
      for (let retry = 0; overlaps && retry < 6; retry++) {
        for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] + accepted[i]) / 2
        strain = (strain + acceptedGrowth) / 2
        overlaps = intersects()
      }
      lastMotion = 0
      if (overlaps) {
        positions.set(accepted)
        previous.set(accepted)
        rejectedSteps++
        if (increment > 0) growthThrottle = Math.max(1 / 8, growthThrottle / 2)
        stepStatus = 'contact'
        lastContactCorrections = 0
        // Retrying from an identical state repeats the same rejection, so open space at the
        // contact before the next attempt. Keep the result only if it stays free of overlap.
        for (let pass = 0; pass < 4; pass++) {
          const corrections = intersects.repel(accepted, contactSettings(), touched, active)
          if (!corrections) break
          // In tightly packed folds a full push can cross a neighboring fold. Back it off until it stays clear.
          let clear = !intersects()
          for (let retry = 0; !clear && retry < 4; retry++) {
            for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] + accepted[i]) / 2
            clear = !intersects()
          }
          if (!clear) {
            positions.set(accepted)
            break
          }
          accepted.set(positions)
          lastContactCorrections += corrections
        }
        previous.set(positions)
        if (lastContactCorrections) geometryRevision++
      } else {
        let squaredMotion = 0
        for (let i = 0; i < positions.length; i++) squaredMotion += (positions[i] - accepted[i]) ** 2
        if (squaredMotion > 0) geometryRevision++
        lastMotion = Math.sqrt(squaredMotion / (positions.length / 3))
        stepStatus = lastMotion < 1e-5 ? 'settled' : 'moving'
        if (increment) {
          for (let i = 0; i < field.length; i++) localGrowth[i] += (strain - acceptedGrowth) * field[i]
        }
        acceptedGrowth = strain
        if (increment > 0) growthThrottle = Math.min(1, growthThrottle * 1.05)
        if (increment > 0 && ++acceptedSteps % 20 === 0) subdivide()
      }
      // Contact heat fades over about a dozen steps so recent contacts stay visible.
      for (let v = 0; v < contactHeat.length; v++) contactHeat[v] = touched[v] ? 1 : contactHeat[v] * 0.92
      // Show and report the field for the new timeline step, so a layer that starts now can grow.
      if (layers.some(isTimed)) refreshField()
    },
  }
}
