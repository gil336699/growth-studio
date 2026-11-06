// OBJ and binary STL export in Z-up coordinates, matching CAD conventions.
export function exportObj(positions: Float32Array, indices: Uint32Array, name = 'growth-studio-sheet') {
  const lines = [`# Growth Studio static mesh`, `o ${name}`]
  for (let offset = 0; offset < positions.length; offset += 3) {
    const [x, y, z] = zUpVertex(positions, offset)
    lines.push(`v ${x.toFixed(7)} ${y.toFixed(7)} ${z.toFixed(7)}`)
  }
  for (let offset = 0; offset < indices.length; offset += 3) lines.push(`f ${indices[offset] + 1} ${indices[offset + 1] + 1} ${indices[offset + 2] + 1}`)
  return `${lines.join('\n')}\n`
}

function zUpVertex(positions: Float32Array, offset: number): [number, number, number] {
  return [positions[offset], -positions[offset + 2], positions[offset + 1]]
}

export function exportBinaryStl(positions: Float32Array, indices: Uint32Array, name = 'Growth Studio sheet') {
  const triangleCount = Math.floor(indices.length / 3)
  const buffer = new ArrayBuffer(84 + triangleCount * 50)
  const bytes = new Uint8Array(buffer)
  const header = new TextEncoder().encode(name.slice(0, 80))
  bytes.set(header, 0)
  const view = new DataView(buffer)
  view.setUint32(80, triangleCount, true)
  let cursor = 84
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = zUpVertex(positions, indices[triangle * 3] * 3)
    const b = zUpVertex(positions, indices[triangle * 3 + 1] * 3)
    const c = zUpVertex(positions, indices[triangle * 3 + 2] * 3)
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    const length = Math.hypot(...normal) || 1
    for (const value of normal) { view.setFloat32(cursor, value / length, true); cursor += 4 }
    for (const vertex of [a, b, c]) for (const value of vertex) { view.setFloat32(cursor, value, true); cursor += 4 }
    view.setUint16(cursor, 0, true)
    cursor += 2
  }
  return buffer
}
