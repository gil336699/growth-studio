import { type KeyboardEvent, type ReactNode, useRef } from 'react'

export type TabItem<T extends string> = { id: T; label: string; title?: string; badge?: string }

// A tab list that follows the ARIA tabs pattern: arrow keys, Home, and End move between tabs.
// Each tab controls the panel with id `${idBase}-${tab.id}`.
export function Tabs<T extends string>({ label, idBase, tabs, value, onChange }: {
  label: string; idBase: string; tabs: TabItem<T>[]; value: T; onChange: (value: T) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const onKey = (event: KeyboardEvent) => {
    const i = tabs.findIndex(tab => tab.id === value)
    const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    onChange(tabs[next].id)
    list.current?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus()
  }
  return <div ref={list} className="tab-list" role="tablist" aria-label={label} onKeyDown={onKey}>
    {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${idBase}-${tab.id}-tab`} aria-controls={`${idBase}-${tab.id}`}
      aria-selected={tab.id === value} tabIndex={tab.id === value ? 0 : -1} data-tip={tab.title} onClick={() => onChange(tab.id)}>
      {tab.label}
      {tab.badge && <><span className="tab-badge" aria-hidden="true" /><span className="visually-hidden">, {tab.badge}</span></>}
    </button>)}
  </div>
}

// Inactive panels stay mounted so open sections and scroll position survive switching tabs.
export function TabPanel({ idBase, id, value, children }: { idBase: string; id: string; value: string; children: ReactNode }) {
  return <div role="tabpanel" id={`${idBase}-${id}`} aria-labelledby={`${idBase}-${id}-tab`} hidden={id !== value} className="tab-panel">
    {children}
  </div>
}
