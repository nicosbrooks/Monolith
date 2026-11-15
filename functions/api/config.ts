// GET /api/config on the hosted site (Cloudflare Pages Functions). Same answer as the dev server's.
import { authConfig, type AuthEnv } from '../../server/auth.ts'

export const onRequestGet = ({ env }: { env: AuthEnv }) =>
  Response.json(authConfig(env), { headers: { 'Cache-Control': 'no-store' } })
