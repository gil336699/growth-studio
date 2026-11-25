// The print solid for the File tab's settings, from the surface as it has grown: a sheet's wall (lib/sheetSolid) or a
// closed shape's solid (lib/closedSolid), smoothed, with the loops chosen in the Edges tool kept sharp or rounded.
// Plain data in and out, so it runs in a worker (lib/printSolid.worker): on a dense mesh a round takes seconds.
import { closedSolid, type ClosedSolid } from './closedSolid'
import { printEdges, type EdgeChoice } from './edgeChoices'
import type { Skipped } from './roundEdges'
import { printSheet, sheetSolid, type SheetSolid } from './sheetSolid'
import { sharpEdges, smoothPassesFor, ungrownEdges, type SmoothLevel } from './smoothSheet'
import { facingSign, printScale, RIM_ROUNDNESS, WALL_SHIFT, type RimProfile, type WallSide } from './thicken'

// How far a round's facets may stray from a true circle, in mm: well under what a printer can show.
export const ROUND_TOLERANCE = 0.005
// The thinnest wall a round on a closed shape may leave, in mm, unless the shape's own walls are thinner: two lines of a
// 0.4 mm nozzle, the least the Wall thickness tooltip advises for filament printers.
export const ROUND_MIN_WALL = 0.8

// The surface as it has grown, and the starting shape it grew from, whose edges the Edges tool's loops are found on.
export type PrintMesh = { positions: Float32Array; indices: Uint32Array; referencePositions: Float32Array; localGrowth: Float32Array }
// Wall thickness and the longest side in mm, as the File tab sets them. size: the default disk's printed longest side.
export type SheetSettings = { wall: number; rim: RimProfile; side: WallSide; size: number; smooth: SmoothLevel; bevel: number; sharpAngle: number; choices: EdgeChoice[] }
// cut: how far above the lowest point Flat base cuts, in mm.
export type ClosedSettings = { smooth: SmoothLevel; bevel: number; sharpAngle: number; flatBase: boolean; cut: number; choices: EdgeChoice[] }
// scale: an STL's millimeters per model unit; null for the default disk, which has no units until it has a size.
export type PrintRequest =
  | { kind: 'sheet'; mesh: PrintMesh; scale: number | null; settings: SheetSettings }
  | { kind: 'closed'; mesh: PrintMesh; scale: number | null; settings: ClosedSettings }
export type PrintPlan = ReturnType<typeof printEdges>
// The solid, what the Edges tool's loops became (plan, and skipped for the rounds left sharp), and for a sheet the
// millimeters per model unit it's exported at.
export type SheetPrint = { solid: SheetSolid; mmPerUnit: number; plan: PrintPlan | null; skipped: Skipped }
export type ClosedPrint = { solid: ClosedSolid; plan: PrintPlan | null; skipped: Skipped }
export type PrintBuild = SheetPrint | ClosedPrint
// The worker's answer. A print that couldn't be made says why, or PRINT_FAILED if the error had nothing to say.
export type PrintReply = { ok: true; print: PrintBuild } | { ok: false; message: string }
export const PRINT_FAILED = 'unknown error'

// The edges that stay sharp when smoothing: sharp in the starting shape, and not grown since (lib/smoothSheet).
const keptCreases = (mesh: PrintMesh, angle: number) => ungrownEdges(sharpEdges(mesh.referencePositions, mesh.indices, angle), mesh.localGrowth)

export function makePrint(request: Extract<PrintRequest, { kind: 'sheet' }>): SheetPrint
export function makePrint(request: Extract<PrintRequest, { kind: 'closed' }>): ClosedPrint
export function makePrint(request: PrintRequest): PrintBuild
export function makePrint(request: PrintRequest): PrintBuild {
  return request.kind === 'sheet' ? makeSheet(request.mesh, request.scale, request.settings) : makeClosed(request.mesh, request.scale, request.settings)
}

// Outside and Inside follow the way the starting surface faces: away from the middle of an STL, or up from the disk.
// An STL keeps its own millimeters. The default disk is scaled so the solid itself, wall and rims included, has the
// chosen longest side; scaling the sheet alone made a 100 mm disk with a 5 mm wall export 105 mm long.
// Smooth first smooths the sheet (Loop subdivision, see lib/smoothSheet), and the wall follows the smoothed surface.
// Edges that bend more than sharpAngle in the starting shape, such as the edge around a flat bottom, stay sharp unless
// bevel rounds them. Loops chosen with the Edges tool are kept fully sharp while smoothing, and rounded after it, before
// the wall (lib/sheetSolid).
function makeSheet(mesh: PrintMesh, scale: number | null, settings: SheetSettings): SheetPrint {
  const { wall, rim, side, size, smooth, bevel, sharpAngle, choices } = settings
  const shift = side === 'both' ? 0 : WALL_SHIFT[side] * facingSign(mesh.referencePositions, mesh.indices, scale !== null ? 'outward' : 'up')
  const passes = smoothPassesFor(smooth, mesh.indices.length / 3)
  const creases = passes && bevel < 1 ? keptCreases(mesh, sharpAngle) : undefined
  const plan = scale !== null && choices.length ? printEdges(choices, mesh.referencePositions, mesh.indices, mesh.localGrowth, scale) : null
  const sheet = printSheet(mesh.positions, mesh.indices, { passes, creases, bevel, keep: plan?.keep, rounds: plan?.rounds })
  const build = (mm: number) => sheetSolid(sheet, { wall: wall / mm, roundness: RIM_ROUNDNESS[rim], shift, tolerance: ROUND_TOLERANCE / mm, sharpAngle })
  if (scale !== null) { const solid = build(scale); return { solid, mmPerUnit: scale, plan, skipped: solid.skipped } }
  // The default disk is scaled so the solid itself has the chosen longest side; it has no Edges choices.
  let mmPerUnit = printScale(mesh.positions, null, size), solid = build(mmPerUnit)
  for (let pass = 0; pass < 2; pass++) { mmPerUnit = printScale(solid.positions, null, size); solid = build(mmPerUnit) }
  return { solid, mmPerUnit, plan, skipped: solid.skipped }
}

// A closed shape, such as a brain, is a solid already: it prints as it grew, smoothed like a sheet, with its loops kept
// sharp or rounded, and cut flat at the bottom if asked (lib/closedSolid). Nothing is rebuilt or merged, so thin walls
// and designed edges stay.
function makeClosed(mesh: PrintMesh, scale: number | null, settings: ClosedSettings): ClosedPrint {
  const { smooth, bevel, sharpAngle, flatBase, cut, choices } = settings
  const passes = smoothPassesFor(smooth, mesh.indices.length / 3)
  const creases = passes && bevel < 1 ? keptCreases(mesh, sharpAngle) : undefined
  const plan = scale !== null && choices.length ? printEdges(choices, mesh.referencePositions, mesh.indices, mesh.localGrowth, scale) : null
  const solid = closedSolid(mesh.positions, mesh.indices, { passes, creases, bevel, keep: plan?.keep, rounds: plan?.rounds,
    tolerance: scale !== null ? ROUND_TOLERANCE / scale : undefined, sharpAngle, minWall: scale !== null ? ROUND_MIN_WALL / scale : undefined,
    cut: flatBase && scale !== null ? cut / scale : 0 })
  return { solid, plan, skipped: solid.skipped }
}

// The arrays a print hands back from its worker without copying them: a solid's can run to tens of megabytes.
export function printTransfer(print: PrintBuild): ArrayBuffer[] {
  const { solid } = print, buffers = new Set<ArrayBuffer>()
  for (const array of [solid.positions, solid.indices, solid.origin, solid.groups, solid.blend]) if (array?.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
  return [...buffers]
}
