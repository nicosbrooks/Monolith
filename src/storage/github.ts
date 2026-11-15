import { del, get, set } from 'idb-keyval'
import { AuthError, ConflictError, MD, type BatchProvider, type Entry } from './types'

// GitHub REST API (CORS-enabled). Auth is a fine-grained personal access token with Contents: read & write.
export const saveToken = (id: string, t: string) => set(`secret:${id}`, t)
export const loadToken = (id: string) => get<string>(`secret:${id}`)
export const forgetToken = (id: string) => del(`secret:${id}`)

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = input.trim().replace(/\.git$/, '').match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)\/?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

async function api<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (res.status === 401) throw new AuthError('GitHub token was rejected')
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.message || `GitHub ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function inspectRepo(owner: string, repo: string, token?: string) {
  const r = await api<{ default_branch: string; full_name: string; permissions?: { push: boolean } }>(`/repos/${owner}/${repo}`, token)
  return { branch: r.default_branch, name: r.full_name, canPush: !!r.permissions?.push }
}

const b64ToText = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

/** Git's blob id, so we know the new revision without another request. */
export async function blobSha(text: string) {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head), all.set(body, head.length)
  const h = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function githubProvider(cfg: { owner: string; repo: string; branch: string; base?: string }, token: string | undefined, canPush: boolean): BatchProvider {
  const R = `/repos/${cfg.owner}/${cfg.repo}`
  const base = (cfg.base || '').replace(/^\/|\/$/g, '')
  const full = (p: string) => (base ? `${base}/${p}` : p)

  const list = async (): Promise<Entry[]> => {
    const t = await api<{ tree: { path: string; type: string; sha: string }[] }>(`${R}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`, token)
    return t.tree
      .filter((e) => !base || e.path.startsWith(base + '/'))
      .map((e) => ({ ...e, rel: base ? e.path.slice(base.length + 1) : e.path }))
      .filter((e) => !e.rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules'))
      .filter((e) => e.type === 'tree' || (e.type === 'blob' && MD.test(e.rel)))
      .map((e) => ({ path: e.rel, rev: e.type === 'tree' ? '' : e.sha, dir: e.type === 'tree' }))
  }

  return {
    batch: true,
    readOnly: !token || !canPush,
    list,
    async read(e) {
      const b = await api<{ content: string }>(`${R}/git/blobs/${e.rev}`, token)
      return b64ToText(b.content)
    },
    async commit(changes, message) {
      // Refuse files that changed on GitHub since we last pulled them.
      const remote = new Map((await list()).map((e) => [e.path, e.rev]))
      if (changes.some((c) => c.prevRev && remote.get(c.path) !== c.prevRev && !(c.text === null && !remote.has(c.path)))) throw new ConflictError()
      const ref = await api<{ object: { sha: string } }>(`${R}/git/ref/heads/${encodeURIComponent(cfg.branch)}`, token)
      const parent = await api<{ tree: { sha: string } }>(`${R}/git/commits/${ref.object.sha}`, token)
      const tree = await api<{ sha: string }>(`${R}/git/trees`, token, {
        method: 'POST',
        body: JSON.stringify({
          base_tree: parent.tree.sha,
          tree: changes
            .filter((c) => c.text !== null || remote.has(c.path))
            .map((c) => ({ path: full(c.path), mode: '100644', type: 'blob', ...(c.text === null ? { sha: null } : { content: c.text }) })),
        }),
      })
      const commit = await api<{ sha: string }>(`${R}/git/commits`, token, { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) })
      try {
        await api(`${R}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, token, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
      } catch (e) {
        if ((e as { status?: number }).status === 422) throw new ConflictError()
        throw e
      }
      const revs: Record<string, string> = {}
      for (const c of changes) if (c.text !== null) revs[c.path] = await blobSha(c.text)
      return revs
    },
  }
}
