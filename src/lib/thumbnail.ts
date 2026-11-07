// Draws a small shaded preview of a mesh on a 2D canvas, viewed from above at an angle.
export function drawThumbnail(canvas: HTMLCanvasElement, positions: ArrayLike<number>, indices: ArrayLike<number>, field?: ArrayLike<number>) {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  // Transparent, so the thumbnail sits on the card behind it in light and dark mode.
  context.clearRect(0, 0, width, height)
  const count = positions.length / 3
  if (!count) return
  // Rotate 35 degrees down about X so the view matches the workspace camera.
  const tilt = 35 * Math.PI / 180, cos = Math.cos(tilt), sin = Math.sin(tilt)
  const projected = new Float32Array(count * 3)
  let cx = 0, cy = 0, cz = 0
  for (let v = 0; v < count; v++) { cx += positions[v * 3]; cy += positions[v * 3 + 1]; cz += positions[v * 3 + 2] }
  cx /= count; cy /= count; cz /= count
  let extent = 1e-6
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3] - cx, y = positions[v * 3 + 1] - cy, z = positions[v * 3 + 2] - cz
    projected[v * 3] = x
    projected[v * 3 + 1] = y * cos - z * sin
    projected[v * 3 + 2] = y * sin + z * cos
    extent = Math.max(extent, Math.abs(x), Math.abs(projected[v * 3 + 1]))
  }
  const scale = 0.44 * Math.min(width, height) / extent
  const faces: { depth: number; i: number }[] = []
  for (let i = 0; i < indices.length; i += 3) {
    faces.push({ depth: projected[indices[i] * 3 + 2] + projected[indices[i + 1] * 3 + 2] + projected[indices[i + 2] * 3 + 2], i })
  }
  faces.sort((a, b) => a.depth - b.depth)
  const light = [0.3, 0.8, 0.5]
  for (const { i } of faces) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]]
    const p = (v: number) => [projected[v * 3], projected[v * 3 + 1], projected[v * 3 + 2]]
    const pa = p(a), pb = p(b), pc = p(c)
    const u = pb.map((value, k) => value - pa[k]), w = pc.map((value, k) => value - pa[k])
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const length = Math.hypot(...n) || 1
    const shade = 0.35 + 0.65 * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / length)
    const heat = field ? (field[a] + field[b] + field[c]) / 3 : 0
    const r = Math.round((219 + (230 - 219) * heat) * shade), g = Math.round((227 + (60 - 227) * heat) * shade), bl = Math.round((222 + (55 - 222) * heat) * shade)
    context.fillStyle = `rgb(${r},${g},${bl})`
    context.beginPath()
    context.moveTo(width / 2 + pa[0] * scale, height / 2 - pa[1] * scale)
    context.lineTo(width / 2 + pb[0] * scale, height / 2 - pb[1] * scale)
    context.lineTo(width / 2 + pc[0] * scale, height / 2 - pc[1] * scale)
    context.closePath()
    context.fill()
  }
}
