// Looks for places where a thickened wall crosses itself, off the page's thread: on a dense mesh this takes seconds.
import { solidCrossings } from './thicken'

self.onmessage = ({ data }: MessageEvent<{ positions: Float32Array; indices: Uint32Array; limit: number }>) => {
  self.postMessage(solidCrossings(data.positions, data.indices, data.limit))
}
