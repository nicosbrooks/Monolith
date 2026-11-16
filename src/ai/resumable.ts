// A download that survives being interrupted. Models are 0.3 to 4 GB; on an ordinary connection that's long enough
// for Wi-Fi to drop, a laptop to sleep or a tab to be closed. Starting again from nothing each time means some people
// never finish. Here the file is written in place as it arrives, a small note beside it records what it is and how
// far it got, and the next try asks the server for the rest only (an HTTP Range request).
//
// Used inside the model workers. No imports, so it can be tested on its own (tests/e2e/download.spec.ts).

export interface Source { url: string; size?: number }
export interface Progress { (fraction: number, loaded: number, total: number): void }

interface Note { url: string; total: number; etag?: string }
const noteName = (file: string) => `${file}.part.json`

type SyncHandle = { write(data: BufferSource, o?: { at: number }): number; flush(): void; close(): void; getSize(): number; truncate(n: number): void }
type FileHandle = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> }

/** Where the bytes go. In a worker, written in place and kept even if the tab dies; elsewhere, kept when closed. */
async function openForAppend(handle: FileHandle, from: number): Promise<{ write(chunk: Uint8Array): Promise<void>; save(): Promise<void>; close(): Promise<void> }> {
  if (handle.createSyncAccessHandle) {
    const h = await handle.createSyncAccessHandle()
    h.truncate(from)
    let at = from
    return {
      write: async (chunk) => void (at += h.write(chunk as BufferSource, { at })),
      save: async () => h.flush(),
      close: async () => (h.flush(), h.close()),
    }
  }
  const w = await handle.createWritable({ keepExistingData: from > 0 })
  if (from > 0) await w.seek(from)
  else await w.truncate(0)
  return { write: (chunk) => w.write(chunk as BufferSource), save: async () => {}, close: () => w.close() }
}

async function readNote(dir: FileSystemDirectoryHandle, file: string): Promise<Note | undefined> {
  try {
    return JSON.parse(await (await (await dir.getFileHandle(noteName(file))).getFile()).text()) as Note
  } catch {
    return undefined
  }
}
async function writeNote(dir: FileSystemDirectoryHandle, file: string, note: Note) {
  const w = await (await dir.getFileHandle(noteName(file), { create: true })).createWritable()
  await w.write(JSON.stringify(note))
  await w.close()
}

const GB = 1024 ** 3
const size = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`)

/** Thrown when the download can't go on; `resumable` says whether what arrived was kept for next time. */
export class DownloadError extends Error {
  resumable: boolean
  constructor(message: string, resumable: boolean) {
    super(message)
    this.resumable = resumable
  }
}

/**
 * Download `src` into `file` in `dir`, carrying on from an earlier try when there is one. Resolves with the number of
 * bytes in the finished file. On failure what arrived is kept (unless the server sent something unexpected), and the
 * error says so.
 */
export async function download(dir: FileSystemDirectoryHandle, file: string, src: Source, onProgress?: Progress, signal?: AbortSignal): Promise<number> {
  const handle = (await dir.getFileHandle(file, { create: true })) as FileHandle
  const note = await readNote(dir, file)
  let have = (await handle.getFile()).size
  // Only carry on from a part of the same file: same address, same length.
  // (Addresses are compared without their query: download links are often signed afresh each time.)
  const same = (a: string, b: string) => a.split('?')[0] === b.split('?')[0]
  if (!note || !same(note.url, src.url) || (src.size && note.total !== src.size) || have > note.total) have = 0

  // Room for the rest, with a little to spare. Checked before asking for a byte.
  const need = (src.size ?? note?.total ?? 0) - have
  if (need > 0 && navigator.storage?.estimate) {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate().catch(() => ({ quota: 0, usage: 0 }))
    if (quota && quota - usage < need + 64 * 1024 ** 2) throw new DownloadError(`Not enough space for this model: it needs ${size(need)} more and this browser has ${size(Math.max(0, quota - usage))} free.`, have > 0)
  }

  const headers: Record<string, string> = have > 0 ? { Range: `bytes=${have}-`, ...(note?.etag ? { 'If-Range': note.etag } : {}) } : {}
  let res: Response
  try {
    res = await fetch(src.url, { headers, signal })
  } catch (e) {
    throw new DownloadError((e as Error)?.message || 'Failed to fetch', have > 0)
  }
  // 206: the server is sending the rest. 200: it's sending everything (it doesn't do ranges, or the file changed).
  if (res.status === 200) have = 0
  else if (res.status === 416 && note && have === note.total) return have // already complete
  else if (res.status !== 206) throw new DownloadError(`The model couldn’t download (${res.status}).`, have > 0)
  if (!res.body) throw new DownloadError('The model couldn’t download.', have > 0)
  const total = src.size ?? (res.status === 206 ? Number(res.headers.get('content-range')?.split('/')[1]) || 0 : Number(res.headers.get('content-length')) || 0) ?? 0
  await writeNote(dir, file, { url: src.url, total, etag: res.headers.get('etag') ?? undefined })

  const out = await openForAppend(handle, have)
  let got = have
  let reported = have
  let saved = have
  if (have) onProgress?.(total ? have / total : 0, have, total)
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await out.write(value)
      got += value.byteLength
      if (total && got - reported > 4_000_000) {
        reported = got
        onProgress?.(got / total, got, total)
      }
      // Every 32 MB, make sure what has arrived is really on disk.
      if (got - saved > 32 * 1024 ** 2) {
        saved = got
        await out.save()
      }
    }
    await out.close()
  } catch (e) {
    await out.close().catch(() => {})
    throw new DownloadError((e as Error)?.message || 'The model download was cut short.', got > 0)
  }
  if (total && got !== total) throw new DownloadError('The model download was cut short. Check your connection and try again.', got > 0 && got < total)
  await dir.removeEntry(noteName(file)).catch(() => {})
  return got
}

/** Remove a part-finished download and its note. */
export async function discard(dir: FileSystemDirectoryHandle, file: string) {
  await dir.removeEntry(noteName(file)).catch(() => {})
  await dir.removeEntry(file).catch(() => {})
}

/** How much of a file has arrived so far (0 to 1), for showing "Paused at 40%". Undefined when nothing is waiting. */
export async function partial(dir: FileSystemDirectoryHandle, file: string): Promise<number | undefined> {
  const note = await readNote(dir, file)
  if (!note?.total) return undefined
  try {
    const have = (await (await dir.getFileHandle(file)).getFile()).size
    return have > 0 && have < note.total ? have / note.total : undefined
  } catch {
    return undefined
  }
}
