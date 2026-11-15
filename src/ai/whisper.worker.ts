import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loadedId = ''

type In = { type: 'transcribe'; audio: Float32Array; model: string }

self.onmessage = async (e: MessageEvent<In>) => {
  const { audio, model } = e.data
  try {
    if (!asr || loadedId !== model) {
      const progress_callback = (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === 'progress') self.postMessage({ type: 'download', progress: (p.progress ?? 0) / 100, file: p.file })
      }
      const webgpu = 'gpu' in navigator
      try {
        asr = (await pipeline('automatic-speech-recognition', model, {
          device: webgpu ? 'webgpu' : 'wasm',
          dtype: webgpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
          progress_callback,
        })) as AutomaticSpeechRecognitionPipeline
      } catch {
        asr = (await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback })) as AutomaticSpeechRecognitionPipeline
      }
      loadedId = model
    }
    self.postMessage({ type: 'status', text: 'Transcribing on device…' })

    // Process in 30s windows so we can report progress and timestamps
    const SR = 16000
    const WIN = 30 * SR
    const segments: { start: number; end: number; text: string }[] = []
    for (let off = 0; off < audio.length; off += WIN) {
      const chunk = audio.subarray(off, Math.min(off + WIN, audio.length))
      if (chunk.length < SR * 0.5) break
      const out = (await asr(chunk, { return_timestamps: true })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }
      const base = off / SR
      const chunkLen = chunk.length / SR
      if (out.chunks?.length) {
        for (const c of out.chunks) {
          const t = c.text.trim()
          if (!t || /^\[.*\]$|^\(.*\)$/.test(t)) continue
          segments.push({ start: base + (c.timestamp[0] ?? 0), end: base + (c.timestamp[1] ?? chunkLen), text: t })
        }
      } else if (out.text.trim()) {
        segments.push({ start: base, end: base + chunkLen, text: out.text.trim() })
      }
      self.postMessage({ type: 'partial', segments: [...segments], progress: Math.min(1, (off + WIN) / audio.length) })
    }
    self.postMessage({ type: 'done', segments })
  } catch (err) {
    self.postMessage({ type: 'error', error: (err as Error).message })
  }
}
