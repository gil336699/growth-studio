import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createGrowingDisk } from '../physics/growingDisk'
import { readGrowthStl, type GrowthStlSource } from '../physics/growthStl'
import { findBorders, loopPoints, traceLoop } from './borders'
import { closedSolid } from './closedSolid'
import { finalStatus, printEdges, type EdgeChoice } from './edgeChoices'
import { makePrint, type ClosedSettings, type PrintBuild, type PrintMesh, type PrintReply, type PrintRequest, type SheetSettings } from './printSolid'
import { printSheet, sheetSolid } from './sheetSolid'
import { sharpEdges, smoothPassesFor, ungrownEdges } from './smoothSheet'
import { latheTriangles, stl } from './testStl'
import { facingSign, printScale, RIM_ROUNDNESS, WALL_SHIFT } from './thicken'

// The print solid the worker makes (lib/printSolid.worker) is the one the page made itself in 0.18.0, bit for bit, and
// so is the one the page makes when the worker can't start. onThePage is App's makeSolid and makeClosed as they were.

type Disk = PrintMesh
const keptCreases = (disk: Disk, angle: number) => ungrownEdges(sharpEdges(disk.referencePositions, disk.indices, angle), disk.localGrowth)
const ROUND_TOLERANCE = 0.005, ROUND_MIN_WALL = 0.8
function onThePage(request: PrintRequest) {
  const disk = request.mesh, input = request.scale === null ? null : { scale: request.scale }
  if (request.kind === 'sheet') {
    const { wall: wallMm, rim, side, size, smooth, bevel, sharpAngle, choices } = request.settings
    const shift = side === 'both' ? 0 : WALL_SHIFT[side] * facingSign(disk.referencePositions, disk.indices, input ? 'outward' : 'up')
    const passes = smoothPassesFor(smooth, disk.indices.length / 3)
    const creases = passes && bevel < 1 ? keptCreases(disk, sharpAngle) : undefined
    const plan = input && choices.length ? printEdges(choices, disk.referencePositions, disk.indices, disk.localGrowth, input.scale) : null
    const sheet = printSheet(disk.positions, disk.indices, { passes, creases, bevel, keep: plan?.keep, rounds: plan?.rounds })
    const build = (scale: number) => sheetSolid(sheet, { wall: wallMm / scale, roundness: RIM_ROUNDNESS[rim], shift, tolerance: ROUND_TOLERANCE / scale, sharpAngle })
    if (input) { const solid = build(input.scale); return { solid, mmPerUnit: input.scale, plan, skipped: solid.skipped } }
    let mmPerUnit = printScale(disk.positions, null, size), solid = build(mmPerUnit)
    for (let pass = 0; pass < 2; pass++) { mmPerUnit = printScale(solid.positions, null, size); solid = build(mmPerUnit) }
    return { solid, mmPerUnit, plan, skipped: solid.skipped }
  }
  const { smooth, bevel, sharpAngle: angle, flatBase: flat, cut: cutMm, choices } = request.settings
  const passes = smoothPassesFor(smooth, disk.indices.length / 3)
  const creases = passes && bevel < 1 ? keptCreases(disk, angle) : undefined
  const plan = input && choices.length ? printEdges(choices, disk.referencePositions, disk.indices, disk.localGrowth, input.scale) : null
  const solid = closedSolid(disk.positions, disk.indices, { passes, creases, bevel, keep: plan?.keep, rounds: plan?.rounds,
    tolerance: input ? ROUND_TOLERANCE / input.scale : undefined, sharpAngle: angle, minWall: input ? ROUND_MIN_WALL / input.scale : undefined,
    cut: flat && input ? cutMm / input.scale : 0 })
  return { solid, plan, skipped: solid.skipped }
}

// The worker module itself, given a stand-in for its global scope: a request goes in copied, as postMessage copies it,
// and the answer comes back with the arrays it hands over moved, not copied.
let inTheWorker: (request: PrintRequest) => { reply: PrintReply; moved: ArrayBuffer[] }
beforeAll(async () => {
  const posted: { message: PrintReply; transfer: Transferable[] }[] = []
  const scope = {
    onmessage: null as ((event: { data: PrintRequest }) => void) | null,
    postMessage: (message: PrintReply, options?: StructuredSerializeOptions) => posted.push({ message, transfer: options?.transfer ?? [] }),
  }
  vi.stubGlobal('self', scope)
  await import('./printSolid.worker')
  inTheWorker = request => {
    scope.onmessage!({ data: structuredClone(request) })
    const { message, transfer } = posted.pop()!
    return { reply: structuredClone(message, { transfer }), moved: transfer as ArrayBuffer[] }
  }
})

// Where two values differ, bit for bit: typed arrays byte by byte and of the same type, numbers by Object.is (so -0 and
// 0 differ), and everything else part by part.
function differences(a: unknown, b: unknown, path = 'print'): string[] {
  const kind = (x: unknown) => x === null ? 'null' : ArrayBuffer.isView(x) ? x.constructor.name : x instanceof Map ? 'Map' : Array.isArray(x) ? 'Array' : typeof x
  if (kind(a) !== kind(b)) return [`${path}: ${kind(a)} against ${kind(b)}`]
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    if (x.length !== y.length) return [`${path}: ${x.length} bytes against ${y.length}`]
    const at = x.findIndex((value, i) => value !== y[i])
    return at < 0 ? [] : [`${path}: byte ${at} differs`]
  }
  if (a instanceof Map && b instanceof Map) return differences([...a], [...b], path)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: ${a.length} items against ${b.length}`]
    return a.flatMap((item, i) => differences(item, b[i], `${path}[${i}]`))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])]
    return keys.flatMap(key => key in x && key in y ? differences(x[key], y[key], `${path}.${key}`) : [`${path}.${key}: only on one side`])
  }
  return Object.is(a, b) ? [] : [`${path}: ${String(a)} against ${String(b)}`]
}

// A point's place on a shape of revolution in mm: how far it is from the axis, and how high above the bottom.
function placeOn(shape: GrowthStlSource, P: ArrayLike<number> = shape.positions) {
  let low = Infinity
  for (let i = 1; i < shape.positions.length; i += 3) low = Math.min(low, shape.positions[i])
  return (v: number) => ({ rho: Math.hypot(P[v * 3], P[v * 3 + 2]) * shape.scale, h: (P[v * 3 + 1] - low) * shape.scale })
}
// The Edges tool's choice of the loop through the sharp edge nearest a place (mm from the axis and above the bottom),
// as a click there picks it.
function choiceAt(shape: GrowthStlSource, rho: number, h: number, action: EdgeChoice['action'], radius = 2): EdgeChoice {
  const borders = findBorders(shape.positions, shape.indices), place = placeOn(shape)
  let pick = 0, best = Infinity
  for (let i = 0; i < borders.sharp.length; i += 2) {
    const a = place(borders.sharp[i]), b = place(borders.sharp[i + 1]), d = Math.hypot((a.rho + b.rho) / 2 - rho, (a.h + b.h) / 2 - h)
    if (d < best) { best = d; pick = i }
  }
  const { points, closed } = loopPoints(traceLoop(borders, shape.positions, borders.sharp[pick], borders.sharp[pick + 1]), shape.positions)
  return { id: `${action}-${rho}-${h}`, points: Array.from(points), closed, action, radius }
}
// An STL as the app reads it, grown a little where grows says: its points there pushed 3% out from the axis, and
// marked as grown, so the surface now differs from the starting shape.
function grownMesh(shape: GrowthStlSource, grows: (rho: number, h: number) => boolean): PrintMesh {
  const place = placeOn(shape), positions = Float32Array.from(shape.positions), localGrowth = new Float32Array(positions.length / 3)
  for (let v = 0; v < localGrowth.length; v++) {
    const { rho, h } = place(v)
    if (!grows(rho, h)) continue
    localGrowth[v] = 0.5; positions[v * 3] *= 1.03; positions[v * 3 + 2] *= 1.03
  }
  return { positions, indices: Uint32Array.from(shape.indices), referencePositions: Float32Array.from(shape.positions), localGrowth }
}
const read = (profile: [number, number][], facets: number, name: string) => readGrowthStl(stl(latheTriangles(profile, facets)), name)
const SHEET: SheetSettings = { wall: 1.2, rim: 'round', side: 'both', size: 100, smooth: 'light', bevel: 0, sharpAngle: 30, choices: [] }
const CLOSED: ClosedSettings = { smooth: 'light', bevel: 0, sharpAngle: 30, flatBase: false, cut: 1, choices: [] }

// What became of each loop chosen, as the cards read it.
const statuses = (print: PrintBuild) => print.plan ? Object.fromEntries(finalStatus(print.plan.status, print.plan.roundIds, print.skipped)) : null

// Each case: the request as App makes it, and what the cards say of its loops, so each case makes what it should.
const cases: [string, () => PrintRequest, Record<string, string> | null][] = [
  ['an STL sheet, smoothed, with loops rounded, too small for the wall, kept sharp, grown and lost', () => {
    // A cup open on top, 20 mm across at the bottom, with two steps out to 26 mm, Z up as CAD writes it.
    const cup = read([[0, 0], [10, 0], [10, 8], [11.5, 8], [11.5, 14], [13, 14], [13, 30]], 48, 'cup.stl')
    const lost = { ...choiceAt(cup, 11.5, 14, 'sharp'), id: 'lost' }
    lost.points = lost.points.map((x, i) => i % 3 === 1 ? x + 3 / cup.scale : x)
    const choices = [choiceAt(cup, 10, 0, 'round', 2), choiceAt(cup, 10, 8, 'round', 0.5), choiceAt(cup, 11.5, 14, 'sharp'), choiceAt(cup, 13, 14, 'sharp'), lost]
    return { kind: 'sheet', mesh: grownMesh(cup, rho => rho > 12.5), scale: cup.scale, settings: { ...SHEET, bevel: 0.25, choices } }
  }, { 'round-10-0': 'rounded', 'round-10-8': 'under the wall', 'sharp-11.5-14': 'kept', 'sharp-13-14': 'grown', lost: 'missing' }],
  ['an STL sheet smoothed twice, its wall outside', () => {
    const cup = read([[0, 0], [10, 0], [10, 30]], 48, 'cup.stl')
    return { kind: 'sheet', mesh: grownMesh(cup, (_, h) => h > 20), scale: cup.scale,
      settings: { ...SHEET, smooth: 'strong', side: 'outside', rim: 'soft', choices: [choiceAt(cup, 10, 0, 'round', 3)] } }
  }, { 'round-10-0': 'rounded' }],
  ['a hat whose round folds the wall', () => {
    // From lib/sheetSolid's tests: a ring stands in the corner of the edge between brim and crown, where the round's
    // wall would fill it.
    const hat = readGrowthStl(stl([...latheTriangles([[20, 0], [10, 0], [10, 30]]), ...latheTriangles([[11.3, 0.7], [11.3, 5]])]), 'hat.stl')
    return { kind: 'sheet', mesh: grownMesh(hat, () => false), scale: hat.scale, settings: { ...SHEET, smooth: 'off', rim: 'square', choices: [choiceAt(hat, 10, 0, 'round', 2)] } }
  }, { 'round-10-0': 'folds the wall' }],
  ['the default disk, grown a little and scaled to its longest side, its wall underneath', () => {
    const disk = createGrowingDisk(), positions = Float32Array.from(disk.positions), localGrowth = new Float32Array(positions.length / 3)
    for (let v = 0; v < localGrowth.length; v++) {
      const r = Math.hypot(positions[v * 3], positions[v * 3 + 2])
      positions[v * 3 + 1] += 0.04 * r * r * Math.sin(5 * Math.atan2(positions[v * 3 + 2], positions[v * 3])); localGrowth[v] = r
    }
    const mesh = { positions, indices: Uint32Array.from(disk.indices), referencePositions: Float32Array.from(disk.referencePositions), localGrowth }
    // The default disk has no Edges choices: a choice left from an STL is ignored, as on the page.
    const stray: EdgeChoice = { id: 'stray', points: [0, 0, 0, 1, 0, 0, 1, 0, 1], closed: true, action: 'round', radius: 2 }
    return { kind: 'sheet', mesh, scale: null, settings: { ...SHEET, wall: 2, side: 'inside', size: 80, bevel: 1, choices: [stray] } }
  }, null],
  ['a closed pot, as it is, with a round that thins the wall, one cut away by the flat base, and one made', () => {
    // From lib/closedSolid's tests: a pot 60 mm across with 1.2 mm walls and bottom.
    const pot = read([[0, 0], [30, 0], [30, 50], [28.8, 50], [28.8, 1.2], [0, 1.2]], 96, 'pot.stl')
    const choices = [choiceAt(pot, 30, 0, 'round', 3), choiceAt(pot, 28.8, 1.2, 'round', 0.5), choiceAt(pot, 30, 50, 'round', 0.5)]
    return { kind: 'closed', mesh: grownMesh(pot, (_, h) => h > 20 && h < 40), scale: pot.scale, settings: { ...CLOSED, smooth: 'off', flatBase: true, cut: 2, choices } }
  }, { 'round-30-0': 'thins the wall', 'round-28.8-1.2': 'cut away', 'round-30-50': 'rounded' }],
  ['a closed can, smoothed, rounded and cut flat', () => {
    const can = read([[0, 0], [10, 0], [10, 30], [0, 30]], 48, 'can.stl')
    return { kind: 'closed', mesh: grownMesh(can, (_, h) => h > 12 && h < 18), scale: can.scale,
      settings: { ...CLOSED, bevel: 0.5, flatBase: true, cut: 1, choices: [choiceAt(can, 10, 0, 'round', 2), choiceAt(can, 10, 30, 'sharp')] } }
  }, { 'round-10-0': 'rounded', 'sharp-10-30': 'kept' }],
]

describe('print solid in a worker', () => {
  it.each(cases)('makes %s as the page did, bit for bit', (_, make, cards) => {
    const request = make(), before = onThePage(request)
    const { reply, moved } = inTheWorker(request)
    if (!reply.ok) throw new Error(reply.message)
    expect(differences(before, reply.print)).toEqual([])
    // The page makes the same print itself when the worker can't start.
    expect(differences(before, makePrint(request))).toEqual([])
    expect(statuses(reply.print)).toEqual(cards)
    // The solid comes back without a copy, and a sheet's rounds still count their own points in the crossing check.
    expect(moved.length).toBeGreaterThanOrEqual(3)
    expect(moved.every(buffer => buffer.byteLength === 0)).toBe(true)
    if (request.kind === 'sheet' && cards && Object.values(cards).includes('rounded')) expect(reply.print.solid.groups).toBeInstanceOf(Uint32Array)
  }, 30_000)

  it('says what went wrong when a print can\'t be made, instead of failing without a word', () => {
    // A mesh without its triangles: making its print throws.
    const mesh = { positions: new Float32Array(9), indices: null as unknown as Uint32Array, referencePositions: new Float32Array(9), localGrowth: new Float32Array(3) }
    const { reply } = inTheWorker({ kind: 'sheet', mesh, scale: 1, settings: SHEET })
    expect(reply.ok).toBe(false)
    expect(reply.ok ? '' : reply.message).toMatch(/\w/)
  })
})
