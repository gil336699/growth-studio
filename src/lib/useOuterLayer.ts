// The outer layer of a closed surface, rebuilt in a worker whenever growth pauses or the layer thickness or flat base
// changes.
// While growth runs there is none; the 3D view previews it by pushing the sheet out along its normals instead.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Solid } from './thicken'
import type { OuterLayerRequest, OuterLayerResult } from './outerLayer.worker'

type Surface = { positions: Float32Array; indices: Uint32Array }
type Built = { key: string; solid: Solid | null; error: string }
type Waiting = { resolve: (data: OuterLayerResult | null) => void; preview: boolean }

const toSolid = (data: OuterLayerResult): Solid | null => 'error' in data ? null
  : { positions: data.positions, indices: data.indices, origin: data.origin, rimEdges: 0, smooth: true }

// cut is the flat base's height above the layer's lowest point, in model units, or 0 for none.
export function useOuterLayer(enabled: boolean, surface: Surface, revision: string, h: number, cut = 0) {
  const [built, setBuilt] = useState<Built>({ key: '', solid: null, error: '' })
  const worker = useRef<Worker | null>(null)
  const waiting = useRef(new Map<number, Waiting>())
  const nextId = useRef(0)
  const live = enabled && h > 0
  const key = `${revision}:${surface.indices.length}:${h}:${cut}`

  const stop = useCallback(() => {
    worker.current?.terminate()
    worker.current = null
    for (const { resolve } of waiting.current.values()) resolve(null)
    waiting.current.clear()
  }, [])
  // One worker at a time; each request waits for the answer with its own id. A new preview replaces an older preview
  // still being built, so dragging the thickness slider doesn't queue builds; an export always waits for its own.
  const send = useCallback((positions: Float32Array, indices: Uint32Array, thickness: number, base: number, preview: boolean) => new Promise<OuterLayerResult | null>(resolve => {
    if (preview && waiting.current.size && [...waiting.current.values()].every(entry => entry.preview)) stop()
    if (!worker.current) {
      const created = new Worker(new URL('./outerLayer.worker.ts', import.meta.url), { type: 'module' })
      created.onmessage = ({ data }: MessageEvent<OuterLayerResult>) => {
        waiting.current.get(data.id)?.resolve(data)
        waiting.current.delete(data.id)
      }
      created.onerror = event => {
        event.preventDefault()
        if (worker.current === created) stop()
      }
      worker.current = created
    }
    const id = ++nextId.current
    waiting.current.set(id, { resolve, preview })
    const request: OuterLayerRequest = { id, positions: positions.slice(), indices: indices.slice(), h: thickness, cut: base }
    worker.current.postMessage(request, [request.positions.buffer, request.indices.buffer])
  }), [stop])
  useEffect(() => stop, [stop])

  useEffect(() => {
    if (!live) return
    let cancelled = false
    // Deferred a little, so dragging the thickness slider builds once it rests.
    const timer = window.setTimeout(() => {
      void send(surface.positions, surface.indices, h, cut, true).then(data => {
        if (cancelled || !data) return
        setBuilt({ key, solid: toSolid(data), error: 'error' in data ? data.error : '' })
      })
    }, 150)
    return () => { cancelled = true; window.clearTimeout(timer) }
  // Positions change in place; the revision tracks them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, key, send])

  const current = live && built.key === key
  // For Export: the layer for the surface as it is now, built first if it isn't ready.
  const request = async (): Promise<Solid | null> => {
    if (current && built.solid) return built.solid
    if (!(h > 0)) return null
    const data = await send(surface.positions, surface.indices, h, cut, false)
    return data ? toSolid(data) : null
  }
  return { solid: current ? built.solid : null, building: live && !current, error: current ? built.error : '', request }
}
