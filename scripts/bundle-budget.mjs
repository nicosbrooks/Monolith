// The startup bundle's budget: what a first visit downloads before Monolith can be used (the entry script, its
// preloaded chunks and the stylesheets index.html links), gzipped. Run after `vite build`; fails when over.
// Raise a budget only on purpose, in the same change that needs it.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET = { js: 200 * 1024, css: 30 * 1024 }
const dist = 'dist'
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const files = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(js|css))"/g)].map((m) => ({ path: m[1], kind: m[2] }))
const kb = (n) => `${(n / 1024).toFixed(1)} KB`
let failed = false
for (const kind of ['js', 'css']) {
  const list = files.filter((f) => f.kind === kind).map((f) => ({ ...f, raw: statSync(join(dist, f.path)).size, gz: gzipSync(readFileSync(join(dist, f.path)), { level: 9 }).length }))
  const total = list.reduce((s, f) => s + f.gz, 0)
  for (const f of list) console.log(`  ${f.path.padEnd(48)} ${kb(f.raw).padStart(10)} ${kb(f.gz).padStart(10)} gzip`)
  const over = total > BUDGET[kind]
  failed ||= over
  console.log(`${over ? '✗' : '✓'} startup ${kind}: ${kb(total)} gzip of ${kb(BUDGET[kind])}\n`)
}
if (failed) {
  console.error('Over the startup budget. Load the new code when it is first used (import()), or raise the budget on purpose.')
  process.exit(1)
}
