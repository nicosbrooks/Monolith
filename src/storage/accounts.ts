import { create } from 'zustand'
import { del, get, set } from 'idb-keyval'
import { useStore } from '../store'
import { MD } from './types'

// ─── Server config (which one-click sign-ins are available) ───────────────

export interface AuthConfig { github: { clientId: string } | null; google: { clientId: string } | null }
let configP: Promise<AuthConfig> | null = null
export function authConfig(): Promise<AuthConfig> {
  return (configP ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((c) => c ?? { github: null, google: null }))
}
/** Google client ID from the server, or one pasted into Settings. */
export async function googleClientId() {
  return (await authConfig()).google?.clientId || useStore.getState().settings.googleClientId.trim() || ''
}

// ─── GitHub account ────────────────────────────────────────────────────────

export interface GitHubAccount { token: string; login: string; avatar?: string }
export const useAccounts = create<{ github: GitHubAccount | null; loaded: boolean }>(() => ({ github: null, loaded: false }))
get<GitHubAccount>('secret:github-account').then((github) => useAccounts.setState({ github: github ?? null, loaded: true }))

async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (r.status === 401) throw new Error('GitHub rejected that token')
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `GitHub ${r.status}`)
  return r.json()
}

export async function saveGitHubToken(token: string): Promise<GitHubAccount> {
  const u = await gh<{ login: string; avatar_url: string }>('/user', token)
  const acct = { token, login: u.login, avatar: u.avatar_url }
  await set('secret:github-account', acct)
  useAccounts.setState({ github: acct })
  return acct
}
export async function signOutGitHub() {
  await del('secret:github-account')
  useAccounts.setState({ github: null })
}

/**
 * Opens GitHub's consent page in a popup. Call straight from a click, after authConfig() has resolved,
 * so the popup isn't blocked.
 */
export function signInGitHub(clientId: string): Promise<GitHubAccount> {
  const state = crypto.randomUUID()
  const redirectUri = `${location.origin}/oauth/github.html`
  const url = `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: 'repo', state, allow_signup: 'true' })}`
  const popup = window.open(url, 'github-oauth', 'width=560,height=720')
  if (!popup) return Promise.reject(new Error('Allow pop-ups for this site to sign in with GitHub'))
  return new Promise((ok, fail) => {
    const bc = new BroadcastChannel('oauth')
    const done = () => (bc.close(), window.removeEventListener('message', onMsg), clearTimeout(timer))
    const handle = async (d: { type?: string; code?: string; state?: string; error?: string }) => {
      if (d?.type !== 'github-oauth' || d.state !== state) return
      done()
      if (!d.code) return fail(new Error(d.error || 'GitHub sign-in was cancelled'))
      try {
        const r = await fetch('/api/github/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: d.code, redirectUri }) })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'GitHub sign-in failed')
        ok(await saveGitHubToken(j.token))
      } catch (e) {
        fail(e)
      }
    }
    const onMsg = (e: MessageEvent) => e.origin === location.origin && handle(e.data)
    bc.onmessage = (e) => handle(e.data)
    window.addEventListener('message', onMsg)
    const timer = setTimeout(() => (done(), fail(new Error('GitHub sign-in timed out'))), 5 * 60_000)
  })
}

/** Pre-filled token page, for when one-click sign-in isn't set up. */
export const tokenUrl = (appName: string) =>
  `https://github.com/settings/tokens/new?${new URLSearchParams({ scopes: 'repo', description: `${appName} notes` })}`

export interface Repo { full_name: string; name: string; owner: { login: string }; private: boolean; pushed_at: string; default_branch: string; description: string | null; permissions?: { push: boolean } }

export async function listRepos(token: string): Promise<Repo[]> {
  const out: Repo[] = []
  for (let page = 1; page <= 5; page++) {
    const r = await gh<Repo[]>(`/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`, token)
    out.push(...r)
    if (r.length < 100) break
  }
  return out.filter((r) => r.permissions?.push !== false)
}

export async function createRepo(token: string, name: string, isPrivate: boolean, appName: string): Promise<Repo> {
  return gh<Repo>('/user/repos', token, {
    method: 'POST',
    body: JSON.stringify({ name, private: isPrivate, auto_init: true, description: `Notes and docs from ${appName}` }),
  })
}

/** Folders in a repo that contain Markdown, with how many files each holds. */
export async function repoFolders(token: string, fullName: string, branch: string): Promise<{ path: string; count: number }[]> {
  const t = await gh<{ tree: { path: string; type: string }[] }>(`/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token)
  const counts = new Map<string, number>()
  for (const e of t.tree) {
    if (e.type !== 'blob' || !MD.test(e.path) || e.path.split('/').some((s) => s.startsWith('.') || s === 'node_modules')) continue
    const parts = e.path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      counts.set(d, (counts.get(d) || 0) + 1)
    }
  }
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path))
}
