import './litert-shim' // first: lets LiteRT-LM load its runtime in a module worker
import { Backend, EmbeddingEngine } from '@litert-lm/core'
import { modelFile } from './litert-download'

/**
 * System 1: EmbeddingGemma 2 (text, 270M) in its own small worker. It turns text into short vectors of meaning, so
 * Monolith can find related passages, rank search results and recognise requests in milliseconds, without the general
 * model. It prefers the CPU build, leaving the GPU to the general model; the GPU build is the fallback.
 * Vectors come back normalised at `DIMS` numbers (EmbeddingGemma is trained so a shorter prefix still works).
 */
type In = { type: 'load'; repo: string; dims: number } | { type: 'embed'; id: number; texts: string[] } | { type: 'unload' }

let engine: EmbeddingEngine | null = null
let dims = 256
const post = (m: object, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

async function load(repo: string, d: number) {
  dims = d
  if (engine) return post({ type: 'ready' })
  const progress = (p: number) => post({ type: 'progress', progress: p })
  for (const backend of [Backend.CPU, Backend.GPU]) {
    try {
      const file = await modelFile(repo, progress, backend)
      engine = await EmbeddingEngine.create({ model: file, backend })
      return post({ type: 'ready', backend: backend === Backend.CPU ? 'cpu' : 'gpu' })
    } catch (e) {
      // No file for this backend, or it can't run here: try the other. A download that didn't arrive stops here.
      if (/fetch|network|cut short|couldn’t download/i.test(String((e as Error)?.message))) throw e
    }
  }
  throw new Error('The meaning model can’t run in this browser.')
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data
  try {
    if (m.type === 'load') return await load(m.repo, m.dims)
    if (m.type === 'unload') {
      await engine?.delete().catch(() => {})
      engine = null
      return post({ type: 'unloaded' })
    }
    if (m.type === 'embed') {
      if (!engine) throw new Error('System 1 isn’t ready.')
      const res = await engine.computeEmbeddingBatch(m.texts, { normalize: true, outputSize: dims })
      const out = new Float32Array(res.length * dims)
      res.forEach((r, i) => out.set(r.embedding.slice(0, dims), i * dims))
      post({ type: 'vectors', id: m.id, data: out }, [out.buffer])
    }
  } catch (err) {
    post({ type: 'error', id: (m as { id?: number }).id, message: String((err as Error)?.message || err) })
  }
}
