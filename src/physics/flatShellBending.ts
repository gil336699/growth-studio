import { Vector3 } from 'three'

// A flat rest configuration has a signed dihedral of zero at every hinge.
export function createFlatShellBending(indices: Uint32Array, rest?: Float32Array, pinned?: Uint8Array) {
  type Hinge = [number, number, number, number]
  const hinges: Hinge[] = []
  const pending = new Map<string, [number, number, number]>()
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3]
      const c = indices[i + (j + 2) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const other = pending.get(key)
      if (other) {
        hinges.push([...other, c])
        pending.delete(key)
      } else {
        pending.set(key, [a, b, c])
      }
    }
  }

  const origin = new Vector3(), edge = new Vector3()
  const ac = new Vector3(), ad = new Vector3()
  const left = new Vector3(), right = new Vector3(), cross = new Vector3()
  const ga = new Vector3(), gb = new Vector3()
  const gradients = [ga, gb, left, right]
  function measure(hinge: Hinge, positions: Float32Array) {
      const [a, b, c, d] = hinge
      origin.fromArray(positions, a * 3)
      edge.fromArray(positions, b * 3).sub(origin)
      ac.fromArray(positions, c * 3).sub(origin)
      ad.fromArray(positions, d * 3).sub(origin)
      left.crossVectors(edge, ac)
      right.crossVectors(ad, edge)
      const lengthSquared = edge.lengthSq()
      const leftSquared = left.lengthSq(), rightSquared = right.lengthSq()
      if (Math.min(lengthSquared, leftSquared, rightSquared) < 1e-16) return undefined
      const length = Math.sqrt(lengthSquared)
      const angle = Math.atan2(cross.crossVectors(left, right).dot(edge) / length, left.dot(right))
      return { angle, length, lengthSquared, leftSquared, rightSquared }
  }
  const restAngles = hinges.map(hinge => rest ? measure(hinge, rest)?.angle ?? 0 : 0)
  return (positions: Float32Array, stiffness: number) => {
    for (let i = 0; i < hinges.length; i++) {
      const hinge = hinges[i]
      const measured = measure(hinge, positions)
      if (!measured) continue
      const { angle, length, lengthSquared, leftSquared, rightSquared } = measured
      left.multiplyScalar(-length / leftSquared)
      right.multiplyScalar(-length / rightSquared)
      const tc = ac.dot(edge) / lengthSquared, td = ad.dot(edge) / lengthSquared
      gb.copy(left).multiplyScalar(-tc).addScaledVector(right, -td)
      ga.copy(left).multiplyScalar(tc - 1).addScaledVector(right, td - 1)
      const weight = gradients.reduce((sum, gradient, j) => sum + (pinned?.[hinge[j]] ? 0 : gradient.lengthSq()), 0)
      if (!weight) continue
      const delta = angle - restAngles[i]
      const correction = -stiffness * Math.atan2(Math.sin(delta), Math.cos(delta)) / weight
      for (let j = 0; j < 4; j++) {
        if (pinned?.[hinge[j]]) continue
        const offset = hinge[j] * 3, gradient = gradients[j]
        positions[offset] += correction * gradient.x
        positions[offset + 1] += correction * gradient.y
        positions[offset + 2] += correction * gradient.z
      }
    }
  }
}
