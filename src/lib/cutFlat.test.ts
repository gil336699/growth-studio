import { describe, expect, it } from 'vitest'
import { cutFlat } from './cutFlat'

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
// A square ring standing up: a 10 × 10 block with a 4 × 4 hole through it from top to bottom.
function ring(): Mesh {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]], inner = [[3, 3], [7, 3], [7, 7], [3, 7]]
  const positions: number[] = []
  for (const y of [0, 10]) for (const [x, z] of [...outer, ...inner]) positions.push(x, y, z)
  const v = (top: number, i: number) => top * 8 + i
  const indices: number[] = []
  // Each quad is listed turning inward, so it's pushed the other way round to face out of the solid.
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, c, b, a, d, c)
  for (let k = 0; k < 4; k++) {
    const o0 = k, o1 = (k + 1) % 4, i0 = 4 + k, i1 = 4 + (k + 1) % 4
    quad(v(0, o0), v(0, o1), v(1, o1), v(1, o0))          // outer wall
    quad(v(0, i1), v(0, i0), v(1, i0), v(1, i1))          // wall of the hole
    quad(v(1, o0), v(1, o1), v(1, i1), v(1, i0))          // top
    quad(v(0, o1), v(0, o0), v(0, i0), v(0, i1))          // bottom
  }
  return { positions, indices }
}
// An icosphere of radius r around (0, cy, 0), refined `levels` times.
function sphere(r: number, cy: number, levels: number): Mesh {
  const t = (1 + Math.sqrt(5)) / 2
  let P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  for (let l = 0; l < levels; l++) {
    const mid = new Map<string, number>(), next: number[][] = []
    const m = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (!mid.has(key)) { mid.set(key, P.length); P.push(P[a].map((x, i) => (x + P[b][i]) / 2)) }
      return mid.get(key)!
    }
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]) }
    F = next
  }
  P = P.map(p => { const l = Math.hypot(...p); return [p[0] / l * r, p[1] / l * r + cy, p[2] / l * r] })
  return { positions: P.flat(), indices: F.flat() }
}
// Every edge used once in each direction: closed and consistently turned.
function closed(mesh: { indices: ArrayLike<number> }) {
  const edges = new Map<string, number>()
  for (let t = 0; t < mesh.indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = mesh.indices[t + k], b = mesh.indices[t + (k + 1) % 3]
    edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1)
  }
  for (const [key, uses] of edges) { const [a, b] = key.split('>'); if (uses !== 1 || edges.get(`${b}>${a}`) !== 1) return false }
  return true
}
const volume = (mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }) => {
  const P = mesh.positions, I = mesh.indices
  let v = 0
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
  }
  return v
}
const lowest = (P: ArrayLike<number>) => { let low = Infinity; for (let i = 1; i < P.length; i += 3) low = Math.min(low, P[i]); return low }

describe('flat cut', () => {
  it('cuts a cube flat and closes it with a cap facing down', () => {
    const cube = box(0, 0, 0, 10, 10, 10)
    const cut = cutFlat(cube.positions, cube.indices, 3)
    expect(closed(cut)).toBe(true)
    expect(lowest(cut.positions)).toBeCloseTo(3, 5)
    expect(volume(cut)).toBeCloseTo(700, 3)
    expect(cut.capArea).toBeCloseTo(100, 4)
  })

  it('keeps a sphere watertight, with a round base of the right size', () => {
    const ball = sphere(5, 5, 3)
    const cut = cutFlat(ball.positions, ball.indices, 1)
    expect(closed(cut)).toBe(true)
    expect(lowest(cut.positions)).toBeCloseTo(1, 5)
    // The cut circle is 3 units across at 4 below the middle: 9π, a little less on a polygon.
    expect(cut.capArea).toBeGreaterThan(0.95 * 9 * Math.PI)
    expect(cut.capArea).toBeLessThan(9 * Math.PI)
    expect(volume(cut)).toBeLessThan(volume(ball))
  })

  it('leaves a hole open: a ring gets a ring-shaped base', () => {
    const shape = ring()
    expect(closed(shape)).toBe(true)
    expect(volume(shape)).toBeCloseTo(84 * 10, 3)
    const cut = cutFlat(shape.positions, shape.indices, 4)
    expect(closed(cut)).toBe(true)
    expect(cut.capArea).toBeCloseTo(100 - 16, 4)
    expect(volume(cut)).toBeCloseTo(84 * 6, 3)
  })

  it('gives each of two parts its own base', () => {
    const two = join(box(0, 0, 0, 10, 10, 10), box(20, 2, 0, 30, 12, 10))
    const cut = cutFlat(two.positions, two.indices, 5)
    expect(closed(cut)).toBe(true)
    expect(cut.capArea).toBeCloseTo(200, 4)
  })

  it('rebuilds a face that already lies on the floor, and leaves a solid above the floor as it is', () => {
    const cube = box(0, 0, 0, 10, 10, 10)
    const onFloor = cutFlat(cube.positions, cube.indices, 0)
    expect(onFloor.indices).toEqual(Uint32Array.from(cube.indices))
    const shifted = box(0, 2, 0, 10, 12, 10)
    const atBottom = cutFlat(shifted.positions, shifted.indices, 2 + 1e-9)
    expect(closed(atBottom)).toBe(true)
    expect(volume(atBottom)).toBeCloseTo(1000, 3)
  })

  it('points each new vertex at a source vertex above the floor, for overlay colors', () => {
    const cube = box(0, 0, 0, 10, 10, 10)
    const cut = cutFlat(cube.positions, cube.indices, 3)
    for (let v = 0; v < cut.positions.length / 3; v++) expect(cube.positions[cut.origin[v] * 3 + 1]).toBeGreaterThan(3)
  })
})
