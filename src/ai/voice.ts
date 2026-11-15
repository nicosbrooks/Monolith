import { create } from 'zustand'
import type { PhononTTS } from 'phonon-tts'

/**
 * Read aloud with Phonon (Gradium's 31M English voice), running in this browser.
 * The voice downloads once (~65 MB) the first time someone presses Listen, then comes from cache.
 * If it can't start here, the system voice reads instead, so Listen always does something.
 */
interface VoiceState {
  /** Id of whatever is being read, or null. */
  speaking: string | null
  /** True until the first sound plays. */
  starting: boolean
}
export const useVoice = create<VoiceState>(() => ({ speaking: null, starting: false }))

let tts: Promise<PhononTTS> | null = null
let ctx: AudioContext | null = null
let ctrl: AbortController | null = null

function phonon() {
  tts ??= import('phonon-tts').then((m) => m.PhononTTS.load({ lang: 'en', device: 'auto' }))
  tts.catch(() => (tts = null))
  return tts
}

/** Markdown and HTML leftovers read badly; keep plain sentences. */
function plain(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#+|[-*•]|\d+[.)]|- \[[ xX]\])\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000)
}

export function stopSpeaking() {
  ctrl?.abort()
  ctrl = null
  void ctx?.close()
  ctx = null
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  useVoice.setState({ speaking: null, starting: false })
}

/** Read `text` aloud. Pressing it again for the same id stops. */
export async function speak(id: string, text: string) {
  if (useVoice.getState().speaking === id) return stopSpeaking()
  stopSpeaking()
  const words = plain(text)
  if (!words) return
  const c = new AbortController()
  ctrl = c
  // Made inside the click, so the browser lets it play.
  const ac = new AudioContext({ sampleRate: 24000 })
  ctx = ac
  useVoice.setState({ speaking: id, starting: true })
  try {
    const t = await phonon()
    if (c.signal.aborted) return
    let at = ac.currentTime + 0.05
    for await (const pcm of t.stream(words, { signal: c.signal })) {
      if (c.signal.aborted) break
      if (useVoice.getState().starting) useVoice.setState({ starting: false })
      const buf = ac.createBuffer(1, pcm.length, t.sampleRate)
      buf.getChannelData(0).set(pcm)
      const src = ac.createBufferSource()
      src.buffer = buf
      src.connect(ac.destination)
      at = Math.max(at, ac.currentTime)
      src.start(at)
      at += buf.duration
    }
    if (!c.signal.aborted) setTimeout(() => ctrl === c && stopSpeaking(), (at - ac.currentTime) * 1000 + 150)
  } catch {
    if (c.signal.aborted) return
    void ac.close()
    ctx = null
    systemVoice(id, words)
  }
}

function systemVoice(id: string, words: string) {
  if (typeof speechSynthesis === 'undefined') return stopSpeaking()
  const u = new SpeechSynthesisUtterance(words)
  u.onend = u.onerror = () => useVoice.getState().speaking === id && useVoice.setState({ speaking: null, starting: false })
  useVoice.setState({ starting: false })
  speechSynthesis.speak(u)
}
