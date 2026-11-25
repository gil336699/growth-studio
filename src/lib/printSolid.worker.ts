// Makes the print solid off the page's thread (lib/usePrintSolid), since on a dense mesh smoothing, rounds and their
// checks take seconds. The solid's arrays are handed back, not copied.
import { makePrint, PRINT_FAILED, printTransfer, type PrintReply, type PrintRequest } from './printSolid'

self.onmessage = ({ data }: MessageEvent<PrintRequest>) => {
  let reply: PrintReply
  try {
    reply = { ok: true, print: makePrint(data) }
  } catch (error) {
    reply = { ok: false, message: error instanceof Error && error.message ? error.message : PRINT_FAILED }
  }
  self.postMessage(reply, { transfer: reply.ok ? printTransfer(reply.print) : [] })
}
