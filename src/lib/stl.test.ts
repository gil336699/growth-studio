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

describe('triangle count before import', () => {
  it('reads binary STL counts exactly and estimates ASCII', async () => {
    const { stlTriangleCount } = await import('./stl')
    const binary = new ArrayBuffer(84 + 3 * 50)
    new DataView(binary).setUint32(80, 3, true)
    expect(stlTriangleCount(binary)).toBe(3)
    const ascii = new TextEncoder().encode('solid x\n' + 'facet normal 0 0 1\n outer loop\n  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n endloop\nendfacet\n'.repeat(40)).buffer
    // The estimate assumes about 250 bytes per facet, typical of CAD exports; this sample is terser.
    expect(stlTriangleCount(ascii)).toBeGreaterThan(10)
    expect(stlTriangleCount(ascii)).toBeLessThan(80)
  })
})
