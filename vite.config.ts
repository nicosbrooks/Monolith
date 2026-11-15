import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { authApi } from './server/oauth.ts'
import { relay } from './server/relay.ts'
import { ics } from './server/ics.ts'

/**
 * The hosted site must fit Cloudflare Pages: no file over 25 MiB. ONNX Runtime's WebAssembly (used by Transformers.js,
 * the fallback engine) is ~27 MB, but Transformers.js loads it from jsDelivr at its exact version, so the copy Vite
 * would emit is never used: leave it out. Then fail the build if anything else is too big.
 */
const PAGES_LIMIT = 25 * 1024 * 1024
const fitPages = (): Plugin => ({
  name: 'fit-pages',
  apply: 'build',
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name]
    const big = Object.entries(bundle).filter(([, out]) => (out.type === 'asset' ? out.source.length : out.code.length) > PAGES_LIMIT)
    if (big.length) this.error(`Over Cloudflare Pages' 25 MiB file limit: ${big.map(([n]) => n).join(', ')}`)
  },
})

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The hosted site has no relay of its own: without this, phone pairing and calendar subscriptions won't work there.
  if (command === 'build' && !env.VITE_RELAY_URL) console.warn('\n⚠ VITE_RELAY_URL is not set: this build can only pair phones and fetch calendars on the dev server. See relay/DEPLOY.md.\n')
  return {
    plugins: [react(), authApi(env), relay(), ics(), fitPages()],
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@huggingface/transformers', '@mlc-ai/web-llm', '@litert-lm/core'] },
    // allowedHosts lets `tailscale serve` (https://<machine>.<tailnet>.ts.net) reach the dev server
    server: { port: 5199, allowedHosts: ['.ts.net'] },
    preview: { port: 5199, allowedHosts: ['.ts.net'] },
  }
})
