import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

// Speech to text on the device: Moonshine (fast, small) or Whisper Large v3 Turbo (most accurate), via Transformers.js.
// Both read a stretch of speech at a time; the caller cuts audio at pauses, so each piece is a natural phrase.

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loadedId = ''

type In =
  | { type: 'file'; audio: Float32Array; model: string }
  | { type: 'piece'; id: number; audio: Float32Array; model: string }
  | { type: 'load'; model: string }

const SR = 16000

async function f16(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu
    const a = await gpu?.requestAdapter()
    return !!a?.features.has('shader-f16')
  } catch {
    return false
  }
}

async function load(model: string) {
  if (asr && loadedId === model) return asr
  await asr?.dispose()
  asr = null
  const progress_callback = (p: { status: string; progress?: number; file?: string }) => {
    if (p.status === 'progress') self.postMessage({ type: 'download', progress: (p.progress ?? 0) / 100, file: p.file })
  }
  const webgpu = 'gpu' in navigator
  // Weights per runtime: the GPU takes 4-bit weights (with 16-bit math where it can); the CPU fallback 8-bit.
  // Moonshine's encoder is small enough to keep at full precision, which it needs to stay accurate.
  const half = await f16()
  const gpuType = model.includes('whisper')
    ? { encoder_model: half ? 'q4f16' : 'q4', decoder_model_merged: half ? 'q4f16' : 'q4' }
    : { encoder_model: 'fp32', decoder_model_merged: 'q4' }
  try {
    if (!webgpu) throw new Error('no webgpu')
    asr = (await pipeline('automatic-speech-recognition', model, { device: 'webgpu', dtype: gpuType as never, progress_callback })) as AutomaticSpeechRecognitionPipeline
  } catch {
    asr = (await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback })) as AutomaticSpeechRecognitionPipeline
  }
  loadedId = model
  return asr
}

const clean = (t: string) => t.replace(/\s+/g, ' ').replace(/^\s*[[(].*?[\])]\s*$/, '').trim()

async function read(model: string, audio: Float32Array) {
  const run = await load(model)
  const out = (await run(audio)) as { text: string }
  return clean(out.text)
}

/** Where to cut long audio: at the quietest moment between 6 and 20 seconds in, so no word is split. */
function pieces(audio: Float32Array, min = 6, max = 20): [number, number][] {
  const frame = 480 // 30 ms
  const out: [number, number][] = []
  let start = 0
  while (start < audio.length) {
    if (audio.length - start <= max * SR) {
      out.push([start, audio.length])
      break
    }
    let best = start + max * SR
    let low = Infinity
    for (let f = start + min * SR; f + frame <= start + max * SR; f += frame) {
      let e = 0
      for (let i = f; i < f + frame; i++) e += audio[i] * audio[i]
      if (e < low) (low = e), (best = f + frame / 2)
    }
    out.push([start, best])
    start = best
  }
  return out
}

function silent(audio: Float32Array) {
  let e = 0
  for (let i = 0; i < audio.length; i++) e += audio[i] * audio[i]
  return Math.sqrt(e / Math.max(1, audio.length)) < 0.003
}

// One job at a time: the model can only run one, and pieces must come back in order.
let chain: Promise<unknown> = Promise.resolve()

self.onmessage = (e: MessageEvent<In>) => {
  const d = e.data
  chain = chain.then(() => handle(d)).catch((err) => self.postMessage({ type: 'error', id: 'id' in d ? d.id : undefined, error: (err as Error).message }))
}

async function handle(d: In) {
  if (d.type === 'load') {
    await load(d.model)
    self.postMessage({ type: 'ready' })
    return
  }
  if (d.type === 'piece') {
    const text = silent(d.audio) ? '' : await read(d.model, d.audio)
    self.postMessage({ type: 'piece', id: d.id, text })
    return
  }
  await load(d.model)
  self.postMessage({ type: 'status', text: 'Transcribing on device…' })
  const segments: { start: number; end: number; text: string }[] = []
  const cuts = pieces(d.audio)
  for (let i = 0; i < cuts.length; i++) {
    const [a, b] = cuts[i]
    const chunk = d.audio.subarray(a, b)
    if (chunk.length >= SR * 0.4 && !silent(chunk)) {
      const text = await read(d.model, chunk)
      if (text) segments.push({ start: a / SR, end: b / SR, text })
    }
    self.postMessage({ type: 'partial', segments: [...segments], progress: (i + 1) / cuts.length })
  }
  self.postMessage({ type: 'done', segments })
}
