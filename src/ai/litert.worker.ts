import { Engine, resolveModel, type Conversation, type Message } from '@litert-lm/core'
import { cachedModel, markCached, modelFileName } from './litert-cache'

// LiteRT-LM loads its runtime with `importScripts` when it sees a worker, but in a module worker (which the app's
// bundler builds) `importScripts` exists and throws. This stand-in does the same job: fetch the script (synchronous
// requests are allowed in workers) and run it in the worker's global scope, where it defines `ModuleFactory` as
// LiteRT-LM expects. A worker has no script tag to tell the runtime where its `.wasm` file is, so `Module.locateFile`
// points it at the script's own folder.
const g = self as unknown as { importScripts: (...urls: string[]) => void; Module?: { locateFile: (path: string) => string } }
g.importScripts = (...urls: string[]) => {
  for (const url of urls) {
    g.Module = { locateFile: (path) => new URL(path, url).href }
    const req = new XMLHttpRequest()
    req.open('GET', url, false)
    req.send()
    if (req.status !== 200) throw new Error(`The assistant’s runtime couldn’t download (${req.status}).`)
    ;(0, eval)(req.responseText)
  }
}

/**
 * Google's LiteRT-LM, for the Gemma tiers. Runs in its own worker so a model compile or a long answer never blocks
 * the page.
 *
 * - The model is downloaded once into this site's private storage (OPFS) and loaded from there afterwards. LiteRT-LM
 *   itself doesn't cache in the browser. A Web Lock keeps two tabs from downloading the same model at once, and a
 *   size-checked marker is written only after the whole file is stored, so a half-finished download is never used.
 * - A chat keeps one LiteRT-LM conversation. When the next request is the same chat plus one new question, only that
 *   question is sent: the model keeps what it already read, so follow-ups start at once. Anything else starts a new
 *   conversation with the earlier messages as its preface.
 */
type In =
  | { type: 'load'; repo: string; maxTokens: number }
  | { type: 'chat'; messages: { role: string; content: string }[]; maxTokens: number; temperature: number }
  | { type: 'stop' }
  | { type: 'unload' }

let engine: Engine | null = null
let loadedRepo = ''
let windowSize = 4096
let convo: { conv: Conversation; history: string; settings: string } | null = null

const post = (m: object) => self.postMessage(m)
const fail = (e: unknown) => post({ type: 'error', message: String((e as Error)?.message || e || 'Something went wrong') })

/** The model file, from storage if it's there, else downloaded into storage first (with progress). */
async function modelFile(repo: string): Promise<File> {
  const have = await cachedModel(repo)
  if (have) return have
  return navigator.locks.request(`monolith-model:${repo}`, async () => {
    // Another tab may have finished the download while this one waited.
    const again = await cachedModel(repo)
    if (again) return again
    const { huggingFace, model } = await resolveModel(`hf://${repo}`)
    const src = huggingFace?.source ?? (typeof model === 'string' ? { url: model } : (model as { url: string; size?: number }))
    const res = await fetch(src.url)
    if (!res.ok || !res.body) throw new Error(`The model couldn’t download (${res.status}).`)
    const total = src.size ?? Number(res.headers.get('content-length')) ?? 0
    const dir = await navigator.storage.getDirectory()
    const handle = await dir.getFileHandle(modelFileName(repo), { create: true })
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
          post({ type: 'progress', progress: got / total, loaded: got, total })
        }
      }
      await out.close()
    } catch (e) {
      await out.abort().catch(() => {})
      await dir.removeEntry(modelFileName(repo)).catch(() => {})
      throw e
    }
    if (total && got !== total) {
      await dir.removeEntry(modelFileName(repo)).catch(() => {})
      throw new Error('The model download was cut short. Check your connection and try again.')
    }
    await markCached(repo, { size: got, url: src.url, sha256: (src as { sha256?: string }).sha256 })
    return handle.getFile()
  })
}

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
  const file = await modelFile(repo)
  post({ type: 'warming' })
  windowSize = maxTokens
  engine = await Engine.create({ model: file, mainExecutorSettings: { maxNumTokens: maxTokens } })
  loadedRepo = repo
  post({ type: 'ready' })
}

/** Text of a streamed chunk: its text parts, leaving out anything on a side channel (such as thoughts). */
const textOf = (m: Message) =>
  typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => (p.type === 'text' ? (p as { text: string }).text : '')).join('')

async function chat(messages: { role: string; content: string }[], maxTokens: number, temperature: number) {
  if (!engine) throw new Error('The assistant is still getting ready.')
  const last = messages[messages.length - 1]
  const before = messages.slice(0, -1)
  const key = JSON.stringify(before)
  const settings = JSON.stringify([maxTokens, temperature])
  // Same chat, one new question: keep the conversation and its memory. Otherwise start again from the preface.
  if (!convo || convo.history !== key || convo.settings !== settings) {
    await dropConversation()
    const conv = await engine.createConversation({
      preface: { messages: before.map((m) => ({ role: m.role, content: m.content })) },
      sessionConfig: { maxOutputTokens: maxTokens, samplerParams: temperature > 0 ? { temperature, k: 40, p: 0.95 } : { temperature: 0 } },
    })
    convo = { conv, history: key, settings }
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
  if (convo) convo.history = JSON.stringify([...messages, { role: 'assistant', content: full }])
  post({ type: 'done', full, window: windowSize })
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
    if (m.type === 'chat') return await chat(m.messages, m.maxTokens, m.temperature)
  } catch (err) {
    fail(err)
  }
}
