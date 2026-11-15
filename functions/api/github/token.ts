// POST /api/github/token on the hosted site (Cloudflare Pages Functions). GITHUB_CLIENT_SECRET is a Pages secret.
import { githubToken, type AuthEnv } from '../../../server/auth.ts'

export async function onRequestPost({ request, env }: { request: Request; env: AuthEnv }) {
  const raw = await request.text()
  if (raw.length > 4096) return Response.json({ error: 'Bad request' }, { status: 400 })
  const r = await githubToken(env, raw)
  return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
}
