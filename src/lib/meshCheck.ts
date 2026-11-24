// Checks and fixes for closed meshes, used when a closed STL is uploaded (lib/upload) and by the tests.

// Edges that aren't used exactly once in each direction: 0 for a closed, consistently turned mesh.
export function edgeProblems(indices: ArrayLike<number>) {
  const directed = new Map<number, number>()
  let n = 0
  for (let i = 0; i < indices.length; i++) n = Math.max(n, indices[i] + 1)
  for (let f = 0; f < indices.length; f += 3) for (let j = 0; j < 3; j++) {
    const a = indices[f + j], b = indices[f + (j + 1) % 3]
    directed.set(a * n + b, (directed.get(a * n + b) ?? 0) + 1)
  }
  let problems = 0
  for (const [key, count] of directed) {
    const a = Math.floor(key / n), b = key % n
    if (count !== 1 || directed.get(b * n + a) !== 1) problems++
  }
  return problems
}

// Volume enclosed by a closed mesh: positive when its triangles face outward.
export function signedVolume(P: ArrayLike<number>, I: ArrayLike<number>) {
  let volume = 0
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3
    volume += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
      + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
  }
  return volume
}

// How a mesh's edges are shared: open edges have one face, and edges with more than two are where pieces meet along a line.
export function edgeUse(indices: ArrayLike<number>, vertices: number) {
  const faces = new Map<number, number[]>()
  for (let f = 0; f < indices.length / 3; f++) for (let k = 0; k < 3; k++) {
    const a = indices[f * 3 + k], b = indices[f * 3 + (k + 1) % 3], key = a < b ? a * vertices + b : b * vertices + a
    const list = faces.get(key)
    if (list) list.push(f); else faces.set(key, [f])
  }
  let open = 0, crowded = 0
  for (const list of faces.values()) { if (list.length === 1) open++; else if (list.length > 2) crowded++ }
  return { faces, open, crowded }
}

// Turns a closed mesh's faces so every edge is run once each way, and each piece faces outward. CAD exports sometimes
// turn a few faces the wrong way, which would make a solid that slicers read as inside out in places. Returns null when
// an edge isn't shared by exactly two faces, or when the faces can't agree (a one-sided surface).
export function orientClosed(positions: ArrayLike<number>, indices: ArrayLike<number>): Uint32Array<ArrayBuffer> | null {
  const I = Uint32Array.from(indices), faceCount = I.length / 3, n = positions.length / 3
  const { faces, open, crowded } = edgeUse(I, n)
  if (open || crowded) return null
  // turn[f]: 0 not reached yet, 1 kept as it is, -1 to be turned over.
  const turn = new Int8Array(faceCount)
  // Whether face f, as it will be turned, runs from a to b (1) or from b to a (-1).
  const runs = (f: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (I[f * 3 + k] === a && I[f * 3 + (k + 1) % 3] === b) return turn[f]
    return -turn[f]
  }
  const pieces: number[][] = []
  for (let start = 0; start < faceCount; start++) {
    if (turn[start]) continue
    turn[start] = 1
    const piece = [start], queue = [start]
    while (queue.length) {
      const f = queue.pop()!
      for (let k = 0; k < 3; k++) {
        const a = I[f * 3 + k], b = I[f * 3 + (k + 1) % 3], key = a < b ? a * n + b : b * n + a
        for (const g of faces.get(key)!) {
          if (g === f) continue
          const wanted = -runs(f, a, b)
          if (!turn[g]) {
            turn[g] = 1
            if (runs(g, a, b) !== wanted) turn[g] = -1
            piece.push(g); queue.push(g)
          } else if (runs(g, a, b) !== wanted) return null
        }
      }
    }
    pieces.push(piece)
  }
  for (let f = 0; f < faceCount; f++) if (turn[f] < 0) { const b = I[f * 3 + 1]; I[f * 3 + 1] = I[f * 3 + 2]; I[f * 3 + 2] = b }
  // Each piece faces out of the volume it encloses, or into it when it lies inside an odd number of other pieces, as the
  // inner wall of a sealed hollow does: turned outward, the hollow would print filled.
  const volumes = pieces.map(piece => {
    const part = new Uint32Array(piece.length * 3)
    piece.forEach((f, i) => part.set(I.subarray(f * 3, f * 3 + 3), i * 3))
    return signedVolume(positions, part)
  })
  pieces.forEach((piece, i) => {
    let depth = 0
    if (pieces.length > 1) {
      const f = piece[0] * 3, x = (positions[I[f] * 3] + positions[I[f + 1] * 3] + positions[I[f + 2] * 3]) / 3
      const y = (positions[I[f] * 3 + 1] + positions[I[f + 1] * 3 + 1] + positions[I[f + 2] * 3 + 1]) / 3
      const z = (positions[I[f] * 3 + 2] + positions[I[f + 1] * 3 + 2] + positions[I[f + 2] * 3 + 2]) / 3
      pieces.forEach((other, j) => { if (j !== i && inside(positions, I, other, x, y, z)) depth++ })
    }
    if ((volumes[i] < 0) !== (depth % 2 === 1)) for (const f of piece) { const b = I[f * 3 + 1]; I[f * 3 + 1] = I[f * 3 + 2]; I[f * 3 + 2] = b }
  })
  return I
}

// Whether a point is inside a closed piece: an odd number of its faces cross a ray from the point (Möller–Trumbore),
// cast in a skewed direction so it doesn't run along an edge.
function inside(P: ArrayLike<number>, I: ArrayLike<number>, piece: number[], x: number, y: number, z: number) {
  const dx = 0.5773, dy = 0.6123, dz = 0.5402
  let crossings = 0
  for (const f of piece) {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2]
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2]
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-15) continue
    const tx = x - P[a], ty = y - P[a + 1], tz = z - P[a + 2]
    const u = (tx * px + ty * py + tz * pz) / det
    if (u < 0 || u > 1) continue
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
    const v = (dx * qx + dy * qy + dz * qz) / det
    if (v < 0 || u + v > 1) continue
    if ((e2x * qx + e2y * qy + e2z * qz) / det > 0) crossings++
  }
  return crossings % 2 === 1
}
