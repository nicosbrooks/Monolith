import type { Connect, Plugin } from 'vite'

/**
 * Fetches a subscribed calendar (an .ics link from Google, Apple, Outlook…) on the server side, because those hosts
 * don't allow browsers to read them directly. Same rules as the hosted relay's /ics route (relay/src/index.ts).
 *
 *   POST /ics, body: <https or webcal URL>  →  the calendar file, or an error
 * The link travels in the body because private calendar links are secrets and URLs end up in logs.
 */
export const MAX_ICS = 5 * 1024 * 1024
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd]|.*\.local$|.*\.internal$)/i

export function icsTarget(raw: string | null): URL | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'))
    if (u.protocol !== 'https:' || PRIVATE.test(u.hostname)) return null
    return u
  } catch {
    return null
  }
}

export async function fetchIcs(raw: string | null): Promise<{ status: number; body: string }> {
  const u = icsTarget(raw)
  if (!u) return { status: 400, body: 'Use an https:// or webcal:// calendar link.' }
  const res = await fetch(u, { headers: { accept: 'text/calendar, */*' }, redirect: 'follow' }).catch(() => null)
  if (!res || !res.ok) return { status: 502, body: 'That calendar couldn’t be reached.' }
  const text = await res.text()
  if (text.length > MAX_ICS) return { status: 413, body: 'That calendar is too large.' }
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return { status: 422, body: 'That link isn’t a calendar.' }
  return { status: 200, body: text }
}

export function ics(): Plugin {
  const handle: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== '/ics' || req.method !== 'POST') return next()
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 2048) break
    }
    const { status, body } = await fetchIcs(raw.slice(0, 2048))
    res.statusCode = status
    res.setHeader('content-type', status === 200 ? 'text/calendar; charset=utf-8' : 'text/plain; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
  return {
    name: 'monolith-ics',
    configureServer: (s) => void s.middlewares.use(handle),
    configurePreviewServer: (s) => void s.middlewares.use(handle),
  }
}
