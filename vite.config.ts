import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import { authApi } from './server/oauth.ts'
import { relay } from './server/relay.ts'
import { ics } from './server/ics.ts'

// Local engines on this machine, reached same-origin so the browser needs no CORS from them.
const engine = (port: number, prefix: string): ProxyOptions => ({
  target: `http://127.0.0.1:${port}`,
  changeOrigin: true,
  rewrite: (p) => p.replace(prefix, ''),
  // The engine sees a request from this machine, whatever page origin the browser used (localhost or tailnet).
  configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
})
const local: Record<string, ProxyOptions> = {
  '/local/ollama': engine(11434, '/local/ollama'),
  '/local/mlx': engine(8080, '/local/mlx'),
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The hosted site has no relay of its own: without this, phone pairing and calendar subscriptions won't work there.
  if (command === 'build' && !env.VITE_RELAY_URL) console.warn('\n⚠ VITE_RELAY_URL is not set: this build can only pair phones and fetch calendars on the dev server. See relay/DEPLOY.md.\n')
  return {
    plugins: [react(), authApi(env), relay(), ics()],
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@huggingface/transformers', '@mlc-ai/web-llm'] },
    // allowedHosts lets `tailscale serve` (https://<machine>.<tailnet>.ts.net) reach the dev server
    server: { port: 5199, allowedHosts: ['.ts.net'], proxy: local },
    preview: { port: 5199, allowedHosts: ['.ts.net'], proxy: local },
  }
})
