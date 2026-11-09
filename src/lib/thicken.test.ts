import { describe, expect, it } from 'vitest'
import { createGrowingDisk } from '../physics/growingDisk'
import { facingSign, printScale, RIM_ROUNDNESS, rimProfile, solidCrossings, solidLeaks, thicken, type RimProfile } from './thicken'

// Every edge used by exactly two faces, once in each direction: closed, with faces turned consistently.
function openEdges(indices: Uint32Array) {
  const directed = new Map<string, number>()
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const key = `${indices[i + k]}:${indices[i + (k + 1) % 3]}`
      directed.set(key, (directed.get(key) ?? 0) + 1)
    }
  }
  let bad = 0
  for (const [key, count] of directed) {
    const [a, b] = key.split(':')
    if (count !== 1 || directed.get(`${b}:${a}`) !== 1) bad++
  }
  return bad
}
// Positive when the faces point outward.
function volume(positions: Float32Array, indices: Uint32Array) {
  let sum = 0
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map(v => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]])
    sum += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
  }
  return sum / 6
}
function area(positions: Float32Array, indices: Uint32Array) {
  let sum = 0
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map(v => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]])
    const u = b.map((value, k) => value - a[k]), w = c.map((value, k) => value - a[k])
    sum += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2
  }
  return sum
}
// The starting disk with its small ripple removed, so it is exactly flat.
const flat = () => {
  const disk = createGrowingDisk()
  const positions = disk.positions.slice()
  for (let v = 0; v < positions.length / 3; v++) positions[v * 3 + 1] = 0
  return { positions, indices: disk.indices.slice() }
}

describe('thicken', () => {
  it('traces each rim profile from the top face to the bottom face', () => {
    for (const roundness of [0, 0.5, 1]) {
      const points = rimProfile(0.5, roundness)
      expect(points[0][0]).toBeCloseTo(0)
      expect(points[0][1]).toBeCloseTo(0.5)
      expect(points.at(-1)![0]).toBeCloseTo(0)
      expect(points.at(-1)![1]).toBeCloseTo(-0.5)
      expect(Math.max(...points.map(([u]) => u))).toBeCloseTo(0.5 * roundness)
    }
    // A half-circle has no repeated middle point.
    expect(rimProfile(0.5, 1, 4)).toHaveLength(9)
  })

  it('closes a flat disk into a watertight solid for every rim profile', () => {
    const { positions, indices } = flat()
    for (const profile of Object.keys(RIM_ROUNDNESS) as RimProfile[]) {
      const solid = thicken(positions, indices, 0.05, RIM_ROUNDNESS[profile])
      expect(openEdges(solid.indices)).toBe(0)
      expect(volume(solid.positions, solid.indices)).toBeGreaterThan(0)
      expect(solid.rimEdges).toBeGreaterThan(20)
      expect(solidCrossings(solid.positions, solid.indices).pairs).toBe(0)
    }
  })

  it('gives a flat sheet with a square rim exactly its area times the thickness', () => {
    const { positions, indices } = flat()
    const solid = thicken(positions, indices, 0.05, 0)
    expect(volume(solid.positions, solid.indices)).toBeCloseTo(area(positions, indices) * 0.05, 6)
    const ys = Array.from({ length: solid.positions.length / 3 }, (_, v) => solid.positions[v * 3 + 1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.05, 6)
  })

  it('rounds the rim outward by half the thickness', () => {
    const { positions, indices } = flat()
    const reach = (points: Float32Array) => Math.max(...Array.from({ length: points.length / 3 }, (_, v) => Math.hypot(points[v * 3], points[v * 3 + 2])))
    const solid = thicken(positions, indices, 0.06, 1)
    expect(reach(solid.positions) - reach(positions)).toBeCloseTo(0.03, 3)
    // Every solid vertex remembers the surface vertex it came from.
    expect(Math.max(...solid.origin)).toBe(positions.length / 3 - 1)
  })

  it('thickens a grown, folded disk without leaks, and finds the wall crossing where it is too thick', () => {
    const disk = createGrowingDisk()
    for (let i = 0; i < 400; i++) disk.step(true)
    const thin = thicken(disk.positions, disk.indices, 0.01, 1)
    expect(openEdges(thin.indices)).toBe(0)
    expect(solidCrossings(thin.positions, thin.indices).pairs).toBe(0)
    // Far thicker than the folds are wide, so the wall must cross itself somewhere.
    const thick = thicken(disk.positions, disk.indices, 0.6, 1)
    const crossings = solidCrossings(thick.positions, thick.indices)
    expect(crossings.pairs).toBeGreaterThan(0)
    expect(crossings.vertices.every(v => v < thick.origin.length)).toBe(true)
  }, 60000)

  it('leaves a closed surface without rim edges', () => {
    // A tetrahedron with outward faces.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
    const solid = thicken(positions, indices, 0.05, 1)
    expect(solid.rimEdges).toBe(0)
    expect(openEdges(solid.indices)).toBe(0)
  })

  it('prints an STL in its own millimeters and scales the disk to the chosen longest side', () => {
    const positions = new Float32Array([-1, 0, -0.5, 1, 0.2, 0.5])
    expect(printScale(positions, 12.5, 100)).toBe(12.5)
    expect(printScale(positions, null, 100)).toBeCloseTo(50)
  })
})

it('stops counting crossings at the limit', () => {
  const disk = createGrowingDisk()
  for (let i = 0; i < 300; i++) disk.step(true)
  const solid = thicken(disk.positions, disk.indices, 0.6, 1)
  const capped = solidCrossings(solid.positions, solid.indices, 5)
  expect(capped).toMatchObject({ pairs: 5, capped: true })
  expect(solidCrossings(solid.positions, solid.indices).capped).toBe(false)
}, 60000)

it('puts the whole wall on one side when asked, keeping the surface as the other face', () => {
  const { positions, indices } = flat()
  const up = facingSign(positions, indices, 'up')
  const n = positions.length / 3
  const heights = (points: Float32Array) => Array.from({ length: points.length / 3 }, (_, v) => points[v * 3 + 1])
  for (const [shift, low, high] of [[up, 0, 0.05], [-up, -0.05, 0]] as const) {
    for (const roundness of [0, 1]) {
      const solid = thicken(positions, indices, 0.05, roundness, 4, shift)
      expect(openEdges(solid.indices)).toBe(0)
      expect(volume(solid.positions, solid.indices)).toBeGreaterThan(0)
      const ys = heights(solid.positions)
      expect(Math.min(...ys)).toBeCloseTo(low, 6)
      expect(Math.max(...ys)).toBeCloseTo(high, 6)
    }
    // With a square rim the solid is exactly the sheet's area times the wall, and one face is the sheet itself.
    const solid = thicken(positions, indices, 0.05, 0, 4, shift)
    expect(volume(solid.positions, solid.indices)).toBeCloseTo(area(positions, indices) * 0.05, 6)
    const kept = shift === up ? solid.positions.subarray(n * 3, n * 6) : solid.positions.subarray(0, n * 3)
    expect(Array.from(kept)).toEqual(Array.from(positions))
  }
})

it('tells which way the faces point', () => {
  // An open cylinder with faces turned outward.
  const segments = 16, positions: number[] = [], indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const angle = 2 * Math.PI * i / segments
    positions.push(Math.cos(angle), 0, Math.sin(angle), Math.cos(angle), 1, Math.sin(angle))
  }
  for (let i = 0; i < segments; i++) {
    const a0 = i * 2, a1 = a0 + 1, b0 = (i + 1) % segments * 2, b1 = b0 + 1
    indices.push(a0, a1, b0, b0, a1, b1)
  }
  expect(facingSign(positions, indices, 'outward')).toBe(1)
  const reversed = indices.map((_, i) => indices[i - i % 3 + 2 - i % 3])
  expect(facingSign(positions, reversed, 'outward')).toBe(-1)
  // Thickened outside, the cylinder only gets wider.
  const solid = thicken(positions, indices, 0.1, 0, 4, 1)
  const radii = Array.from({ length: solid.positions.length / 3 }, (_, v) => Math.hypot(solid.positions[v * 3], solid.positions[v * 3 + 2]))
  expect(Math.min(...radii)).toBeCloseTo(1, 6)
  expect(Math.max(...radii)).toBeGreaterThan(1.09)
  expect(openEdges(solid.indices)).toBe(0)
})

// A flat grid of quads in the xz plane, faces turned up.
function grid(size = 6) {
  const positions: number[] = [], indices: number[] = []
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) positions.push(x / size, 0, z / size)
  const at = (x: number, z: number) => z * (size + 1) + x
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) indices.push(at(x, z), at(x, z + 1), at(x + 1, z), at(x + 1, z), at(x, z + 1), at(x + 1, z + 1))
  return { positions, indices }
}

it('treats a nearly flat STL as a sheet, so Outside stays on the same side as it grows', () => {
  const { positions, indices } = grid()
  const up = facingSign(positions, indices, 'up')
  // A very shallow bowl: its faces tilt toward the middle, which read as facing in, though it is a sheet facing up.
  const bowl = positions.map((value, i) => i % 3 === 1 ? 0.02 * ((positions[i - 1] - 0.5) ** 2 + (positions[i + 1] - 0.5) ** 2) : value)
  expect(facingSign(bowl, indices, 'outward')).toBe(up)
})

it('reports a solid that is not closed', () => {
  const { positions, indices } = grid()
  expect(solidLeaks(thicken(positions, indices, 0.05, 1).indices)).toBe(0)
  // Two squares that touch at one corner only.
  const pinch = { positions: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 2, 0, 1, 2, 0, 2, 1, 0, 2], indices: [0, 3, 1, 1, 3, 2, 2, 6, 4, 4, 6, 5] }
  expect(solidLeaks(thicken(pinch.positions, pinch.indices, 0.05, 1).indices)).toBeGreaterThan(0)
  // Half the faces turned the other way.
  const flipped = indices.map((_, i) => i < indices.length / 2 ? indices[i - i % 3 + 2 - i % 3] : indices[i])
  expect(solidLeaks(thicken(positions, flipped, 0.05, 1).indices)).toBeGreaterThan(0)
})

it('keeps the rim round past a face with no area', () => {
  const { positions, indices } = grid()
  // A sliver on the z = 0 rim: its three corners lie on one line.
  const n = positions.length / 3
  positions.push(0.5 / 6, 0, 0)
  indices.push(0, 1, n)
  const solid = thicken(positions, indices, 0.1, 1)
  expect(solidLeaks(solid.indices)).toBe(0)
  const axis = (k: number) => Array.from({ length: solid.positions.length / 3 }, (_, v) => solid.positions[v * 3 + k])
  expect(Math.min(...axis(1))).toBeCloseTo(-0.05, 6)
  expect(Math.max(...axis(1))).toBeCloseTo(0.05, 6)
  // The rim still rounds out past z = 0 by half the wall, instead of folding flat into the sheet.
  expect(Math.min(...axis(2))).toBeCloseTo(-0.05, 3)
})

it('says more than the limit only when there are more', () => {
  const disk = createGrowingDisk()
  for (let i = 0; i < 300; i++) disk.step(true)
  const solid = thicken(disk.positions, disk.indices, 0.6, 1)
  const all = solidCrossings(solid.positions, solid.indices)
  expect(solidCrossings(solid.positions, solid.indices, all.pairs)).toMatchObject({ pairs: all.pairs, capped: false })
  expect(solidCrossings(solid.positions, solid.indices, all.pairs - 1)).toMatchObject({ pairs: all.pairs - 1, capped: true })
}, 60000)
