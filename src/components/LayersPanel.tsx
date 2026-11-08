import type { ReactNode } from 'react'
import { createLayer, LAYER_LABELS, timeFactor, type GrowthLayer, type LayerKind, type LayerTiming } from '../physics/growthLayers'
import { rangeFill } from '../lib/rangeFill'
import { rimName, type Tool } from '../lib/tools'

type Rim = { index: number; vertices: number[]; height: number }
type Props = {
  layers: GrowthLayer[]
  selectedId: string | null
  rims: Rim[]
  tool: Tool
  timelineEnd: number
  onSelect: (id: string) => void
  onChange: (layers: GrowthLayer[]) => void
  onTool: (tool: Tool) => void
  onPreviewRim: (index: number | null) => void
  onClearPaint: () => void
}

const percent = (value: number) => `${Math.round(value * 100)}%`

// What a layer covers, in a few words for its row, without repeating its name.
function layerSummary(layer: GrowthLayer, rims: Rim[]) {
  const parts: string[] = []
  if (layer.kind === 'rim') {
    if (!rims.length) return 'No open rims on this model'
    const where = rimName(rims, layer.rim)
    if (where !== layer.name) parts.push(where)
    parts.push(`${percent(layer.width)} wide`)
    if (layer.lobes) parts.push(`${layer.lobes} lobes`)
  } else if (layer.kind === 'point') parts.push(`Radius ${percent(layer.radius)}`)
  else if (layer.kind === 'line') parts.push(layer.points.length ? `${percent(layer.radius)} wide` : 'Not drawn yet')
  else if (layer.kind === 'height') parts.push(`${percent(layer.low)} to ${percent(layer.high)} of height`)
  else if (layer.kind === 'noise') parts.push(`Pattern ${layer.scale.toFixed(2)}`)
  else parts.push('Brush strokes')
  if (layer.timing.start) parts.push(`from step ${layer.timing.start}`)
  if (layer.timing.end !== null) parts.push(`until step ${layer.timing.end}`)
  return parts.join(' · ')
}
const ADDABLE: LayerKind[] = ['rim', 'point', 'line', 'height', 'noise']
// What each kind of layer does, shown on hover.
const LAYER_TIPS: Record<LayerKind, string> = {
  rim: 'Grows inward from an open rim, like a lettuce leaf edge. Lobes grow from spots around the rim instead.',
  paint: 'Growth you brush onto the model with Paint. Erase removes paint first, then blocks other layers.',
  point: 'A growing spot you place on the model, with a radius.',
  line: 'A band of growth along a line you draw on the model.',
  height: 'Growth that increases from one height of the starting shape to another.',
  noise: 'Organic variation on top of the other layers. It does not grow anything on its own.',
}

function Slider({ label, value, display, min, max, step, title, onChange, disabled }: {
  label: string; value: number; display: ReactNode; min: number; max: number; step: number; title?: string
  onChange: (value: number) => void; disabled?: boolean
}) {
  return <label data-tip={title}><span>{label} <b>{display}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={rangeFill(value, min, max)}
      onChange={event => onChange(event.currentTarget.valueAsNumber)} />
  </label>
}

function Falloff({ value, onChange }: { value: 'linear' | 'soft'; onChange: (value: 'linear' | 'soft') => void }) {
  return <div className="button-row compact" role="group" aria-label="Falloff">
    <button type="button" aria-pressed={value === 'linear'} data-tip="Growth fades evenly from the source to the edge of the field." onClick={() => onChange('linear')}>Even fade</button>
    <button type="button" aria-pressed={value === 'soft'} data-tip="Growth stays strong near the source and fades quickly at the edge." onClick={() => onChange('soft')}>Soft fade</button>
  </div>
}

// A small curve of the layer's intensity over the timeline.
function TimingCurve({ timing, end }: { timing: LayerTiming; end: number }) {
  const span = Math.max(end, timing.start + 100, ...timing.keys.map(key => key.step + 50), (timing.end ?? 0) + 50)
  const points = Array.from({ length: 61 }, (_, i) => {
    const step = span * i / 60
    return `${(i / 60 * 200).toFixed(1)},${(28 - timeFactor(timing, step) * 24).toFixed(1)}`
  }).join(' ')
  return <svg className="timing-curve" viewBox="0 0 200 32" role="img" aria-label="Layer intensity over the timeline">
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    <text x="0" y="31">0</text><text x="200" y="31" textAnchor="end">{Math.round(span)}</text>
  </svg>
}

function TimingEditor({ layer, end, update }: { layer: GrowthLayer; end: number; update: (patch: Partial<GrowthLayer>) => void }) {
  const { timing } = layer
  const set = (patch: Partial<LayerTiming>) => update({ timing: { ...timing, ...patch } })
  const number = (value: string) => Math.max(0, Math.round(Number(value) || 0))
  return <details className="layer-timing">
    <summary data-tip="Start, stop, or ramp this layer at points on the timeline.">Timing</summary>
    <div className="timing-row">
      <label data-tip="Timeline step when this layer starts growing.">Starts at step
        <input className="number-input" type="number" min="0" step="10" value={timing.start} onChange={event => set({ start: number(event.currentTarget.value) })} />
      </label>
      <label data-tip="Timeline step when this layer stops. Leave empty to keep growing.">Stops at step
        <input className="number-input" type="number" min="0" step="10" placeholder="Never" value={timing.end ?? ''}
          onChange={event => set({ end: event.currentTarget.value === '' ? null : number(event.currentTarget.value) })} />
      </label>
    </div>
    <p className="hint">Intensity keyframes ramp this layer up or down over time.</p>
    {timing.keys.map((key, i) => <div className="key-row" key={i}>
      <input className="number-input" type="number" min="0" step="10" aria-label={`Keyframe ${i + 1} step`} data-tip="Timeline step of this keyframe." value={key.step}
        onChange={event => set({ keys: timing.keys.map((k, j) => j === i ? { ...k, step: number(event.currentTarget.value) } : k) })} />
      <input type="range" min="0" max="1" step="0.05" aria-label={`Keyframe ${i + 1} intensity`} data-tip="Layer intensity at this step. Between keyframes it changes smoothly." value={key.value} style={rangeFill(key.value, 0, 1)}
        onChange={event => set({ keys: timing.keys.map((k, j) => j === i ? { ...k, value: event.currentTarget.valueAsNumber } : k) })} />
      <b>{percent(key.value)}</b>
      <button type="button" aria-label={`Remove keyframe ${i + 1}`} data-tip="Remove this keyframe." onClick={() => set({ keys: timing.keys.filter((_, j) => j !== i) })}>×</button>
    </div>)}
    <button type="button" className="wide" data-tip="Add a point on the timeline where this layer's intensity changes." onClick={() => {
      const last = timing.keys.at(-1)
      set({ keys: [...timing.keys, { step: last ? last.step + 100 : Math.max(timing.start, end), value: last ? 1 - last.value : 1 }] })
    }}>Add keyframe</button>
    <TimingCurve timing={timing} end={end} />
  </details>
}

export function LayersPanel(props: Props) {
  const { layers, selectedId, rims, tool, timelineEnd } = props
  const selected = layers.find(layer => layer.id === selectedId) ?? layers[0]
  const update = (id: string, patch: Partial<GrowthLayer>) =>
    props.onChange(layers.map(layer => layer.id === id ? { ...layer, ...patch } as GrowthLayer : layer))
  const add = (kind: LayerKind) => {
    const count = layers.filter(layer => layer.kind === kind).length
    const layer = createLayer(kind, { name: `${LAYER_LABELS[kind]}${count ? ` ${count + 1}` : ''}` })
    props.onChange([...layers.filter(l => l.kind !== 'paint'), layer, ...layers.filter(l => l.kind === 'paint')])
    props.onSelect(layer.id)
    if (kind === 'point') props.onTool('point')
    if (kind === 'line') props.onTool('line')
  }
  const remove = (id: string) => {
    const next = layers.filter(layer => layer.id !== id)
    props.onChange(next)
    props.onSelect(next[0]?.id)
  }
  return <section><h2>Growth layers</h2>
    <p className="hint">Each layer adds growth somewhere. Where layers overlap, the strongest wins. Erase and noise apply on top.</p>
    <ul className="layer-list" aria-label="Growth layers">
      {layers.map(layer => <li key={layer.id} className={[layer.id === selected?.id ? 'selected' : '', layer.kind === 'rim' && !rims.length ? 'inactive' : ''].filter(Boolean).join(' ') || undefined}
        onPointerEnter={() => layer.kind === 'rim' && props.onPreviewRim(layer.rim === 'all' ? -1 : layer.rim)}
        onPointerLeave={() => props.onPreviewRim(null)}>
        <button type="button" className="layer-eye" aria-pressed={layer.visible} aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
          data-tip={layer.visible ? 'Turn this layer off without deleting it.' : 'Turn this layer back on.'} onClick={() => update(layer.id, { visible: !layer.visible })}>
          <span className="switch" aria-hidden="true" />
        </button>
        <button type="button" className="layer-name" data-tip={`${layer.name}. ${LAYER_TIPS[layer.kind]}`} onClick={() => props.onSelect(layer.id)}>
          <span>{layer.name}</span>
          <small>{layerSummary(layer, rims)}</small>
        </button>
        <b data-tip={layer.kind === 'noise' ? 'Variation' : 'Strength'}>{percent(layer.strength)}</b>
      </li>)}
    </ul>
    <div className="add-layer" role="group" aria-labelledby="add-layer-label">
      <span id="add-layer-label">Add a layer</span>
      <div>
        {ADDABLE.map(kind => <button key={kind} type="button" disabled={kind === 'rim' && !rims.length}
          data-tip={kind === 'rim' && !rims.length ? 'This surface has no open rims.' : LAYER_TIPS[kind]}
          onClick={() => add(kind)}><span aria-hidden="true">+</span> {LAYER_LABELS[kind]}</button>)}
      </div>
    </div>

    {selected && <div className="layer-editor" aria-label={`${selected.name} settings`}>
      <label data-tip="Rename this layer.">Name<input className="number-input" value={selected.name} maxLength={40} onChange={event => update(selected.id, { name: event.currentTarget.value.slice(0, 40) })} /></label>
      <Slider label={selected.kind === 'noise' ? 'Variation' : 'Strength'} value={selected.strength} display={percent(selected.strength)}
        min={0} max={1} step={0.05} title={selected.kind === 'noise' ? 'How much the noise varies growth in other layers.' : 'How strongly this layer grows at its center.'}
        onChange={value => update(selected.id, { strength: value })} />

      {selected.kind === 'rim' && <>
        <label data-tip="Which open edge grows. On a vase, the upper and lower rims can grow separately.">Rim
          <select value={String(selected.rim)} onChange={event => update(selected.id, { rim: event.currentTarget.value === 'all' ? 'all' : Number(event.currentTarget.value) })}>
            <option value="all">{rimName(rims, 'all')}</option>
            {rims.length > 1 && rims.map(rim => <option key={rim.index} value={rim.index}>{rimName(rims, rim.index)}</option>)}
          </select>
        </label>
        <Slider label="Growth field width" value={selected.width} display={percent(selected.width)} min={0.03} max={0.8} step={0.01}
          title="How far growth reaches in from the rim, as a share of the model radius. Narrower fields make smaller, more numerous folds."
          onChange={value => update(selected.id, { width: value })} />
        <Slider label="Lobes" value={selected.lobes} display={selected.lobes ? selected.lobes : 'Whole rim'} min={0} max={12} step={1}
          title="Grow from evenly spaced spots around the rim instead of the whole rim."
          onChange={value => update(selected.id, { lobes: value })} />
        {selected.lobes > 0 && <Slider label="Lobe rotation" value={selected.phase} display={`${selected.phase}°`} min={0} max={359} step={1}
          title="Turn the lobes around the rim." onChange={value => update(selected.id, { phase: value })} />}
        <Falloff value={selected.falloff} onChange={falloff => update(selected.id, { falloff })} />
      </>}

      {selected.kind === 'point' && <>
        <button type="button" className={tool === 'point' ? 'wide primary' : 'wide'} onClick={() => props.onTool(tool === 'point' ? 'orbit' : 'point')}
          data-tip={tool === 'point' ? 'Finish placing.' : 'Click the model to move the growing spot there.'}>
          {tool === 'point' ? 'Click the model to place · Esc to finish' : 'Place on model'}
        </button>
        <Slider label="Radius" value={selected.radius} display={percent(selected.radius)} min={0.02} max={0.8} step={0.01}
          title="Size of the growing spot, as a share of the model radius." onChange={value => update(selected.id, { radius: value })} />
        <Falloff value={selected.falloff} onChange={falloff => update(selected.id, { falloff })} />
      </>}

      {selected.kind === 'line' && <>
        <button type="button" className={tool === 'line' ? 'wide primary' : 'wide'} onClick={() => props.onTool(tool === 'line' ? 'orbit' : 'line')}
          data-tip={tool === 'line' ? 'Finish drawing.' : 'Click points on the model to extend the line.'}>
          {tool === 'line' ? 'Click to add points · Esc to finish' : 'Draw on model'}
        </button>
        <p className="hint">{selected.points.length} {selected.points.length === 1 ? 'point' : 'points'}. Growth follows a band along the line.</p>
        <div className="button-row">
          <button type="button" disabled={!selected.points.length} data-tip="Remove the last point of the line." onClick={() => update(selected.id, { points: selected.points.slice(0, -1) })}>Remove last</button>
          <button type="button" disabled={!selected.points.length} data-tip="Remove every point and start the line again." onClick={() => update(selected.id, { points: [] })}>Clear line</button>
        </div>
        <Slider label="Band width" value={selected.radius} display={percent(selected.radius)} min={0.02} max={0.5} step={0.01}
          title="How far growth reaches on either side of the line." onChange={value => update(selected.id, { radius: value })} />
        <Falloff value={selected.falloff} onChange={falloff => update(selected.id, { falloff })} />
      </>}

      {selected.kind === 'height' && <>
        <Slider label="Starts at height" value={selected.low} display={percent(selected.low)} min={0} max={1} step={0.01}
          title="Height on the starting shape where growth begins, from bottom (0%) to top (100%)." onChange={value => update(selected.id, { low: value })} />
        <Slider label="Full growth at height" value={selected.high} display={percent(selected.high)} min={0} max={1} step={0.01}
          title="Height where growth reaches full strength. Set it below the start height to grow toward the bottom instead."
          onChange={value => update(selected.id, { high: value })} />
      </>}

      {selected.kind === 'noise' && <>
        <Slider label="Pattern size" value={selected.scale} display={selected.scale.toFixed(2)} min={0.03} max={1} step={0.01}
          title="Size of the noise blotches, as a share of the model radius." onChange={value => update(selected.id, { scale: value })} />
        <div className="button-row">
          <span className="hint" data-tip="The number that picks this random pattern. Saved with the project.">Seed {selected.seed}</span>
          <button type="button" data-tip="Try a different random pattern." onClick={() => update(selected.id, { seed: Math.floor(Math.random() * 10_000) })}>New pattern</button>
        </div>
      </>}

      {selected.kind === 'paint' && <>
        <p className="hint">Paint growth on the model with the brush tools above the 3D view. Erase removes paint first, then masks other layers.</p>
        <div className="button-row">
          <button type="button" className={tool === 'paint' ? 'primary' : undefined} data-tip={tool === 'paint' ? 'Go back to orbiting.' : 'Pick the Paint brush and brush growth onto the model.'} data-key="B"
            onClick={() => props.onTool(tool === 'paint' ? 'orbit' : 'paint')}>{tool === 'paint' ? 'Stop painting' : 'Paint on model'}</button>
          <button type="button" data-tip="Remove all paint and erase marks from the model." onClick={props.onClearPaint}>Clear paint</button>
        </div>
      </>}

      <TimingEditor layer={selected} end={timelineEnd} update={patch => update(selected.id, patch)} />
      {selected.kind !== 'paint' && <button type="button" className="wide danger" data-tip="Remove this layer. Its growth so far stays in the shape." onClick={() => remove(selected.id)}>Delete layer</button>}
    </div>}
  </section>
}
