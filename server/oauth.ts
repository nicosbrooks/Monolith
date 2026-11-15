import type { Connect, Plugin } from 'vite'

/**
 * Tiny backend for sign-in, mounted on the dev and preview servers.
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
      if (req.method === 'GET' && req.url === '/api/config') {
        return send(200, {
          github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID } : null,
          google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : null,
        })
      }
      if (req.method === 'POST' && req.url === '/api/github/token') {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return send(501, { error: 'GitHub sign-in is not configured' })
        let raw = ''
        for await (const chunk of req) raw += chunk
        const { code, redirectUri } = JSON.parse(raw || '{}')
        if (typeof code !== 'string') return send(400, { error: 'Missing code' })
        const r = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
        })
        const d = (await r.json()) as { access_token?: string; error?: string; error_description?: string }
        return d.access_token ? send(200, { token: d.access_token }) : send(400, { error: d.error_description || d.error || 'GitHub sign-in failed' })
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
