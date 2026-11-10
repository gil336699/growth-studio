import { useEffect, useRef, useState } from 'react'
import { drawThumbnail } from '../lib/thumbnail'
import type { VariantMessage, VariantRequest } from '../lib/variants.worker'
import type { DISK_DEFAULTS, DiskSnapshot } from '../physics/growingDisk'
import type { GrowthLayer } from '../physics/growthLayers'
import type { DiskSession } from '../lib/diskSession'

type Mechanics = typeof DISK_DEFAULTS
type Parameter = 'width' | 'bending' | 'growthRate' | 'repelDistance' | 'coreStiffness'
const PARAMETERS: Record<Parameter, { label: string; factors: number[]; format: (value: number) => string }> = {
  width: { label: 'Growth field width', factors: [0.5, 0.75, 1, 1.5], format: value => `${Math.round(value * 100)}%` },
  bending: { label: 'Bend stiffness', factors: [0.4, 0.7, 1, 1.6], format: value => `${(value * 100).toFixed(1)}%` },
  growthRate: { label: 'Growth rate', factors: [0.5, 0.75, 1, 1.5], format: value => `${(value * 100).toFixed(2)}%` },
  repelDistance: { label: 'Repel distance', factors: [0.6, 1, 1.6, 2.4], format: value => `${(value * 100).toFixed(1)}%` },
  coreStiffness: { label: 'Core firmness', factors: [0.5, 0.75, 1, 1.5], format: value => `${(value * 100).toFixed(2)}%` },
}
type Result = { value: number; label: string; done: number; snapshot?: DiskSnapshot; strain?: number; error?: string }

export function Variants({ disk, source, mechanics, layers, onUse }: {
  disk: DiskSession
  source: { positions: Float32Array; indices: Uint32Array } | null
  mechanics: Mechanics
  layers: GrowthLayer[]
  onUse: (snapshot: DiskSnapshot, mechanics: Mechanics, layers: GrowthLayer[]) => void
}) {
  const [parameter, setParameter] = useState<Parameter>('width')
  const [steps, setSteps] = useState(200)
  const [results, setResults] = useState<Result[]>([])
  const [settings, setSettings] = useState<{ mechanics: Mechanics; layers: GrowthLayer[] }[]>([])
  const workers = useRef<Worker[]>([])
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const rimLayers = layers.filter(layer => layer.kind === 'rim')
  // Width needs a rim layer and Core firmness a core; without them, vary Bend stiffness instead of four identical copies.
  const unavailable = (key: Parameter) => (key === 'width' && !rimLayers.length) || (key === 'coreStiffness' && !mechanics.coreStiffness)
  const effective: Parameter = unavailable(parameter) ? 'bending' : parameter
  const base = effective === 'width' ? rimLayers[0]?.kind === 'rim' ? rimLayers[0].width : 0.16 : mechanics[effective]
  const running = results.some(result => !result.snapshot && !result.error)
  useEffect(() => () => workers.current.forEach(worker => worker.terminate()), [])
  useEffect(() => {
    results.forEach((result, i) => {
      const canvas = canvases.current[i]
      if (canvas && result.snapshot) drawThumbnail(canvas, result.snapshot.positions, result.snapshot.indices, result.snapshot.field)
    })
  }, [results])

  const run = async () => {
    workers.current.forEach(worker => worker.terminate())
    const { snapshot } = await disk.requestSnap()
    const variants = PARAMETERS[effective].factors.map(factor => {
      const value = base * factor
      const nextLayers = effective === 'width'
        ? layers.map(layer => layer.kind === 'rim' ? { ...layer, width: Math.min(0.8, Math.max(0.03, layer.width * factor)) } : layer)
        : layers
      const nextMechanics = effective === 'width' ? mechanics : { ...mechanics, [effective]: value }
      return { value, layers: nextLayers, mechanics: nextMechanics }
    })
    setSettings(variants.map(({ mechanics, layers }) => ({ mechanics, layers })))
    setResults(variants.map(({ value }) => ({ value, label: PARAMETERS[effective].format(value), done: 0 })))
    workers.current = variants.map((variant, id) => {
      const worker = new Worker(new URL('../lib/variants.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }: MessageEvent<VariantMessage>) => setResults(current => current.map((result, i) => {
        if (i !== data.id) return result
        if (data.kind === 'progress') return { ...result, done: data.done }
        if (data.kind === 'done') { worker.terminate(); return { ...result, done: steps, snapshot: data.snapshot, strain: data.strain } }
        worker.terminate()
        return { ...result, error: data.message }
      }))
      worker.postMessage({ id, source, snapshot, mechanics: variant.mechanics, layers: variant.layers, steps } satisfies VariantRequest)
      return worker
    })
  }

  return <section><h2>Explore variants</h2>
    <p className="hint">Grow four versions from the current shape with one setting changed, then continue the one you like.</p>
    <label data-tip="Which setting changes between the four variants.">Vary
      <select value={effective} disabled={running} onChange={event => setParameter(event.currentTarget.value as Parameter)}>
        {(Object.keys(PARAMETERS) as Parameter[]).map(key => <option key={key} value={key} disabled={unavailable(key)}>{PARAMETERS[key].label}</option>)}
      </select>
    </label>
    <label data-tip="How long each variant grows. Longer shows more difference but takes more time.">Steps per variant
      <select value={steps} disabled={running} onChange={event => setSteps(Number(event.currentTarget.value))}>
        {[100, 200, 400].map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <button type="button" className="wide" disabled={running} onClick={() => void run()}
      data-tip="Grow four versions from the current shape in the background, each with the chosen setting changed.">{running ? 'Growing variants…' : 'Grow 4 variants'}</button>
    {results.length > 0 && <div className="variant-grid">
      {results.map((result, i) => <figure key={i} className="variant">
        <canvas ref={element => { canvases.current[i] = element }} width={150} height={120} aria-label={`Variant with ${PARAMETERS[effective].label} ${result.label}`} />
        <figcaption>
          <span>{result.label}</span>
          {result.error ? <small role="alert">{result.error}</small>
            : result.snapshot ? <button type="button" data-tip="Continue from this variant, with its settings." onClick={() => onUse(result.snapshot!, settings[i].mechanics, settings[i].layers)}>Use</button>
              : <small>{Math.round(result.done / steps * 100)}%</small>}
        </figcaption>
      </figure>)}
    </div>}
  </section>
}
