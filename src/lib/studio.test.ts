import { expect, it } from 'vitest'
import { validLayers } from '../physics/growthLayers'
import { BRUSH_DEFAULTS } from './diskProject'
import { formSize, rimWaves } from './formReadouts'
import { PRESETS } from './presets'
import { symmetricPoints } from './symmetry'

// A ring of rim vertices whose height follows a wave with the given count.
function wavyRim(waves: number, count = 120) {
  const rest: number[] = [], positions: number[] = []
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * i / count
    rest.push(Math.cos(angle), 0, Math.sin(angle))
    positions.push(Math.cos(angle), 0.2 * Math.sin(waves * angle), Math.sin(angle))
  }
  return { rim: { vertices: Array.from({ length: count }, (_, i) => i) }, rest, positions }
}

it('counts waves around a rim and ignores a flat rim', () => {
  for (const waves of [3, 5, 8]) {
    const { rim, rest, positions } = wavyRim(waves)
    expect(rimWaves(rim, rest, positions)).toBe(waves)
  }
  const flat = wavyRim(0)
  expect(rimWaves(flat.rim, flat.rest, flat.positions)).toBe(0)
})

it('reports size against the starting shape and in millimeters', () => {
  const rest = [0, 0, 0, 1, 1, 1]
  const grown = [0, 0, 0, 2, 2, 2]
  const size = formSize(grown, rest, 10)
  expect(size.multiple).toBeCloseTo(2, 6)
  expect(size.millimeters).toEqual([20, 20, 20])
})

it('builds valid layers for every preset on disks and vases', () => {
  for (const preset of PRESETS) {
    for (const rims of [0, 1, 2]) {
      const { layers } = preset.build(rims)
      expect(validLayers(JSON.parse(JSON.stringify(layers)))).toBe(true)
      expect(layers.filter(layer => layer.kind === 'paint')).toHaveLength(1)
    }
  }
})

it('repeats brush points around the vertical axis and mirrors them', () => {
  const radial = symmetricPoints([1, 0.5, 0], [1, 0, 0], { ...BRUSH_DEFAULTS, symmetry: 'radial', copies: 4 }, [0, 0])
  expect(radial).toHaveLength(4)
  expect(radial[1].point.map(v => +v.toFixed(6))).toEqual([0, 0.5, 1])
  expect(radial[2].point.map(v => +v.toFixed(6))).toEqual([-1, 0.5, 0])
  const mirror = symmetricPoints([1, 0.5, 0.3], [1, 0, 0], { ...BRUSH_DEFAULTS, symmetry: 'mirror' }, [0.5, 0])
  expect(mirror[1].point).toEqual([0, 0.5, 0.3])
})
