import { resolveModel } from '@litert-lm/core'
import { cachedModel, markCached, modelFileName } from './litert-cache'
import { discard, download, DownloadError } from './resumable'

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
    const dir = await navigator.storage.getDirectory()
    // Carries on from where an earlier try stopped (resumable.ts). A try that fails keeps what arrived; one whose
    // result can't be trusted is removed so the next starts clean.
    let got: number
    try {
      got = await download(dir, modelFileName(name), src, onProgress)
    } catch (e) {
      if (!(e instanceof DownloadError) || !e.resumable) {
        await discard(dir, modelFileName(name))
        throw e
      }
      // Say that nothing was lost: the next try picks up from here.
      throw new Error(/not enough space/i.test(e.message) ? e.message : 'The model download stopped part-way. What arrived is kept, so the next try carries on from there.')
    }
    const handle = await dir.getFileHandle(modelFileName(name))
    await markCached(name, { size: got, url: src.url, sha256: (src as { sha256?: string }).sha256 })
    return handle.getFile()
  })
}
