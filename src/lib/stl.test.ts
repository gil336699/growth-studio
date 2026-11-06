import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { formatDimension, prepareGeometry, StlImportError } from './stl'

describe('prepareGeometry', () => {
  it('centers a valid triangle and reports metadata', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 4, 0], 3))
    const model = prepareGeometry(geometry, 'triangle.stl')
    expect(model.fileName).toBe('triangle.stl')
    expect(model.triangleCount).toBe(1)
    expect(model.dimensions.toArray()).toEqual([2, 4, 0])
    expect(model.geometry.boundingBox?.getCenter(new Vector3()).toArray()).toEqual([0, 0, 0])
  })

  it('rejects empty geometry', () => {
    expect(() => prepareGeometry(new BufferGeometry(), 'empty.stl')).toThrow(StlImportError)
  })

  it('rejects invalid coordinates', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, Number.NaN, 1, 0], 3))
    expect(() => prepareGeometry(geometry, 'bad.stl')).toThrow('invalid vertex coordinates')
  })
})

describe('formatDimension', () => {
  it('keeps practical precision across model scales', () => {
    expect(formatDimension(4.126)).toBe('4.13')
    expect(formatDimension(40.126)).toBe('40.1')
  })
})
