import { type ReactNode, useEffect, useRef } from 'react'

// A modal dialog that takes focus, keeps Tab inside, and returns focus to where it was opened.
export function Modal({ role = 'dialog', labelledBy, describedBy, label, onClose, children }: {
  role?: 'dialog' | 'alertdialog'
  labelledBy?: string
  describedBy?: string
  label?: string
  onClose: () => void
  children: ReactNode
}) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Prefer the marked control, even when other buttons come first in the dialog.
    const first = card.current?.querySelector<HTMLElement>('[data-autofocus]') ?? card.current?.querySelector<HTMLElement>('button')
    first?.focus()
    return () => opener?.focus()
  }, [])
  const trapTab = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !card.current) return
    const items = [...card.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')]
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div className="help-backdrop" role="presentation" onClick={onClose}>
    <div ref={card} className="help-card" role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}
      aria-label={label} onKeyDown={trapTab} onClick={event => event.stopPropagation()}>
      {children}
    </div>
  </div>
}
