// Checks a thickened solid off the page's thread, since on a dense mesh this takes seconds: is it closed, and
// where does the wall cross itself?
import { solidCrossings, solidLeaks } from './thicken'

self.onmessage = ({ data }: MessageEvent<{ positions: Float32Array; indices: Uint32Array; limit: number }>) => {
  self.postMessage({ leaks: solidLeaks(data.indices), ...solidCrossings(data.positions, data.indices, data.limit) })
}
