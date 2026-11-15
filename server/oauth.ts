import type { Connect, Plugin } from 'vite'
import { authConfig, githubToken } from './auth.ts'

/**
 * Tiny backend for sign-in, mounted on the dev and preview servers. The hosted site runs the same code as Pages
 * Functions (functions/api/).
 * GitHub won't hand an OAuth token to a browser directly (it needs the client secret
 * and doesn't allow CORS), so the code-for-token exchange happens here.
 *
 * Configure in .env.local:
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET  – a GitHub OAuth App
 *   GOOGLE_CLIENT_ID                         – a Google OAuth "Web application" client
 */
export function authApi(env: Record<string, string>): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    }
    try {
      if (req.method === 'GET' && req.url === '/api/config') return send(200, authConfig(env))
      if (req.method === 'POST' && req.url === '/api/github/token') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const r = await githubToken(env, raw)
        return send(r.status, r.body)
      }
      next()
    } catch (e) {
      send(500, { error: (e as Error).message })
    }
  }
  return {
    name: 'auth-api',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  }
}
