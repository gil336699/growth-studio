import { Box3, BufferAttribute, BufferGeometry, Matrix4, Triangle, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

// Default contact response: surfaces stay this far apart (in model radii) and each step
// restores this fraction of any shortfall.
export const CONTACT_DEFAULTS = { distance: 0.012, strength: 0.85 }
// Separate response for the growth field. Contacts blend toward it by the largest field weight involved.
export type ContactSettings = { distance: number; strength: number; field: ArrayLike<number> }

export function createDiskSelfContact(positions: Float32Array, indices: Uint32Array, rest?: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const collisionIndices = indices.slice()
  geometry.setIndex(new BufferAttribute(collisionIndices, 1))
  const tree = new MeshBVH(geometry, { maxLeafTris: 4 })
  const identity = new Matrix4()
  const neighbors = Array.from({ length: positions.length / 3 }, (_, i) => new Set([i]))
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2]
    neighbors[a].add(b).add(c)
    neighbors[b].add(a).add(c)
    neighbors[c].add(a).add(b)
  }

  function intersects(refit = true) {
    if (refit) tree.refit()
    return tree.bvhcast(tree, identity, {
      intersectsTriangles(a, b, first, second) {
        if (first >= second) return false
        const i = first * 3
        const j = second * 3
        for (let u = 0; u < 3; u++) {
          for (let v = 0; v < 3; v++) {
            if (collisionIndices[i + u] === collisionIndices[j + v]) return false
          }
        }
        return a.intersectsTriangle(b)
      },
    })
  }

  let clearance = CONTACT_DEFAULTS.distance
  let settings: ContactSettings | undefined
  const response = (vertices: number[]) => {
    let weight = 0
    if (settings) for (const vertex of vertices) weight = Math.max(weight, settings.field[vertex] ?? 0)
    return {
      distance: CONTACT_DEFAULTS.distance + ((settings?.distance ?? CONTACT_DEFAULTS.distance) - CONTACT_DEFAULTS.distance) * weight,
      strength: CONTACT_DEFAULTS.strength + ((settings?.strength ?? CONTACT_DEFAULTS.strength) - CONTACT_DEFAULTS.strength) * weight,
    }
  }
  const query = new Box3(), point = new Vector3(), nearest = new Vector3()
  const weights = new Vector3(), direction = new Vector3(), priorDirection = new Vector3()
  const triangle = new Triangle(), restTriangle = new Triangle()
  const offsets = new Int32Array(neighbors.length).fill(-1)

  // Unique mesh edges, so crossing edges can be separated even when every corner is far away.
  const edgeIndex = new Map<string, number>()
  const edgeEnds: number[] = []
  const edgeKey = (u: number, v: number) => u < v ? `${u}:${v}` : `${v}:${u}`
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const u = indices[i + j], v = indices[i + (j + 1) % 3], key = edgeKey(u, v)
      if (edgeIndex.has(key)) continue
      edgeIndex.set(key, edgeEnds.length / 2)
      edgeEnds.push(u, v)
    }
  }
  const p1 = new Vector3(), q1 = new Vector3(), p2 = new Vector3(), q2 = new Vector3()
  const c1 = new Vector3(), c2 = new Vector3(), d1 = new Vector3(), d2 = new Vector3(), r = new Vector3()

  // Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9).
  function closestSegmentParameters(): [number, number] {
    d1.subVectors(q1, p1)
    d2.subVectors(q2, p2)
    r.subVectors(p1, p2)
    const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r)
    if (a < 1e-16 && e < 1e-16) return [0, 0]
    if (a < 1e-16) return [0, Math.min(1, Math.max(0, f / e))]
    const c = d1.dot(r)
    if (e < 1e-16) return [Math.min(1, Math.max(0, -c / a)), 0]
    const b = d1.dot(d2), denominator = a * e - b * b
    let s = denominator > 1e-16 ? Math.min(1, Math.max(0, (b * f - c * e) / denominator)) : 0
    let t = (b * s + f) / e
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
    else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)) }
    return [s, t]
  }
  const loadSegments = (source: Float32Array, e1: number, e2: number) => {
    p1.fromArray(source, edgeEnds[e1 * 2] * 3)
    q1.fromArray(source, edgeEnds[e1 * 2 + 1] * 3)
    p2.fromArray(source, edgeEnds[e2 * 2] * 3)
    q2.fromArray(source, edgeEnds[e2 * 2 + 1] * 3)
  }

  // Push apart nonlocal edges that come within clearance, keeping each pair on its last accepted side.
  function repelEdges(previous: Float32Array) {
    tree.refit()
    const pairs: number[] = []
    const edgeCount = edgeEnds.length / 2
    for (let e1 = 0; e1 < edgeCount; e1++) {
      const u = edgeEnds[e1 * 2], v = edgeEnds[e1 * 2 + 1]
      p1.fromArray(positions, u * 3)
      q1.fromArray(positions, v * 3)
      query.makeEmpty().expandByPoint(p1).expandByPoint(q1).expandByScalar(clearance)
      let best = clearance, partner = -1
      tree.shapecast({
        intersectsBounds: box => box.intersectsBox(query),
        intersectsTriangle(_face, index) {
          const offset = index * 3
          for (let j = 0; j < 3; j++) {
            const a = collisionIndices[offset + j], b = collisionIndices[offset + (j + 1) % 3]
            // Only edges that share an endpoint are skipped, so a sharp crease cannot fold through itself.
            if (a === u || a === v || b === u || b === v) continue
            const e2 = edgeIndex.get(edgeKey(a, b))!
            if (e2 <= e1) continue
            loadSegments(positions, e1, e2)
            const [s, t] = closestSegmentParameters()
            c1.copy(p1).addScaledVector(d1, s)
            c2.copy(p2).addScaledVector(d2, t)
            const distance = c1.distanceTo(c2)
            if (distance < best) { best = distance; partner = e2 }
          }
          return false
        },
      })
      if (partner >= 0) pairs.push(e1, partner)
    }

    let corrections = 0
    for (let i = 0; i < pairs.length; i += 2) {
      const e1 = pairs[i], e2 = pairs[i + 1]
      loadSegments(positions, e1, e2)
      const [s, t] = closestSegmentParameters()
      c1.copy(p1).addScaledVector(d1, s)
      c2.copy(p2).addScaledVector(d2, t)
      direction.subVectors(c1, c2)
      const distance = direction.length()
      const ends = [edgeEnds[e1 * 2], edgeEnds[e1 * 2 + 1], edgeEnds[e2 * 2], edgeEnds[e2 * 2 + 1]]
      const { distance: spacing, strength } = response(ends)
      let gap = spacing
      if (rest) {
        loadSegments(rest, e1, e2)
        const [restS, restT] = closestSegmentParameters()
        c1.copy(p1).addScaledVector(d1, restS)
        c2.copy(p2).addScaledVector(d2, restT)
        gap = Math.min(gap, 0.8 * c1.distanceTo(c2))
      }
      if (distance >= gap) continue
      loadSegments(previous, e1, e2)
      c1.copy(p1).lerp(q1, s)
      c2.copy(p2).lerp(q2, t)
      priorDirection.subVectors(c1, c2)
      const crossed = direction.dot(priorDirection) < 0
      if (distance < 1e-8) {
        if (priorDirection.lengthSq() < 1e-16) continue
        direction.copy(priorDirection).normalize()
      } else {
        direction.multiplyScalar((crossed ? -1 : 1) / distance)
      }
      const shares = [1 - s, s, -(1 - t), -t]
      const mass = shares.reduce((total, share) => total + share * share, 0)
      direction.multiplyScalar(strength * (gap + (crossed ? distance : -distance)) / mass)
      for (let k = 0; k < 4; k++) {
        for (let axis = 0; axis < 3; axis++) positions[ends[k] * 3 + axis] += direction.getComponent(axis) * shares[k]
      }
      corrections++
    }
    return corrections
  }

  // Find the closest nonlocal surface to each vertex. Collect pairs before
  // applying corrections so the BVH bounds stay valid throughout the queries.
  function repel(previous: Float32Array, contact?: ContactSettings) {
    settings = contact
    // Search far enough for whichever response is larger.
    clearance = Math.max(CONTACT_DEFAULTS.distance, contact?.distance ?? CONTACT_DEFAULTS.distance)
    tree.refit()
    offsets.fill(-1)
    for (let vertex = 0; vertex < neighbors.length; vertex++) {
      point.fromArray(positions, vertex * 3)
      query.min.copy(point).addScalar(-clearance)
      query.max.copy(point).addScalar(clearance)
      let closest = clearance ** 2
      tree.shapecast({
        intersectsBounds: box => box.intersectsBox(query),
        intersectsTriangle(face, index) {
          const offset = index * 3
          // Skip only the faces around this vertex. Faces one ring away can meet it at a sharp crease.
          if (collisionIndices[offset] === vertex || collisionIndices[offset + 1] === vertex
            || collisionIndices[offset + 2] === vertex) return false
          face.closestPointToPoint(point, nearest)
          const distance = point.distanceToSquared(nearest)
          if (distance < closest) {
            closest = distance
            offsets[vertex] = offset
          }
          return false
        },
      })
    }

    let corrections = 0
    for (let vertex = 0; vertex < offsets.length; vertex++) {
      const offset = offsets[vertex]
      if (offset < 0) continue
      const a = collisionIndices[offset] * 3, b = collisionIndices[offset + 1] * 3, c = collisionIndices[offset + 2] * 3
      const p = vertex * 3
      point.fromArray(positions, p)
      triangle.a.fromArray(positions, a)
      triangle.b.fromArray(positions, b)
      triangle.c.fromArray(positions, c)
      triangle.closestPointToPoint(point, nearest)
      if (!triangle.getBarycoord(nearest, weights)) continue
      const distance = direction.subVectors(point, nearest).length()
      const { distance: spacing, strength } = response([vertex, a / 3, b / 3, c / 3])
      let gap = spacing
      if (rest) {
        restTriangle.a.fromArray(rest, a)
        restTriangle.b.fromArray(rest, b)
        restTriangle.c.fromArray(rest, c)
        point.fromArray(rest, p)
        restTriangle.closestPointToPoint(point, nearest)
        gap = Math.min(gap, 0.8 * point.distanceTo(nearest))
      }
      if (distance >= gap) continue

      // Use the last accepted side when a small step crosses the surface.
      for (let axis = 0; axis < 3; axis++) {
        priorDirection.setComponent(axis, previous[p + axis] - weights.x * previous[a + axis]
          - weights.y * previous[b + axis] - weights.z * previous[c + axis])
      }
      const crossed = direction.dot(priorDirection) < 0
      if (distance < 1e-8) {
        if (priorDirection.lengthSq() < 1e-16) continue
        direction.copy(priorDirection).normalize()
      } else {
        direction.multiplyScalar((crossed ? -1 : 1) / distance)
      }
      direction.multiplyScalar(strength * (gap + (crossed ? distance : -distance)) / (1 + weights.lengthSq()))
      for (let axis = 0; axis < 3; axis++) {
        const correction = direction.getComponent(axis)
        positions[p + axis] += correction
        positions[a + axis] -= correction * weights.x
        positions[b + axis] -= correction * weights.y
        positions[c + axis] -= correction * weights.z
      }
      corrections++
    }
    return corrections + repelEdges(previous)
  }

  return Object.assign(intersects, { repel })
}
