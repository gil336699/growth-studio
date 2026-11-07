import { useEffect } from 'react'

const SHOW_DELAY = 350
// After a tooltip closes, moving straight to another control shows its tooltip at once.
const WARM_WINDOW = 500

// One tooltip for the whole app. Any element with a data-tip attribute shows it on hover, after a short delay,
// or right away on keyboard focus. data-key adds a shortcut chip. While a tooltip is shown, the focused or hovered
// control is linked to it with aria-describedby, so screen readers announce the description too.
export function TooltipLayer() {
  useEffect(() => {
    const tip = document.createElement('div')
    tip.id = 'app-tooltip'
    tip.setAttribute('role', 'tooltip')
    tip.className = 'app-tooltip'
    tip.hidden = true
    const text = document.createElement('span')
    const key = document.createElement('kbd')
    tip.append(text, key)
    document.body.append(tip)

    let anchor: HTMLElement | null = null
    let described: HTMLElement | null = null
    let previousDescribedBy: string | null = null
    let timer = 0
    let warmUntil = 0
    let mode: 'hover' | 'focus' = 'hover'

    const unlink = () => {
      if (!described) return
      if (previousDescribedBy) described.setAttribute('aria-describedby', previousDescribedBy)
      else described.removeAttribute('aria-describedby')
      described = null
    }
    const hide = () => {
      window.clearTimeout(timer)
      if (anchor) warmUntil = Date.now() + WARM_WINDOW
      anchor = null
      unlink()
      tip.hidden = true
      tip.classList.remove('visible')
    }
    const place = (element: HTMLElement) => {
      const box = element.getBoundingClientRect()
      tip.hidden = false
      tip.style.transform = 'translate(-9999px, 0)'
      const size = tip.getBoundingClientRect()
      const below = box.bottom + 8
      const top = below + size.height > window.innerHeight - 8 ? Math.max(8, box.top - size.height - 8) : below
      const left = Math.min(Math.max(8, box.left + box.width / 2 - size.width / 2), window.innerWidth - size.width - 8)
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    }
    const show = (element: HTMLElement, describe: HTMLElement, how: typeof mode) => {
      const description = element.dataset.tip
      if (!description || !element.isConnected) return
      anchor = element
      mode = how
      text.textContent = description
      key.textContent = element.dataset.key ?? ''
      key.hidden = !element.dataset.key
      unlink()
      described = describe
      previousDescribedBy = describe.getAttribute('aria-describedby')
      describe.setAttribute('aria-describedby', previousDescribedBy ? `${previousDescribedBy} app-tooltip` : 'app-tooltip')
      place(element)
      tip.classList.add('visible')
    }
    const tipOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null

    const onOver = (event: PointerEvent) => {
      // No tooltips for touch, or while dragging a slider or brushing.
      if (event.pointerType === 'touch' || event.buttons !== 0) return
      const element = tipOf(event.target)
      if (element === anchor) return
      window.clearTimeout(timer)
      // A tooltip opened by keyboard focus stays while the pointer moves over empty space.
      if (!element) { if (mode === 'hover') hide(); return }
      hide()
      const delay = Date.now() < warmUntil ? 0 : SHOW_DELAY
      timer = window.setTimeout(() => show(element, element, 'hover'), delay)
    }
    const onOut = (event: PointerEvent) => { if (!event.relatedTarget) hide() }
    const onFocus = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!target || !target.matches(':focus-visible')) return
      const element = tipOf(target)
      hide()
      if (element) show(element, target, 'focus')
    }
    const onBlur = () => { if (anchor && mode === 'focus') hide() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    window.addEventListener('resize', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      window.removeEventListener('resize', hide)
      tip.remove()
    }
  }, [])
  return null
}
