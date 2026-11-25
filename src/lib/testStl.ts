// Small STL files built in code, for tests: boxes, plates, balls and shapes of revolution, Z up as CAD writes them.

// A binary STL of triangles given as corner points, Z up as CAD writes them.
export function stl(triangles: number[][][]) {
  const buffer = new ArrayBuffer(84 + triangles.length * 50), view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  triangles.forEach((corners, f) => corners.forEach((point, k) => point.forEach((c, a) => view.setFloat32(84 + f * 50 + 12 + k * 12 + a * 4, c, true))))
  return buffer
}
// A closed box, x × y × z mm from (x0, 0, 0), with outward-facing triangles; turned lists faces to write inside out.
export function boxTriangles(x: number, y: number, z: number, x0 = 0, turned: number[] = []) {
  const p = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]].map(([a, b, c]) => [a + x0, b, c])
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  return faces.map((face, f) => (turned.includes(f) ? [face[0], face[2], face[1]] : face).map(v => p[v]))
}
// A closed ball: an octahedron split `levels` times and pushed out to a 20 mm sphere.
export function ballTriangles(levels: number) {
  let tris = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, -1, 0], [-1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, -1, 0], [0, 0, -1]]]
  const mid = (a: number[], b: number[]) => a.map((v, i) => (v + b[i]) / 2)
  for (let l = 0; l < levels; l++) tris = tris.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] })
  return tris.map(t => t.map(p => { const l = Math.hypot(...p); return p.map(v => 20 * v / l) }))
}
// A shape of revolution about the Z axis in `facets` facets, from a profile of (radius, height) points in mm: a profile
// that starts or ends on the axis is closed there by a fan, and one that doesn't is open there.
export function latheTriangles(profile: [number, number][], facets = 48) {
  const tris: number[][][] = [], at = (i: number, [rho, z]: [number, number]) => [rho * Math.cos(2 * Math.PI * i / facets), rho * Math.sin(2 * Math.PI * i / facets), z]
  for (let k = 0; k + 1 < profile.length; k++) {
    const p = profile[k], q = profile[k + 1]
    for (let i = 0; i < facets; i++) {
      if (p[0] === 0) tris.push([at(i, p), at(i + 1, q), at(i, q)])
      else if (q[0] === 0) tris.push([at(i, p), at(i + 1, p), at(i, q)])
      else tris.push([at(i, p), at(i + 1, p), at(i + 1, q)], [at(i, p), at(i + 1, q), at(i, q)])
    }
  }
  return tris
}
