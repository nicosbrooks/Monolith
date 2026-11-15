import { resolveModel } from '@litert-lm/core'
import { cachedModel, markCached, modelFileName } from './litert-cache'

// Shared by the LiteRT-LM workers (Gemma, and EmbeddingGemma for System 1). Not imported by the page.

/** The model file, from storage if it's there, else downloaded into storage first (with progress). */
export async function modelFile(repo: string, onProgress?: (progress: number, loaded: number, total: number) => void, backend?: number): Promise<File> {
  // A model's CPU and GPU builds are different files: keep them apart in storage.
  const name = backend !== undefined ? `${repo}@${backend}` : repo
  const have = await cachedModel(name)
  if (have) return have
  return navigator.locks.request(`monolith-model:${name}`, async () => {
    // Another tab may have finished the download while this one waited.
    const again = await cachedModel(name)
    if (again) return again
    const { huggingFace, model } = await resolveModel(`hf://${repo}`, backend !== undefined ? { backend } : {})
    const src = huggingFace?.source ?? (typeof model === 'string' ? { url: model } : (model as { url: string; size?: number }))
    const res = await fetch(src.url)
    if (!res.ok || !res.body) throw new Error(`The model couldn’t download (${res.status}).`)
    const total = src.size ?? Number(res.headers.get('content-length')) ?? 0
    const dir = await navigator.storage.getDirectory()
    const handle = await dir.getFileHandle(modelFileName(name), { create: true })
    const out = await handle.createWritable()
    let got = 0
    let last = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await out.write(value)
        got += value.byteLength
        if (total && got - last > 4_000_000) {
          last = got
          onProgress?.(got / total, got, total)
        }
      }
      await out.close()
    } catch (e) {
      await out.abort().catch(() => {})
      await dir.removeEntry(modelFileName(name)).catch(() => {})
      throw e
    }
    if (total && got !== total) {
      await dir.removeEntry(modelFileName(name)).catch(() => {})
      throw new Error('The model download was cut short. Check your connection and try again.')
    }
    await markCached(name, { size: got, url: src.url, sha256: (src as { sha256?: string }).sha256 })
    return handle.getFile()
  })
}
