import { describe, expect, it } from 'vitest'
import { createGrowingDisk } from '../physics/growingDisk'
import { GROWN_LIMIT, sharpEdges, SMOOTH_MAX_TRIANGLES, smoothPassesFor, smoothSheet, ungrownEdges } from './smoothSheet'
import { solidLeaks, thicken } from './thicken'

// Edges used by one face: the sheet's open rims.
function rimEdges(indices: ArrayLike<number>) {
  const count = new Map<string, number>()
  for (let f = 0; f < indices.length; f += 3) for (let k = 0; k < 3; k++) {
    const a = indices[f + k], b = indices[f + (k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  return [...count.values()].filter(c => c === 1).length
}
// The largest angle, in degrees, between the normals of two faces that share an edge: how faceted a surface is.
function sharpestFold(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const normal = (f: number) => {
    const p = (v: number) => [0, 1, 2].map(k => positions[indices[f * 3 + v] * 3 + k])
    const [a, b, c] = [p(0), p(1), p(2)], u = b.map((x, k) => x - a[k]), w = c.map((x, k) => x - a[k])
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n)
    return n.map(x => x / l)
  }
  const byEdge = new Map<string, number[]>()
  for (let f = 0; f < indices.length / 3; f++) for (let k = 0; k < 3; k++) {
    const a = indices[f * 3 + k], b = indices[f * 3 + (k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`
    byEdge.set(key, [...(byEdge.get(key) ?? []), f])
  }
  let worst = 0
  for (const pair of byEdge.values()) {
    if (pair.length !== 2) continue
    const [m, n] = pair.map(normal), dot = m[0] * n[0] + m[1] * n[1] + m[2] * n[2]
    worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI)
  }
  return worst
}
// A coarse open tube, 8 sides by 4 rings: 45° between neighbouring faces, like a low-detail vase wall.
function tube() {
  const positions: number[] = [], indices: number[] = [], sides = 8, rings = 4
  for (let j = 0; j <= rings; j++) for (let i = 0; i < sides; i++) {
    const a = 2 * Math.PI * i / sides
    positions.push(Math.cos(a), j * 0.5, Math.sin(a))
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    const a = j * sides + i, b = j * sides + (i + 1) % sides, c = a + sides, d = b + sides
    indices.push(a, c, b, b, c, d)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

describe('smoothSheet', () => {
  it('splits every triangle into four each pass and keeps the same open rims', () => {
    const disk = createGrowingDisk(), faces = disk.indices.length / 3, rims = rimEdges(disk.indices)
    for (const passes of [1, 2]) {
      const sheet = smoothSheet(disk.positions, disk.indices, passes)
      expect(sheet.indices.length / 3).toBe(faces * 4 ** passes)
      // A rim edge splits in two, so a pass doubles them and no new rim appears.
      expect(rimEdges(sheet.indices)).toBe(rims * 2 ** passes)
      expect(sheet.positions.every(Number.isFinite)).toBe(true)
      expect(Math.max(...sheet.origin)).toBeLessThan(disk.positions.length / 3)
      expect(Math.max(...sheet.origin2)).toBeLessThan(disk.positions.length / 3)
      // New points on edges blend two sheet vertices, so overlay colors change smoothly across the solid.
      expect(sheet.origin.some((v, i) => v !== sheet.origin2[i])).toBe(true)
    }
  })

  it('keeps a flat sheet flat, rim included', () => {
    const disk = createGrowingDisk(), positions = disk.positions.slice()
    for (let v = 0; v < positions.length / 3; v++) positions[v * 3 + 1] = 0.25
    const sheet = smoothSheet(positions, disk.indices, 2)
    for (let v = 0; v < sheet.positions.length / 3; v++) expect(sheet.positions[v * 3 + 1]).toBeCloseTo(0.25, 6)
  })

  it('smooths a faceted surface and keeps a flat rim in its plane', () => {
    const { positions, indices } = tube()
    expect(sharpestFold(positions, indices)).toBeCloseTo(45, 0)
    const light = smoothSheet(positions, indices, 1), strong = smoothSheet(positions, indices, 2)
    expect(sharpestFold(light.positions, light.indices)).toBeLessThan(25)
    expect(sharpestFold(strong.positions, strong.indices)).toBeLessThan(13)
    // The bottom rim of the tube stays at its height, like a vase standing on its rim.
    const bottom = [...Array(strong.positions.length / 3).keys()].filter(v => strong.positions[v * 3 + 1] < 0.01)
    expect(bottom.length).toBeGreaterThan(8 * 4 - 1)
    for (const v of bottom) expect(strong.positions[v * 3 + 1]).toBeCloseTo(0, 6)
  })

  it('still makes a closed solid once the wall is added', () => {
    const { positions, indices } = tube()
    const sheet = smoothSheet(positions, indices, 2)
    const solid = thicken(sheet.positions, sheet.indices, 0.05, 1, 4, 1)
    expect(solidLeaks(solid.indices)).toBe(0)
  })

  it('takes fewer passes on a dense sheet, so the solid stays under the triangle limit', () => {
    expect(smoothPassesFor('off', 1000)).toBe(0)
    expect(smoothPassesFor('strong', 2_000)).toBe(2)
    expect(smoothPassesFor('strong', 50_000)).toBe(1)
    expect(smoothPassesFor('light', SMOOTH_MAX_TRIANGLES)).toBe(0)
  })
})

// A vase base as an open sheet: a flat bottom of radius 20 mm meeting a 30 mm wall at a sharp 90° edge, open on top.
function vaseBase(ring = 24, rings = 4, rows = 6, R = 20, H = 30) {
  const positions: number[] = [0, 0, 0], indices: number[] = []
  for (let r = 1; r <= rings; r++) for (let k = 0; k < ring; k++) {
    const a = 2 * Math.PI * k / ring, rr = R * r / rings
    positions.push(rr * Math.cos(a), rr * Math.sin(a), 0)
  }
  const disc = (r: number, k: number) => r === 0 ? 0 : 1 + (r - 1) * ring + (k % ring)
  for (let k = 0; k < ring; k++) indices.push(0, disc(1, k), disc(1, k + 1))
  for (let r = 1; r < rings; r++) for (let k = 0; k < ring; k++) indices.push(disc(r, k), disc(r + 1, k), disc(r + 1, k + 1), disc(r, k), disc(r + 1, k + 1), disc(r, k + 1))
  const base = positions.length / 3
  for (let h = 1; h <= rows; h++) for (let k = 0; k < ring; k++) { const a = 2 * Math.PI * k / ring; positions.push(R * Math.cos(a), R * Math.sin(a), H * h / rows) }
  const wall = (h: number, k: number) => h === 0 ? disc(rings, k) : base + (h - 1) * ring + (k % ring)
  for (let h = 0; h < rows; h++) for (let k = 0; k < ring; k++) indices.push(wall(h, k), wall(h + 1, k), wall(h + 1, k + 1), wall(h, k), wall(h + 1, k + 1), wall(h, k + 1))
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
// How far out the flat bottom still reaches, and how low the wall still comes, in mm.
function bottomEdge(positions: ArrayLike<number>, R = 20) {
  let flat = 0, wallBottom = Infinity
  for (let v = 0; v < positions.length / 3; v++) {
    const r = Math.hypot(positions[v * 3], positions[v * 3 + 1]), z = positions[v * 3 + 2]
    if (Math.abs(z) < 1e-4) flat = Math.max(flat, r)
    if (r > R - 0.3) wallBottom = Math.min(wallBottom, z)
  }
  return { flat, wallBottom }
}

// A square tube, open at both ends: four sharp vertical edges, each ending at both rims, like a square vase.
function squareTube(per = 4, rows = 4) {
  const positions: number[] = [], indices: number[] = [], corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
  for (let j = 0; j <= rows; j++) for (let c = 0; c < 4; c++) for (let i = 0; i < per; i++) {
    const [x0, y0] = corners[c], [x1, y1] = corners[(c + 1) % 4], u = i / per
    positions.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, j * 0.5)
  }
  const around = 4 * per
  for (let j = 0; j < rows; j++) for (let i = 0; i < around; i++) {
    const a = j * around + i, b = j * around + (i + 1) % around
    indices.push(a, b, b + around, a, b + around, a + around)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), corners, per }
}
// The largest distance between matching points of two smoothed sheets.
const furthest = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let worst = 0
  for (let i = 0; i < a.length; i += 3) worst = Math.max(worst, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]))
  return worst
}

describe('sharp edges', () => {
  it('keeps only the sharp edges that have not grown, as designed edges', () => {
    // Three creases: one where nothing grew, one half grown past the limit, one just at it.
    const creases = [0, 1, 2, 3, 4, 5]
    const growth = [0, 0, 0, 0.3, GROWN_LIMIT, GROWN_LIMIT]
    expect(Array.from(ungrownEdges(creases, growth))).toEqual([0, 1, 4, 5])
    // Vertices added by splits after the growth was read count as not grown.
    expect(Array.from(ungrownEdges([7, 8], growth))).toEqual([7, 8])
  })

  it('finds the edge around a flat bottom and nothing on smooth or flat sheets', () => {
    const base = vaseBase(), creases = sharpEdges(base.positions, base.indices)
    expect(creases.length / 2).toBe(24)
    for (let i = 0; i < creases.length; i++) {
      const v = creases[i]
      expect(Math.hypot(base.positions[v * 3], base.positions[v * 3 + 1])).toBeCloseTo(20, 4)
      expect(base.positions[v * 3 + 2]).toBeCloseTo(0, 6)
    }
    expect(sharpEdges(createGrowingDisk().positions, createGrowingDisk().indices).length).toBe(0)
    // The 8-sided tube bends 45° between faces: sharp at the default angle, smooth if the angle is raised past it.
    expect(sharpEdges(tube().positions, tube().indices).length / 2).toBe(32)
    expect(sharpEdges(tube().positions, tube().indices, 50).length).toBe(0)
  })

  it('reads faces turned inconsistently, so a flipped face is not a sharp edge', () => {
    const base = vaseBase(), flipped = base.indices.slice()
    // Turn one bottom face over: it lies flat like its neighbours, so it adds no sharp edge.
    const f = 30; [flipped[f * 3 + 1], flipped[f * 3 + 2]] = [flipped[f * 3 + 2], flipped[f * 3 + 1]]
    expect(sharpEdges(base.positions, flipped).length / 2).toBe(24)
  })
})

describe('smoothing with sharp edges', () => {
  it('keeps a flat bottom flat out to its sharp edge, with no bevel', () => {
    const base = vaseBase(), creases = sharpEdges(base.positions, base.indices)
    for (const passes of [1, 2]) {
      const plain = bottomEdge(smoothSheet(base.positions, base.indices, passes).positions)
      const sharp = bottomEdge(smoothSheet(base.positions, base.indices, passes, { creases, bevel: 0 }).positions)
      // Without creases the bottom edge rounds: the flat part shrinks and the wall lifts off the bed.
      expect(plain.flat).toBeLessThan(19)
      expect(plain.wallBottom).toBeGreaterThan(1)
      // With them the flat bottom reaches the wall, which comes down to the bed. The edge loop itself smooths a little
      // around the 24-sided circle, so it sits just inside 20 mm.
      expect(sharp.flat).toBeGreaterThan(19.7)
      expect(sharp.wallBottom).toBeCloseTo(0, 5)
    }
  })

  it('rounds the edge part way at 50 % and exactly like plain smoothing at 100 %', () => {
    const base = vaseBase(), creases = sharpEdges(base.positions, base.indices)
    // The original points on the bottom edge keep their numbers; their average height shows how far the edge rounds.
    const edgeHeight = (positions: ArrayLike<number>) => {
      let sum = 0
      for (let i = 0; i < creases.length; i += 2) sum += positions[creases[i] * 3 + 2]
      return sum / (creases.length / 2)
    }
    for (const passes of [1, 2]) {
      const plain = smoothSheet(base.positions, base.indices, passes)
      const full = smoothSheet(base.positions, base.indices, passes, { creases, bevel: 1 })
      expect(full.positions).toEqual(plain.positions)
      expect(full.indices).toEqual(plain.indices)
      const sharp = edgeHeight(smoothSheet(base.positions, base.indices, passes, { creases, bevel: 0 }).positions)
      const half = edgeHeight(smoothSheet(base.positions, base.indices, passes, { creases, bevel: 0.5 }).positions)
      expect(sharp).toBeCloseTo(0, 6)
      expect(half).toBeGreaterThan(0.05)
      expect(half).toBeLessThan(edgeHeight(plain.positions) - 0.05)
    }
  })

  it('keeps a sharp edge sharp where it meets a rim, and the solid stands on its whole bottom', () => {
    const { positions: P, indices: I, corners, per } = squareTube(), rows = 4, creases = sharpEdges(P, I)
    expect(creases.length / 2).toBe(4 * rows)
    const sharp = smoothSheet(P, I, 2, { creases, bevel: 0 }), plain = smoothSheet(P, I, 2)
    // The bottom corner of each vertical edge stays exactly where it was; plain smoothing rounds the corners off.
    for (let c = 0; c < 4; c++) {
      expect(sharp.positions[c * per * 3]).toBeCloseTo(corners[c][0], 6)
      expect(sharp.positions[c * per * 3 + 1]).toBeCloseTo(corners[c][1], 6)
      expect(Math.hypot(plain.positions[c * per * 3], plain.positions[c * per * 3 + 1])).toBeLessThan(Math.SQRT2 - 0.05)
    }
    expect(sharpestFold(sharp.positions, sharp.indices)).toBeGreaterThan(85)
    // The walled vase base (2 mm wall) keeps a flat, sharp-edged bottom: within 0.05 mm of the bed, a quarter of a
    // 0.2 mm layer, it reaches out to the wall's outer face at 21 mm. Rounded, it stands on a smaller circle.
    const footprint = (bevel: number) => {
      const base = vaseBase(), vase = smoothSheet(base.positions, base.indices, 1, { creases: sharpEdges(base.positions, base.indices), bevel })
      const solid = thicken(vase.positions, vase.indices, 2, 0, 4, 0)
      let lowest = Infinity, reach = 0
      for (let v = 0; v < solid.positions.length / 3; v++) lowest = Math.min(lowest, solid.positions[v * 3 + 2])
      for (let v = 0; v < solid.positions.length / 3; v++) if (solid.positions[v * 3 + 2] < lowest + 0.05) reach = Math.max(reach, Math.hypot(solid.positions[v * 3], solid.positions[v * 3 + 1]))
      return reach
    }
    expect(footprint(0)).toBeGreaterThan(20.8)
    expect(footprint(1)).toBeLessThan(19.5)
  })
})

describe('bevel', () => {
  it('eases in without jumps, also where a sharp edge meets a rim', () => {
    const tube = squareTube(), creases = sharpEdges(tube.positions, tube.indices)
    const at = (passes: number, bevel: number) => smoothSheet(tube.positions, tube.indices, passes, { creases, bevel }).positions
    // A small turn of the slider moves the surface a little, right up to 100% and across Strong's halfway point.
    expect(furthest(at(1, 0.999), at(1, 1))).toBeLessThan(0.002)
    expect(furthest(at(2, 0.999), at(2, 1))).toBeLessThan(0.002)
    expect(furthest(at(2, 0.499), at(2, 0.501))).toBeLessThan(0.002)
    expect(furthest(at(1, 0), at(1, 1))).toBeGreaterThan(0.05)
  })

  it('rounds Strong part way with a fraction of a pass left (25 %), between 0 % and 50 %', () => {
    const base = vaseBase(), creases = sharpEdges(base.positions, base.indices)
    const edgeHeight = (bevel: number) => {
      const P = smoothSheet(base.positions, base.indices, 2, { creases, bevel }).positions
      let sum = 0
      for (let i = 0; i < creases.length; i += 2) sum += P[creases[i] * 3 + 2]
      return sum / (creases.length / 2)
    }
    expect(edgeHeight(0)).toBeCloseTo(0, 6)
    expect(edgeHeight(0.25)).toBeGreaterThan(0.01)
    expect(edgeHeight(0.25)).toBeLessThan(edgeHeight(0.5) - 0.01)
  })

  it('keeps a corner where three sharp edges meet, and reads odd meshes safely', () => {
    // An open box: a square bottom and four walls. Each bottom corner joins three sharp edges.
    const P = Float32Array.from([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 0, 0, 1, 2, 0, 1, 2, 2, 1, 0, 2, 1])
    const I = Uint32Array.from([0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7])
    const creases = sharpEdges(P, I)
    expect(creases.length / 2).toBe(8)
    const sharp = smoothSheet(P, I, 2, { creases, bevel: 0 }).positions
    for (let v = 0; v < 4; v++) for (let k = 0; k < 3; k++) expect(sharp[v * 3 + k]).toBeCloseTo(P[v * 3 + k], 6)
    // An edge with three faces (two flat, one standing up like a fin) is a seam that smoothing keeps anyway, not a crease.
    const fin = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1])
    expect(sharpEdges(fin, Uint32Array.from([0, 1, 2, 1, 0, 3, 0, 1, 4])).length).toBe(0)
    // A face with no area has no normal, so its edges are skipped, and nothing comes out as NaN.
    const flat = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0])
    const sliver = sharpEdges(flat, Uint32Array.from([0, 1, 2, 1, 0, 3]))
    expect(sliver.length).toBe(0)
  })
})

describe('sharp edge angle', () => {
  // A base with a chamfer, like a CAD pen holder: the bottom meets a 45° chamfer 2 mm tall (a 45° bend), and the chamfer
  // meets a wall leaning out 10° (a 35° bend). Returns the mesh and the vertex numbers of the chamfer's top edge.
  function chamferedBase(ring = 48, R = 20, c = 2, H = 30, rows = 6) {
    const positions: number[] = [0, 0, 0], indices: number[] = [], rings = 4, lean = Math.tan(10 * Math.PI / 180)
    const radius: number[] = [], height: number[] = []
    for (let r = 1; r <= rings; r++) { radius.push(R * r / rings); height.push(0) }
    radius.push(R + c); height.push(c)
    for (let h = 1; h <= rows; h++) { radius.push(R + c + lean * H * h / rows); height.push(c + H * h / rows) }
    radius.forEach((rr, j) => { for (let k = 0; k < ring; k++) { const a = 2 * Math.PI * k / ring; positions.push(rr * Math.cos(a), rr * Math.sin(a), height[j]) } })
    const at = (j: number, k: number) => 1 + j * ring + (k % ring)
    for (let k = 0; k < ring; k++) indices.push(0, at(0, k), at(0, k + 1))
    for (let j = 0; j + 1 < radius.length; j++) for (let k = 0; k < ring; k++) indices.push(at(j, k), at(j + 1, k), at(j + 1, k + 1), at(j, k), at(j + 1, k + 1), at(j, k + 1))
    const top = [...Array(ring).keys()].map(k => at(rings, k))
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), top, c }
  }

  it('keeps both edges of a chamfer sharp at the default 30°, where 40° rounded the upper one', () => {
    const base = chamferedBase()
    const at30 = sharpEdges(base.positions, base.indices), at40 = sharpEdges(base.positions, base.indices, 40)
    expect(at30.length / 2).toBe(96) // both edges of the chamfer, 48 segments each
    expect(at40.length / 2).toBe(48) // only the one at the bed
    // How far the chamfer's top edge moves up or down when smoothed: a sharp edge stays at its height.
    const drift = (creases: Uint32Array) => {
      const P = smoothSheet(base.positions, base.indices, 2, { creases, bevel: 0 }).positions
      return Math.max(...base.top.map(v => Math.abs(P[v * 3 + 2] - base.c)))
    }
    expect(drift(at30)).toBeLessThan(1e-5)
    expect(drift(at40)).toBeGreaterThan(0.1)
  })
})
