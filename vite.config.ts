import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { authApi } from './server/oauth.ts'
import { relay } from './server/relay.ts'
import { localModels } from './server/models.ts'
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

/**
 * licenses.txt: every package the app ships (its dependencies and theirs), with its licence text, served at
 * /licenses.txt and linked from Settings › About.
 */
function licenseText(): string {
  const seen = new Map<string, { version: string; license: string; text: string }>()
  const visit = (name: string) => {
    if (seen.has(name)) return
    const dir = join('node_modules', name)
    if (!existsSync(join(dir, 'package.json'))) return
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license?: string | { type: string }; dependencies?: Record<string, string> }
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    const license = typeof pkg.license === 'object' ? pkg.license.type : (pkg.license ?? 'See package')
    seen.set(name, { version: pkg.version, license, text: file ? readFileSync(join(dir, file), 'utf8').trim() : '' })
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep)
  }
  const root = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }
  for (const dep of Object.keys(root.dependencies)) visit(dep)
  const rows = [...seen].sort(([a], [b]) => a.localeCompare(b))
  return [
    'Monolith is built on these open-source packages. Thank you to everyone who made them.',
    '',
    ...rows.map(([n, p]) => `${n} ${p.version} — ${p.license}`),
    '',
    ...rows.filter(([, p]) => p.text).map(([n, p]) => `${'─'.repeat(72)}\n${n} ${p.version}\n\n${p.text}\n`),
  ].join('\n')
}
/** Names the service worker's cache after this build, so every release is a new worker the page can offer. */
const stampWorker = (stamp: string): Plugin => ({
  name: 'stamp-worker',
  apply: 'build',
  writeBundle(opts) {
    const file = join(opts.dir ?? 'dist', 'sw.js')
    if (existsSync(file)) writeFileSync(file, readFileSync(file, 'utf8').replace("const CACHE = 'app-v1'", `const CACHE = 'app-${stamp}'`))
  },
})
const licenses = (): Plugin => ({
  name: 'licenses',
  configureServer(server) {
    server.middlewares.use('/licenses.txt', (_req, res) => (res.setHeader('Content-Type', 'text/plain; charset=utf-8'), res.end(licenseText())))
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: licenseText() })
  },
})

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The hosted site has no relay of its own: without this, phone pairing and calendar subscriptions won't work there.
  if (command === 'build' && !env.VITE_RELAY_URL) console.warn('\n⚠ VITE_RELAY_URL is not set: this build can only pair phones and fetch calendars on the dev server. See relay/DEPLOY.md.\n')
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
  return {
    // Shown in Settings › About; the build stamp also names the service worker's cache, so each release replaces it.
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
    plugins: [react(), authApi(env), relay(), localModels(), ics(), licenses(), stampWorker(`${pkg.version}-${Date.now().toString(36)}`), fitPages()],
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@huggingface/transformers', '@mlc-ai/web-llm', '@litert-lm/core'] },
    // allowedHosts lets `tailscale serve` (https://<machine>.<tailnet>.ts.net) reach the dev server
    server: { port: 5199, allowedHosts: ['.ts.net'] },
    preview: { port: 5199, allowedHosts: ['.ts.net'] },
  }
})
