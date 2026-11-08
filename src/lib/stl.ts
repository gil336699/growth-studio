import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { HostModel } from '../types'
import { analyzeMeshTopology } from './meshTopology'

export class StlImportError extends Error {}

// Triangle count from the file size and header, without parsing: exact for binary STL, estimated for ASCII.
export function stlTriangleCount(buffer: ArrayBuffer) {
  if (buffer.byteLength >= 84) {
    const count = new DataView(buffer).getUint32(80, true)
    if (84 + count * 50 === buffer.byteLength) return count
  }
  return Math.round(buffer.byteLength / 250)
}

// Above this, preparing the surface can lock the browser; above the warning, each step takes seconds.
export const MAX_TRIANGLES = 500_000
export const SLOW_TRIANGLES = 30_000

export function prepareGeometry(source: BufferGeometry, fileName: string): HostModel & { sourceCenter: [number, number, number] } {
  const position = source.getAttribute('position')
  if (!position || position.count < 3 || position.count % 3 !== 0) {
    throw new StlImportError('This STL does not contain a valid triangle mesh.')
  }

  for (let index = 0; index < position.count; index += 1) {
    if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
      throw new StlImportError('This STL contains invalid vertex coordinates.')
    }
  }

  const geometry = toCreasedNormals(source.clone(), Math.PI / 3)
  geometry.computeBoundingBox()

  const bounds = geometry.boundingBox as Box3
  const dimensions = bounds.getSize(new Vector3())
  const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z)
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    geometry.dispose()
    throw new StlImportError('This STL has no measurable size.')
  }

  const center = bounds.getCenter(new Vector3())
  geometry.translate(-center.x, -center.y, -center.z)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const topology = analyzeMeshTopology(geometry)
  geometry.setAttribute('color', new BufferAttribute(topology.vertexColors, 3))
  return {
    fileName,
    geometry,
    dimensions,
    sourceCenter: center.toArray(),
    triangleCount: position.count / 3,
    radius: (geometry.boundingSphere as Sphere).radius,
    topology,
  }
}

export function parseStl(buffer: ArrayBuffer, fileName: string): HostModel & { sourceCenter: [number, number, number] } {
  try {
    return prepareGeometry(new STLLoader().parse(buffer), fileName)
  } catch (error) {
    if (error instanceof StlImportError) throw error
    throw new StlImportError('It could not be read as an STL mesh.')
  }
}

export function formatDimension(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (value >= 10) return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
