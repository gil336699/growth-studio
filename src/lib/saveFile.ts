// Save a file with the system save dialog where the browser offers one, otherwise as a download.
// Embedded browsers can ignore download links, so the save dialog is tried first.

type Picker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable: () => Promise<{ write: (data: BlobPart) => Promise<void>; close: () => Promise<void> }> }>

export type SaveResult = 'saved' | 'downloaded' | 'cancelled' | 'failed'

export async function saveFile(filename: string, data: BlobPart, type: string, description: string): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
  if (picker) {
    try {
      const extension = filename.slice(filename.lastIndexOf('.'))
      const handle = await picker.call(window, { suggestedName: filename, types: [{ description, accept: { [type]: [extension] } }] })
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
      return 'saved'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Fall through to a download when the dialog is unavailable.
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}
