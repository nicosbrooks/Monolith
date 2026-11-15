import type { Segment } from '../types'

export const WHISPER_MODELS = [
  { id: 'Xenova/whisper-tiny.en', name: 'Whisper Tiny', size: '≈ 40 MB', note: 'Fastest' },
  { id: 'Xenova/whisper-base.en', name: 'Whisper Base', size: '≈ 80 MB', note: 'Balanced' },
  { id: 'Xenova/whisper-small.en', name: 'Whisper Small', size: '≈ 250 MB', note: 'Most accurate' },
]

let worker: Worker | null = null

export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  const audio = await ctx.decodeAudioData(buf)
  ctx.close()
  if (audio.numberOfChannels === 1) return audio.getChannelData(0)
  const a = audio.getChannelData(0)
  const b = audio.getChannelData(1)
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2
  return out
}

export function transcribe(
  blob: Blob,
  model: string,
  on: { status?: (t: string, p?: number) => void; partial?: (s: Segment[], p: number) => void },
): Promise<Segment[]> {
  return new Promise(async (resolve, reject) => {
    try {
      on.status?.('Preparing audio…')
      const audio = await decodeTo16k(blob)
      worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        const d = e.data
        if (d.type === 'download') on.status?.('Getting ready to transcribe (first time only)…', d.progress)
        else if (d.type === 'status') on.status?.(d.text)
        else if (d.type === 'partial') on.partial?.(d.segments, d.progress)
        else if (d.type === 'done') resolve(d.segments)
        else if (d.type === 'error') reject(new Error(d.error))
      }
      worker.postMessage({ type: 'transcribe', audio, model }, [audio.buffer])
    } catch (e) {
      reject(e)
    }
  })
}

/** Live captions while recording. Uses the browser's speech engine (on-device where the OS supports it). */
type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void
  onend: () => void
  onerror: (e: unknown) => void
  start: () => void
  stop: () => void
}

export function liveCaptions(onText: (finalText: string, interim: string) => void): { stop: () => void } | null {
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition
  if (!Ctor) return null
  const rec = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = navigator.language || 'en-US'
  let final = ''
  let stopped = false
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) final += r[0].transcript.trim() + ' '
      else interim += r[0].transcript
    }
    onText(final, interim)
  }
  rec.onerror = () => {}
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start()
      } catch {
        /* ignore */
      }
    }
  }
  try {
    rec.start()
  } catch {
    return null
  }
  return {
    stop: () => {
      stopped = true
      rec.stop()
    },
  }
}
