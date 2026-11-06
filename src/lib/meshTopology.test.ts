import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import { analyzeMeshTopology } from './meshTopology'

describe('M5.6 imported mesh topology readiness', () => {
  it('recognizes a closed connected box as ready', () => { const result=analyzeMeshTopology(new BoxGeometry().toNonIndexed()); expect(result.components).toBe(1); expect(result.boundaryEdges).toBe(0); expect(result.nonManifoldEdges).toBe(0); expect(result.readiness).toBe('READY') })
  it('flags an open triangle for review', () => { const geometry=new BufferGeometry(); geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)); const result=analyzeMeshTopology(geometry); expect(result.boundaryEdges).toBe(3); expect(result.readiness).toBe('REVIEW') })
  it('blocks disconnected triangle components', () => { const geometry=new BufferGeometry(); geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0,3,0,0,4,0,0,3,1,0],3)); const result=analyzeMeshTopology(geometry); expect(result.components).toBe(2); expect(result.readiness).toBe('BLOCKED') })
})
