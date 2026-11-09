import { useState, type InputHTMLAttributes } from 'react'

// A number box people can type into freely. While typing, the text is kept as it is and applied on Enter or when
// the box loses focus, clamped to the range then. Clamping each keystroke made typing 80 over 100 give 10, then 100,
// and typing into a cleared Stop at step could stop playback at the first digit. The arrow keys and spin buttons
// apply at once. allowEmpty lets an emptied box mean "none", as for a layer that never stops.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'> & {
  value: number | null
  min: number
  max?: number
  integer?: boolean
  allowEmpty?: boolean
  onValue: (value: number | null) => void
}

export function NumberField({ value, min, max = Number.MAX_SAFE_INTEGER, integer = true, allowEmpty = false, onValue, onBlur, onKeyDown, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number) => Math.min(max, Math.max(min, integer ? Math.round(n) : n))
  const commit = (text: string) => {
    setDraft(null)
    if (text.trim() === '') { if (allowEmpty) onValue(null); return }
    const n = Number(text)
    if (Number.isFinite(n)) onValue(clamp(n))
  }
  return <input {...rest} className={rest.className ?? 'number-input'} type="number" min={min} max={max === Number.MAX_SAFE_INTEGER ? undefined : max}
    value={draft ?? (value ?? '')}
    onChange={event => {
      const typing = /^(insert|delete)/.test((event.nativeEvent as InputEvent).inputType ?? '')
      if (typing) setDraft(event.currentTarget.value)
      else commit(event.currentTarget.value)
    }}
    onBlur={event => { if (draft !== null) commit(draft); onBlur?.(event) }}
    onKeyDown={event => {
      if (event.key === 'Enter' && draft !== null) commit(draft)
      if (event.key === 'Escape' && draft !== null) setDraft(null)
      onKeyDown?.(event)
    }} />
}
