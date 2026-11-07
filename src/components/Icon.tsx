// Small symbols for the playback controls, drawn to sit with text at 12–13 px.
const PATHS = {
  play: <path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  step: <path d="M5.5 6.6v10.8a1 1 0 0 0 1.55.83L14.5 13.3V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.7L7.05 5.77A1 1 0 0 0 5.5 6.6Z" />,
  reset: <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" />
  </g>,
}

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">{PATHS[name]}</svg>
}
