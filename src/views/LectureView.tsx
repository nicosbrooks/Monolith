import { useEffect, useRef, useState } from 'react'
import type { Editor as TEditor } from '@tiptap/react'
import { format } from 'date-fns'
import { Mic, Square, Pause, Play, PenLine, Upload, Trash2, Layers, Loader2, Captions, RotateCcw, MoreHorizontal } from 'lucide-react'
import { openMenu } from '../components/Overlays'
import { motion } from 'motion/react'
import { loadAudio, saveAudio, useStore } from '../store'
import { MobileBack } from '../components/MobileBack'
import type { Item, Segment } from '../types'
import { Editor } from '../components/editor/Editor'
import { liveTranscribe, transcribe, type Live } from '../ai/stt'
import { chat, enqueue, ensureAI, isReady, SYSTEM } from '../ai/llm'
import { formatDuration, mdToHtml } from '../lib/util'
import { toast } from '../components/Toast'

export function LectureView({ item }: { item: Item }) {
  const st = useStore.getState()
  const settings = useStore((s) => s.settings)
  const lec = item.lecture!
  const [tab, setTab] = useState<'notes' | 'transcript'>(lec.transcript.length ? 'notes' : 'transcript')
  const [rec, setRec] = useState<'idle' | 'rec' | 'paused'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [live, setLive] = useState<{ lines: Segment[]; interim: string }>({ lines: [], interim: '' })
  const [status, setStatus] = useState<{ text: string; p?: number } | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [gen, setGen] = useState(false)
  const [cards, setCards] = useState<{ q: string; a: string }[] | null>(null)
  const edRef = useRef<TEditor | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const mr = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const caps = useRef<Live | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)
  const accumulated = useRef(0)

  const setLec = (patch: Partial<typeof lec>) => {
    const cur = useStore.getState().items.find((i) => i.id === item.id)?.lecture ?? lec
    st.updateItem(item.id, { lecture: { ...cur, ...patch } })
  }

  useEffect(() => {
    let url: string | null = null
    if (lec.hasAudio) loadAudio(item.id).then((b) => b && setAudioUrl((url = URL.createObjectURL(b))))
    return () => {
      if (url) URL.revokeObjectURL(url)
      stopAll()
    }
  }, [item.id]) // eslint-disable-line

  useEffect(() => {
    if (rec !== 'rec') return
    const i = setInterval(() => setElapsed(accumulated.current + (Date.now() - startedAt.current) / 1000), 250)
    return () => clearInterval(i)
  }, [rec])

  function stopAll() {
    cancelAnimationFrame(raf.current)
    caps.current?.stop()
    caps.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      chunks.current = []
      const m = new MediaRecorder(stream)
      m.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      m.onstop = async () => {
        const blob = new Blob(chunks.current, { type: m.mimeType })
        await saveAudio(item.id, blob)
        setAudioUrl(URL.createObjectURL(blob))
        // The live lines are the transcript: each phrase was read on the device as it was spoken.
        const lines = (await caps.current?.stop()) ?? []
        caps.current = null
        stopAll()
        if (lines.length) {
          setLec({ hasAudio: true, duration: accumulated.current, transcript: lines, status: 'done' })
          toast('Transcript ready', isReady() ? { action: { label: 'Write study notes', run: () => generate() } } : {})
        } else {
          setLec({ hasAudio: true, duration: accumulated.current, status: 'idle' })
          runTranscribe(blob)
        }
      }
      m.start(1000)
      mr.current = m
      startedAt.current = Date.now()
      accumulated.current = 0
      setRec('rec')
      setLec({ status: 'recording' })
      setTab('transcript')
      setLive({ lines: [], interim: '' })
      caps.current = liveTranscribe(stream, settings.whisperModel, {
        update: (lines, interim) => setLive({ lines, interim }),
        status: (text, p) => setStatus(text ? { text, p } : null),
      })
      visualize(stream)
    } catch (e) {
      toast('Microphone access was blocked: ' + (e as Error).message)
    }
  }

  function visualize(stream: MediaStream) {
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(an)
    const data = new Uint8Array(an.frequencyBinCount)
    const bars: number[] = Array(48).fill(0)
    const draw = () => {
      const c = canvas.current
      if (c) {
        an.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        bars.push(Math.min(1, peak / 60))
        bars.shift()
        const g = c.getContext('2d')!
        const dpr = devicePixelRatio
        c.width = c.clientWidth * dpr
        c.height = c.clientHeight * dpr
        g.clearRect(0, 0, c.width, c.height)
        const bw = c.width / bars.length
        g.fillStyle = getComputedStyle(c).color
        bars.forEach((b, i) => {
          const h = Math.max(3 * dpr, b * c.height * 0.9)
          g.globalAlpha = 0.35 + (i / bars.length) * 0.65
          g.beginPath()
          g.roundRect(i * bw + bw * 0.2, (c.height - h) / 2, bw * 0.6, h, bw * 0.3)
          g.fill()
        })
      }
      raf.current = requestAnimationFrame(draw)
    }
    draw()
  }

  function pause() {
    if (!mr.current) return
    if (rec === 'rec') {
      mr.current.pause()
      caps.current?.pause(true)
      accumulated.current += (Date.now() - startedAt.current) / 1000
      setRec('paused')
    } else {
      mr.current.resume()
      caps.current?.pause(false)
      startedAt.current = Date.now()
      setRec('rec')
    }
  }

  function stop() {
    if (rec === 'rec') accumulated.current += (Date.now() - startedAt.current) / 1000
    setRec('idle')
    mr.current?.stop()
  }

  async function runTranscribe(blob?: Blob) {
    blob ??= await loadAudio(item.id)
    if (!blob) return
    setLec({ status: 'transcribing' })
    setStatus({ text: 'Preparing…' })
    try {
      const segs = await transcribe(blob, settings.whisperModel, {
        status: (text, p) => setStatus({ text, p }),
        partial: (s, p) => (setStatus({ text: 'Transcribing on device…', p }), setLec({ transcript: s })),
      })
      const audio = new Audio(URL.createObjectURL(blob))
      audio.onloadedmetadata = () => isFinite(audio.duration) && setLec({ duration: audio.duration })
      setLec({ transcript: segs.length ? segs : liveToSegments(), status: 'done' })
      toast('Transcript ready', isReady() ? { action: { label: 'Write study notes', run: () => generate() } } : {})
    } catch (e) {
      const fallback = liveToSegments()
      setLec({ status: 'done', transcript: fallback.length ? fallback : lec.transcript })
      toast('Transcription failed: ' + (e as Error).message)
    } finally {
      setStatus(null)
    }
  }

  const liveToSegments = () => live.lines

  async function importAudio() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*,video/*'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      await saveAudio(item.id, f)
      setAudioUrl(URL.createObjectURL(f))
      setLec({ hasAudio: true })
      if (!item.title || /^(Lecture|Recording) ·/.test(item.title)) st.updateItem(item.id, { title: f.name.replace(/\.[^.]+$/, '') })
      setTab('transcript')
      runTranscribe(f)
    }
    input.click()
  }

  const transcriptText = () => (useStore.getState().items.find((i) => i.id === item.id)?.lecture?.transcript ?? lec.transcript).map((s) => `[${formatDuration(s.start)}] ${s.text}`).join('\n')

  async function generate() {
    const full = transcriptText()
    if (!full) return toast('No transcript yet')
    setGen(true)
    setTab('notes')
    try {
      if (!isReady()) {
        setStatus({ text: 'Getting the assistant ready…' })
        if (!(await ensureAI())) throw new Error('The assistant can’t start in this browser.')
      }
      // Map–reduce so long recordings fit a small model's context window
      const CH = 5000
      const parts: string[] = []
      for (let i = 0; i < full.length; i += CH) parts.push(full.slice(i, i + CH))
      let digest = full
      if (parts.length > 1) {
        const notes: string[] = []
        for (let i = 0; i < parts.length; i++) {
          setStatus({ text: `Reading part ${i + 1} of ${parts.length}…`, p: i / parts.length })
          notes.push(await enqueue(() => chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Transcript excerpt (part ${i + 1}/${parts.length}) from a recording: a class, meeting or conversation. List the key points, decisions, definitions and anything with a date (deadlines, exams, follow-ups) as terse Markdown bullets. Keep timestamps like [12:30] for important points.\n\n${parts[i]}` }], undefined, { temperature: 0.3, maxTokens: 500 })))
        }
        digest = notes.join('\n')
      }
      setStatus({ text: 'Writing notes…' })
      const ed = edRef.current
      const head = `<h1>${item.title || 'Notes'}</h1>`
      const out = await enqueue(() =>
        chat(
          [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: `Write clear notes for this recording (a class, meeting or conversation) in Markdown with these sections:\n## Summary\n(2–3 sentences)\n## Key points\n(bullets, **bold** important terms or decisions)\n## Details\n(bullets)\n## To do\n(checklist "- [ ] ..." of deadlines and follow-ups actually mentioned; leave the section out if there are none)\nUse only what is in the transcript.\n\n${parts.length > 1 ? 'Digest' : 'Transcript'}:\n${digest.slice(0, 7000)}`,
            },
          ],
          (txt) => ed?.commands.setContent(head + mdToHtml(txt), { emitUpdate: false }),
          { temperature: 0.4, maxTokens: 1200 },
        ),
      )
      const html = head + mdToHtml(out)
      ed?.commands.setContent(html, { emitUpdate: false })
      st.updateItem(item.id, { content: html })
      st.dismiss(`lec:${item.id}`)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setGen(false)
      setStatus(null)
    }
  }

  async function flashcards() {
    if (!isReady() && !(await ensureAI())) return toast('The assistant can’t start in this browser.')
    const src = edRef.current?.getText() || transcriptText()
    setGen(true)
    try {
      const out = await enqueue(() =>
        chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Create 8 flashcards from this material. Format each strictly as:\nQ: question\nA: short answer\n\n${src.slice(0, 7000)}` }], undefined, { temperature: 0.4 }),
      )
      const list = [...out.matchAll(/Q:\s*(.+)\n+\s*A:\s*(.+)/g)].map((m) => ({ q: m[1].trim(), a: m[2].trim() }))
      if (!list.length) toast('No cards came back. Try again.')
      setCards(list)
    } finally {
      setGen(false)
    }
  }

  const seek = (s: number) => {
    const a = audioRef.current
    if (a) (a.currentTime = s), a.play()
  }

  const recording = rec !== 'idle'
  const transcribing = lec.status === 'transcribing'

  return (
    <div className="doc-pane lecture">
      <div className="toolbar">
        <MobileBack item={item} />
        <input className="lec-title" value={item.title} placeholder="Untitled recording" onChange={(e) => st.updateItem(item.id, { title: e.target.value })} />
        <span className="grow" />
        <span className="muted small hide-sm">{format(item.createdAt, 'EEE, MMM d · h:mm a')}</span>
        {item.deletedAt ? (
          <button className="btn sm" onClick={() => st.restoreItem(item.id)}><RotateCcw size={14} /> Recover</button>
        ) : (
          <button
            className="tb"
            title="More"
            aria-label="More"
            onClick={(e) =>
              openMenu(e, [
                ...(lec.hasAudio && !recording ? [{ label: 'Record again', icon: Mic, run: start }, { label: 'Transcribe again', icon: Captions, run: () => runTranscribe() }] : []),
                ...(!recording ? [{ label: 'Use an audio file', icon: Upload, run: importAudio }] : []),
                ...(lec.transcript.length || item.content ? [{ label: 'Flashcards', icon: Layers, run: flashcards }] : []),
                'sep' as const,
                { label: 'Delete', icon: Trash2, danger: true, run: () => (st.trashItem(item.id), toast('Moved to Recently Deleted', { action: { label: 'Undo', run: () => st.restoreItem(item.id) } })) },
              ])
            }
          >
            <MoreHorizontal size={17} />
          </button>
        )}
      </div>

      <div className="page-scroll">
        <div className="page wide">
          <div className={`recorder ${recording ? 'live' : ''}`}>
            {recording ? (
              <>
                <div className="rec-dot" />
                <div className="rec-time">{formatDuration(elapsed)}</div>
                <canvas ref={canvas} className="wave" />
                <button className="round" onClick={pause} title={rec === 'paused' ? 'Resume' : 'Pause'}>{rec === 'paused' ? <Play size={18} /> : <Pause size={18} />}</button>
                <button className="round stop" onClick={stop} title="Stop"><Square size={16} fill="currentColor" /></button>
              </>
            ) : (
              <>
                {/* One way to start. Importing is the quiet alternative; re-doing things lives in the ⋯ of a finished recording. */}
                {!lec.hasAudio ? (
                  <>
                    <motion.button whileTap={{ scale: 0.94 }} className="rec-btn" onClick={start} disabled={transcribing}>
                      <Mic size={20} /> Start recording
                    </motion.button>
                    <button className="text-btn muted" onClick={importAudio} disabled={transcribing}>or use an audio file</button>
                  </>
                ) : (
                  !transcribing && !lec.transcript.length && <button className="btn" onClick={() => runTranscribe()}><Captions size={15} /> Transcribe</button>
                )}
              </>
            )}
          </div>

          {audioUrl && !recording && <audio ref={audioRef} className="player" src={audioUrl} controls onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />}

          {status && (
            <div className="progress-card">
              <Loader2 size={15} className="spin" />
              <span>{status.text}</span>
              {status.p !== undefined && <div className="bar"><i style={{ width: `${status.p * 100}%` }} /></div>}
            </div>
          )}

          {(lec.transcript.length > 0 || recording) && <div className="tabs">
            <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes</button>
            <button className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>
              Transcript {lec.transcript.length > 0 && <em>{lec.transcript.length}</em>}
            </button>
            <span className="grow" />
            {lec.transcript.length > 0 && !recording && (
              <button className="btn sm ai" onClick={generate} disabled={gen}>
                {gen ? <Loader2 size={14} className="spin" /> : <PenLine size={14} />} Write notes
              </button>
            )}
          </div>}

          {tab === 'notes' ? (
            <Editor
              key={item.id}
              html={item.content}
              placeholder={lec.transcript.length ? 'Write notes, or press “Write notes” for a first draft…' : 'Take notes while you record…'}
              onReady={(e) => (edRef.current = e)}
              onChange={(html) => st.updateItem(item.id, { content: html })}
            />
          ) : (
            <div className="transcript">
              {recording && (
                <p className="live-cap">
                  {live.lines.map((l) => l.text).join(' ')}
                  {live.lines.length > 0 && ' '}
                  <span className="interim">{live.interim}</span>
                  {!live.lines.length && !live.interim && <span className="muted">Listening… Words appear here as they’re said, transcribed on this device.</span>}
                </p>
              )}
              {!recording &&
                lec.transcript.map((s, i) => (
                  <button key={i} className={`tseg ${t >= s.start && t < s.end ? 'now' : ''}`} onClick={() => seek(s.start)}>
                    <span className="ts">{formatDuration(s.start)}</span>
                    <span>{s.text}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {cards && <Flashcards cards={cards} onClose={() => setCards(null)} onSave={() => {
        const ed = edRef.current
        const rows = cards.map((c) => `<tr><td><p>${c.q}</p></td><td><p>${c.a}</p></td></tr>`).join('')
        const html = `<h2>Flashcards</h2><table><tbody><tr><th><p>Question</p></th><th><p>Answer</p></th></tr>${rows}</tbody></table>`
        if (ed) ed.chain().focus('end').insertContent(html).run()
        else st.updateItem(item.id, { content: item.content + html })
        setCards(null)
        toast('Flashcards added to notes')
      }} />}
    </div>
  )
}

function Flashcards({ cards, onClose, onSave }: { cards: { q: string; a: string }[]; onClose: () => void; onSave: () => void }) {
  const [i, setI] = useState(0)
  const [flip, setFlip] = useState(false)
  const c = cards[i]
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === ' ') (e.preventDefault(), setFlip((f) => !f))
      if (e.key === 'ArrowRight') (setI((x) => Math.min(cards.length - 1, x + 1)), setFlip(false))
      if (e.key === 'ArrowLeft') (setI((x) => Math.max(0, x - 1)), setFlip(false))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [cards.length, onClose])
  if (!c) return null
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="cards-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="muted small">Card {i + 1} of {cards.length} · Space to flip, ← → to move</div>
        <motion.div className="flashcard" onClick={() => setFlip(!flip)} animate={{ rotateY: flip ? 180 : 0 }} transition={{ type: 'spring', duration: 0.5 }}>
          <div className="face front">{c.q}</div>
          <div className="face back">{c.a}</div>
        </motion.div>
        <div className="row">
          <button className="btn" disabled={i === 0} onClick={() => (setI(i - 1), setFlip(false))}>Previous</button>
          <button className="btn" disabled={i === cards.length - 1} onClick={() => (setI(i + 1), setFlip(false))}>Next</button>
          <span className="grow" />
          <button className="btn primary" onClick={onSave}>Save to notes</button>
        </div>
      </div>
    </div>
  )
}
