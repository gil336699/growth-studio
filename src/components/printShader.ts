import { CanvasTexture, Color, SRGBColorSpace, type WebGLProgramParametersWithUniforms } from 'three'
import { marginCosine, needCosine } from '../lib/printCheck'

// The colors of Gil's Parametric Viewer, so both tools read the same. Low points are dark, to stand out on red.
export const PRINT_COLORS = { printable: '#4cc38a', marginal: '#f2c23b', needs: '#e6484d', bed: '#5b8def', low: '#1d1d1f' }

// A round dark dot with a white ring, for the low points: drawn the same size on screen at any zoom.
let dot: CanvasTexture | null = null
export function lowPointDot() {
  if (dot) return dot
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const g = canvas.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill()
  g.fillStyle = PRINT_COLORS.low
  g.beginPath(); g.arc(16, 16, 11, 0, Math.PI * 2); g.fill()
  dot = new CanvasTexture(canvas)
  dot.colorSpace = SRGBColorSpace
  return dot
}

// What the 3D view needs to color the print check: the support angle from the bed, where the bed is and how close to it
// a face counts as on it (model units), and whether the surface is an open sheet that prints as a two-sided wall.
export type PrintView = { angle: number; low: number; bedTolerance: number; twoSided: boolean }

// Colors each face by how it prints, from the face itself: its normal is worked out per pixel from the surface
// positions, so the colors match what the print check counts, on smooth and flat-shaded meshes alike. The normal faces
// the camera, which on a closed solid is always outward. The shader is always compiled in; update() turns it on or off.
export function createPrintShader() {
  const uniforms = {
    uPrint: { value: 0 }, uNeed: { value: 1 }, uMargin: { value: 1 }, uLow: { value: -1e9 }, uBed: { value: 0 },
    uTwoSided: { value: 0 },
    uPrintable: { value: new Color(PRINT_COLORS.printable) }, uMarginal: { value: new Color(PRINT_COLORS.marginal) },
    uNeeds: { value: new Color(PRINT_COLORS.needs) }, uOnBed: { value: new Color(PRINT_COLORS.bed) },
  }
  const onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec3 vPrintPosition;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPrintPosition = position;')
    shader.fragmentShader = `varying vec3 vPrintPosition;
uniform float uPrint, uNeed, uMargin, uLow, uBed, uTwoSided;
uniform vec3 uPrintable, uMarginal, uNeeds, uOnBed;
` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  if (uPrint > 0.5) {
    vec3 faceNormal = normalize(cross(dFdx(vPrintPosition), dFdy(vPrintPosition)));
    float down = uTwoSided > 0.5 ? abs(faceNormal.y) : -faceNormal.y;
    diffuseColor.rgb = down > 0.999 && vPrintPosition.y - uLow < uBed ? uOnBed
      : down > uNeed ? uNeeds : down > uMargin ? uMarginal : uPrintable;
  }`)
  }
  const update = (view: PrintView | null) => {
    uniforms.uPrint.value = view ? 1 : 0
    if (!view) return
    uniforms.uNeed.value = needCosine(view.angle)
    uniforms.uMargin.value = marginCosine(view.angle)
    uniforms.uLow.value = Number.isFinite(view.low) ? view.low : -1e9
    uniforms.uBed.value = view.bedTolerance
    uniforms.uTwoSided.value = view.twoSided ? 1 : 0
  }
  return { onBeforeCompile, cacheKey: () => 'print-check', update }
}
