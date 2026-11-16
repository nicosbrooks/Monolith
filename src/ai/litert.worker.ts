import './litert-shim' // first: lets LiteRT-LM load its runtime in a module worker
import { Engine, type Conversation, type Message } from '@litert-lm/core'
import { modelFile } from './litert-download'
import { afterAnswer, canReuse, turnKeys, type Held } from './reuse'

/**
 * Google's LiteRT-LM, for the Gemma tiers. Runs in its own worker so a model compile or a long answer never blocks
 * the page.
 *
 * - The model is downloaded once into this site's private storage (OPFS) and loaded from there afterwards. LiteRT-LM
 *   itself doesn't cache in the browser. A Web Lock keeps two tabs from downloading the same model at once, and a
 *   size-checked marker is written only after the whole file is stored, so a half-finished download is never used.
 * - A chat keeps one LiteRT-LM conversation. When the next request is the same chat plus one new question, only that
 *   question is sent: the model keeps what it already read, so follow-ups start at once. Anything else starts a new
 *   conversation with the earlier messages as its preface. "The same chat" is decided in reuse.ts.
 */
type In =
  | { type: 'load'; repo: string; maxTokens: number }
  | { type: 'chat'; messages: { role: string; content: string }[]; keys?: string[]; maxTokens: number; temperature: number; metrics?: boolean }
  | { type: 'stop' }
  | { type: 'unload' }

let engine: Engine | null = null
let loadedRepo = ''
let windowSize = 4096
let convo: { conv: Conversation; held: Held } | null = null

const post = (m: object) => self.postMessage(m)
const fail = (e: unknown) => post({ type: 'error', message: String((e as Error)?.message || e || 'Something went wrong') })


async function dropConversation() {
  const c = convo
  convo = null
  await c?.conv.delete().catch(() => {})
}

async function load(repo: string, maxTokens: number) {
  if (engine && loadedRepo === repo) return post({ type: 'ready' })
  await dropConversation()
  await engine?.delete().catch(() => {})
  engine = null
  loadedRepo = ''
  const file = await modelFile(repo, (progress, loaded, total) => post({ type: 'progress', progress, loaded, total }))
  post({ type: 'warming' })
  windowSize = maxTokens
  engine = await Engine.create({ model: file, mainExecutorSettings: { maxNumTokens: maxTokens } })
  loadedRepo = repo
  post({ type: 'ready' })
}

/** Text of a streamed chunk: its text parts, leaving out anything on a side channel (such as thoughts). */
const textOf = (m: Message) =>
  typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => (p.type === 'text' ? (p as { text: string }).text : '')).join('')

async function chat(messages: { role: string; content: string }[], maxTokens: number, temperature: number, metrics?: boolean, given?: string[]) {
  if (!engine) throw new Error('The assistant is still getting ready.')
  const last = messages[messages.length - 1]
  const before = messages.slice(0, -1)
  const keys = given?.length === messages.length ? given : turnKeys(messages)
  // Same chat, one new question: keep the conversation and its memory. Otherwise start again from the preface.
  const reused = canReuse(convo?.held, keys, maxTokens, temperature)
  // A conversation that's kept may have been made with room for a longer answer; that limit stays.
  const limit = reused ? convo!.held.maxTokens : maxTokens
  if (!convo || !reused) {
    await dropConversation()
    const conv = await engine.createConversation({
      preface: { messages: before.map((m) => ({ role: m.role, content: m.content })) },
      sessionConfig: { maxOutputTokens: maxTokens, samplerParams: temperature > 0 ? { temperature, k: 40, p: 0.95 } : { temperature: 0 } },
    })
    convo = { conv, held: { keys: keys.slice(0, -1), maxTokens, temperature } }
  }
  let full = ''
  try {
    for await (const chunk of convo.conv.sendMessageStreaming({ role: 'user', content: last.content })) {
      full += textOf(chunk)
      post({ type: 'token', full })
    }
  } catch (e) {
    // A stopped or failed turn leaves the conversation mid-answer: start clean next time.
    await dropConversation()
    throw e
  }
  if (convo) convo.held = afterAnswer(keys, limit, temperature)
  let measured: { contextTokens?: number; prefillTokens?: number; reused: boolean } | undefined
  if (metrics && convo) {
    const [count, benchmark] = await Promise.allSettled([convo.conv.getTokenCount(), convo.conv.getBenchmarkInfo()])
    measured = { reused }
    if (count.status === 'fulfilled') measured.contextTokens = count.value
    if (benchmark.status === 'fulfilled') measured.prefillTokens = benchmark.value.lastPrefillTokenCount
  }
  post({ type: 'done', full, window: windowSize, ...measured })
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data
  try {
    if (m.type === 'stop') return convo?.conv.cancel()
    if (m.type === 'unload') {
      await dropConversation()
      await engine?.delete().catch(() => {})
      engine = null
      loadedRepo = ''
      return post({ type: 'unloaded' })
    }
    if (m.type === 'load') return await load(m.repo, m.maxTokens)
    if (m.type === 'chat') return await chat(m.messages, m.maxTokens, m.temperature, m.metrics, m.keys)
  } catch (err) {
    fail(err)
  }
}
