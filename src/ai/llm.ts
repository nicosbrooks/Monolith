import { create } from 'zustand'
import type { MLCEngineInterface } from '@mlc-ai/web-llm'
import { useStore } from '../store'
import { APP_NAME } from '../brand'

export type Tier = 'fast' | 'default' | 'enhanced' | 'more'
export interface ModelInfo {
  id: string
  name: string
  tier: Tier
  note: string
  /** GPU memory it needs, from WebLLM's catalogue. */
  needMB: number
  /** Set for Transformers.js models: the Hugging Face repo and the weights to use on GPU and on CPU. */
  onnx?: { repo: string; gpu: string; cpu?: string }
}

/**
 * Open models that run in a browser tab, all 2B or smaller so they download quickly and answer fast. Downloaded once,
 * then cached offline. Each runs in the engine that suits it: WebLLM, or Transformers.js for models WebLLM doesn't
 * have (those carry `onnx`). Monolith switches engines itself; people only pick a tier.
 * Same tiers as the iPhone and iPad app, so Fast / Default / Enhanced mean the same everywhere.
 */
export const MODELS: ModelInfo[] = [
  {
    id: 'Qwen3.5-0.8B-q4f16_1-MLC',
    name: 'Qwen 3.5 0.8B',
    tier: 'fast',
    note: 'Instant answers, smallest download',
    needMB: 1630,
  },
  {
    // Liquid AI's on-device model (Oct 2026): best in class at following instructions, about 1.1 GB.
    id: 'onnx:LFM3-1.7B',
    name: 'LFM 3 1.7B',
    tier: 'default',
    note: 'Quick and accurate, about 1 GB',
    needMB: 1800,
    onnx: { repo: 'onnx-community/LFM3-1.7B-ONNX', gpu: 'q4f16' },
  },
  {
    id: 'gemma-4-E2B-it-q4f16_1-MLC',
    name: 'Gemma 4 E2B',
    tier: 'enhanced',
    note: 'Sharpest writing and reasoning',
    needMB: 3390,
  },
  // Default where LFM 3 can't run (it needs the other engine on WebGPU).
  {
    id: 'Qwen3.5-2B-q4f16_1-MLC',
    name: 'Qwen 3.5 2B',
    tier: 'more',
    note: 'Strong all-rounder',
    needMB: 2250,
  },
]
const FALLBACK_DEFAULT = 'Qwen3.5-2B-q4f16_1-MLC'

/**
 * The tiers where WebLLM can't run: Firefox (fewer GPU buffers than WebLLM's kernels need) and browsers with no
 * WebGPU (on the CPU, only models with a `cpu` build are offered). Standard-attention models, because they have fast
 * GPU kernels in ONNX Runtime; Qwen 3.5's hybrid attention measured several times slower there.
 */
export const ONNX_MODELS: ModelInfo[] = [
  {
    id: 'onnx:Qwen3-0.6B',
    name: 'Qwen 3 0.6B',
    tier: 'fast',
    note: 'Instant answers, smallest download',
    needMB: 900,
    onnx: { repo: 'onnx-community/Qwen3-0.6B-ONNX', gpu: 'q4f16', cpu: 'q4' },
  },
  MODELS[1],
  {
    id: 'onnx:LFM2-1.2B',
    name: 'LFM 2 1.2B',
    tier: 'more',
    note: 'Liquid AI’s quick small model',
    needMB: 1400,
    onnx: { repo: 'onnx-community/LFM2-1.2B-ONNX', gpu: 'q4f16', cpu: 'q4' },
  },
]
const ONNX_FALLBACK_DEFAULT = 'onnx:LFM2-1.2B'

/** Which engine runs models in this tab. */
export function browserEngine(): 'webllm' | 'onnx' {
  // WebLLM wherever there's WebGPU (Firefox included: see llm.worker.ts); the other engine if it fails here.
  return gpu.adapter && !webllmFailed ? 'webllm' : 'onnx'
}
/** The models this browser can run, in the engine it will use. */
export const models = () => (browserEngine() === 'webllm' ? MODELS : ONNX_MODELS.filter((m) => gpu.adapter || m.onnx!.cpu))
const findModel = (id: string) => [...MODELS, ...ONNX_MODELS].find((m) => m.id === id)

/** Rough GPU memory this browser can spare for a model. Phones and small laptops get less. */
export function gpuBudgetMB() {
  if (!hasWebGPU()) return browserEngine() === 'onnx' ? 1500 : 0
  const nav = navigator as Navigator & { deviceMemory?: number }
  const mem = nav.deviceMemory ?? 8 // Chrome caps this at 8; Safari doesn't report it
  if (/iPhone|iPad|Android/.test(navigator.userAgent)) return 2500
  return mem >= 8 ? 7000 : mem >= 4 ? 3600 : 2000
}
/** 32-bit builds need about a third more memory than 16-bit ones. */
export const fits = (m: ModelInfo) => m.needMB * (gpu.f16 === false ? 1.3 : 1) <= gpuBudgetMB()

/**
 * What this browser's GPU can do. Firefox (and some others) expose WebGPU without 16-bit shaders, so the same
 * model runs from its 32-bit build there. Checked once, quietly.
 */
const gpu: { adapter: boolean | null; f16: boolean | null; buffers: number } = {
  adapter: null,
  f16: null,
  buffers: 0,
}
let gpuChecked: Promise<void> | null = null
export function detectGPU() {
  if (!gpuChecked)
    gpuChecked = (async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) return void (gpu.adapter = false)
      try {
        type Adapter = {
          features: Set<string>
          limits: { maxStorageBuffersPerShaderStage: number }
        }
        const a = await (
          navigator as unknown as {
            gpu: { requestAdapter(): Promise<Adapter | null> }
          }
        ).gpu.requestAdapter()
        gpu.adapter = !!a
        gpu.f16 = !!a?.features.has('shader-f16')
        gpu.buffers = a?.limits.maxStorageBuffersPerShaderStage ?? 0
      } catch {
        gpu.adapter = false
      }
    })()
  return gpuChecked
}
/** The build to download for a model on this browser. */
const build = (id: string) => (gpu.f16 === false ? id.replace('q4f16_1', 'q4f32_1') : id)
/** Set when WebLLM failed in this tab; the Transformers.js engine takes over. */
let webllmFailed = false
/** Set when a Transformers.js model failed where WebLLM works; Default then uses WebLLM's lighter model. */
let onnxFailed = false

/** The model behind a tier on this device. Default steps down to a lighter model where it won't fit or can't run. */
export function modelForTier(t: Exclude<Tier, 'more'>): ModelInfo {
  const list = models()
  const fallback = () => list.find((x) => x.id === (browserEngine() === 'webllm' ? FALLBACK_DEFAULT : ONNX_FALLBACK_DEFAULT)) ?? list[0]
  const m = list.find((x) => x.tier === t)
  // Without WebGPU only small models run (on the CPU): Default is the light one, Enhanced isn't offered.
  if (!m)
    return t === 'default'
      ? fallback()
      : t === 'enhanced'
        ? (list.find((x) => x.tier === 'enhanced') ?? {
            ...fallback(),
            needMB: Infinity,
          })
        : list[0]
  if (t === 'default' && (!fits(m) || (m.onnx && onnxFailed && browserEngine() === 'webllm'))) return fallback()
  return m
}

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

interface AIState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'
  progress: number
  progressText: string
  loadedModel: string | null
  error: string | null
  busy: boolean
  cached: Record<string, boolean>
}

export const useAI = create<AIState>(() => ({
  status: 'idle',
  progress: 0,
  progressText: '',
  loadedModel: null,
  error: null,
  busy: false,
  cached: {},
}))

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator && gpu.adapter !== false

let engine: MLCEngineInterface | null = null
let webllmWorker: Worker | null = null
let onnx: Worker | null = null
/** Which engine holds the loaded model. */
let loadedEngine: 'webllm' | 'onnx' | null = null
let loading: Promise<void> | null = null

/** Transformers.js keeps downloads in the Cache API, one entry per file URL. */
async function onnxCached(repos: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const keys = await (await caches.open('transformers-cache')).keys()
    for (const r of repos) if (keys.some((k) => k.url.includes(`/${r}/`) && /\.onnx(_data)?/.test(k.url))) out.add(r)
  } catch {
    /* no Cache API (private window) */
  }
  return out
}

export async function refreshCache() {
  try {
    await detectGPU()
    if (browserEngine() === 'onnx') {
      const have = await onnxCached(ONNX_MODELS.map((m) => m.onnx!.repo))
      useAI.setState({
        cached: Object.fromEntries(ONNX_MODELS.map((m) => [m.id, have.has(m.onnx!.repo)])),
      })
      return
    }
    const { hasModelInCache } = await import('@mlc-ai/web-llm')
    const have = await onnxCached(MODELS.filter((m) => m.onnx).map((m) => m.onnx!.repo))
    const entries = await Promise.all(MODELS.map(async (m) => [m.id, m.onnx ? have.has(m.onnx.repo) : await hasModelInCache(build(m.id))] as const))
    useAI.setState({ cached: Object.fromEntries(entries) })
  } catch {
    /* ignore */
  }
}

/** Whether the assistant can answer right now. */
export const isReady = () => useAI.getState().status === 'ready'

/** What someone picked in Settings. Picking is all it takes; this gets it running. */
export async function chooseModel(id: string) {
  useStore.getState().setSettings({ llmModel: id })
  return loadModel(id)
}

/** The model id to load: the saved choice, or the Default tier if nothing has been picked. */
export function resolvedModel() {
  const id = useStore.getState().settings.llmModel
  if (!id || id === 'default') return modelForTier('default').id
  if (models().some((m) => m.id === id)) return id
  // Picked in the other engine (say, on Chrome, then opened in Firefox): the same tier here.
  const t = findModel(id)?.tier
  return modelForTier(t && t !== 'more' ? t : 'default').id
}

/** Models earlier versions offered. Their downloads (up to 5 GB each) are cleared once, since nothing uses them now. */
const RETIRED = ['Qwen3.5-4B-q4f16_1-MLC', 'Qwen3.5-9B-q4f16_1-MLC', 'Qwen3-8B-q4f16_1-MLC', 'Phi-4-mini-instruct-q4f16_1-MLC']
const RETIRED_ONNX = ['onnx-community/Qwen3-1.7B-ONNX', 'onnx-community/Qwen3-4B-ONNX']
async function clearRetired() {
  try {
    const { deleteModelAllInfoInCache, hasModelInCache } = await import('@mlc-ai/web-llm')
    for (const id of RETIRED) for (const b of [id, id.replace('q4f16_1', 'q4f32_1')]) if (await hasModelInCache(b).catch(() => false)) await deleteModelAllInfoInCache(b)
    const c = await caches.open('transformers-cache')
    for (const k of await c.keys()) if (RETIRED_ONNX.some((r) => k.url.includes(`/${r}/`))) await c.delete(k)
  } catch {
    /* nothing cached, or no Cache API */
  }
}

/** At startup: find what this machine already has and get it going quietly. Downloads nothing new. */
export async function startAI() {
  await detectGPU()
  void clearRetired()
  await refreshCache()
  const id = resolvedModel()
  if (useAI.getState().cached[id]) void loadModel(id)
}

/** Make sure something can answer, downloading the in-browser model once if nothing else is there. */
export async function ensureAI() {
  if (isReady()) return true
  await loadModel()
  return isReady()
}

export async function loadModel(modelId?: string) {
  await detectGPU()
  while (loading) await loading
  const id = modelId ?? resolvedModel()
  if (browserEngine() === 'onnx') {
    const tier = findModel(id)?.tier
    return void (await loadOnnx(ONNX_MODELS.some((m) => m.id === id) ? id : modelForTier(tier && tier !== 'more' ? tier : 'default').id, true))
  }
  // A model WebLLM doesn't have runs in the other engine; if it can't start here, Default uses WebLLM's lighter one.
  if (findModel(id)?.onnx) {
    await unloadWebLLM()
    if (await loadOnnx(id, false)) return
    if (isNetwork(lastLoadError)) return void useAI.setState({ status: 'error', error: NO_DOWNLOAD })
    onnxFailed = true
    return loadModel(FALLBACK_DEFAULT)
  }
  if (useAI.getState().loadedModel === id && engine) return
  // Only one model in memory at a time.
  if (loadedEngine === 'onnx') unloadOnnx()
  useAI.setState({
    status: 'loading',
    progress: 0,
    progressText: 'Starting…',
    error: null,
  })
  let fellBack = false
  loading = (async () => {
    try {
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
      const cb = (r: { progress: number; text: string }) => useAI.setState({ progress: r.progress, progressText: r.text })
      if (engine) {
        await engine.reload(build(id))
      } else {
        webllmWorker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
        engine = await CreateWebWorkerMLCEngine(webllmWorker, build(id), { initProgressCallback: cb })
      }
      loadedEngine = 'webllm'
      useAI.setState({ status: 'ready', loadedModel: id, progress: 1 })
      refreshCache()
    } catch (e) {
      webllmWorker?.terminate()
      webllmWorker = null
      engine = null
      if (isNetwork(e)) useAI.setState({ status: 'error', error: NO_DOWNLOAD })
      else {
        // WebLLM can't run on this GPU. The other engine usually can: same tier, different build.
        webllmFailed = true
        fellBack = true
      }
    } finally {
      loading = null
    }
  })()
  await loading
  if (fellBack) {
    const t = findModel(id)?.tier
    await loadOnnx(modelForTier(t && t !== 'more' ? t : 'default').id, true)
  }
}

async function unloadWebLLM() {
  if (!engine) return
  await engine.unload().catch(() => {})
  webllmWorker?.terminate()
  webllmWorker = null
  engine = null
  if (loadedEngine === 'webllm') {
    loadedEngine = null
    useAI.setState({ status: 'idle', loadedModel: null })
  }
}
function unloadOnnx() {
  onnx?.terminate()
  onnx = null
  if (loadedEngine === 'onnx') {
    loadedEngine = null
    useAI.setState({ status: 'idle', loadedModel: null })
  }
}

/** The last load failure, to tell a lost connection from a model that can't run here. */
let lastLoadError: unknown = null
const NO_DOWNLOAD = 'The model couldn’t download. Check your connection and try again.'
/** A download that didn't arrive says nothing about whether the model runs here, so it never triggers a fallback. */
const isNetwork = (e: unknown) => (typeof navigator !== 'undefined' && !navigator.onLine) || /failed to fetch|networkerror|network error|load failed|err_|fetch failed|timed? ?out/i.test(message(e))

/** Errors arrive as Error objects, strings, or nothing at all; always show something readable. */
const message = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message) || 'The assistant couldn’t start.'

type OnnxOut = { type: 'progress'; progress: number } | { type: 'warming' } | { type: 'ready' } | { type: 'token'; full: string } | { type: 'done'; full: string } | { type: 'error'; message: string }

function onnxWorker() {
  onnx ??= new Worker(new URL('./onnx.worker.ts', import.meta.url), {
    type: 'module',
  })
  return onnx
}

/** Send one request to the Transformers.js worker and follow its replies until `until` says it's finished. */
function onnxCall(msg: object, on: (m: OnnxOut) => boolean | void): Promise<void> {
  const w = onnxWorker()
  return new Promise((resolve, reject) => {
    const h = (e: MessageEvent<OnnxOut>) => {
      if (e.data.type === 'error') {
        w.removeEventListener('message', h)
        return reject(new Error(e.data.message))
      }
      if (on(e.data)) {
        w.removeEventListener('message', h)
        resolve()
      }
    }
    w.addEventListener('message', h)
    w.postMessage(msg)
  })
}

/** Load a Transformers.js model. False if it couldn't start; `showError` puts that on screen (no fallback left). */
async function loadOnnx(modelId: string, showError: boolean): Promise<boolean> {
  const m = ONNX_MODELS.find((x) => x.id === modelId) ?? modelForTier('default')
  while (loading) await loading
  if (useAI.getState().loadedModel === m.id && loadedEngine === 'onnx') return true
  const device = gpu.adapter ? 'webgpu' : 'wasm'
  useAI.setState({
    status: 'loading',
    progress: 0,
    progressText: 'Starting…',
    error: null,
  })
  let ok = false
  loading = (async () => {
    try {
      await onnxCall(
        {
          type: 'load',
          model: m.onnx!.repo,
          device,
          dtype: device === 'webgpu' ? m.onnx!.gpu : (m.onnx!.cpu ?? 'q4'),
        },
        (r) => {
          if (r.type === 'progress') useAI.setState({ progress: Math.min(r.progress, 0.97) })
          if (r.type === 'warming') useAI.setState({ progress: 0.98, progressText: 'Almost ready…' })
          return r.type === 'ready'
        },
      )
      loadedEngine = 'onnx'
      ok = true
      useAI.setState({ status: 'ready', loadedModel: m.id, progress: 1 })
      refreshCache()
    } catch (e) {
      lastLoadError = e
      loadedEngine = null
      unloadOnnx()
      useAI.setState(showError ? { status: 'error', error: isNetwork(e) ? NO_DOWNLOAD : message(e) } : { status: 'idle' })
    } finally {
      loading = null
    }
  })()
  await loading
  return ok
}

export async function deleteModel(modelId: string) {
  const o = ONNX_MODELS.find((m) => m.id === modelId)
  if (o) {
    if (useAI.getState().loadedModel === modelId) {
      onnx?.terminate()
      onnx = null
      loadedEngine = null
      useAI.setState({ status: 'idle', loadedModel: null })
    }
    try {
      const c = await caches.open('transformers-cache')
      for (const k of await c.keys()) if (k.url.includes(`/${o.onnx!.repo}/`)) await c.delete(k)
    } catch {
      /* nothing cached */
    }
    return refreshCache()
  }
  const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm')
  if (useAI.getState().loadedModel === modelId) {
    await engine?.unload()
    webllmWorker?.terminate()
    webllmWorker = null
    engine = null
    loadedEngine = null
    useAI.setState({ status: 'idle', loadedModel: null })
  }
  await deleteModelAllInfoInCache(build(modelId))
  refreshCache()
}

/** Stream a chat completion from the model running in this browser. Returns the full text. */
export async function chat(messages: Msg[], onToken?: (full: string) => void, opts: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  useAI.setState({ busy: true })
  try {
    if (loadedEngine === 'onnx') {
      // Hybrid reasoning models (Qwen 3, LFM 3) answer directly; notes and chat don't need a visible chain of thought.
      const direct = /^onnx:(Qwen3|LFM3)/.test(useAI.getState().loadedModel ?? '')
      let full = ''
      const stop = () => onnx?.postMessage({ type: 'stop' })
      opts.signal?.addEventListener('abort', stop)
      try {
        await onnxCall(
          {
            type: 'chat',
            messages,
            maxTokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.6,
            think: !direct,
          },
          (r) => {
            if (r.type === 'token' || r.type === 'done') {
              full = r.full
              onToken?.(clean(full))
            }
            return r.type === 'done'
          },
        )
      } finally {
        opts.signal?.removeEventListener('abort', stop)
      }
      return clean(full)
    }
    if (!engine) throw new Error('The assistant is still getting ready.')
    // Qwen 3 thinks out loud by default; for notes and chat a direct answer is faster and just as good.
    const direct = useAI.getState().loadedModel?.startsWith('Qwen3') ? noThink(messages) : messages
    const stream = await engine.chat.completions.create({
      messages: direct,
      stream: true,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 1024,
    })
    let full = ''
    for await (const chunk of stream) {
      if (opts.signal?.aborted) {
        engine.interruptGenerate()
        break
      }
      full += chunk.choices[0]?.delta?.content ?? ''
      onToken?.(clean(full))
    }
    return clean(full)
  } finally {
    useAI.setState({ busy: false })
  }
}

// Every user turn, not just the last: earlier turns must read the same as when they were sent, or the model's cache is thrown away.
function noThink(m: Msg[]): Msg[] {
  return m.map((x) => (x.role === 'user' && !x.content.endsWith(' /no_think') ? { ...x, content: `${x.content} /no_think` } : x))
}

// Strip <think> blocks from reasoning models (Qwen3)
function clean(t: string) {
  return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart()
}

// Requests run one at a time on a single local model; queue them. What the person asks for goes first: anything
// running in the background (page insights) is stopped, and background work still waiting is dropped.
let queue: Promise<unknown> = Promise.resolve()
let behind: AbortController | null = null
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  behind?.abort()
  behind = null
  const p = queue.then(fn, fn)
  queue = p.catch(() => {})
  return p
}
/** Work nobody is waiting for. It gives way the moment someone asks something. */
export function background<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController()
  behind = c
  const gaveWay = () => new DOMException('Gave way', 'AbortError')
  // A stopped run can still resolve with what it had so far; that's cut off mid-sentence, so it counts as a failure.
  const run = () => (c.signal.aborted ? Promise.reject(gaveWay()) : fn(c.signal).then((v) => (c.signal.aborted ? Promise.reject(gaveWay()) : v)))
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p.finally(() => behind === c && (behind = null))
}

export const SYSTEM = `You are ${APP_NAME}, a concise study and productivity assistant that runs fully on the user's device. Be direct and practical. Use short Markdown (headings, bullet lists, **bold**). Use emoji only if the user requests them or they are part of text you need to preserve. Never invent facts about the user's notes beyond what is given.`
