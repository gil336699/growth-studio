// The print solid for the File tab's settings, made in a worker (lib/printSolid.worker), so the page stays responsive
// while it's made: on a dense mesh a round takes seconds. A change of settings stops the print being made for the last
// ones and drops its answer, and the last print stays up until the next one is ready.
import { useEffect, useRef, useState } from 'react'
import { makePrint, PRINT_FAILED, type PrintBuild, type PrintReply, type PrintRequest } from './printSolid'

// A change waits this long before its print is started, so dragging a slider makes one print when it stops, not one
// for every step of the drag.
export const PRINT_DELAY_MS = 100

export type PrintWorker = {
  onmessage: ((event: MessageEvent<PrintReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(request: PrintRequest): void
  terminate(): void
}
export type PrintOutcome = { print: PrintBuild; error?: undefined } | { print: null; error: string }
// The last print made, for the request it was made for, and that request's key (printKey).
export type Built = { key: string; request: PrintRequest; print: PrintBuild | null; error: string }

const spawnWorker = (): PrintWorker => new Worker(new URL('./printSolid.worker.ts', import.meta.url), { type: 'module' })
const reason = (error: unknown) => error instanceof Error && error.message ? error.message : PRINT_FAILED

// Starts making request's print and calls done with it once, unless the cancel it returns is called first: then the
// worker stops, and an answer already on its way is dropped. Where the worker can't be made, can't be sent the request,
// or fails, the page makes the print itself, as it always did before 0.18.1.
export function startPrintBuild(request: PrintRequest, done: (outcome: PrintOutcome) => void,
  { spawn = spawnWorker, fallback = makePrint, delay = PRINT_DELAY_MS }: { spawn?: () => PrintWorker; fallback?: (request: PrintRequest) => PrintBuild; delay?: number } = {}) {
  let over = false, worker: PrintWorker | null = null
  const finish = (outcome: () => PrintOutcome) => {
    worker?.terminate()
    if (over) return
    over = true
    done(outcome())
  }
  const onPage = () => finish(() => { try { return { print: fallback(request) } } catch (error) { return { print: null, error: reason(error) } } })
  const timer = setTimeout(() => {
    try {
      const own = worker = spawn()
      own.onmessage = ({ data }) => finish(() => data.ok ? { print: data.print } : { print: null, error: data.message || PRINT_FAILED })
      own.onerror = event => { event.preventDefault(); onPage() }
      own.onmessageerror = onPage
      own.postMessage(request)
    } catch {
      onPage()
    }
  }, delay)
  return () => { over = true; clearTimeout(timer); worker?.terminate() }
}

// Two requests with the same key make the same print: the same kind, surface, units and settings.
const meshIds = new WeakMap<object, number>()
let meshCount = 0
export function printKey(request: PrintRequest) {
  if (!meshIds.has(request.mesh)) meshIds.set(request.mesh, ++meshCount)
  return `${request.kind}:${meshIds.get(request.mesh)}:${request.scale}:${JSON.stringify(request.settings)}`
}

// What to show for the print asked for: the one made for it, or while that's being made, the last one made for the same
// surface. settled: whether the print shown is the one asked for, as Export needs. With nothing asked for, as while
// growth runs, there is none.
export function printState(built: Built | null, request: PrintRequest | null): { print: PrintBuild | null; settled: boolean; error: string } {
  if (!request) return { print: null, settled: true, error: '' }
  const settled = built !== null && built.key === printKey(request)
  return { print: built && built.request.mesh === request.mesh ? built.print : null, settled, error: settled ? built.error : '' }
}

// request: a new object whenever anything that changes the print may have, and the same one otherwise. One with the same
// key as the last print made, as when Add thickness goes off and on again, shows that print at once.
export function usePrintSolid(request: PrintRequest | null) {
  const [built, setBuilt] = useState<Built | null>(null)
  const made = useRef<Built | null>(null)
  useEffect(() => {
    if (!request) return
    const key = printKey(request)
    if (made.current?.print && made.current.key === key) return
    return startPrintBuild(request, ({ print, error }) => { made.current = { key, request, print, error: error ?? '' }; setBuilt(made.current) })
  }, [request])
  return printState(built, request)
}
