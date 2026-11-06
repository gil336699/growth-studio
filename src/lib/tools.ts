// Viewport tools and rim names shared across panels.
export type Tool = 'orbit' | 'paint' | 'erase' | 'smooth' | 'point' | 'line'
export const BRUSH_TOOLS: Tool[] = ['paint', 'erase', 'smooth']

type Rim = { index: number; height: number }
export function rimName(rims: Rim[], index: number | 'all') {
  if (index === 'all') return rims.length > 1 ? 'All rims' : 'Rim'
  const distinctEnds = rims.length === 2 && Math.abs(rims[0].height - rims[1].height) > 0.05
  return distinctEnds ? (index === 0 ? 'Upper rim' : 'Lower rim') : `Rim ${index + 1}`
}
