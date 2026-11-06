import { buildSurfaceVoronoi } from './surfaceVoronoi'

self.onmessage = ({ data }: MessageEvent<{ positions: Float32Array; indices: Uint32Array }>) => {
  self.postMessage(buildSurfaceVoronoi(data.positions, data.indices))
}
