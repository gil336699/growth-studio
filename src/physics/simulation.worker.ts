// Runs the growth simulation off the page's thread, so drawing and orbiting stay smooth however long a step takes.
import { createSimulationRunner, type ToRunner } from './simulationRunner'

const runner = createSimulationRunner((message, transfer) => self.postMessage(message, { transfer }))
self.onmessage = ({ data }: MessageEvent<ToRunner>) => runner.handle(data)
