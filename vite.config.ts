import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { authApi } from './server/oauth.ts'
import { relay } from './server/relay.ts'
import { ics } from './server/ics.ts'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The hosted site has no relay of its own: without this, phone pairing and calendar subscriptions won't work there.
  if (command === 'build' && !env.VITE_RELAY_URL) console.warn('\n⚠ VITE_RELAY_URL is not set: this build can only pair phones and fetch calendars on the dev server. See relay/DEPLOY.md.\n')
  return {
    plugins: [react(), authApi(env), relay(), ics()],
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@huggingface/transformers', '@mlc-ai/web-llm'] },
    // allowedHosts lets `tailscale serve` (https://<machine>.<tailnet>.ts.net) reach the dev server
    server: { port: 5199, allowedHosts: ['.ts.net'] },
    preview: { port: 5199, allowedHosts: ['.ts.net'] },
  }
})
