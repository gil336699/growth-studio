import { BufferGeometry } from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { parseStl } from '../lib/stl'

// A starting shape made in brain mode: the built-in brain, or an uploaded STL rebuilt as a smooth, closed shape.
export type BrainInfo = { builtin: boolean; foldSize: 'fine' | 'medium' | 'broad'; smoothing?: 'light' | 'medium' | 'strong' }

export type GrowthStlSource = {
  name: string
  scale: number
  sourceCenter?: [number, number, number]
  positions: Float32Array<ArrayBuffer>
  indices: Uint32Array<ArrayBuffer>
  brain?: BrainInfo
}

export function readGrowthStl(buffer: ArrayBuffer, name: string): GrowthStlSource {
  const model = parseStl(buffer, name)
  const source = new BufferGeometry()
  try {
    source.setAttribute('position', model.geometry.getAttribute('position').clone())
    source.rotateX(-Math.PI / 2)
    source.scale(1 / model.radius, 1 / model.radius, 1 / model.radius)
    const welded = mergeVertices(source, 1e-6)
    const vertices = welded.getAttribute('position')
    const faces: number[] = []
    const seen = new Set<string>()
    const index = welded.getIndex()!
    for (let i = 0; i < index.count; i += 3) {
      const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      if (new Set(face).size !== 3) continue
      const key = [...face].sort((a, b) => a - b).join(':')
      if (seen.has(key)) continue
      seen.add(key)
      faces.push(...face)
    }
    const positions = Float32Array.from(vertices.array)
    welded.dispose()
    if (!faces.length) throw new Error('No usable surface triangles were found.')
    return { name, scale: model.radius, sourceCenter: model.sourceCenter, positions, indices: Uint32Array.from(faces) }
  } finally {
    source.dispose()
    model.geometry.dispose()
  }
}

export function growthExportPositions(positions: Float32Array, source: GrowthStlSource, centered: boolean) {
  let offset = [0, 0, 0]
  if (centered) {
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3
      low[axis] = Math.min(low[axis], positions[i])
      high[axis] = Math.max(high[axis], positions[i])
    }
    offset = low.map((min, axis) => -(min + high[axis]) * source.scale / 2)
  } else if (source.sourceCenter) {
    const [x, y, z] = source.sourceCenter
    // Translate in the solver's Y-up axes before the exporter converts to STL axes.
    offset = [x, z, -y]
  }
  return positions.map((value, i) => value * source.scale + offset[i % 3])
}
