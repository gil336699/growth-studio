import { OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, MOUSE, Vector3 } from 'three'
import { createGrowingDisk, DISK_DEFAULTS, diskGravityDirection } from './physics/growingDisk'
import { growthExportPositions, readGrowthStl } from './physics/growthStl'
import { deserializeDiskProject, serializeDiskProject, type DiskView as View } from './lib/diskProject'
import { exportBinaryStl, exportObj } from './lib/meshExport'
import { buildDiskVoronoi, diskVoronoiLines } from './physics/diskVoronoi'
import { type buildSurfaceVoronoi, surfaceVoronoiLines } from './physics/surfaceVoronoi'
import './styles.css'

type Disk = ReturnType<typeof createGrowingDisk>

function Sheet({ disk, field, view, imported, running, rimEdges, brush, onBrush }: {
  disk: Disk; field: boolean; view: View; imported: boolean; running: boolean; rimEdges?: number[]
  brush?: { radius: number; erase: boolean }
  onBrush: (footprint: ReturnType<Disk['brushFootprint']>, erase: boolean) => void
}) {
  const geometryRevision = disk.geometryRevision
  const { indices, uv, field: weights, positions } = disk
  const geometry = useMemo(() => {
    const mesh = new BufferGeometry()
    mesh.setAttribute('position', new BufferAttribute(positions.slice(), 3))
    mesh.setIndex(new BufferAttribute(indices, 1))
    mesh.setAttribute('uv', new BufferAttribute(uv, 2))
    const neutral = new Color('#dbe3de'), rim = new Color('#e63c37')
    const rgb = new Float32Array(weights.length * 3)
    weights.forEach((value, i) => neutral.clone().lerp(rim, field ? value : 0).toArray(rgb, i * 3))
    mesh.setAttribute('color', new BufferAttribute(rgb, 3))
    if (!imported) mesh.computeVertexNormals()
    return mesh
  }, [positions, indices, uv, weights, field, imported])
  useEffect(() => {
    const position = geometry.getAttribute('position') as BufferAttribute
    position.array.set(positions)
    position.needsUpdate = true
    if (!imported) geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
  }, [positions, geometry, geometryRevision, imported])
  useEffect(() => () => geometry.dispose(), [geometry])
  const cells = useMemo(() => imported ? [] : buildDiskVoronoi(uv, indices), [uv, indices, imported])
  const showCells = view === 'cells' || view === 'fans'
  const [surfaceDiagram, setSurfaceDiagram] = useState<{
    indices: Uint32Array; lines: ReturnType<typeof buildSurfaceVoronoi>
  } | null>(null)
  useEffect(() => {
    if (!imported || !showCells) return
    const worker = new Worker(new URL('./physics/surfaceVoronoi.worker.ts', import.meta.url), { type: 'module' })
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
      setSurfaceDiagram({ indices, lines: data })
    }
    refresh()
    // Also refresh after manual steps while playback is paused.
    const timer = window.setInterval(refresh, running ? 250 : 80)
    return () => {
      window.clearInterval(timer)
      worker.terminate()
    }
  }, [disk, positions, indices, imported, showCells, running])
  const surfaceCells = surfaceDiagram?.indices === indices ? surfaceDiagram.lines : null
  const overlay = useMemo(() => {
    const lines = new BufferGeometry()
    if (view === 'cells' || view === 'fans') {
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
  useEffect(() => () => overlay.dispose(), [overlay])
  const rimOutline = useMemo(() => {
    if (!rimEdges) return null
    const outline = new BufferGeometry()
    const coordinates = new Float32Array(rimEdges.length * 3)
    rimEdges.forEach((vertex, i) => coordinates.set(positions.subarray(vertex * 3, vertex * 3 + 3), i * 3))
    outline.setAttribute('position', new BufferAttribute(coordinates, 3))
    return outline
  // Positions update in place during simulation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rimEdges, positions, geometryRevision])
  useEffect(() => () => rimOutline?.dispose(), [rimOutline])
  const [brushHit, setBrushHit] = useState<{ disk: Disk; face: number; point: number[] } | null>(null)
  const brushPreview = useMemo(() => {
    if (!brush || !brushHit || brushHit.disk !== disk) return null
    const footprint = disk.brushFootprint(brushHit.face, brushHit.point, brush.radius)
    const coordinates = new Float32Array(footprint.length * 3)
    footprint.forEach(({ vertex }, i) => coordinates.set(positions.subarray(vertex * 3, vertex * 3 + 3), i * 3))
    return new BufferAttribute(coordinates, 3)
  // Positions update in place during simulation. Geometry revision tracks actual motion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brush, brushHit, disk, positions, geometryRevision])
  const trackBrush = (event: ThreeEvent<PointerEvent>) => {
    if (!brush || event.faceIndex == null) return
    const point = event.point.toArray()
    setBrushHit({ disk, face: event.faceIndex, point })
    if ((event.buttons & 1) === 0) return
    event.stopPropagation()
    onBrush(disk.brushFootprint(event.faceIndex, point, brush.radius), brush.erase)
  }
  return <group>
    <mesh geometry={geometry}
      onPointerDown={brush ? trackBrush : undefined}
      onPointerMove={brush ? trackBrush : undefined}
      onPointerOut={() => setBrushHit(null)}>
      <meshStandardMaterial vertexColors flatShading={imported} side={DoubleSide} roughness={0.85} polygonOffset polygonOffsetFactor={2} />
    </mesh>
    {view === 'triangles'
      ? <mesh geometry={geometry}><meshBasicMaterial color="#294557" wireframe /></mesh>
      : view !== 'smooth' && <lineSegments geometry={overlay}><lineBasicMaterial vertexColors /></lineSegments>}
    {brushPreview && <points renderOrder={3}>
      <bufferGeometry><primitive object={brushPreview} attach="attributes-position" /></bufferGeometry>
      <pointsMaterial color={brush?.erase ? '#79d9ff' : '#ffd66a'} size={5} sizeAttenuation={false} depthWrite={false} />
    </points>}
    {rimOutline && <lineSegments geometry={rimOutline} renderOrder={2}><lineBasicMaterial color="#ffd66a" depthTest={false} /></lineSegments>}
  </group>
}

export function App() {
  const [disk, setDisk] = useState(createGrowingDisk)
  const [revision, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [manualQueue, setManualQueue] = useState(0)
  const [relaxing, setRelaxing] = useState(false)
  const [field, setField] = useState(true)
  const [sources, setSources] = useState(0)
  const [zone, setZone] = useState(0.3)
  const projectRef = useRef<HTMLInputElement>(null)
  const [projectStatus, setProjectStatus] = useState('')
  const [projectError, setProjectError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [centerExport, setCenterExport] = useState(false)
  const [view, setView] = useState<View>('cells')
  const [mechanics, setMechanics] = useState(DISK_DEFAULTS)
  const gravityArrow = useMemo(() => {
    const length = 0.25 + 0.55 * mechanics.gravity
    return [new Vector3(...diskGravityDirection(mechanics)), new Vector3(), length, '#ffda68', 0.13, 0.075] satisfies [Vector3, Vector3, number, string, number, number]
  }, [mechanics])
  const [input, setInput] = useState<ReturnType<typeof readGrowthStl> | null>(null)
  const [importError, setImportError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [brush, setBrush] = useState<'orbit' | 'paint' | 'erase'>('orbit')
  const [rimWidth, setRimWidth] = useState(0.16)
  const brushStrokeStarted = useRef(false)
  const [brushRadius, setBrushRadius] = useState(0.15)
  const [previewRim, setPreviewRim] = useState<number | null>(null)
  const rims = disk.openRims
  const rimEdges = rims.find(rim => rim.id === previewRim)?.edges
  const distinctEnds = rims.length === 2 && Math.abs(rims[0].height - rims[1].height) > 0.05
  const [edits, refreshPaint] = useState(0)
  // Growth steps and brush or opening edits since the last save, open, import, or reset.
  const [savedPoint, setSavedPoint] = useState({ revision: 0, edits: 0 })
  const unsaved = revision !== savedPoint.revision || edits !== savedPoint.edits
  const confirmDiscard = (action: string) => !unsaved || window.confirm(
    `${action} Unsaved growth and brush edits in the current design will be lost. Choose Cancel, then Save project, to keep them.`)
  const [batch, setBatch] = useState(100)
  const [speed, setSpeed] = useState(3)
  const [importBatch, setImportBatch] = useState(10)
  const [importSpeed, setImportSpeed] = useState(1)
  const manualSteps = input ? importBatch : batch
  const stepsPerUpdate = input ? importSpeed : speed
  const editing = Boolean(input && !running && !manualQueue && brush !== 'orbit')
  const brushSettings = useMemo(() => editing ? { radius: brushRadius, erase: brush === 'erase' } : undefined,
    [editing, brushRadius, brush])
  const paint = (footprint: ReturnType<Disk['brushFootprint']>, erase: boolean) => {
    if (!editing || !footprint.length) return
    if (!brushStrokeStarted.current || !disk.canUndoBrush) {
      disk.beginBrushStroke()
      brushStrokeStarted.current = true
    }
    disk.applyBrush(footprint, erase)
    refreshPaint(value => value + 1)
  }
  const change = (key: keyof typeof DISK_DEFAULTS, value: number) => {
    const settings = { ...mechanics, [key]: value }
    disk.setMechanics(settings)
    setMechanics(settings)
  }
  const reset = (source = input) => {
    setRunning(false)
    setManualQueue(0)
    setRelaxing(false)
    const fresh = createGrowingDisk(source ?? undefined, mechanics.remeshLength)
    fresh.configure(sources, zone)
    fresh.setMechanics(mechanics)
    if (source) {
      fresh.selectOpenRings(rimWidth)
      // Keep the designer's opening choices when restarting the same model.
      const previousRims = disk.openRims, nextRims = fresh.openRims
      if (source === input && previousRims.length === nextRims.length) {
        nextRims.forEach((rim, i) => { if (!previousRims[i].enabled) fresh.setRimEnabled(rim.id, false, rimWidth) })
      }
    }
    setPreviewRim(null)
    setDisk(fresh)
    setRevision(0)
    setSavedPoint({ revision: 0, edits })
    setExportStatus('')
    setProjectStatus('')
    setProjectError('')
  }
  const importStl = async (file: File) => {
    setRunning(false)
    setManualQueue(0)
    setLoading(true)
    setImportError('')
    try {
      const source = readGrowthStl(await file.arrayBuffer(), file.name)
      reset(source)
      setInput(source)
      setCenterExport(false)
      setView(current => current === 'fans' ? 'fans' : 'cells')
      setBrush('orbit')
      setField(true)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not prepare this STL.')
    } finally {
      setLoading(false)
    }
  }
  const modelName = (input?.name.replace(/\.stl$/i, '') ?? 'default-disk')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'surface'
  const snapshotName = `${modelName}-step-${revision}`
  const download = (filename: string, data: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const exportMesh = (format: 'obj' | 'stl') => {
    const positions = input ? growthExportPositions(disk.positions, input, centerExport) : disk.positions
    const data = format === 'obj' ? exportObj(positions, disk.indices, snapshotName) : exportBinaryStl(positions, disk.indices, snapshotName)
    const filename = `${snapshotName}.${format}`
    download(filename, data, format === 'obj' ? 'text/plain' : 'model/stl')
    setExportStatus(`Download requested for ${filename}.`)
  }
  const saveProject = () => {
    const source = input && { ...input, positions: Array.from(input.positions), indices: Array.from(input.indices) }
    const json = serializeDiskProject({
      source, disk: disk.snapshot(), mechanics, revision, rimWidth, brushRadius, centerExport,
      ringSelection: input ? rims.reduce((total, rim) => total + (rim.enabled ? rim.vertices.length : 0), 0) : null,
      relaxing, showField: field, view, speed, batch, importSpeed, importBatch,
    })
    const filename = `${snapshotName}.growthstudio.json`
    download(filename, json, 'application/json')
    setProjectError('')
    setSavedPoint({ revision, edits })
    setProjectStatus(`Download requested for ${filename}.`)
  }
  const openProject = async (file: File) => {
    setLoading(true)
    setProjectError('')
    setProjectStatus('')
    try {
      const project = deserializeDiskProject(await file.text())
      const restored = createGrowingDisk(project.source ?? undefined, project.mechanics.remeshLength, project.disk)
      restored.setMechanics(project.mechanics)
      setRunning(false)
      setManualQueue(0)
      setDisk(restored)
      setInput(project.source)
      setCenterExport(project.centerExport ?? false)
      setRevision(project.revision)
      setMechanics(project.mechanics)
      setSources(project.disk.sources)
      setZone(project.disk.zone)
      setRimWidth(project.rimWidth)
      setBrushRadius(project.brushRadius)
      setPreviewRim(null)
      setRelaxing(project.relaxing)
      setField(project.showField)
      setView(project.view)
      setSpeed(project.speed)
      setBatch(project.batch)
      setImportSpeed(project.importSpeed)
      setImportBatch(project.importBatch)
      setBrush('orbit')
      setImportError('')
      setExportStatus('')
      setSavedPoint({ revision: project.revision, edits })
      setProjectStatus(`Opened ${file.name}.`)
    } catch (error) {
      setProjectError(error instanceof SyntaxError ? 'This project file could not be read.'
        : error instanceof Error ? error.message : 'Could not open this project.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!running && !manualQueue) return
    let remaining = manualQueue
    const id = window.setInterval(() => {
      const deadline = performance.now() + 12
      const limit = running ? stepsPerUpdate : remaining
      let attempts = 0
      do {
        disk.step(!relaxing)
        attempts++
      } while (attempts < limit && (!input || performance.now() < deadline))
      setRevision(value => value + attempts)
      if (!running) {
        remaining -= attempts
        if (!remaining) {
          window.clearInterval(id)
          setManualQueue(0)
        }
      }
    }, running ? 40 : 16)
    return () => window.clearInterval(id)
  }, [running, manualQueue, disk, stepsPerUpdate, relaxing, input])
  const canSimulate = !loading && !disk.initialOverlap && (!input || disk.hasPaint || disk.strain > 0)
  const active = running || manualQueue > 0
  const detailLimit = disk.positions.length / 3 >= disk.growthBudget
  const contactStatus = disk.initialOverlap ? 'Starting mesh overlaps'
    : disk.stepStatus === 'contact' ? 'Contact blocked the last step'
      : disk.lastContactCorrections > 0 ? 'Contact corrected last step' : ''
  const slowed = !relaxing && disk.growthThrottle < 0.995
  const playbackStatus = contactStatus || (loading ? 'Loading…' : active
    ? (relaxing ? 'Relaxing' : slowed ? `Growing at ${Math.round(disk.growthThrottle * 100)}% (contact)` : 'Growing') : 'Paused')
  return <main className="spike-shell disk-workspace">
    <header className="spike-header disk-toolbar">
      <div><p className="app-kicker">Differential growth</p><h1>Growth Studio</h1></div>
      <div className="disk-playback">
        <span className="disk-playback-status" role="status" data-warning={Boolean(contactStatus || detailLimit)}>
          {playbackStatus}{detailLimit && <><span aria-hidden="true"> · </span>Mesh detail limit</>}
        </span>
        <div className="disk-transport" role="group" aria-label="Playback">
          <button className="primary" disabled={!active && !canSimulate} onClick={() => {
            if (active) {
              setRunning(false)
              setManualQueue(0)
            } else {
              setRunning(true)
            }
          }}>{active ? 'Stop simulation' : relaxing ? 'Play relaxation' : 'Play growth'}</button>
          <button disabled={active || !canSimulate} onClick={() => setManualQueue(manualSteps)}>Step {manualSteps}</button>
          <button disabled={loading} onClick={() => {
            if (!confirmDiscard('Reset to the starting surface?')) return
            reset()
          }}>Reset</button>
        </div>
      </div>
    </header>
    <aside className="spike-controls">
      <section><h2>Starting surface</h2>
        <p className="hint">{input ? input.name : 'Default disk'}</p>
        <input ref={inputRef} type="file" accept=".stl,model/stl" hidden aria-label="Choose an STL file" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importStl(file)
        }} />
        <button className="wide" disabled={loading} onClick={() => { if (confirmDiscard('Load a new STL?')) inputRef.current?.click() }}>{loading ? 'Preparing surface…' : 'Upload STL'}</button>
        {input && <button className="wide" disabled={loading} onClick={() => {
          if (!confirmDiscard('Switch to the default disk?')) return
          reset(null)
          setInput(null)
          setImportError('')
        }}>Use default disk</button>}
        {importError && <p role="alert">{importError}</p>}
        <p className="hint">Upload a surface to grow it directly. Set Remesh edge length under Advanced and use Reset to prepare the STL again.</p>
        {input && <p className="hint">Prepared mesh: {disk.preparationPatches} planar {disk.preparationPatches === 1 ? 'patch' : 'patches'} rebuilt, {disk.preparationSplits} edge splits, and {disk.preparationFlips} balancing flips. Use Mesh view to inspect the triangles.</p>}
        {disk.initialOverlap && <p role="alert">The overlap check flagged the starting surface. You can inspect it here. Repair intersecting or unwelded faces in the STL before growing it.</p>}
      </section>
      {input && <section><h2>Growth brush</h2>
        <div className="disk-brush-tools" role="group" aria-label="Viewport tool">
          {(['orbit', 'paint', 'erase'] as const).map(tool => <button
            key={tool}
            type="button"
            aria-pressed={brush === tool}
            className={brush === tool ? 'primary' : undefined}
            disabled={(running || Boolean(manualQueue)) && tool !== 'orbit'}
            onClick={() => {
              setBrush(tool)
              setField(true)
            }}
          >{tool === 'orbit' ? 'Orbit' : tool === 'paint' ? 'Paint' : 'Erase'}</button>)}
        </div>
        <button className="wide" disabled={active || loading || !disk.canUndoBrush} onClick={() => {
          disk.undoBrush(rimWidth)
          setField(true)
          refreshPaint(value => value + 1)
        }}>Undo brush stroke</button>
        <p className="hint">Highlighted points show the brush footprint. Undo applies until the mesh adds triangles.</p>
        {rims.length ? <fieldset className="disk-openings" disabled={loading}>
          <legend>Grow from openings</legend>
          {rims.map((rim, index) => <label key={rim.id}
            onPointerEnter={() => setPreviewRim(rim.id)} onPointerLeave={() => setPreviewRim(null)}>
            <input type="checkbox" checked={rim.enabled}
              onFocus={() => setPreviewRim(rim.id)} onBlur={() => setPreviewRim(null)}
              onChange={event => {
                disk.setRimEnabled(rim.id, event.currentTarget.checked, rimWidth)
                setField(true)
                refreshPaint(value => value + 1)
              }} />
            {distinctEnds ? (index === 0 ? 'Upper opening' : 'Lower opening') : `Opening ${index + 1}`}
          </label>)}
          <p className="hint">Uncheck an opening to turn off automatic growth at its rim. Brush edits stay in place.</p>
        </fieldset> : <p className="hint">This mesh has no open rims. Use Paint to choose a growth region.</p>}
        <label><span>Growth field width <b>{Math.round(rimWidth * 100)}%</b></span>
          <input type="range" min="0.03" max="0.8" step="0.01" value={rimWidth} disabled={!rims.some(rim => rim.enabled)} onChange={event => {
            const width = event.currentTarget.valueAsNumber
            setRimWidth(width)
            disk.selectOpenRings(width)
            setField(true)
            refreshPaint(value => value + 1)
          }} />
        </label>
        <p className="hint">Sets how far growth fades inward from each open rim, as a percentage of the model radius. Paint and erase edits stay in place.</p>
        <label><span>Brush radius <b>{Math.round(brushRadius * 100)}%</b></span>
          <input type="range" min="0.03" max="0.5" step="0.01" value={brushRadius} onChange={event => setBrushRadius(event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">{running ? 'Stop playback to edit the growth field.'
          : brush === 'orbit' ? 'Drag to rotate. Select Paint or Erase to edit growth.'
            : 'Left-drag to edit. Right-drag to rotate. Scroll to zoom.'}</p>
        <p className="hint">Red marks future growth. Reset keeps your opening choices and clears brush edits.</p>
      </section>}
      <section><h2>Simulation</h2>
        <div className="button-row" role="group" aria-label="Simulation mode">
          <button type="button" aria-pressed={!relaxing} disabled={Boolean(manualQueue)} onClick={() => setRelaxing(false)}>Grow</button>
          <button type="button" aria-pressed={relaxing} disabled={Boolean(manualQueue)} onClick={() => setRelaxing(true)}>Relax only</button>
        </div>
        <p className="hint">{relaxing ? 'The sheet settles at its current growth level.'
          : disk.stepStatus === 'contact' ? 'Contact blocked the last step. Try a lower growth rate or a smaller painted region.'
            : input && !disk.hasPaint ? 'Turn on an opening or paint a region to add growth.'
              : mechanics.growthRate === 0 ? 'Growth rate is zero. Increase it to add expansion.'
                : 'Growth adds expansion in the red regions.'}</p>
        {relaxing && <p className="hint" role="status">{disk.stepStatus === 'contact'
          ? 'Contact blocked the last step. The last accepted shape is held.'
          : disk.stepStatus === 'settled'
            ? 'Very little motion in the last step. The sheet is nearly settled.'
            : disk.stepStatus === 'moving'
              ? `Last-step motion: ${disk.lastMotion.toExponential(2)} disk radii (RMS).`
              : 'Ready to relax.'}</p>}
      </section>
      <section><h2>Design</h2>
        {!input && <><label>Growth sources
          <select disabled={Boolean(input)} value={sources} onChange={event => {
            const value = Number(event.currentTarget.value)
            disk.configure(value, zone)
            setSources(value)
          }}>
            <option value={0}>Entire rim</option>
            {[3, 4, 5, 6].map(count => <option key={count} value={count}>{count} rim sources</option>)}
          </select>
        </label>
        <p className="hint">{input ? 'The imported surface supplies the growth sources.' : 'Choose where growth starts along the rim.'}</p>
        <label><span>Growth zone width <b>{Math.round(zone * 100)}%</b></span>
          <input type="range" min="0.1" max="0.8" step="0.01" value={zone} onChange={event => {
            const value = event.currentTarget.valueAsNumber
            disk.configure(sources, value)
            setZone(value)
          }} />
        </label>
        <p className="hint">A wider zone extends faster growth farther into the disk.</p>
        </>}
        <label><span>Growth rate <b>{(mechanics.growthRate * 100).toFixed(2)}% {mechanics.compoundGrowth ? 'of size ' : ''}/ step</b></span>
          <input type="range" min="0" max="0.008" step="0.0005" value={mechanics.growthRate} onChange={event => change('growthRate', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Sets how much target expansion is added per accepted step. Zero pauses expansion while the sheet settles.</p>
        <div className="button-row" role="group" aria-label="Growth curve">
          <button type="button" aria-pressed={!mechanics.compoundGrowth} onClick={() => change('compoundGrowth', 0)}>Linear</button>
          <button type="button" aria-pressed={Boolean(mechanics.compoundGrowth)} onClick={() => change('compoundGrowth', 1)}>Compounding</button>
        </div>
        <p className="hint">{mechanics.compoundGrowth
          ? 'Each step adds a share of the current size, so growth speeds up over time. Contact and the mesh detail limit arrive sooner.'
          : 'Each step adds the same amount, so growth stays steady.'}</p>
        <label><span>Bend stiffness <b>{(mechanics.bending * 100).toFixed(1)}%</b></span>
          <input type="range" min="0" max="0.3" step="0.005" value={mechanics.bending} onChange={event => change('bending', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Higher values resist tight folds and favor smoother bends.</p>
      </section>
      <section><h2>Gravity</h2>
        <label><span>Strength <b>{Math.round(mechanics.gravity * 100)}%</b></span>
          <input type="range" min="0" max="1" step="0.01" value={mechanics.gravity} onChange={event => change('gravity', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Pulls only on the red growth field in Grow and Relax only. The rest of the model stays in place while gravity is on.</p>
        <label><span>Tilt from down <b>{mechanics.gravityTilt}°</b></span>
          <input type="range" min="0" max="180" step="1" value={mechanics.gravityTilt} onChange={event => change('gravityTilt', event.currentTarget.valueAsNumber)} />
        </label>
        <label><span>Heading <b>{mechanics.gravityHeading}°</b></span>
          <input type="range" min="0" max="359" step="1" value={mechanics.gravityHeading} onChange={event => change('gravityHeading', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Tilt aims the pull away from straight down. Heading rotates a tilted pull around the vertical axis.</p>
      </section>
      <section><h2>Contact in growth field</h2>
        <label><span>Repel distance <b>{input
          ? `${(mechanics.repelDistance * input.scale).toFixed(1)} mm`
          : `${(mechanics.repelDistance * 100).toFixed(1)}% of radius`}</b></span>
          <input type="range" min="0.004" max="0.04" step="0.001" value={mechanics.repelDistance} onChange={event => change('repelDistance', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">How far apart folds in the red growth field stay when they meet. Larger values leave wider gaps between folds.</p>
        <label><span>Repel strength <b>{Math.round(mechanics.repelStrength * 100)}%</b></span>
          <input type="range" min="0.1" max="1" step="0.05" value={mechanics.repelStrength} onChange={event => change('repelStrength', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">How quickly touching folds are pushed back to that distance each step. Low values let folds press closer and can block more steps. The rest of the model keeps the default contact.</p>
      </section>
      <section><details><summary>Advanced</summary>
        <label><span>Damping <b>{Math.round(mechanics.damping * 100)}%</b></span>
          <input type="range" min="0.02" max="0.9" step="0.01" value={mechanics.damping} onChange={event => change('damping', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Higher values reduce lingering motion after the sheet bends.</p>
        <label><span>Remesh edge length <b>{mechanics.remeshLength.toFixed(3)}</b></span>
          <input type="range" min="0.09" max="0.25" step="0.005" value={mechanics.remeshLength} onChange={event => change('remeshLength', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Lower values split edges sooner as the growth field expands. Use Reset to apply this setting to the starting STL.</p>
        <label><span>Mesh detail limit <b>{disk.growthBudget.toLocaleString()} vertices · {mechanics.detailScale}×</b></span>
          <input type="range" min="1" max="4" step="0.25" value={mechanics.detailScale} onChange={event => change('detailScale', event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Raises how many vertices growth can add, so folds keep refining after the default limit. Each doubling of the vertex count roughly halves the step speed. Takes effect immediately.</p>
        <label><span>Playback speed <b>{stepsPerUpdate} {stepsPerUpdate === 1 ? 'step' : 'steps'} per update</b></span>
          <input type="range" min="1" max={input ? 3 : 5} step="1" value={stepsPerUpdate} disabled={Boolean(manualQueue)} onChange={event => (input ? setImportSpeed : setSpeed)(event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Sets how many solver steps run per update while playing.</p>
        <label><span>Manual step size <b>{manualSteps}</b></span>
          <input type="range" min="10" max={input ? 30 : 100} step="10" value={manualSteps} onChange={event => (input ? setImportBatch : setBatch)(event.currentTarget.valueAsNumber)} />
        </label>
        <p className="hint">Sets how many steps the Step button attempts per click.</p>
      </details></section>
    </aside>
    <section className="spike-view"><div className="spike-canvas"
      onPointerDownCapture={event => { if (event.button === 0) brushStrokeStarted.current = false }}
      style={{ cursor: editing ? 'crosshair' : 'grab' }}>
      <Canvas camera={{ position: [0, 3.4, 3.4], fov: 48 }} role="img"
        aria-label="3D view of the growing surface. Drag to orbit, scroll to zoom. Use the controls to step, play, and inspect growth.">
        <color attach="background" args={['#17212b']} />
        <ambientLight intensity={1} /><directionalLight position={[1, 4, 3]} intensity={2.4} />
        <Sheet disk={disk} rimEdges={rimEdges} view={view} field={field} running={running} imported={Boolean(input)} brush={brushSettings} onBrush={paint} />
        {mechanics.gravity > 0 && <arrowHelper args={gravityArrow} />}
        <OrbitControls mouseButtons={editing
          ? { LEFT: undefined, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
          : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} />
      </Canvas>
      <div className="disk-view-caption">
        <span>{editing ? 'Left drag to edit · Right drag to orbit' : 'Drag to orbit · Scroll to zoom'}</span>
        {field && <span className="disk-field-key">Growth field</span>}
      </div>
    </div></section>
    <aside className="metrics-panel disk-inspector">
      <section><h2>Inspect</h2>
        <label>Mesh view
          <select value={view} onChange={event => setView(event.currentTarget.value as View)}>
            <option value="smooth">{input ? 'Surface' : 'Smooth surface'}</option>
            <option value="triangles">{'1 · Simulation triangles'}</option>
            <option value="cells">2 · Voronoi polygons</option>
            <option value="fans">3 · Retriangulated cells</option>
          </select>
        </label>
        <p className="hint">Choose which surface or mesh lines are shown. {input && 'Voronoi cells update from the current triangle vertices as the surface grows.'}</p>
        <label><span>Show growth field <input type="checkbox" checked={field} onChange={event => setField(event.currentTarget.checked)} /></span></label>
        <p className="hint">Colors faster-growing areas red.</p>
      </section>
      <section><h2>Project</h2>
        <p className="hint">Save the current shape, settings, and brush edits so you can pick up where you left off.</p>
        <input ref={projectRef} type="file" accept=".json,application/json" hidden aria-label="Choose a Growth Studio project file" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void openProject(file)
        }} />
        <div className="button-row">
          <button disabled={loading || active} onClick={saveProject}>Save project</button>
          <button disabled={loading || active} onClick={() => { if (confirmDiscard('Open another project?')) projectRef.current?.click() }}>Open project</button>
        </div>
        {active && <p className="hint">Stop the simulation to save, open, or export.</p>}
        {projectStatus && <p className="hint" role="status">{projectStatus}</p>}
        {projectError && <p className="hint" role="alert">{projectError}</p>}
      </section>
      <section><h2>Export mesh</h2>
        <p className="hint">Exports the current surface as triangles. Open sheets may need thickness before printing.</p>
        {input && <>
          <label><span>Center exported mesh <input type="checkbox" checked={centerExport}
            onChange={event => { setCenterExport(event.currentTarget.checked); setExportStatus('') }} /></span></label>
          <p className="hint">{input.sourceCenter
            ? 'Exports use the original STL coordinates unless you choose to center the mesh.'
            : 'This saved project predates coordinate preservation. Reimport the original STL to use its source coordinates.'}</p>
        </>}
        <button className="wide" disabled={active} onClick={() => exportMesh('obj')}>Export OBJ</button>
        <button className="wide" disabled={active} onClick={() => exportMesh('stl')}>Export STL</button>
        <p className="hint" role="status">{exportStatus}</p>
      </section>
      {view === 'fans' && <p className="hint">{input
        ? 'Dark lines show Voronoi boundaries. Orange lines show how each cell fragment is triangulated.'
        : 'Dark lines mark polygon boundaries. Orange lines connect each corner to its original mesh vertex.'}</p>}
      <section>
        <h2>Growth</h2>
        <dl>
          <div><dt>Step attempts</dt><dd>{revision}</dd></div>
          <div><dt>Maximum target strain</dt><dd>{Math.round(disk.strain * 100)}%</dd></div>
          <div><dt>Edge splits</dt><dd>{disk.splits}</dd></div>
          <div><dt>Triangles</dt><dd>{(disk.indices.length / 3).toLocaleString()}</dd></div>
          <div><dt>Vertices</dt><dd>{(disk.positions.length / 3).toLocaleString()} / {disk.growthBudget.toLocaleString()}</dd></div>
          <div><dt>Contact corrections · last step</dt><dd>{disk.lastContactCorrections}</dd></div>
          <div><dt>Overlap steps rejected</dt><dd>{disk.rejectedSteps}</dd></div>
          <div><dt>Growth speed after contact</dt><dd>{Math.round(disk.growthThrottle * 100)}%</dd></div>
        </dl>
        {slowed && <p className="hint">Blocked steps slowed growth to keep folds from passing through each other. It recovers as steps are accepted again. A larger Repel distance usually means fewer blocked steps.</p>}
        {detailLimit &&
          <p className="hint">Mesh detail limit reached. Growth can still reshape the existing triangles. Raise Mesh detail limit under Advanced to keep refining.</p>}
      </section>
    </aside>
    <footer className="spike-footer">{input ? 'STL surface · crease-preserving remesh' : 'Voronoi cells from rest-mesh vertices · solver uses the source triangles'}</footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
