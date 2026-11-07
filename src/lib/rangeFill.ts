import type { CSSProperties } from 'react'

// How far along its track a range input is, so the stylesheet can fill the track up to the thumb.
export function rangeFill(value: number, min: number, max: number): CSSProperties {
  const share = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  return { '--fill': `${(share * 100).toFixed(1)}%` } as CSSProperties
}
