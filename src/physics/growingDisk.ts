import { createFlatShellBending } from './flatShellBending'
import { CONTACT_DEFAULTS, createDiskSelfContact } from './diskSelfContact'
import { remeshPlanarPatches } from './remeshPlanarPatches'
import { balanceSurfaceTriangles } from './balanceSurfaceTriangles'

export const DISK_DEFAULTS = {
  growthRate: 0.003, bending: 0.065, damping: 0.18, remeshLength: 0.145, gravity: 0, gravityTilt: 0, gravityHeading: 0,
  // 0 adds the same amount each step. 1 adds a share of the current size, so growth speeds up.
  compoundGrowth: 0,
  // Contact response inside the growth field. The rest of the model keeps the defaults.
  repelDistance: CONTACT_DEFAULTS.distance, repelStrength: CONTACT_DEFAULTS.strength,
  // Multiplies the default vertex limit so growth can keep adding triangles.
  detailScale: 1,
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
  brushOverrides: [number, number][]
  disabledRims?: number[]
  sources: number
  zone: number
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

export function createGrowingDisk(input?: { positions: Float32Array; indices: Uint32Array }, startingEdgeLength = DISK_DEFAULTS.remeshLength, snapshot?: DiskSnapshot) {
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
  let painted = Boolean(input && snapshot && field.some(weight => weight > 0))
  let neighbors: number[][] = []
  let bend = createFlatShellBending(indices, input ? Float32Array.from(rest) : undefined)
  type Adjacent = { offset: number; u: number; v: number; other: number }
  const links = new Map<string, { a: number; b: number; length: number; weight: number; adjacent: Adjacent[] }>()
  let sources = snapshot?.sources ?? 0
  let zone = snapshot?.zone ?? 0.3
  function rebuildLinks() {
    if (!input) field = Float32Array.from({ length: rest.length / 3 }, (_, i) => {
      const x = rest[i * 3], z = rest[i * 3 + 2]
      const radius = Math.hypot(x, z)
      const angle = Math.atan2(z, x)
      const distance = sources ? Math.sqrt(Math.max(0, 1 + radius ** 2 - 2 * radius * Math.cos(angle - Math.round(angle * sources / (2 * Math.PI)) * 2 * Math.PI / sources))) : 1 - radius
      if (distance >= zone) return 0
      const falloff = Math.max(0.02, zone * 0.45)
      const edgeWeight = Math.exp(-zone / falloff)
      return (Math.exp(-distance / falloff) - edgeWeight) / (1 - edgeWeight)
    })
    links.clear()
    neighbors = Array.from({ length: field.length }, () => [])
    for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const face = { offset: i, u: a, v: b, other: indices[i + (j + 2) % 3] }
      const existing = links.get(key)
      if (existing) { existing.adjacent.push(face); continue }
      neighbors[a].push(b)
      neighbors[b].push(a)
      links.set(key, { a: a * 3, b: b * 3, length: Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]), weight: (field[a] + field[b]) / 2, adjacent: [face] })
    }
  }
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
  let lastMotion = 0
  let lastContactCorrections = 0
  let geometryRevision = 0
  let stepStatus: 'ready' | 'moving' | 'settled' | 'contact' = 'ready'
  let splits = 0
  let mechanics = { ...DISK_DEFAULTS }
  let gravityDirection = diskGravityDirection(mechanics)
  const contactSettings = () => ({ distance: mechanics.repelDistance, strength: mechanics.repelStrength, field })
  let acceptedSteps = snapshot?.acceptedSteps ?? 0
  const preparationBudget = Math.max(900, rest.length / 3 + (input ? 300 : 0))
  let growthBudget = snapshot?.growthBudget ?? preparationBudget
  const brushOverrides = new Map<number, number>(snapshot?.brushOverrides)
  const brushHistory: Map<number, number>[] = []
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
      const expansion = input ? (localGrowth[a] + localGrowth[b]) / 2 : acceptedGrowth * edge.weight
      // Compressed folds can need more material even when the edge stays short.
      const size = preparing ? actual : Math.max(actual, edge.length * (1 + expansion))
      if (size > threshold) candidates.push({ edge, size })
    }
    candidates.sort((a, b) => b.size - a.size)
    const usedFaces = new Set<number>()
    const replacement = new Map<number, number[]>()
    const nextPositions = Array.from(positions), nextPrevious = Array.from(previous)
    const nextField = Array.from(field), nextGrowth = Array.from(localGrowth)
    for (const { edge, size } of candidates) {
      if (nextPositions.length / 3 >= vertexBudget) break
      const a = edge.a / 3, b = edge.b / 3
      const { adjacent } = edge
      if (adjacent.some(({ offset, other }) => usedFaces.has(offset)
        || (preparing && Math.max(distance(a, other), distance(b, other)) > size))) continue
      const middle = nextPositions.length / 3
      nextField.push((field[a] + field[b]) / 2)
      if (brushOverrides.has(a) || brushOverrides.has(b)) brushOverrides.set(middle, nextField[middle])
      nextGrowth.push((localGrowth[a] + localGrowth[b]) / 2)
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
    brushHistory.length = 0
    const newFaces: number[] = []
    for (let i = 0; i < indices.length; i += 3) newFaces.push(...(replacement.get(i) ?? indices.subarray(i, i + 3)))
    indices = Uint32Array.from(newFaces)
    if (input) field = Float32Array.from(nextField)
    localGrowth = Float32Array.from(nextGrowth)
    positions = Float32Array.from(nextPositions)
    referencePositions = Float32Array.from(rest)
    previous = Float32Array.from(nextPrevious)
    accepted = positions.slice()
    uv = Float32Array.from(pointsToUV())
    bend = createFlatShellBending(indices, input ? Float32Array.from(rest) : undefined)
    intersects = createDiskSelfContact(positions, indices, referencePositions)
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
  const initialOverlap = Boolean((input || snapshot) && intersects())
  splits = snapshot?.splits ?? 0
  const disabledRims = new Set(snapshot?.disabledRims)
  let rimIndices: Uint32Array | undefined
  let rims: { id: number; vertices: number[]; edges: number[]; height: number }[] = []
  function openRims() {
    if (!input || rimIndices === indices) return rims
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

  function selectOpenRings(width = 0.16) {
    const boundaries = openRims()
    if (!input) return 0
    const distance = new Float64Array(field.length).fill(Infinity)
    const owner = new Int32Array(field.length).fill(-1)
    const queue: number[] = []
    let selected = 0
    for (const rim of boundaries) {
      if (!disabledRims.has(rim.id)) selected += rim.vertices.length
      for (const vertex of rim.vertices) {
        distance[vertex] = 0
        owner[vertex] = rim.id
        queue.push(vertex)
      }
    }
    for (const vertex of queue) {
      for (const next of neighbors[vertex]) {
        const length = Math.hypot(rest[vertex * 3] - rest[next * 3],
          rest[vertex * 3 + 1] - rest[next * 3 + 1], rest[vertex * 3 + 2] - rest[next * 3 + 2])
        const nextDistance = distance[vertex] + length
        if (nextDistance >= width || nextDistance >= distance[next]) continue
        distance[next] = nextDistance
        owner[next] = owner[vertex]
        queue.push(next)
      }
    }
    field = field.map((_, vertex) => brushOverrides.get(vertex)
      ?? (disabledRims.has(owner[vertex]) ? 0 : Math.max(0, 1 - distance[vertex] / width)))
    painted = field.some(value => value > 0)
    for (const edge of links.values()) edge.weight = (field[edge.a / 3] + field[edge.b / 3]) / 2
    return selected
  }

  function brushFootprint(face: number, point: readonly number[], radius: number) {
    const footprint: { vertex: number; amount: number }[] = []
    if (!input || face < 0 || face * 3 + 2 >= indices.length) return footprint
    const distance = (vertex: number) => Math.hypot(
      positions[3 * vertex] - point[0], positions[3 * vertex + 1] - point[1], positions[3 * vertex + 2] - point[2],
    )
    const queue = [...indices.subarray(face * 3, face * 3 + 3)]
    const visited = new Set(queue)
    for (const vertex of queue) {
      footprint.push({ vertex, amount: Math.max(0.05, 1 - distance(vertex) / radius) })
      for (const next of neighbors[vertex]) {
        if (visited.has(next) || distance(next) > radius) continue
        visited.add(next)
        queue.push(next)
      }
    }
    return footprint
  }

  function applyBrush(footprint: ReturnType<typeof brushFootprint>, erase: boolean) {
    if (!footprint.length) return
    field = field.slice()
    for (const { vertex, amount } of footprint) {
      field[vertex] = erase ? 0 : Math.max(field[vertex], amount)
      brushOverrides.set(vertex, field[vertex])
    }
    painted = field.some(value => value > 0)
    for (const edge of links.values()) edge.weight = (field[edge.a / 3] + field[edge.b / 3]) / 2
  }

  return {
    preparationSplits,
    preparationFlips,
    preparationPatches,
    initialOverlap,
    snapshot(): DiskSnapshot {
      return {
        rest: [...rest],
        indices: Array.from(indices),
        positions: Array.from(positions),
        previous: Array.from(previous),
        field: Array.from(field),
        localGrowth: Array.from(localGrowth),
        brushOverrides: [...brushOverrides],
        disabledRims: [...disabledRims],
        sources, zone, strain: acceptedGrowth, acceptedSteps, rejectedSteps, splits, growthBudget, baseBudget, growthThrottle,
        preparationSplits, preparationFlips, preparationPatches,
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
    configure(nextSources: number, nextZone: number) {
      if (sources === nextSources && zone === nextZone) return
      sources = nextSources
      zone = nextZone
      rebuildLinks()
    },
    get strain() { return acceptedGrowth },
    get hasBrushEdits() { return brushOverrides.size > 0 },
    get hasPaint() { return painted },
    get openRims() {
      return openRims().map(rim => ({ ...rim, enabled: !disabledRims.has(rim.id) }))
    },
    selectOpenRings,
    setRimEnabled(id: number, enabled: boolean, width: number) {
      if (enabled) disabledRims.delete(id)
      else disabledRims.add(id)
      selectOpenRings(width)
    },
    brushFootprint,
    beginBrushStroke() {
      brushHistory.push(new Map(brushOverrides))
      if (brushHistory.length > 20) brushHistory.shift()
    },
    get canUndoBrush() { return brushHistory.length > 0 },
    undoBrush(width: number) {
      const previousStroke = brushHistory.pop()
      if (!previousStroke) return
      brushOverrides.clear()
      for (const [vertex, weight] of previousStroke) brushOverrides.set(vertex, weight)
      selectOpenRings(width)
    },
    applyBrush,
    paint(face: number, point: readonly number[], radius: number, erase: boolean) {
      applyBrush(brushFootprint(face, point, radius), erase)
    },
    get geometryRevision() { return geometryRevision },
    get rejectedSteps() { return rejectedSteps },
    get growthThrottle() { return growthThrottle },
    get lastMotion() { return lastMotion },
    get lastContactCorrections() { return lastContactCorrections },
    get stepStatus() { return stepStatus },
    step(grow: boolean) {
      if (input && !painted && acceptedGrowth === 0) return
      // Compounding scales each step by the current target size. Edges at full field weight grow exactly
      // by (1 + rate) per step; edges with partial weight follow the same curve scaled by their weight.
      const increment = grow && (!input || painted)
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
      for (let pass = 0; pass < 5; pass++) {
        for (const { a, b, length, weight } of links.values()) {
          const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2]
          const distance = Math.sqrt(x * x + y * y + z * z)
          if (distance < 1e-8) continue
          const expansion = input ? (localGrowth[a / 3] + localGrowth[b / 3]) / 2 + increment * weight : strain * weight
          const correction = 0.36 * (distance - length * (1 + expansion)) / distance
          positions[a] += x * correction
          positions[a + 1] += y * correction
          positions[a + 2] += z * correction
          positions[b] -= x * correction
          positions[b + 1] -= y * correction
          positions[b + 2] -= z * correction
        }
        bend(positions, mechanics.bending)
        holdAnchors()
      }
      lastContactCorrections = intersects.repel(accepted, contactSettings())
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
          const corrections = intersects.repel(accepted, contactSettings())
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
        if (input && increment) {
          for (let i = 0; i < field.length; i++) localGrowth[i] += (strain - acceptedGrowth) * field[i]
        }
        acceptedGrowth = strain
        if (increment > 0) growthThrottle = Math.min(1, growthThrottle * 1.05)
        if (increment > 0 && ++acceptedSteps % 20 === 0) subdivide()
      }
    },
  }
}
