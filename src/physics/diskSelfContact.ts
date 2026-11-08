import { Box3, BufferAttribute, BufferGeometry, Matrix4, Triangle, Vector3 } from 'three'
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh'

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

  // Vertices where the starting surface already crossed itself. Faces touching them are not
  // checked against each other, so only new crossings block a step.
  let exempt: Uint8Array | null = null
  const exemptFace = (offset: number) => Boolean(exempt && (exempt[collisionIndices[offset]]
    || exempt[collisionIndices[offset + 1]] || exempt[collisionIndices[offset + 2]]))
  const sharesVertex = (i: number, j: number) => {
    for (let u = 0; u < 3; u++) {
      for (let v = 0; v < 3; v++) {
        if (collisionIndices[i + u] === collisionIndices[j + v]) return true
      }
    }
    return false
  }

  // True when two faces' bounding boxes are apart by more than a small rounding margin, so they cannot cross.
  const boundsApart = (i: number, j: number, margin: number) => {
    for (let axis = 0; axis < 3; axis++) {
      const a0 = positions[collisionIndices[i] * 3 + axis], a1 = positions[collisionIndices[i + 1] * 3 + axis]
      const a2 = positions[collisionIndices[i + 2] * 3 + axis]
      const b0 = positions[collisionIndices[j] * 3 + axis], b1 = positions[collisionIndices[j + 1] * 3 + axis]
      const b2 = positions[collisionIndices[j + 2] * 3 + axis]
      if (Math.min(a0, a1, a2) > Math.max(b0, b1, b2) + margin || Math.min(b0, b1, b2) > Math.max(a0, a1, a2) + margin) return true
    }
    return false
  }
  const first = new ExtendedTriangle(), second = new ExtendedTriangle()
  const loadFace = (target: ExtendedTriangle, offset: number) => {
    target.a.fromArray(positions, collisionIndices[offset] * 3)
    target.b.fromArray(positions, collisionIndices[offset + 1] * 3)
    target.c.fromArray(positions, collisionIndices[offset + 2] * 3)
    target.needsUpdate = true
  }

  // True if any two nonadjacent faces cross. Faces are read straight from the index, and a face is built
  // for the exact test only after the cheap checks, instead of for every pair in overlapping leaves.
  function intersects(refit = true) {
    if (refit) tree.refit()
    const margin = clearance * 1e-3
    return tree.bvhcast(tree, identity, {
      intersectsRanges(offset1, count1, offset2, count2) {
        for (let face2 = offset2; face2 < offset2 + count2; face2++) {
          const j = face2 * 3
          let loaded = false
          for (let face1 = offset1; face1 < offset1 + count1; face1++) {
            if (face1 >= face2) continue
            const i = face1 * 3
            if (sharesVertex(i, j) || (exempt && exemptFace(i) && exemptFace(j)) || boundsApart(i, j, margin)) continue
            if (!loaded) { loadFace(second, j); loaded = true }
            loadFace(first, i)
            if (first.intersectsTriangle(second)) return true
          }
        }
        return false
      },
    })
  }

  // Every crossing pair, and the vertices of the faces involved.
  function crossings() {
    tree.refit()
    const vertices = new Set<number>()
    let pairs = 0
    tree.bvhcast(tree, identity, {
      intersectsTriangles(a, b, first, second) {
        const i = first * 3, j = second * 3
        if (first >= second || sharesVertex(i, j) || !a.intersectsTriangle(b)) return false
        pairs++
        for (let k = 0; k < 3; k++) { vertices.add(collisionIndices[i + k]); vertices.add(collisionIndices[j + k]) }
        return false
      },
    })
    return { pairs, vertices: [...vertices] }
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
  // The edge number of each triangle side, in the BVH's triangle order, so the edge search needs no lookups.
  const faceEdges = new Int32Array(collisionIndices.length)
  for (let i = 0; i < collisionIndices.length; i += 3) {
    for (let j = 0; j < 3; j++) faceEdges[i + j] = edgeIndex.get(edgeKey(collisionIndices[i + j], collisionIndices[i + (j + 1) % 3]))!
  }
  // Each edge borders two triangles, so a search meets it twice. A stamp per search measures it once.
  const edgeStamp = new Uint32Array(edgeEnds.length / 2)
  let stamp = 0
  const p1 = new Vector3(), q1 = new Vector3(), p2 = new Vector3(), q2 = new Vector3()
  const c1 = new Vector3(), c2 = new Vector3(), d1 = new Vector3(), d2 = new Vector3(), r = new Vector3()

  // Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9).
  // Writes the parameters to segmentS and segmentT, so the hot loop allocates nothing.
  let segmentS = 0, segmentT = 0
  function closestSegmentParameters() {
    d1.subVectors(q1, p1)
    d2.subVectors(q2, p2)
    r.subVectors(p1, p2)
    const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r)
    if (a < 1e-16 && e < 1e-16) { segmentS = 0; segmentT = 0; return }
    if (a < 1e-16) { segmentS = 0; segmentT = Math.min(1, Math.max(0, f / e)); return }
    const c = d1.dot(r)
    if (e < 1e-16) { segmentS = Math.min(1, Math.max(0, -c / a)); segmentT = 0; return }
    const b = d1.dot(d2), denominator = a * e - b * b
    let s = denominator > 1e-16 ? Math.min(1, Math.max(0, (b * f - c * e) / denominator)) : 0
    let t = (b * s + f) / e
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
    else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)) }
    segmentS = s
    segmentT = t
  }
  const loadSegments = (source: Float32Array, e1: number, e2: number) => {
    p1.fromArray(source, edgeEnds[e1 * 2] * 3)
    q1.fromArray(source, edgeEnds[e1 * 2 + 1] * 3)
    p2.fromArray(source, edgeEnds[e2 * 2] * 3)
    q2.fromArray(source, edgeEnds[e2 * 2 + 1] * 3)
  }

  // Push apart nonlocal edges that come within clearance, keeping each pair on its last accepted side.
  function repelEdges(previous: Float32Array, touched?: Uint8Array, active?: Uint8Array) {
    tree.refit()
    const pairs: number[] = []
    const edgeCount = edgeEnds.length / 2
    for (let e1 = 0; e1 < edgeCount; e1++) {
      const u = edgeEnds[e1 * 2], v = edgeEnds[e1 * 2 + 1]
      if (active && !active[u] && !active[v]) continue
      p1.fromArray(positions, u * 3)
      q1.fromArray(positions, v * 3)
      query.makeEmpty().expandByPoint(p1).expandByPoint(q1).expandByScalar(clearance)
      // An edge entirely outside this box, with a small margin for rounding, is farther than clearance.
      const margin = clearance * 1e-3
      const minX = query.min.x - margin, minY = query.min.y - margin, minZ = query.min.z - margin
      const maxX = query.max.x + margin, maxY = query.max.y + margin, maxZ = query.max.z + margin
      if (++stamp === 0xffffffff) { edgeStamp.fill(0); stamp = 1 }
      let best = clearance, partner = -1
      tree.shapecast({
        intersectsBounds: box => box.intersectsBox(query),
        // Reads triangles straight from the index, without building a triangle object for each one.
        intersectsRange(first, count) {
          for (let offset = first * 3, end = (first + count) * 3; offset < end; offset += 3) {
            for (let j = 0; j < 3; j++) {
              const a = collisionIndices[offset + j], b = collisionIndices[offset + (j + 1) % 3]
              // Only edges that share an endpoint are skipped, so a sharp crease cannot fold through itself.
              if (a === u || a === v || b === u || b === v) continue
              const e2 = faceEdges[offset + j]
              // Each pair is found from its lower edge, unless that edge is skipped as inactive.
              if (e2 <= e1 && (!active || active[a] || active[b])) continue
              if (edgeStamp[e2] === stamp) continue
              edgeStamp[e2] = stamp
              const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
              const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
              if ((ax < minX && bx < minX) || (ax > maxX && bx > maxX) || (ay < minY && by < minY)
                || (ay > maxY && by > maxY) || (az < minZ && bz < minZ) || (az > maxZ && bz > maxZ)) continue
              loadSegments(positions, e1, e2)
              closestSegmentParameters()
              c1.copy(p1).addScaledVector(d1, segmentS)
              c2.copy(p2).addScaledVector(d2, segmentT)
              const distance = c1.distanceTo(c2)
              if (distance < best) { best = distance; partner = e2 }
            }
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
      closestSegmentParameters()
      const s = segmentS, t = segmentT
      c1.copy(p1).addScaledVector(d1, s)
      c2.copy(p2).addScaledVector(d2, t)
      direction.subVectors(c1, c2)
      const distance = direction.length()
      const ends = [edgeEnds[e1 * 2], edgeEnds[e1 * 2 + 1], edgeEnds[e2 * 2], edgeEnds[e2 * 2 + 1]]
      const { distance: spacing, strength } = response(ends)
      let gap = spacing
      if (rest) {
        loadSegments(rest, e1, e2)
        closestSegmentParameters()
        const restS = segmentS, restT = segmentT
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
        if (touched) touched[ends[k]] = 1
      }
      corrections++
    }
    return corrections
  }

  // Find the closest nonlocal surface to each vertex. Collect pairs before
  // applying corrections so the BVH bounds stay valid throughout the queries.
  // Optionally marks every vertex moved by a correction in `touched`.
  // With `active`, only vertices that can move into contact are searched: large still regions are skipped.
  function repel(previous: Float32Array, contact?: ContactSettings, touched?: Uint8Array, active?: Uint8Array) {
    settings = contact
    // Search far enough for whichever response is larger.
    clearance = Math.max(CONTACT_DEFAULTS.distance, contact?.distance ?? CONTACT_DEFAULTS.distance)
    tree.refit()
    offsets.fill(-1)
    for (let vertex = 0; vertex < neighbors.length; vertex++) {
      if (active && !active[vertex]) continue
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
      if (touched) touched[vertex] = touched[a / 3] = touched[b / 3] = touched[c / 3] = 1
      corrections++
    }
    return corrections + repelEdges(previous, touched, active)
  }

  return Object.assign(intersects, { repel, crossings, setExempt(next: Uint8Array | null) { exempt = next } })
}
