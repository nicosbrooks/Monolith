import { APP_NAME, OLD_APP_NAME } from '../brand'
import { AuthError, ConflictError, MD, type Entry, type FileProvider } from './types'

// Google Drive v3 with the narrow drive.file scope: the app only sees files it created,
// inside a folder named after the app in the user's Drive. Sign-in uses Google Identity Services (browser-only token flow).
const API = 'https://www.googleapis.com/drive/v3'
const UP = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

interface TokenClient { requestAccessToken(o?: { prompt?: string }): void }
interface GIS { accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type: string }) => void }): TokenClient } } }

let gisLoading: Promise<GIS> | null = null
/** Load Google's sign-in script early so the consent popup opens straight from the click. */
export const preloadGoogle = () => void loadGis().catch(() => {})
function loadGis(): Promise<GIS> {
  const w = window as unknown as { google?: GIS }
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google)
  return (gisLoading ??= new Promise((ok, fail) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.onload = () => ok(w.google!)
    s.onerror = () => fail(new Error('Could not load Google sign-in'))
    document.head.appendChild(s)
  }))
}

// Access tokens last an hour. Kept for this tab session only.
const KEY = 'socratic-gdrive-token'
export function cachedToken(): string | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return t && t.exp > Date.now() + 60_000 ? t.v : null
  } catch {
    return null
  }
}

/** Must be called from a click: opens Google's consent popup. */
export async function signInDrive(clientId: string): Promise<string> {
  const g = await loadGis()
  return new Promise((ok, fail) => {
    const c = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return fail(new Error(r.error || 'Google sign-in was cancelled'))
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ v: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 }))
        } catch { /* private mode */ }
        ok(r.access_token)
      },
      error_callback: (e) => fail(new Error(e.type === 'popup_closed' ? 'Google sign-in was cancelled' : `Google sign-in failed (${e.type})`)),
    })
    c.requestAccessToken({ prompt: '' })
  })
}
export const signOutDrive = () => sessionStorage.removeItem(KEY)

export function driveProvider(token: string, rootId: string): FileProvider & { dirIds: Map<string, string> } {
  const dirIds = new Map<string, string>([['', rootId]])
  const req = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } })
    if (res.status === 401) throw new AuthError('Google sign-in expired')
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || `Google Drive ${res.status}`)
    return (res.headers.get('content-type') || '').includes('json') ? res.json() : (res.text() as Promise<T>)
  }
  const children = async (id: string) => {
    const out: { id: string; name: string; mimeType: string; version: string }[] = []
    let page = ''
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed=false`)
      const r = await req<{ files: typeof out; nextPageToken?: string }>(`${API}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,version)&pageSize=1000${page ? `&pageToken=${page}` : ''}`)
      out.push(...r.files)
      page = r.nextPageToken || ''
    } while (page)
    return out
  }
  const mkdir = async (path: string): Promise<string> => {
    if (dirIds.has(path)) return dirIds.get(path)!
    const parent = await mkdir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    const f = await req<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: path.split('/').pop(), mimeType: FOLDER, parents: [parent] }),
    })
    dirIds.set(path, f.id)
    return f.id
  }
  const multipart = (meta: object, text: string) => {
    const b = 'socratic' + Math.random().toString(36).slice(2)
    return {
      headers: { 'Content-Type': `multipart/related; boundary=${b}` },
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`,
    }
  }

  return {
    dirIds,
    async list() {
      const out: Entry[] = []
      const walk = async (id: string, prefix: string, depth: number) => {
        if (depth > 8) return
        for (const f of await children(id)) {
          const path = prefix + f.name
          if (f.mimeType === FOLDER) {
            dirIds.set(path, f.id)
            out.push({ path, rev: '', id: f.id, dir: true })
            await walk(f.id, path + '/', depth + 1)
          } else if (MD.test(f.name)) out.push({ path, rev: f.version, id: f.id })
        }
      }
      await walk(rootId, '', 0)
      return out
    },
    read: (e) => req<string>(`${API}/files/${e.id}?alt=media`),
    async write(path, text, prev, force) {
      if (prev?.id) {
        const cur = await req<{ version: string; trashed: boolean }>(`${API}/files/${prev.id}?fields=version,trashed`).catch(() => null)
        if (cur && !cur.trashed) {
          if (!force && cur.version !== prev.rev) throw new ConflictError()
          const r = await req<{ id: string; version: string }>(`${UP}/files/${prev.id}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8' }, body: text })
          return { path, rev: r.version, id: r.id }
        }
      }
      const parent = await mkdir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
      const r = await req<{ id: string; version: string }>(`${UP}/files?uploadType=multipart&fields=id,version`, {
        method: 'POST',
        ...multipart({ name: path.split('/').pop(), parents: [parent], mimeType: 'text/markdown' }, text),
      })
      return { path, rev: r.version, id: r.id }
    },
    async remove(e) {
      // Moves to Drive's trash, so it can be recovered there.
      if (e.id) await req(`${API}/files/${e.id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
    },
    async rename(e, newPath) {
      const r = await req<{ id: string; version: string }>(`${API}/files/${e.id}?fields=id,version`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPath.split('/').pop() }),
      })
      return { path: newPath, rev: r.version, id: r.id }
    },
  }
}

/** Find or create the app's folder in Drive. */
export async function ensureRoot(token: string): Promise<string> {
  const h = { Authorization: `Bearer ${token}` }
  // A folder made before the rename keeps being used, so nothing has to move.
  for (const name of [APP_NAME, OLD_APP_NAME]) {
    const q = encodeURIComponent(`name='${name}' and mimeType='${FOLDER}' and 'root' in parents and trashed=false`)
    const r = await fetch(`${API}/files?q=${q}&fields=files(id)`, { headers: h }).then((x) => x.json())
    if (r.files?.[0]) return r.files[0].id
  }
  const c = await fetch(`${API}/files?fields=id`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: APP_NAME, mimeType: FOLDER }) }).then((x) => x.json())
  if (!c.id) throw new Error(c.error?.message || `Could not create the ${APP_NAME} folder in Drive`)
  return c.id
}
