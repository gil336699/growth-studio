// The outer layer of a closed surface, rebuilt in a worker whenever growth pauses or the layer thickness changes.
// While growth runs there is none; the 3D view previews it by pushing the sheet out along its normals instead.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Solid } from './thicken'
import type { OuterLayerRequest, OuterLayerResult } from './outerLayer.worker'

type Surface = { positions: Float32Array; indices: Uint32Array }
type Built = { key: string; solid: Solid | null; error: string }

const toSolid = (data: OuterLayerResult): Solid | null => 'error' in data ? null
  : { positions: data.positions, indices: data.indices, origin: data.origin, rimEdges: 0, smooth: true }

export function useOuterLayer(enabled: boolean, surface: Surface, revision: string, h: number) {
  const [built, setBuilt] = useState<Built>({ key: '', solid: null, error: '' })
  const worker = useRef<Worker | null>(null)
  const waiting = useRef(new Map<number, (data: OuterLayerResult | null) => void>())
  const nextId = useRef(0)
  const key = `${revision}:${surface.indices.length}:${h}`

  // One worker, kept while the page is open; each request waits for the answer with its own id.
  const send = useCallback((positions: Float32Array, indices: Uint32Array, thickness: number) => new Promise<OuterLayerResult | null>(resolve => {
    if (!worker.current) {
      const created = new Worker(new URL('./outerLayer.worker.ts', import.meta.url), { type: 'module' })
      created.onmessage = ({ data }: MessageEvent<OuterLayerResult>) => {
        waiting.current.get(data.id)?.(data)
        waiting.current.delete(data.id)
      }
      created.onerror = event => {
        event.preventDefault()
        created.terminate()
        if (worker.current === created) worker.current = null
        for (const done of waiting.current.values()) done(null)
        waiting.current.clear()
      }
      worker.current = created
    }
    const id = ++nextId.current
    waiting.current.set(id, resolve)
    const request: OuterLayerRequest = { id, positions: positions.slice(), indices: indices.slice(), h: thickness }
    worker.current.postMessage(request, [request.positions.buffer, request.indices.buffer])
  }), [])
  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // Deferred a little, so dragging the thickness slider builds once it rests.
    const timer = window.setTimeout(() => {
      void send(surface.positions, surface.indices, h).then(data => {
        if (cancelled) return
        setBuilt({ key, solid: data ? toSolid(data) : null, error: !data ? "The outer layer couldn't be built in this browser." : 'error' in data ? data.error : '' })
      })
    }, 150)
    return () => { cancelled = true; window.clearTimeout(timer) }
  // Positions change in place; the revision tracks them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, send])

  const current = enabled && built.key === key
  // For Export: the layer for the surface as it is now, built first if it isn't ready.
  const request = async (): Promise<Solid | null> => {
    if (current && built.solid) return built.solid
    const data = await send(surface.positions, surface.indices, h)
    return data ? toSolid(data) : null
  }
  return { solid: current ? built.solid : null, building: enabled && !current, error: current ? built.error : '', request }
}
