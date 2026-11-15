import { del, get, set } from 'idb-keyval'
import { ConflictError, MD, type Entry, type FileProvider } from './types'

// File System Access API (Chrome, Edge, Arc). Handles are stored in IndexedDB so the folder survives reloads.
type DH = FileSystemDirectoryHandle
type FH = FileSystemFileHandle
const SKIP = /^(\.|node_modules$|dist$|build$)/
const RW = { mode: 'readwrite' } as const

export const hasFolderAccess = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function pickFolder(): Promise<DH> {
  return (window as unknown as { showDirectoryPicker: (o: object) => Promise<DH> }).showDirectoryPicker({ mode: 'readwrite', id: 'socratic' })
}
export const saveHandle = (id: string, h: DH) => set(`fsh:${id}`, h)
export const loadHandle = (id: string) => get<DH>(`fsh:${id}`)
export const forgetHandle = (id: string) => del(`fsh:${id}`)

type PermHandle = DH & { queryPermission(o: object): Promise<PermissionState>; requestPermission(o: object): Promise<PermissionState> }
export async function hasPermission(h: DH, ask: boolean) {
  const p = h as PermHandle
  if (!p.queryPermission) return true // origin-private folders need no prompt
  if ((await p.queryPermission(RW)) === 'granted') return true
  return ask && (await p.requestPermission(RW)) === 'granted'
}

export function folderProvider(root: DH): FileProvider {
  const dirFor = async (path: string, create: boolean) => {
    let d = root
    for (const part of path.split('/').slice(0, -1)) if (part) d = await d.getDirectoryHandle(part, { create })
    return d
  }
  const fileFor = async (path: string, create = false): Promise<FH | null> => {
    try {
      return await (await dirFor(path, create)).getFileHandle(path.split('/').pop()!, { create })
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return null
      throw e
    }
  }
  const revOf = (f: File) => `${f.lastModified}-${f.size}`

  return {
    async list() {
      const out: Entry[] = []
      const walk = async (d: DH, prefix: string, depth: number) => {
        if (depth > 8 || out.length > 3000) return
        for await (const [name, child] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (SKIP.test(name)) continue
          const path = prefix + name
          if (child.kind === 'directory') {
            out.push({ path, rev: '', dir: true })
            await walk(child as DH, path + '/', depth + 1)
          } else if (MD.test(name)) {
            out.push({ path, rev: revOf(await (child as FH).getFile()) })
          }
        }
      }
      await walk(root, '', 0)
      return out
    },
    async read(e) {
      const h = await fileFor(e.path)
      return h ? (await h.getFile()).text() : ''
    },
    async write(path, text, prev, force) {
      if (prev && !force) {
        const cur = await fileFor(path)
        if (cur && revOf(await cur.getFile()) !== prev.rev) throw new ConflictError()
      }
      const h = (await fileFor(path, true))!
      const w = await h.createWritable()
      await w.write(text)
      await w.close()
      return { path, rev: revOf(await h.getFile()) }
    },
    async remove(e) {
      try {
        await (await dirFor(e.path, false)).removeEntry(e.path.split('/').pop()!)
      } catch (err) {
        if ((err as DOMException).name !== 'NotFoundError') throw err
      }
    },
  }
}
