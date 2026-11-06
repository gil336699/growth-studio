import type { Phase } from '../lib/diskProject'

export type SnapshotMark = { step: number; strain: number; size: number }
type Props = {
  marks: SnapshotMark[]
  viewing: number | null
  step: number
  every: number
  active: boolean
  phases: Phase[]
  phaseIndex: number | null
  onScrub: (index: number | null) => void
  onSnapshot: () => void
  onEvery: (every: number) => void
  onPhases: (phases: Phase[]) => void
  onRunPhases: () => void
}

export function Timeline(props: Props) {
  const { marks, viewing, step, every, active, phases, phaseIndex } = props
  const last = marks.length - 1
  const shown = viewing ?? last
  const span = Math.max(1, step, marks.at(-1)?.step ?? 1)
  const totalPhaseSteps = phases.reduce((sum, phase) => sum + phase.steps, 0)
  return <section className="timeline" aria-label="Timeline">
    <div className="timeline-head">
      <h2>Timeline</h2>
      <span className="hint">{viewing !== null && viewing < last
        ? `Viewing step ${marks[viewing].step}. Play or step to continue from here; later snapshots will be replaced.`
        : `Step ${step}. A snapshot is kept every ${every} steps.`}</span>
    </div>
    <svg className="timeline-marks" viewBox="0 0 1000 18" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="9" x2="1000" y2="9" />
      {marks.map((mark, i) => <rect key={i} x={mark.step / span * 990} y="3" width="10" height="12" rx="2"
        className={i === shown ? 'current' : undefined} />)}
    </svg>
    <div className="timeline-controls">
      <input type="range" min="0" max={Math.max(0, last)} step="1" value={Math.max(0, shown)} disabled={marks.length < 2 || active}
        aria-label="Scrub snapshots" title="Drag to go back to an earlier snapshot."
        onChange={event => { const index = event.currentTarget.valueAsNumber; props.onScrub(index === last ? null : index) }} />
      <span className="timeline-readout">{marks.length ? `${marks[Math.max(0, shown)].step} · ${Math.round(marks[Math.max(0, shown)].strain * 100)}%` : '—'}</span>
      <button type="button" disabled={active} onClick={props.onSnapshot} title="Keep the current shape as a snapshot.">Snapshot</button>
      <select value={every} aria-label="Snapshot interval" title="How often snapshots are kept automatically." onChange={event => props.onEvery(Number(event.currentTarget.value))}>
        {[20, 50, 100, 200].map(value => <option key={value} value={value}>Every {value}</option>)}
      </select>
    </div>
    <details className="phases">
      <summary>Phases {phases.length ? `· ${phases.length} · ${totalPhaseSteps} steps` : ''}</summary>
      <p className="hint">A recipe of grow and relax phases. Run phases plays them in order, then stops.</p>
      <div className="phase-list">
        {phases.map((phase, i) => <div key={i} className="phase-chip">
          <select value={phase.mode} aria-label={`Phase ${i + 1} mode`} onChange={event => props.onPhases(phases.map((p, j) => j === i ? { ...p, mode: event.currentTarget.value as Phase['mode'] } : p))}>
            <option value="grow">Grow</option><option value="relax">Relax</option>
          </select>
          <input className="number-input" type="number" min="1" step="10" aria-label={`Phase ${i + 1} steps`} value={phase.steps}
            onChange={event => props.onPhases(phases.map((p, j) => j === i ? { ...p, steps: Math.max(1, Math.round(Number(event.currentTarget.value) || 1)) } : p))} />
          <button type="button" aria-label={`Remove phase ${i + 1}`} onClick={() => props.onPhases(phases.filter((_, j) => j !== i))}>×</button>
          {phaseIndex === i && <b className="phase-now">now</b>}
        </div>)}
      </div>
      <div className="button-row">
        <button type="button" onClick={() => props.onPhases([...phases, { mode: phases.at(-1)?.mode === 'grow' ? 'relax' : 'grow', steps: 100 }])}>Add phase</button>
        <button type="button" className="primary" disabled={!phases.length || active} onClick={props.onRunPhases}>Run phases</button>
      </div>
    </details>
  </section>
}
