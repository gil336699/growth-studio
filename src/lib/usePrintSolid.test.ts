import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRINT_FAILED, type PrintBuild, type PrintMesh, type PrintReply, type PrintRequest } from './printSolid'
import { PRINT_DELAY_MS, printKey, printState, startPrintBuild, type PrintOutcome, type PrintWorker } from './usePrintSolid'

// A stand-in for the print worker: it keeps what it's sent, and answers only when told to, as a slow round would.
// An answer still arrives after terminate, as one already on its way can. refuse: postMessage throws, as it does for a
// request it can't copy.
class FakeWorker implements PrintWorker {
  onmessage: PrintWorker['onmessage'] = null
  onerror: PrintWorker['onerror'] = null
  onmessageerror: PrintWorker['onmessageerror'] = null
  sent: PrintRequest[] = []
  terminated = false
  constructor(readonly refuse = false) {}
  postMessage(request: PrintRequest) { if (this.refuse) throw new DOMException('Could not be cloned.', 'DataCloneError'); this.sent.push(request) }
  terminate() { this.terminated = true }
  answer(reply: PrintReply) { this.onmessage?.({ data: reply } as MessageEvent<PrintReply>) }
  crash() { this.onerror?.({ preventDefault() {} } as ErrorEvent) }
  unreadable() { this.onmessageerror?.({} as MessageEvent) }
}
const mesh = (name: string) => ({ name }) as unknown as PrintMesh
const request = (name: string, on = mesh('cup')) => ({ kind: 'sheet', mesh: on, scale: 1, settings: { name } }) as unknown as PrintRequest
const print = (name: string) => ({ name }) as unknown as PrintBuild

let workers: FakeWorker[], done: ReturnType<typeof vi.fn<(outcome: PrintOutcome) => void>>, fallback: ReturnType<typeof vi.fn<(request: PrintRequest) => PrintBuild>>
const start = (asked: PrintRequest, spawn = (refuse = false) => { const worker = new FakeWorker(refuse); workers.push(worker); return worker }) =>
  startPrintBuild(asked, done, { spawn: () => spawn(), fallback })
beforeEach(() => {
  vi.useFakeTimers()
  workers = []
  done = vi.fn<(outcome: PrintOutcome) => void>()
  fallback = vi.fn<(request: PrintRequest) => PrintBuild>(asked => print(`page ${(asked.settings as unknown as { name: string }).name}`))
})
afterEach(() => { vi.useRealTimers() })

describe('making the print in a worker', () => {
  it('makes one print for a burst of changes, once they stop', () => {
    // Dragging a slider: each step replaces the last before its print is started.
    let cancel = start(request('1 mm'))
    for (const wall of ['1.1 mm', '1.2 mm']) { vi.advanceTimersByTime(PRINT_DELAY_MS / 2); cancel(); cancel = start(request(wall)) }
    expect(workers).toHaveLength(0)
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    expect(workers).toHaveLength(1)
    expect(workers[0].sent).toEqual([request('1.2 mm')])
    workers[0].answer({ ok: true, print: print('1.2 mm') })
    expect(done.mock.calls).toEqual([[{ print: print('1.2 mm') }]])
    expect(workers[0].terminated).toBe(true)
  })

  it('drops a print whose settings changed while it was being made, even when its answer is already on its way', () => {
    const cancel = start(request('2 mm round'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    const [first] = workers
    expect(first.sent).toEqual([request('2 mm round')])
    // The radius changes while the 2 mm round is being made: that work stops, and the new radius is made instead.
    cancel()
    expect(first.terminated).toBe(true)
    start(request('3 mm round'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    first.answer({ ok: true, print: print('2 mm round') })
    expect(done).not.toHaveBeenCalled()
    workers[1].answer({ ok: true, print: print('3 mm round') })
    expect(done.mock.calls).toEqual([[{ print: print('3 mm round') }]])
  })

  it('makes the print on the page, as before, when the worker can\'t start', () => {
    start(request('round'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    workers[0].crash()
    expect(fallback.mock.calls).toEqual([[request('round')]])
    expect(done.mock.calls).toEqual([[{ print: print('page round') }]])
    expect(workers[0].terminated).toBe(true)
    // A worker that fails after its settings changed makes nothing on the page.
    const cancel = start(request('later'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    cancel()
    workers[1].crash()
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('makes the print on the page when the worker can\'t be made at all, or can\'t be sent the request, or its answer can\'t be read', () => {
    // A page that may not start workers, as in some sandboxed frames: new Worker throws at once.
    start(request('round'), () => { throw new DOMException('Workers are not allowed.', 'SecurityError') })
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    expect(done.mock.calls).toEqual([[{ print: print('page round') }]])
    start(request('unsent'), () => { const worker = new FakeWorker(true); workers.push(worker); return worker })
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    expect(done.mock.calls[1]).toEqual([{ print: print('page unsent') }])
    expect(workers.at(-1)!.terminated).toBe(true)
    start(request('unread'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    workers.at(-1)!.unreadable()
    expect(done.mock.calls.slice(2)).toEqual([[{ print: print('page unread') }]])
    // An error that follows makes nothing more: done is called once for each print.
    workers.at(-1)!.crash()
    expect(done.mock.calls.slice(2)).toEqual([[{ print: print('page unread') }]])
    expect(fallback).toHaveBeenCalledTimes(3)
  })

  it('says why when the print can\'t be made', () => {
    start(request('round'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    workers[0].answer({ ok: false, message: 'Out of memory.' })
    expect(done.mock.calls).toEqual([[{ print: null, error: 'Out of memory.' }]])
    // Nor on the page, when the worker can't start.
    fallback.mockImplementation(() => { throw new Error('Out of memory.') })
    start(request('again'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    workers[1].crash()
    expect(done.mock.calls[1]).toEqual([{ print: null, error: 'Out of memory.' }])
    // An error with nothing to say still says the print failed, so the page doesn't wait for it.
    start(request('quiet'))
    vi.advanceTimersByTime(PRINT_DELAY_MS)
    workers[2].answer({ ok: false, message: '' })
    expect(done.mock.calls[2]).toEqual([{ print: null, error: PRINT_FAILED }])
  })

  it('keeps the last print up while the next is made, for the same surface only', () => {
    const cup = mesh('cup'), asked = request('2 mm', cup), made = { key: printKey(asked), request: asked, print: print('2 mm'), error: '' }
    expect(printState(made, asked)).toEqual({ print: print('2 mm'), settled: true, error: '' })
    // The same settings asked for again, as when Add thickness goes off and on: that print, at once.
    expect(printState(made, request('2 mm', cup))).toEqual({ print: print('2 mm'), settled: true, error: '' })
    // New settings: the last print stays up until the new one is ready, so the view doesn't flicker.
    expect(printState(made, request('3 mm', cup))).toEqual({ print: print('2 mm'), settled: false, error: '' })
    // A surface that grew or another model: the last print isn't shown on it.
    expect(printState(made, request('2 mm', mesh('grown cup')))).toEqual({ print: null, settled: false, error: '' })
    // No print asked for, as while growth runs.
    expect(printState(made, null)).toEqual({ print: null, settled: true, error: '' })
    expect(printState(null, asked)).toEqual({ print: null, settled: false, error: '' })
    const failed = { key: printKey(asked), request: asked, print: null, error: 'Out of memory.' }
    expect(printState(failed, asked)).toEqual({ print: null, settled: true, error: 'Out of memory.' })
    expect(printState(failed, request('3 mm', cup))).toEqual({ print: null, settled: false, error: '' })
  })
})
