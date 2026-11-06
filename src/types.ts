import type { BufferGeometry, Vector3 } from 'three'
import type { MeshTopology } from './lib/meshTopology'

export type HostModel = {
  fileName: string
  geometry: BufferGeometry
  dimensions: Vector3
  triangleCount: number
  radius: number
  topology: MeshTopology
}
