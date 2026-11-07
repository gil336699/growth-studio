import { expect, it } from 'vitest'
import { createDiskSelfContact } from './diskSelfContact'

// Triangle A lies in the z = 0 plane. Vertex 3 of triangle B hovers above A's interior at (0.3, 0.3).
// B's other vertices are far away, so only vertex 3 is within the contact clearance.
const faces = new Uint32Array([0, 1, 2, 3, 4, 5])
const build = (hover: number) => new Float32Array([
  0, 0, 0, 2, 0, 0, 0, 2, 0,
  0.3, 0.3, hover, 1.5, 0.3, 1, 0.3, 1.5, 1,
])
// Height of vertex 3 above triangle A's plane at its barycentric position.
const gap = (positions: Float32Array) =>
  positions[11] - (0.7 * positions[2] + 0.15 * positions[5] + 0.15 * positions[8])

it('leaves separated faces untouched', () => {
  const positions = build(0.5)
  const before = positions.slice()
  const contact = createDiskSelfContact(positions, faces)
  expect(contact.repel(before)).toBe(0)
  expect(positions).toEqual(before)
})

it('pushes a vertex that is within clearance of a nonadjacent face away from it', () => {
  const positions = build(0.005)
  const contact = createDiskSelfContact(positions, faces)
  const corrections = contact.repel(positions.slice())
  expect(corrections).toBeGreaterThan(0)
  expect(gap(positions)).toBeGreaterThan(0.005)
  expect(positions.every(Number.isFinite)).toBe(true)
})

it('returns a vertex to its last accepted side after a small step crosses the surface', () => {
  const previous = build(0.01)
  const positions = build(-0.002)
  const contact = createDiskSelfContact(positions, faces)
  expect(contact.repel(previous)).toBeGreaterThan(0)
  expect(gap(positions)).toBeGreaterThan(0)
})

it('does not push apart faces that were already close in the rest shape', () => {
  const positions = build(0.005)
  const rest = positions.slice()
  const contact = createDiskSelfContact(positions, faces, rest)
  expect(contact.repel(positions.slice())).toBe(0)
  expect(positions).toEqual(rest)
})

// Two separate triangles whose long edges pass close to each other while every corner stays far away.
const crossingFaces = new Uint32Array([0, 1, 2, 3, 4, 5])
const crossing = (height: number) => new Float32Array([
  -1, 0, 0, 1, 0, 0, 0, -1, -1,
  0, -1, height, 0, 1, height, 1, 0, 1,
])

it('pushes apart crossing edges when no corner is near the other face', () => {
  const positions = crossing(0.004)
  const contact = createDiskSelfContact(positions, crossingFaces)
  expect(contact.repel(positions.slice())).toBeGreaterThan(0)
  // Edge 0-1 runs along x at z = 0; edge 3-4 runs along y at the given height.
  const separation = (positions[11] + positions[14]) / 2 - (positions[2] + positions[5]) / 2
  expect(separation).toBeGreaterThan(0.004)
})

it('returns crossing edges to their last accepted side', () => {
  const previous = crossing(0.006)
  const positions = crossing(-0.002)
  const contact = createDiskSelfContact(positions, crossingFaces)
  expect(contact.repel(previous)).toBeGreaterThan(0)
  expect((positions[11] + positions[14]) / 2 - (positions[2] + positions[5]) / 2).toBeGreaterThan(0)
})

it('applies the growth-field contact settings only where the field is active', () => {
  // Vertex 3 hovers just outside the default distance.
  const settings = (field: number) => ({ distance: 0.03, strength: 1, field: [0, 0, 0, field, 0, 0] })
  const outside = build(0.015)
  expect(createDiskSelfContact(outside, faces).repel(outside.slice(), settings(0))).toBe(0)
  expect(gap(outside)).toBeCloseTo(0.015, 6)

  const inside = build(0.015)
  expect(createDiskSelfContact(inside, faces).repel(inside.slice(), settings(1))).toBeGreaterThan(0)
  expect(gap(inside)).toBeGreaterThan(0.025)
})

it('scales how much of the shortfall is restored by the growth-field strength', () => {
  const field = [0, 0, 0, 1, 0, 0]
  const weak = build(0.005), strong = build(0.005)
  createDiskSelfContact(weak, faces).repel(weak.slice(), { distance: 0.012, strength: 0.2, field })
  createDiskSelfContact(strong, faces).repel(strong.slice(), { distance: 0.012, strength: 1, field })
  expect(gap(weak)).toBeGreaterThan(0.005)
  expect(gap(strong)).toBeGreaterThan(gap(weak))
})

it('pushes a vertex off a face one ring away when a sharp crease folds onto it', () => {
  // Face 1-3-4 lies flat; vertex 0 shares an edge with vertex 1 and has folded down onto that face.
  const crease = new Uint32Array([0, 1, 2, 1, 3, 4])
  const positions = new Float32Array([0.3, 0.3, 0.005, 0, 0, 0, -1, -1, 1, 2, 0, 0, 0, 2, 0])
  const rest = new Float32Array([-0.3, -0.3, 0, 0, 0, 0, -1, -1, 1, 2, 0, 0, 0, 2, 0])
  const contact = createDiskSelfContact(positions, crease, rest)
  expect(contact.repel(positions.slice())).toBeGreaterThan(0)
  expect(positions[2]).toBeGreaterThan(0.005)
})

it('grows a surface that starts crossed once its existing crossings are ignored', async () => {
  const { createGrowingDisk } = await import('./growingDisk')
  // Two open square sheets that cut through each other.
  const square = (offset: number[], axis: 'y' | 'z') => {
    const p: number[] = []
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) p.push(offset[0] + u, offset[1] + (axis === 'y' ? v : 0), offset[2] + (axis === 'z' ? v : 0))
    return p
  }
  const positions = Float32Array.from([...square([0, 0, 0], 'z'), ...square([0, 0, 0], 'y')])
  const indices = Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7)
  const disk = createGrowingDisk({ positions, indices })
  expect(disk.initialOverlap).toBe(true)
  expect(disk.startingCrossings).toBeGreaterThan(0)
  expect(disk.ignoreStartingOverlaps()).toBeGreaterThan(0)
  expect(disk.initialOverlap).toBe(false)
  for (let i = 0; i < 25; i++) disk.step(true)
  expect(disk.strain).toBeGreaterThan(0)
  const reopened = createGrowingDisk({ positions, indices }, undefined, disk.snapshot())
  expect(reopened.initialOverlap).toBe(false)
  expect(reopened.ignoringOverlaps).toBe(true)
})
