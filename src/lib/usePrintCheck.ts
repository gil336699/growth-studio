// The print check for the surface the 3D view shows. Paused, it counts again as soon as the surface or a setting
// changes; while growth runs, the surface changes every step, so it counts at most four times a second.
import { useEffect, useRef, useState } from 'react'
import { printCheck, type PrintCheck } from './printCheck'
import { printScale } from './thicken'

type Surface = { positions: ArrayLike<number>; indices: ArrayLike<number> }
// marks: the low points' positions when they were counted, so a remesh can't move them onto other vertices.
export type PrintResult = PrintCheck & { marks: [number, number, number][] }
type Counted = { key: string; surface: Surface; result: PrintResult }

const EVERY_MS = 250

// scale: millimeters per model unit for an STL; the default disk has none and uses size, its printed longest side.
export function usePrintCheck(enabled: boolean, surface: Surface | null, revision: string, angle: number,
  twoSided: boolean, scale: number | null, size: number, running: boolean): PrintResult | null {
  const [counted, setCounted] = useState<Counted | null>(null)
  const last = useRef(-Infinity)
  const key = `${revision}:${angle}:${twoSided}:${scale}:${size}`
  useEffect(() => {
    if (!enabled || !surface || (counted?.key === key && counted.surface === surface)) return
    // A deadline, not a delay: a delay that restarts with every step would never come while growth runs.
    const wait = running ? Math.max(0, last.current + EVERY_MS - performance.now()) : 0
    const timer = window.setTimeout(() => {
      last.current = performance.now()
      const P = surface.positions
      const mm = scale ?? printScale(P, null, size)
      const check = printCheck(P, surface.indices, angle, { twoSided, mm })
      const marks = check.lowPoints.map(v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]] as [number, number, number])
      setCounted({ key, surface, result: { ...check, marks } })
    }, wait)
    return () => window.clearTimeout(timer)
  }, [enabled, surface, key, counted, angle, twoSided, scale, size, running])
  // The last count stays up until the next one is ready, so the colors and the readout don't flicker while growing.
  return enabled && counted ? counted.result : null
}
