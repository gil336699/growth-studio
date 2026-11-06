import type { BrushSettings } from './diskProject'

type Point = [number, number, number]

// The model's vertical axis: the center of its current bounding box in X and Z.
export function verticalAxis(positions: ArrayLike<number>): [number, number] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i])
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2])
  }
  return [(minX + maxX) / 2, (minZ + maxZ) / 2]
}

// The brush point plus its mirrored or radially repeated copies around the vertical axis.
export function symmetricPoints(point: Point, normal: Point, brush: BrushSettings, axis: [number, number]) {
  const [ax, az] = axis
  const copies: { point: Point; normal: Point }[] = [{ point, normal }]
  if (brush.symmetry === 'mirror') {
    copies.push({ point: [2 * ax - point[0], point[1], point[2]], normal: [-normal[0], normal[1], normal[2]] })
  } else if (brush.symmetry === 'radial') {
    for (let k = 1; k < brush.copies; k++) {
      const angle = 2 * Math.PI * k / brush.copies, c = Math.cos(angle), s = Math.sin(angle)
      const x = point[0] - ax, z = point[2] - az
      copies.push({
        point: [ax + x * c - z * s, point[1], az + x * s + z * c],
        normal: [normal[0] * c - normal[2] * s, normal[1], normal[0] * s + normal[2] * c],
      })
    }
  }
  return copies
}
