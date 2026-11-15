// Sign-in helpers shared by the Vite dev/preview server (server/oauth.ts) and the hosted site's Pages Functions
// (functions/api/…). No Node or Workers APIs here, only fetch, so both can run it.

export interface AuthEnv { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GOOGLE_CLIENT_ID?: string }

/** Which one-click sign-ins this site offers. Only public client IDs; the secret never leaves the server. */
export function authConfig(env: AuthEnv) {
  return {
    github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID } : null,
    google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : null,
  }
}

/**
 * Swap GitHub's sign-in code for a token. GitHub needs the client secret for this step and doesn't allow CORS, so it
 * can't happen in the browser. The token goes straight back to the browser; nothing is stored.
 */
export async function githubToken(env: AuthEnv, raw: string): Promise<{ status: number; body: { token?: string; error?: string } }> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return { status: 501, body: { error: 'GitHub sign-in is not configured' } }
  let input: { code?: unknown; redirectUri?: unknown }
  try {
    input = JSON.parse(raw || '{}')
  } catch {
    return { status: 400, body: { error: 'Bad request' } }
  }
  if (typeof input.code !== 'string' || !input.code) return { status: 400, body: { error: 'Missing code' } }
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: input.code, redirect_uri: typeof input.redirectUri === 'string' ? input.redirectUri : undefined }),
  })
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  return d.access_token ? { status: 200, body: { token: d.access_token } } : { status: 400, body: { error: d.error_description || d.error || 'GitHub sign-in failed' } }
}
