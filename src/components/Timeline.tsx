import { type ReactNode, useState } from 'react'
import type { Phase } from '../lib/diskProject'
import type { SnapshotMark } from '../lib/playback'
import { rangeFill } from '../lib/rangeFill'

type Props = {
  marks: SnapshotMark[]
  viewing: number | null
  step: number
  strain: number
  every: number
  active: boolean
  phases: Phase[]
  phaseIndex: number | null
  onScrub: (index: number | null) => void
  onSnapshot: () => void
  onEvery: (every: number) => void
  onPhases: (phases: Phase[]) => void
  onRunPhases: () => void
  // Playback buttons and status, shown at the start of the timeline like a media player.
  transport?: ReactNode
  status?: ReactNode
}

export function Timeline(props: Props) {
  const { marks, viewing, step, strain, every, active, phases, phaseIndex } = props
  const last = marks.length - 1
  const shown = viewing ?? last
  const span = Math.max(1, step, marks.at(-1)?.step ?? 1)
  const totalPhaseSteps = phases.reduce((sum, phase) => sum + phase.steps, 0)
  const [showPhases, setShowPhases] = useState(false)
  const viewingPast = viewing !== null && viewing < last
  return <section className="timeline glass" aria-labelledby="timeline-title">
    <h2 id="timeline-title" className="visually-hidden">Timeline</h2>
    <div className="timeline-head">
      {props.transport}
      <div className="timeline-status">{props.status}</div>
      <button type="button" className="phases-toggle" aria-expanded={showPhases} aria-controls="phase-editor"
        data-tip="Plan a recipe of grow and relax phases that plays in order." onClick={() => setShowPhases(!showPhases)}>
        Phases{phases.length ? ` · ${phases.length} · ${totalPhaseSteps}` : ''} <span className="chevron" aria-hidden="true">{showPhases ? '▾' : '▴'}</span>
      </button>
      {phases.length > 0 && <button type="button" className="primary phases-toggle" disabled={active} data-tip="Play the phases in order, then stop." onClick={props.onRunPhases}>Run phases</button>}
    </div>
    <svg className="timeline-marks" viewBox="0 0 1000 18" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="9" x2="1000" y2="9" />
      {marks.map((mark, i) => <rect key={i} x={mark.step / span * 990} y="3" width="10" height="12" rx="2"
        className={i === shown ? 'current' : undefined} />)}
    </svg>
    <div className="timeline-controls">
      <input type="range" min="0" max={Math.max(0, last)} step="1" value={Math.max(0, shown)} disabled={marks.length < 2 || active}
        style={rangeFill(Math.max(0, shown), 0, Math.max(1, last))}
        aria-label="Scrub snapshots" data-tip={marks.length < 2 ? 'Snapshots appear here as the model grows. Drag back to any of them.' : 'Drag to go back to an earlier snapshot. Play or step from there to branch.'}
        onChange={event => { const index = event.currentTarget.valueAsNumber; props.onScrub(index === last ? null : index) }} />
      <span className="timeline-readout" data-tip={`Timeline step and target strain. A snapshot is kept every ${every} steps.`}>{viewing !== null && marks[viewing]
        ? `${marks[viewing].step} · ${Math.round(marks[viewing].strain * 100)}%`
        : `${step} · ${Math.round(strain * 100)}%`}</span>
      <button type="button" disabled={active} onClick={props.onSnapshot} data-tip="Keep the current shape on the timeline so you can come back to it.">Snapshot</button>
      <select value={every} aria-label="Snapshot interval" data-tip="How often snapshots are kept automatically." onChange={event => props.onEvery(Number(event.currentTarget.value))}>
        {[20, 50, 100, 200].map(value => <option key={value} value={value}>Every {value}</option>)}
      </select>
    </div>
    {viewingPast && <p className="timeline-note">Viewing step {marks[viewing].step}. Play or step to continue from here; later snapshots will be replaced.</p>}
    {showPhases && <div className="phases" id="phase-editor">
      <p className="hint">A recipe of grow and relax phases. Run phases plays them in order, then stops.</p>
      <div className="phase-list">
        {phases.map((phase, i) => <div key={i} className="phase-chip">
          <select value={phase.mode} aria-label={`Phase ${i + 1} mode`} data-tip="Grow adds growth. Relax lets the shape settle." onChange={event => props.onPhases(phases.map((p, j) => j === i ? { ...p, mode: event.currentTarget.value as Phase['mode'] } : p))}>
            <option value="grow">Grow</option><option value="relax">Relax</option>
          </select>
          <input className="number-input" type="number" min="1" step="10" aria-label={`Phase ${i + 1} steps`} data-tip="How many steps this phase runs." value={phase.steps}
            onChange={event => props.onPhases(phases.map((p, j) => j === i ? { ...p, steps: Math.max(1, Math.round(Number(event.currentTarget.value) || 1)) } : p))} />
          <button type="button" aria-label={`Remove phase ${i + 1}`} data-tip="Remove this phase." onClick={() => props.onPhases(phases.filter((_, j) => j !== i))}>×</button>
          {phaseIndex === i && <b className="phase-now">now</b>}
        </div>)}
      </div>
      <button type="button" data-tip="Add a phase to the end of the recipe." onClick={() => props.onPhases([...phases, { mode: phases.at(-1)?.mode === 'grow' ? 'relax' : 'grow', steps: 100 }])}>Add phase</button>
    </div>}
  </section>
}
