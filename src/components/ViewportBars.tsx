import type { BrushSettings, DiskView, Overlay } from '../lib/diskProject'
import { rangeFill } from '../lib/rangeFill'
import type { Tool } from '../lib/tools'

type Props = {
  tool: Tool
  brush: BrushSettings
  canUndo: boolean
  overlay: Overlay
  view: DiskView
  ghost: boolean
  // What a point or line tool is placing, shown with a Done button.
  placing: string | null
  onTool: (tool: Tool) => void
  onBrush: (brush: BrushSettings) => void
  onUndo: () => void
  onOverlay: (overlay: Overlay) => void
  onView: (view: DiskView) => void
  onGhost: (ghost: boolean) => void
  onFrame: () => void
}

const TOOLS = [
  ['orbit', 'Orbit', 'O', 'Drag to turn the view, right-drag to pan, and scroll to zoom.'],
  ['paint', 'Paint', 'B', 'Brush growth onto the model. Works while it grows, and pen pressure sets strength.'],
  ['erase', 'Erase', 'E', 'Remove paint, then block other layers wherever you brush.'],
  ['smooth', 'Smooth', 'S', 'Soften the edges of painted growth.'],
] as const
const percent = (value: number) => `${Math.round(value * 100)}%`

function BarSlider({ label, value, display, min, max, step, title, shortcut, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; title: string; shortcut?: string
  onChange: (value: number) => void
}) {
  return <label className="bar-slider" data-tip={title} data-key={shortcut}><span>{label} <b>{display}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} style={rangeFill(value, min, max)} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
  </label>
}

// Floating controls over the 3D view: tools on the left and display options on the right, with brush settings below.
export function ViewportBars(props: Props) {
  const { tool, brush } = props
  const brushing = tool === 'paint' || tool === 'erase' || tool === 'smooth'
  const set = (patch: Partial<BrushSettings>) => props.onBrush({ ...brush, ...patch })
  return <div className="viewport-bars">
    <div className="viewport-bar-row">
      <div className="floating-bar glass" role="group" aria-label="Viewport tools">
        {TOOLS.map(([value, label, key, title]) => <button key={value} type="button" aria-pressed={tool === value} data-tip={title} data-key={key}
          onClick={() => props.onTool(value)}>{label}</button>)}
        <span className="bar-divider" aria-hidden="true" />
        <button type="button" disabled={!props.canUndo} aria-label="Undo brush stroke" data-key="⌘Z"
          data-tip={props.canUndo ? 'Undo the last brush stroke.' : 'No brush strokes to undo yet.'} onClick={props.onUndo}>Undo</button>
      </div>
      <div className="floating-bar glass view-bar" role="group" aria-label="Display">
        <label className="bar-select" data-key="G"
          data-tip="Color the model by where it grows now (Field), where it has grown (Grown), or where folds touched (Contact)."><span aria-hidden="true">Color</span>
          <select aria-label="Color overlay" value={props.overlay} onChange={event => props.onOverlay(event.currentTarget.value as Overlay)}>
            <option value="field">Field</option><option value="growth">Grown</option><option value="contact">Contact</option><option value="none">Plain</option>
          </select>
        </label>
        <label className="bar-select" data-key="1–4"
          data-tip="Show the surface smooth, as simulation triangles, as Voronoi cells, or as retriangulated cells."><span aria-hidden="true">Mesh</span>
          <select aria-label="Mesh view" value={props.view} onChange={event => props.onView(event.currentTarget.value as DiskView)}>
            <option value="smooth">Surface</option><option value="triangles">Triangles</option><option value="cells">Voronoi</option><option value="fans">Cell fans</option>
          </select>
        </label>
        <button type="button" aria-pressed={props.ghost} data-tip="Show the starting shape as a faint wireframe, to compare with the grown form." onClick={() => props.onGhost(!props.ghost)}>Ghost</button>
        <button type="button" data-tip="Fit the whole model in the view." data-key="F" onClick={props.onFrame}>Frame</button>
      </div>
    </div>
    {brushing && <div className="floating-bar glass brush-bar" role="group" aria-label="Brush settings">
      <BarSlider label="Size" value={brush.radius} display={percent(brush.radius)} min={0.02} max={0.6} step={0.01}
        title="Brush radius, as a share of the model radius." shortcut="[ ]" onChange={radius => set({ radius })} />
      <BarSlider label="Strength" value={brush.strength} display={percent(brush.strength)} min={0.05} max={1} step={0.05}
        title="How much growth one pass adds or removes. Pen pressure scales it." onChange={strength => set({ strength })} />
      <BarSlider label="Hardness" value={brush.hardness} display={percent(brush.hardness)} min={0} max={0.95} step={0.05}
        title="Soft brushes fade toward the edge. Hard brushes paint evenly to the inner ring." onChange={hardness => set({ hardness })} />
      <div className="bar-segment" role="group" aria-labelledby="symmetry-label">
        <span id="symmetry-label" data-tip="Repeat each stroke: mirrored across the vertical axis, or around it.">Symmetry</span>
        <div>
          {(['off', 'mirror', 'radial'] as const).map(value => <button key={value} type="button" aria-pressed={brush.symmetry === value}
            data-tip={value === 'off' ? 'Paint one place.' : value === 'mirror' ? 'Mirror strokes across the vertical axis.' : 'Repeat strokes around the vertical axis.'}
            onClick={() => set({ symmetry: value })}>{value === 'off' ? 'Off' : value === 'mirror' ? 'Mirror' : 'Radial'}</button>)}
        </div>
      </div>
      {brush.symmetry === 'radial' && <BarSlider label="Copies" value={brush.copies} display={String(brush.copies)} min={2} max={12} step={1}
        title="How many times a stroke repeats around the model." onChange={copies => set({ copies })} />}
    </div>}
    {props.placing && <div className="floating-bar glass placing-bar" role="group" aria-label="Placing">
      <span>{props.placing}</span>
      <button type="button" data-tip="Finish placing and go back to orbiting." data-key="Esc" onClick={() => props.onTool('orbit')}>Done</button>
    </div>}
  </div>
}
