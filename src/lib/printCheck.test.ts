import { describe, expect, it } from 'vitest'
import { lowPoints, printCheck } from './printCheck'

type Mesh = { positions: number[]; indices: number[] }
const join = (...meshes: Mesh[]): Mesh => {
  const out: Mesh = { positions: [], indices: [] }
  for (const mesh of meshes) {
    const offset = out.positions.length / 3
    out.positions.push(...mesh.positions)
    out.indices.push(...mesh.indices.map(i => i + offset))
  }
  return out
}
// A box with outward-facing triangles, Y up.
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Mesh {
  const positions = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
  return { positions, indices: quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]) }
}
// A square facing down, tilted so it leans out at `slope` degrees from the bed (0 is a flat ceiling).
function tiltedUnderside(slope: number, y: number): Mesh {
  const s = Math.sin(slope * Math.PI / 180) * 10, c = Math.cos(slope * Math.PI / 180) * 10
  return { positions: [0, y, 0, c, y + s, 0, c, y + s, 10, 0, y, 10], indices: [0, 1, 2, 0, 2, 3] }
}
// A flat grid of n x n vertices at height y, 1 unit apart, with one vertex in the middle moved by dip.
function grid(n: number, y: number, dip: number): Mesh {
  const positions: number[] = [], indices: number[] = [], middle = (n - 1) / 2
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) positions.push(i, y + (i === middle && j === middle ? -dip : 0), j)
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = a + 1, c = a + n, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  return { positions, indices }
}
const area = (mesh: Mesh) => {
  const P = mesh.positions
  let total = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t] * 3, mesh.indices[t + 1] * 3, mesh.indices[t + 2] * 3]
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
    total += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
  }
  return total
}

describe('print check', () => {
  it('puts a cube on the bed: its bottom touches the bed and nothing needs support', () => {
    const cube = box(0, 0, 0, 10, 10, 10)
    const check = printCheck(cube.positions, cube.indices, 45)
    expect(check.bed).toBeCloseTo(100, 6)
    expect(check.needs).toBe(0)
    expect(check.marginal).toBe(0)
    expect(check.lowPoints).toEqual([])
  })

  it('finds the underside of a plate floating above the bed, as a share of the whole surface', () => {
    const mesh = join(box(0, 0, 0, 10, 10, 10), box(20, 20, 0, 30, 22, 10))
    const check = printCheck(mesh.positions, mesh.indices, 30)
    expect(check.needs).toBeCloseTo(100 / area(mesh), 6)
    expect(check.bed).toBeCloseTo(100, 6)
  })

  it('counts the angle up from the bed: a 38° underside is marginal at 30° and needs support at 45°', () => {
    const mesh = join(box(0, 0, 0, 10, 10, 10), tiltedUnderside(38, 20))
    const share = 100 / area(mesh)
    expect(printCheck(mesh.positions, mesh.indices, 45).needs).toBeCloseTo(share, 6)
    const at30 = printCheck(mesh.positions, mesh.indices, 30)
    expect(at30.needs).toBe(0)
    expect(at30.marginal).toBeCloseTo(share, 6)
    // 60° from the bed is steeper than 30° + 10°, so it prints.
    const steep = join(box(0, 0, 0, 10, 10, 10), tiltedUnderside(60, 20))
    expect(printCheck(steep.positions, steep.indices, 30).marginal).toBe(0)
  })

  it('reads an open sheet as a wall with two sides: a sheet tilted 20° needs support whichever way it faces', () => {
    // The square faces up as wound, so only the two-sided check sees its underside. Two-sided is for open sheets only.
    const sheet = tiltedUnderside(20, 5)
    const up = { positions: sheet.positions, indices: [0, 2, 1, 0, 3, 2] }
    expect(printCheck(up.positions, up.indices, 45).needs).toBe(0)
    // Both sides count in the surface, and one of them faces down: half, as the solid it becomes will read.
    expect(printCheck(up.positions, up.indices, 45, { twoSided: true }).needs).toBeCloseTo(0.5, 6)
  })

  it('scales the bed area and tolerance with millimeters per unit', () => {
    const cube = box(0, 0, 0, 1, 1, 1)
    const check = printCheck(cube.positions, cube.indices, 45, { mm: 10 })
    expect(check.bed).toBeCloseTo(100, 6)
    expect(check.bedTolerance).toBeCloseTo(0.02, 9)
  })

  it('puts only the first layer, 0.2 mm, on the bed: a face 0.3 mm up prints over air and needs support', () => {
    // Two squares facing straight down, one on the bed and one 0.3 mm up, like the default disk's starting ripple.
    const mesh = { positions: [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10, 20, 0.3, 0, 30, 0.3, 0, 30, 0.3, 10, 20, 0.3, 10], indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] }
    const check = printCheck(mesh.positions, mesh.indices, 45, { twoSided: true })
    expect(check.bed).toBeCloseTo(100, 6)
    expect(check.needs).toBeCloseTo(100 / 400, 6)
    const near = { positions: mesh.positions.map((v, i) => i % 3 === 1 && v ? 0.1 : v), indices: mesh.indices }
    expect(printCheck(near.positions, near.indices, 45, { twoSided: true }).bed).toBeCloseTo(200, 6)
  })
})

describe('low points', () => {
  it('finds a tip hanging in the air, but not the corners that sit on the bed', () => {
    // An upside-down pyramid above a cube: its tip is lower than all its neighbours.
    // Wound outward: its sides face down and out, its top faces up.
    const tip = { positions: [5, 20, 5, 0, 25, 0, 10, 25, 0, 10, 25, 10, 0, 25, 10], indices: [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 3, 2, 1, 4, 3] }
    const mesh = join(box(0, 0, 0, 10, 10, 10), tip)
    expect(printCheck(mesh.positions, mesh.indices, 45).lowPoints).toEqual([8])
  })

  it('skips ripples: a dent counts only when it sits at least 0.2 mm below its third ring of neighbours', () => {
    const base = box(0, 0, 0, 10, 1, 10)
    const ripple = join(base, grid(9, 20, 0.1)), dent = join(base, grid(9, 20, 1))
    expect(lowPoints(ripple.positions, ripple.indices, 0)).toEqual([])
    // The middle vertex of the 9 x 9 grid, after the cube's 8 vertices.
    expect(lowPoints(dent.positions, dent.indices, 0)).toEqual([8 + 40])
  })

  it('counts a dip only where the surface faces down on a solid; on an open sheet every dip hangs', () => {
    // The grid is wound to face down, like the underside of a shelf: its dent hangs in the air.
    const down = grid(9, 20, 1)
    const under = join(box(0, 0, 0, 10, 1, 10), down)
    expect(printCheck(under.positions, under.indices, 45).lowPoints).toEqual([8 + 40])
    // Wound to face up, like the top of a fold with material under it: the dent doesn't hang, unless it is an open sheet.
    const up = { positions: down.positions, indices: down.indices.map((_, i, all) => all[i - (i % 3) + [0, 2, 1][i % 3]]) }
    const over = join(box(0, 0, 0, 10, 1, 10), up)
    expect(printCheck(over.positions, over.indices, 45).lowPoints).toEqual([])
    expect(printCheck(over.positions, over.indices, 45, { twoSided: true }).lowPoints).toContain(8 + 40)
  })

  it('leaves out low points within 0.5 mm of the bed, which print on the first layers', () => {
    const near = join(box(0, 0, 0, 10, 1, 10), grid(9, 1.4, 1))
    expect(lowPoints(near.positions, near.indices, 0)).toEqual([])
  })
})
