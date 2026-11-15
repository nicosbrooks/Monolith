import { create } from 'zustand'
import { del, get, keys, set } from 'idb-keyval'
import { useStore } from '../store'
import type { Item } from '../types'
import { chunks } from './context'

/**
 * System 1: a small model that understands meaning, always ready and cheap, next to the general model (System 2).
 *
 * EmbeddingGemma 2 (270M, text) turns each passage of every doc and recording into a short vector of meaning. A question
 * becomes a vector too, and the passages closest to it are what it's about, even with none of the same words ("notes on
 * eigenvectors" finds "Linear algebra, week 3"). Used to pick what the assistant reads, and to rank search.
 *
 * Kept small on purpose: 256 numbers a passage, stored as one byte each with a scale (about 260 bytes a passage, so a
 * few thousand passages is about a megabyte, in memory and in IndexedDB). Indexing runs when the browser is idle, a
 * few passages at a time, and only for docs whose text changed. The model runs in its own worker on the CPU where it
 * can, leaving the GPU to the general model.
 */

export const S1_REPO = 'litert-community/embeddinggemma-2-text-270m-litert-lm'
const DIMS = 256
/** Stored vectors are only reused if they came from this model at this size. */
const VERSION = `${S1_REPO}:${DIMS}:1`

export interface Embedder {
  /** Normalised vectors, `DIMS` numbers each, back to back. */
  embed(texts: string[]): Promise<Float32Array>
}

interface Entry { v: string; h: string; n: number; q: Int8Array; s: Float32Array }

export const useSystem1 = create<{ status: 'off' | 'loading' | 'ready' | 'error'; progress: number; indexed: number; total: number; error?: string; backend?: string }>(() => ({
  status: 'off',
  progress: 0,
  indexed: 0,
  total: 0,
}))

const index = new Map<string, Entry>()
let embedder: Embedder | null = null

// ─── The worker ────────────────────────────────────────────────────────────

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { ok: (v: Float32Array) => void; fail: (e: Error) => void }>()

function workerEmbedder(): Promise<Embedder> {
  worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') useSystem1.setState({ progress: m.progress })
      else if (m.type === 'ready') {
        useSystem1.setState({ backend: m.backend })
        resolve({
          embed: (texts) =>
            new Promise((ok, fail) => {
              const id = nextId++
              waiting.set(id, { ok, fail })
              worker!.postMessage({ type: 'embed', id, texts })
            }),
        })
      } else if (m.type === 'vectors') (waiting.get(m.id)?.ok(m.data), waiting.delete(m.id))
      else if (m.type === 'error') {
        if (m.id && waiting.has(m.id)) (waiting.get(m.id)!.fail(new Error(m.message)), waiting.delete(m.id))
        else reject(new Error(m.message))
      }
    }
    worker!.postMessage({ type: 'load', repo: S1_REPO, dims: DIMS })
  })
}

// ─── Vectors ───────────────────────────────────────────────────────────────

/** One byte a number: each vector keeps a scale, so a dot product is the bytes times the query, times that scale. */
function quantize(vecs: Float32Array, n: number) {
  const q = new Int8Array(n * DIMS)
  const s = new Float32Array(n)
  for (let r = 0; r < n; r++) {
    let max = 1e-9
    for (let i = 0; i < DIMS; i++) max = Math.max(max, Math.abs(vecs[r * DIMS + i]))
    s[r] = max / 127
    for (let i = 0; i < DIMS; i++) q[r * DIMS + i] = Math.round(vecs[r * DIMS + i] / s[r])
  }
  return { q, s }
}
function similarity(e: Entry, row: number, query: Float32Array) {
  let sum = 0
  const off = row * DIMS
  for (let i = 0; i < DIMS; i++) sum += e.q[off + i] * query[i]
  return sum * e.s[row]
}

/** What the model reads for a passage and for a question (EmbeddingGemma's own prompt formats). */
const docText = (i: Item, text: string) => `title: ${i.title.trim() || 'none'} | text: ${text}`
const queryText = (q: string) => `task: search result | query: ${q}`

/** Changes whenever the passages would. */
function hashOf(i: Item) {
  const t = i.title + '\u0000' + i.content + '\u0000' + (i.lecture?.transcript.length ?? 0) + (i.lecture?.transcript.at(-1)?.text ?? '')
  let h = 2166136261
  for (let k = 0; k < t.length; k++) h = Math.imul(h ^ t.charCodeAt(k), 16777619)
  return (h >>> 0).toString(36) + t.length.toString(36)
}

// ─── Indexing ──────────────────────────────────────────────────────────────

const idle = () => new Promise<void>((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 50)))
let indexing = false
let again = false

/** Bring the index up to date: new and changed docs get vectors, deleted ones lose theirs. A few passages at a time. */
async function indexPass() {
  if (!embedder) return
  if (indexing) return void (again = true)
  indexing = true
  try {
    do {
      again = false
      const live = useStore.getState().items.filter((i) => !i.deletedAt && !i.file?.dir)
      const ids = new Set(live.map((i) => i.id))
      for (const id of [...index.keys()]) if (!ids.has(id)) (index.delete(id), void del(`s1:${id}`))
      const todo = live.filter((i) => index.get(i.id)?.h !== hashOf(i))
      useSystem1.setState({ total: live.length, indexed: live.length - todo.length })
      for (const item of todo) {
        await idle()
        const passages = chunks(item)
        const h = hashOf(item)
        if (!passages.length) {
          index.set(item.id, { v: VERSION, h, n: 0, q: new Int8Array(), s: new Float32Array() })
          continue
        }
        const vecs = new Float32Array(passages.length * DIMS)
        for (let k = 0; k < passages.length; k += 8) {
          const batch = passages.slice(k, k + 8).map((c) => docText(item, c.text))
          vecs.set(await embedder.embed(batch), k * DIMS)
          if (k + 8 < passages.length) await idle()
        }
        const { q, s } = quantize(vecs, passages.length)
        const entry: Entry = { v: VERSION, h, n: passages.length, q, s }
        index.set(item.id, entry)
        void set(`s1:${item.id}`, entry)
        useSystem1.setState((st) => ({ indexed: Math.min(st.total, st.indexed + 1) }))
      }
    } while (again)
  } finally {
    indexing = false
  }
}

// ─── Using it ──────────────────────────────────────────────────────────────

/** Ready to answer: the model is loaded. (The index may still be filling in; what's there is used.) */
export const system1Ready = () => !!embedder && useSystem1.getState().status === 'ready'

/** A question as a vector, or undefined if System 1 isn't ready or takes longer than `ms`. */
async function queryVector(question: string, ms: number): Promise<Float32Array | undefined> {
  if (!system1Ready() || !question.trim()) return undefined
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))
  return Promise.race([embedder!.embed([queryText(question)]).catch(() => undefined), timeout])
}

/**
 * How close each passage is to a question in meaning (cosine, about −1…1), keyed `itemId#passage` to match the
 * passages in context.ts. Undefined when System 1 can't answer in time; callers then rank by words alone.
 */
export async function passageScores(question: string, ms = 300): Promise<Map<string, number> | undefined> {
  const qv = await queryVector(question, ms)
  if (!qv) return undefined
  const out = new Map<string, number>()
  for (const [id, e] of index) for (let r = 0; r < e.n; r++) out.set(`${id}#${r}`, similarity(e, r, qv))
  return out
}

/** Docs and recordings closest in meaning to `question`, best first. */
export async function related(question: string, k = 6, ms = 300): Promise<{ id: string; score: number }[]> {
  const qv = await queryVector(question, ms)
  if (!qv) return []
  const best: { id: string; score: number }[] = []
  for (const [id, e] of index) {
    let top = -1
    for (let r = 0; r < e.n; r++) top = Math.max(top, similarity(e, r, qv))
    if (e.n) best.push({ id, score: top })
  }
  return best.sort((a, b) => b.score - a.score).slice(0, k)
}

// ─── Starting and stopping ─────────────────────────────────────────────────

let unsubscribe: (() => void) | null = null

/** Start System 1 (Settings › Assistant › Understand meaning, on unless turned off). Safe to call again. */
export async function startSystem1(custom?: Embedder) {
  if (useStore.getState().settings.system1 === false && !custom) return stopSystem1()
  if (embedder || useSystem1.getState().status === 'loading') return
  useSystem1.setState({ status: 'loading', progress: 0, error: undefined })
  try {
    for (const k of await keys()) {
      if (typeof k !== 'string' || !k.startsWith('s1:')) continue
      const e = await get<Entry>(k)
      if (e?.v === VERSION) index.set(k.slice(3), e)
      else void del(k)
    }
    embedder = custom ?? (await workerEmbedder())
    useSystem1.setState({ status: 'ready', progress: 1 })
    let t = 0
    unsubscribe = useStore.subscribe((s, prev) => {
      if (s.items !== prev.items) (clearTimeout(t), (t = window.setTimeout(() => void indexPass(), 4000)))
    })
    void indexPass()
  } catch (e) {
    worker?.terminate()
    worker = null
    const msg = (e as Error)?.message || ''
    // Tried again on the next start; until then search and context use words only.
    useSystem1.setState({ status: 'error', error: /fetch|network|cut short|download/i.test(msg) || !navigator.onLine ? 'the model didn’t download. It will try again next time.' : msg })
  }
}

/** Stop System 1 and free its memory. The stored vectors stay, so turning it on again is quick. */
export function stopSystem1() {
  unsubscribe?.()
  unsubscribe = null
  worker?.terminate()
  worker = null
  embedder = null
  index.clear()
  useSystem1.setState({ status: 'off', progress: 0 })
}
