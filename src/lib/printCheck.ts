// The print check: what a slicer would support, counted on the mesh. A face needs support when it faces down and leans
// out flatter than the support angle, counted up from the bed as Bambu Studio and PrusaSlicer count it (Cura counts from
// vertical, so only 45° is the same in both). Faces lying on the bed need none. A low point hanging in the air needs a
// support to start on even when its sides are steep; Bambu Studio calls these sharp tails. Y is up, as in the 3D view.

export const PRINT_ANGLE_DEFAULT = 45
export const PRINT_ANGLE_RANGE: [number, number] = [10, 60]
// Faces up to this many degrees steeper than the support angle are marginal: they print, but only just.
export const PRINT_MARGIN = 10

// A face facing straight down this close to the lowest point sits on the bed: Bambu Studio's first layer is 0.2 mm.
// Higher up, even 0.3 mm, it prints over a gap of air, as on the crests of the default disk's starting ripple.
const BED_MM = 0.2
// Low points closer to the bed than this print on the first layers. The rest count when they are the lowest of
// everything within three rings of neighbours and sit this far below the third ring, so the small ripples of a smoothed
// surface don't count.
const LOW_POINT_HEIGHT_MM = 0.5
const LOW_POINT_DEPTH_MM = 0.2

export type PrintCheckOptions = {
  // An open sheet prints as a wall with two sides: each face counts twice in the surface, and one of its sides faces
  // down whichever way it was wound. So a sheet reads about as its solid will.
  twoSided?: boolean
  // Millimeters per model unit, for the bed tolerance, the low points and the bed area.
  mm?: number
}

export type PrintCheck = {
  // Shares of the whole surface, bed included, and both sides of an open sheet: what needs support, and what is marginal.
  needs: number
  marginal: number
  // Area lying on the bed, in square millimeters.
  bed: number
  // Vertices that are low points hanging in the air.
  lowPoints: number[]
  // The height of the lowest point, where the bed is, and how close to it a face counts as on the bed, in model units.
  low: number
  bedTolerance: number
}

// The cosine of how far a face may tilt from facing straight down and still need support, for the shader as well.
export const needCosine = (angle: number) => Math.cos(angle * Math.PI / 180)
export const marginCosine = (angle: number) => Math.cos(Math.min(90, angle + PRINT_MARGIN) * Math.PI / 180)
export const bedTolerance = (mm = 1) => BED_MM / mm

export function printCheck(positions: ArrayLike<number>, indices: ArrayLike<number>, angle: number,
  options: PrintCheckOptions = {}): PrintCheck {
  const mm = options.mm ?? 1, twoSided = Boolean(options.twoSided), P = positions
  let low = Infinity
  for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i])
  const need = needCosine(angle), margin = marginCosine(angle), onBed = bedTolerance(mm)
  let total = 0, needs = 0, marginal = 0, bed = 0
  // Which way the surface around each vertex faces, area-weighted, for the low points on a solid.
  const facing = twoSided ? null : new Float64Array(P.length / 3)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz)
    if (!length) continue
    const area = length / 2 * mm * mm
    total += twoSided ? 2 * area : area
    if (facing) { facing[indices[t]] += ny; facing[indices[t + 1]] += ny; facing[indices[t + 2]] += ny }
    // How straight down the face looks: 1 facing the bed, 0 for a wall, negative facing up.
    const down = twoSided ? Math.abs(ny / length) : -ny / length
    if (down > 0.999 && Math.max(P[a + 1], P[b + 1], P[c + 1]) - low < onBed) bed += area
    else if (down > need) needs += area
    else if (down > margin) marginal += area
  }
  return {
    needs: total ? needs / total : 0, marginal: total ? marginal / total : 0, bed,
    lowPoints: lowPoints(P, indices, low, mm, facing), low, bedTolerance: onBed,
  }
}

// Each vertex's neighbours in one flat list: list[start[v]] to list[start[v + 1]], with repeats.
function neighbours(vertices: number, indices: ArrayLike<number>) {
  const start = new Int32Array(vertices + 1)
  for (let i = 0; i < indices.length; i++) start[indices[i] + 1] += 2
  for (let v = 0; v < vertices; v++) start[v + 1] += start[v]
  const fill = start.slice(0, vertices), list = new Int32Array(start[vertices])
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k]
    list[fill[a]++] = indices[t + (k + 1) % 3]
    list[fill[a]++] = indices[t + (k + 2) % 3]
  }
  return { start, list }
}

// facing: for a solid, which way the surface around each vertex faces (its normal's height, any scale). A dip in a surface
// facing up has material under it, so only low points on surfaces facing down hang in the air. An open sheet has none.
export function lowPoints(positions: ArrayLike<number>, indices: ArrayLike<number>, low: number, mm = 1,
  facing: ArrayLike<number> | null = null): number[] {
  const vertices = positions.length / 3, { start, list } = neighbours(vertices, indices)
  const height = LOW_POINT_HEIGHT_MM / mm, depth = LOW_POINT_DEPTH_MM / mm
  const seen = new Int32Array(vertices).fill(-1), found: number[] = []
  for (let v = 0; v < vertices; v++) {
    const y = positions[v * 3 + 1]
    if (y - low < height || start[v] === start[v + 1] || (facing && facing[v] >= 0)) continue
    // Most vertices have a neighbour as low or lower; skip them before searching three rings.
    let lowest = true
    for (let i = start[v]; i < start[v + 1] && lowest; i++) if (positions[list[i] * 3 + 1] <= y) lowest = false
    if (!lowest) continue
    seen[v] = v
    let ring = [v], rise = Infinity
    for (let level = 0; level < 3 && lowest; level++) {
      const next: number[] = []
      for (const a of ring) for (let i = start[a]; i < start[a + 1]; i++) {
        const b = list[i]
        if (seen[b] === v) continue
        seen[b] = v
        next.push(b)
        const dy = positions[b * 3 + 1] - y
        if (dy <= 0) lowest = false
        else if (level === 2) rise = Math.min(rise, dy)
      }
      ring = next
    }
    if (lowest && rise >= depth) found.push(v)
  }
  return found
}
