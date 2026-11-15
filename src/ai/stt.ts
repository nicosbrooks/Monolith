import type { Segment } from '../types'

/**
 * On-device speech models. Moonshine is small and quick (English). Whisper Large v3 Turbo is the accurate one:
 * better with names and technical words, punctuated, and many languages, but it wants a GPU.
 * (Parakeet CTC was tried: fast, but its browser build writes lowercase with no punctuation.)
 */
export const STT_MODELS = [
  { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base', size: '≈ 100 MB', note: 'Fast' },
  { id: 'onnx-community/whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', size: '≈ 560 MB', note: 'Most accurate' },
]
/** The saved choice, or the default when it's unknown (older versions saved Whisper models here). */
export const sttModel = (id?: string) => STT_MODELS.find((m) => m.id === id)?.id ?? STT_MODELS[0].id

const SR = 16000
let worker: Worker | null = null
const listeners = new Set<(d: Record<string, unknown>) => void>()
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => listeners.forEach((l) => l(e.data))
  }
  return worker
}
function listen(l: (d: Record<string, unknown>) => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: SR })
  const audio = await ctx.decodeAudioData(buf)
  ctx.close()
  if (audio.numberOfChannels === 1) return audio.getChannelData(0)
  const a = audio.getChannelData(0)
  const b = audio.getChannelData(1)
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2
  return out
}

/** Transcribe a whole recording, e.g. an imported file. */
export function transcribe(
  blob: Blob,
  model: string,
  on: { status?: (t: string, p?: number) => void; partial?: (s: Segment[], p: number) => void },
): Promise<Segment[]> {
  return new Promise(async (resolve, reject) => {
    try {
      on.status?.('Preparing audio…')
      const audio = await decodeTo16k(blob)
      const w = getWorker()
      const off = listen((d) => {
        if (d.type === 'download') on.status?.('Getting ready to transcribe (first time only)…', d.progress as number)
        else if (d.type === 'status') on.status?.(d.text as string)
        else if (d.type === 'partial') on.partial?.(d.segments as Segment[], d.progress as number)
        else if (d.type === 'done') (off(), resolve(d.segments as Segment[]))
        else if (d.type === 'error' && d.id === undefined) (off(), reject(new Error(d.error as string)))
      })
      w.postMessage({ type: 'file', audio, model: sttModel(model) }, [audio.buffer])
    } catch (e) {
      reject(e)
    }
  })
}

export type Live = {
  /** Stop listening; resolves with every line heard, with times, once the last piece is read. */
  stop: () => Promise<Segment[]>
  pause: (paused: boolean) => void
}

/**
 * Live transcription on the device while recording. Audio is cut at natural pauses; each finished
 * phrase becomes a line, and the phrase still being spoken is shown as it's read, about once a second.
 * The lines are the transcript: nothing has to be transcribed again after recording.
 */
export function liveTranscribe(
  stream: MediaStream,
  model: string,
  on: { update: (lines: Segment[], interim: string) => void; status?: (text: string | null, p?: number) => void },
): Live {
  const id = sttModel(model)
  const w = getWorker()
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  // Downmix and resample to 16 kHz as audio arrives. ScriptProcessor is old but runs everywhere without a module file.
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const ratio = ctx.sampleRate / SR
  let open = new Float32Array(SR * 30)
  let len = 0 // samples in the open phrase
  let at = 0 // where the open phrase starts, in samples since recording began
  let paused = false
  let carry = 0
  proc.onaudioprocess = (e) => {
    if (paused) return
    const input = e.inputBuffer.getChannelData(0)
    const n = Math.max(0, Math.ceil((input.length - carry) / ratio))
    if (len + n > open.length) {
      const bigger = new Float32Array(open.length * 2)
      bigger.set(open.subarray(0, len))
      open = bigger
    }
    // Averaging each step's samples filters out what 16 kHz can't hold, instead of folding it back in as noise.
    for (let i = 0; i < n; i++) {
      const a = Math.floor(carry + i * ratio)
      const b = Math.min(input.length, Math.max(a + 1, Math.floor(carry + (i + 1) * ratio)))
      let s = 0
      for (let j = a; j < b; j++) s += input[j]
      open[len + i] = s / (b - a)
    }
    // Where the next 16 kHz sample falls in the next buffer.
    carry = carry + n * ratio - input.length
    len += n
  }
  source.connect(proc)
  proc.connect(ctx.destination)

  const lines: Segment[] = []
  let interim = ''
  let next = 0
  const waiting = new Map<number, (text: string) => void>()
  let ready = false
  const off = listen((d) => {
    if (d.type === 'download') on.status?.('Getting live transcription ready (first time only)…', d.progress as number)
    if (d.type === 'piece' || (d.type === 'error' && typeof d.id === 'number')) {
      if (!ready) (ready = true), on.status?.(null)
      const cb = waiting.get(d.id as number)
      waiting.delete(d.id as number)
      cb?.((d.text as string) ?? '')
    }
  })
  const ask = (audio: Float32Array) =>
    new Promise<string>((resolve) => {
      const n = next++
      waiting.set(n, resolve)
      w.postMessage({ type: 'piece', id: n, audio, model: id }, [audio.buffer])
    })

  const rms = (a: Float32Array, from: number, to: number) => {
    let e = 0
    for (let i = from; i < to; i++) e += a[i] * a[i]
    return Math.sqrt(e / Math.max(1, to - from))
  }
  let floor = 0.004
  /** Finish the open phrase up to `cut` (samples) and queue it as a line. */
  let finals: Promise<unknown> = Promise.resolve()
  const finish = (cut: number) => {
    const audio = open.slice(0, cut)
    const start = at / SR
    const end = (at + cut) / SR
    open.copyWithin(0, cut, len)
    len -= cut
    at += cut
    finals = finals.then(async () => {
      const text = await ask(audio)
      if (text) lines.push({ start, end, text })
      interim = ''
      on.update([...lines], interim)
    })
  }

  let busy = false
  const frame = 480
  const tick = () => {
    if (paused || len < SR * 0.5) return
    // A quiet room sets the bar for what counts as a pause.
    const frames: number[] = []
    for (let f = 0; f + frame <= len; f += frame) frames.push(rms(open, f, f + frame))
    const sorted = [...frames].sort((a, b) => a - b)
    floor = 0.9 * floor + 0.1 * Math.max(0.002, sorted[Math.floor(sorted.length * 0.15)] ?? floor)
    const quiet = (v: number) => v < Math.max(0.006, floor * 2)
    // A pause of 0.5 s after at least 2 s of speech ends a phrase; anything over 15 s is cut at its quietest point.
    const tail = frames.slice(-16)
    if (len > SR * 2 && tail.length === 16 && tail.every(quiet)) return finish(len - frame * 8)
    if (len > SR * 15) {
      let best = frames.length - 1
      for (let i = Math.floor((SR * 8) / frame); i < frames.length; i++) if (frames[i] < frames[best]) best = i
      return finish(best * frame + frame / 2)
    }
    // Otherwise show what's being said now, unless the model is still busy with the last look.
    if (busy || !frames.some((v) => !quiet(v))) return
    busy = true
    const start = at
    ask(open.slice(0, len)).then((text) => {
      busy = false
      if (start === at && text) (interim = text), on.update([...lines], interim)
    })
  }
  const timer = setInterval(tick, 900)
  // Start the model loading now, so the first words come back quickly.
  w.postMessage({ type: 'load', model: id })

  return {
    pause: (p) => (paused = p),
    stop: async () => {
      clearInterval(timer)
      proc.disconnect()
      source.disconnect()
      ctx.close()
      if (len > SR * 0.4) finish(len)
      await finals
      off()
      return lines
    },
  }
}
