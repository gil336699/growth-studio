import { OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { type ComponentRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Line, LineBasicMaterial, MOUSE, NeutralToneMapping, Quaternion, TOUCH, Vector3,
} from 'three'
import type { BrushSettings, DiskView, Overlay } from '../lib/diskProject'
import { symmetricPoints, verticalAxis } from '../lib/symmetry'
import type { Tool } from '../lib/tools'
import type { DiskSession } from '../lib/diskSession'
import type { StrokePoint } from '../physics/growingDisk'
import type { GrowthLayer, Vec3 } from '../physics/growthLayers'
import { buildDiskVoronoi, diskVoronoiLines } from '../physics/diskVoronoi'
import { type buildSurfaceVoronoi, surfaceVoronoiLines } from '../physics/surfaceVoronoi'

type Disk = DiskSession

const NEUTRAL = new Color('#ffffff')
// Neutral tone mapping keeps the white surface white. The default, ACES, turns it light grey.
const RENDERER = { toneMapping: NeutralToneMapping }
const OVERLAY_COLORS: Record<Overlay, Color> = {
  field: new Color('#e63c37'), growth: new Color('#5b4bd6'), contact: new Color('#e0a100'), none: NEUTRAL,
}

// Nearest vertex of the starting shape, so markers placed in rest space follow the grown surface.
function nearestRest(rest: ArrayLike<number>, point: Vec3) {
  let best = 0, bestDistance = Infinity
  for (let v = 0; v < rest.length / 3; v++) {
    const d = (rest[v * 3] - point[0]) ** 2 + (rest[v * 3 + 1] - point[1]) ** 2 + (rest[v * 3 + 2] - point[2]) ** 2
    if (d < bestDistance) { bestDistance = d; best = v }
  }
  return best
}

type SheetProps = {
  disk: Disk; tick: number; view: DiskView; overlay: Overlay; ghost: boolean; imported: boolean; running: boolean
  tool: Tool; canEdit: boolean; brush: BrushSettings; rimEdges?: number[]
  layers: GrowthLayer[]; selectedLayerId: string | null
  onStroke: (points: StrokePoint[], pressure: number, first: boolean) => void
  onPlace: (point: Vec3) => void
}

function Sheet(props: SheetProps) {
  const { disk, tick, view, overlay, ghost, imported, running, tool, canEdit, brush, rimEdges, layers, selectedLayerId } = props
  const geometryRevision = disk.geometryRevision
  const { indices, uv, positions } = disk
  const geometry = useMemo(() => {
    const mesh = new BufferGeometry()
    mesh.setAttribute('position', new BufferAttribute(positions.slice(), 3))
    mesh.setIndex(new BufferAttribute(indices, 1))
    mesh.setAttribute('uv', new BufferAttribute(uv, 2))
    mesh.setAttribute('color', new BufferAttribute(new Float32Array(positions.length), 3))
    if (!imported) mesh.computeVertexNormals()
    return mesh
  }, [positions, indices, uv, imported])
  // Layout effects run before the next frame is drawn. A new mesh starts with black vertex colors, so
  // filling them in a later effect let a frame show the model black each time growth added triangles.
  useLayoutEffect(() => {
    const position = geometry.getAttribute('position') as BufferAttribute
    position.array.set(positions)
    position.needsUpdate = true
    if (!imported) geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
  }, [positions, geometry, geometryRevision, imported])
  // Vertex colors show the chosen overlay: growth field, growth so far, or recent contact.
  useLayoutEffect(() => {
    const color = geometry.getAttribute('color') as BufferAttribute
    const rgb = color.array as Float32Array
    const values = overlay === 'growth' ? disk.localGrowth : overlay === 'contact' ? disk.contactHeat : disk.field
    let max = 1
    if (overlay === 'growth') { max = 0; for (const value of values) max = Math.max(max, value) }
    const target = OVERLAY_COLORS[overlay], mixed = new Color()
    for (let v = 0; v < rgb.length / 3; v++) {
      const t = overlay === 'none' || !max ? 0 : Math.min(1, values[v] / max)
      mixed.copy(NEUTRAL).lerp(target, t).toArray(rgb, v * 3)
    }
    color.needsUpdate = true
  }, [geometry, overlay, disk, tick, disk.fieldRevision])
  useEffect(() => () => geometry.dispose(), [geometry])

  const ghostGeometry = useMemo(() => {
    if (!ghost) return null
    const mesh = new BufferGeometry()
    mesh.setAttribute('position', new BufferAttribute(disk.referencePositions.slice(), 3))
    mesh.setIndex(new BufferAttribute(indices, 1))
    return mesh
  }, [ghost, disk, indices])
  useEffect(() => () => ghostGeometry?.dispose(), [ghostGeometry])

  const cells = useMemo(() => imported ? [] : buildDiskVoronoi(uv, indices), [uv, indices, imported])
  const showCells = view === 'cells' || view === 'fans'
  const [surfaceDiagram, setSurfaceDiagram] = useState<{ disk: Disk; lines: ReturnType<typeof buildSurfaceVoronoi> } | null>(null)
  useEffect(() => {
    if (!imported || !showCells) return
    const worker = new Worker(new URL('../physics/surfaceVoronoi.worker.ts', import.meta.url), { type: 'module' })
    let pending = false
    let lastRevision = -1
    const refresh = () => {
      if (pending || lastRevision === disk.geometryRevision) return
      lastRevision = disk.geometryRevision
      pending = true
      const snapshot = positions.slice()
      worker.postMessage({ positions: snapshot, indices }, [snapshot.buffer])
    }
    worker.onmessage = ({ data }: MessageEvent<ReturnType<typeof buildSurfaceVoronoi>>) => {
      pending = false
      setSurfaceDiagram({ disk, lines: data })
    }
    refresh()
    const timer = window.setInterval(refresh, running ? 250 : 80)
    return () => {
      window.clearInterval(timer)
      worker.terminate()
    }
  }, [disk, positions, indices, imported, showCells, running])
  // Splits only append vertices, so the last diagram for this surface stays valid until the next one arrives.
  const surfaceCells = surfaceDiagram?.disk === disk ? surfaceDiagram.lines : null
  const cellLines = useMemo(() => {
    const lines = new BufferGeometry()
    if (showCells) {
      const data = imported
        ? surfaceVoronoiLines(surfaceCells ?? [], positions, view === 'fans')
        : diskVoronoiLines(cells, positions, view === 'fans')
      lines.setAttribute('position', new BufferAttribute(data.positions, 3))
      lines.setAttribute('color', new BufferAttribute(data.colors, 3))
    }
    return lines
  // The simulation mutates positions in place. Geometry revision tracks actual motion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, surfaceCells, imported, positions, view, geometryRevision])
  useEffect(() => () => cellLines.dispose(), [cellLines])

  const rimOutline = useMemo(() => {
    if (!rimEdges) return null
    const outline = new BufferGeometry()
    const coordinates = new Float32Array(rimEdges.length * 3)
    rimEdges.forEach((vertex, i) => coordinates.set(positions.subarray(vertex * 3, vertex * 3 + 3), i * 3))
    outline.setAttribute('position', new BufferAttribute(coordinates, 3))
    return outline
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rimEdges, positions, geometryRevision])
  useEffect(() => () => rimOutline?.dispose(), [rimOutline])

  // Point and line layer markers, drawn on the grown surface at the nearest starting vertex.
  const markers = useMemo(() => {
    const rest = disk.referencePositions
    const at = (point: Vec3) => {
      const v = nearestRest(rest, point)
      return new Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
    }
    const points = layers.filter(layer => layer.kind === 'point' && layer.visible).map(layer => layer.kind === 'point' && ({
      id: layer.id, at: at(layer.center), radius: layer.radius, selected: layer.id === selectedLayerId,
    })).filter(Boolean) as { id: string; at: Vector3; radius: number; selected: boolean }[]
    const lines = layers.filter(layer => layer.kind === 'line' && layer.visible && layer.points.length).map(layer => {
      if (layer.kind !== 'line') return null
      const geometry = new BufferGeometry().setFromPoints(layer.points.map(at))
      return { id: layer.id, line: new Line(geometry, new LineBasicMaterial({ color: layer.id === selectedLayerId ? '#ffd66a' : '#f5c4b3', depthTest: false })) }
    }).filter(Boolean) as { id: string; line: Line }[]
    return { points, lines }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, selectedLayerId, disk, positions, geometryRevision])
  useEffect(() => () => markers.lines.forEach(({ line }) => { line.geometry.dispose(); (line.material as LineBasicMaterial).dispose() }), [markers])

  const [hover, setHover] = useState<{ point: Vec3; normal: Vec3 } | null>(null)
  const brushing = canEdit && (tool === 'paint' || tool === 'erase' || tool === 'smooth')
  const placing = canEdit && (tool === 'point' || tool === 'line')
  const axis = useMemo(() => verticalAxis(positions),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, geometryRevision])
  const rings = useMemo(() => !brushing || !hover ? [] : symmetricPoints(hover.point, hover.normal, brush, axis).map(({ point, normal }) => ({
    position: new Vector3(...point),
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...normal).normalize()),
  })), [brushing, hover, brush, axis])
  const stroke = useRef(false)
  const surfaceHit = (event: ThreeEvent<PointerEvent>) => {
    const normal = event.face?.normal ?? new Vector3(0, 1, 0)
    return { point: event.point.toArray() as Vec3, normal: normal.toArray() as Vec3 }
  }
  const handleMove = (event: ThreeEvent<PointerEvent>, down = false) => {
    if (!brushing || event.faceIndex == null) return
    const hit = surfaceHit(event)
    setHover(hit)
    if ((event.buttons & 1) === 0) { stroke.current = false; return }
    event.stopPropagation()
    const pressure = event.nativeEvent.pointerType === 'pen' ? Math.max(0.1, event.nativeEvent.pressure) : 1
    const points = symmetricPoints(hit.point, hit.normal, brush, axis).map(({ point }, i) => ({ face: i === 0 ? event.faceIndex! : -1, point }))
    props.onStroke(points, pressure, down || !stroke.current)
    stroke.current = true
  }
  return <group>
    <mesh geometry={geometry}
      onPointerDown={event => {
        if (placing && event.button === 0) {
          event.stopPropagation()
          props.onPlace(event.point.toArray() as Vec3)
          return
        }
        handleMove(event, true)
      }}
      onPointerMove={event => handleMove(event)}
      onPointerUp={() => { stroke.current = false }}
      onPointerOut={() => setHover(null)}>
      <meshStandardMaterial vertexColors flatShading={imported} side={DoubleSide} roughness={0.85} polygonOffset polygonOffsetFactor={2} />
    </mesh>
    {view === 'triangles'
      ? <mesh geometry={geometry}><meshBasicMaterial color="#294557" wireframe /></mesh>
      : view !== 'smooth' && <lineSegments geometry={cellLines}><lineBasicMaterial vertexColors /></lineSegments>}
    {ghostGeometry && <mesh geometry={ghostGeometry} renderOrder={1}>
      <meshBasicMaterial color="#9fb4c8" wireframe transparent opacity={0.22} depthWrite={false} />
    </mesh>}
    {rings.map((ring, i) => <group key={i} position={ring.position} quaternion={ring.quaternion} renderOrder={4}>
      <mesh><ringGeometry args={[brush.radius * 0.96, brush.radius, 48]} /><meshBasicMaterial color={tool === 'erase' ? '#79d9ff' : tool === 'smooth' ? '#c9f2c7' : '#ffd66a'} side={DoubleSide} depthTest={false} transparent opacity={i ? 0.5 : 0.95} /></mesh>
      {brush.hardness > 0.05 && <mesh><ringGeometry args={[brush.radius * brush.hardness * 0.97, brush.radius * brush.hardness, 48]} /><meshBasicMaterial color="#ffffff" side={DoubleSide} depthTest={false} transparent opacity={0.35} /></mesh>}
    </group>)}
    {markers.points.map(marker => <mesh key={marker.id} position={marker.at} renderOrder={3}>
      <sphereGeometry args={[marker.radius, 24, 12]} />
      <meshBasicMaterial color={marker.selected ? '#ffd66a' : '#f5c4b3'} wireframe transparent opacity={marker.selected ? 0.45 : 0.2} depthWrite={false} />
    </mesh>)}
    {markers.lines.map(({ id, line }) => <primitive key={id} object={line} />)}
    {rimOutline && <lineSegments geometry={rimOutline} renderOrder={2}><lineBasicMaterial color="#ffd66a" depthTest={false} /></lineSegments>}
  </group>
}

export function Viewport(props: SheetProps & {
  gravityArrow: [Vector3, Vector3, number, string, number, number] | null
  cameraKey: number
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  useEffect(() => { controls.current?.reset() }, [props.cameraKey])
  const editing = props.canEdit && props.tool !== 'orbit'
  return <div className="stage-canvas" style={{ cursor: editing ? 'crosshair' : 'grab' }}>
    <Canvas camera={{ position: [0, 3.4, 3.4], fov: 48 }} gl={RENDERER} role="img"
      aria-label="3D view of the growing surface. Drag to orbit, scroll to zoom. Use the controls to step, play, and inspect growth.">
      <ambientLight intensity={1} /><directionalLight position={[1, 4, 3]} intensity={2.4} />
      <Sheet {...props} />
      {props.gravityArrow && <arrowHelper args={props.gravityArrow} />}
      {/* While editing, one finger paints and two fingers zoom and turn. */}
      <OrbitControls ref={controls} makeDefault
        touches={editing ? { ONE: undefined, TWO: TOUCH.DOLLY_ROTATE } : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        mouseButtons={editing
        ? { LEFT: undefined, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
        : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} />
    </Canvas>
  </div>
}
