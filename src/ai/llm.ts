import { create } from 'zustand'
import type { MLCEngineInterface } from '@mlc-ai/web-llm'
import { useStore } from '../store'
import { APP_NAME } from '../brand'
import { cachedModel, removeModel } from './litert-cache'

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
  /** Set for LiteRT-LM models (Gemma): the Hugging Face repo of the web build. */
  litert?: { repo: string }
  /** What runs instead if this model's engine can't start on this device. */
  fallback?: string
  /** Only a fallback: never listed in Settings. */
  hidden?: boolean
}

/**
 * Open models that run in a browser tab. Downloaded once, then cached offline.
 * - Gemma 4 (Default, Enhanced) runs in Google's LiteRT-LM, the fastest web runtime for it: Google reports ~73 tokens/s
 *   writing and ~4,800 tokens/s reading on an M4 Max for E2B, and a conversation keeps what it has read between turns.
 * - Qwen 3.5 0.8B (Fast) runs in WebLLM: LiteRT-LM has no model that small.
 * - If LiteRT-LM can't start on a device, each Gemma tier falls back to a WebLLM model (hidden from Settings).
 * LFM 3, the iPhone's Default, isn't used here: in the browser it only runs through Transformers.js, which reads a
 * prompt in one pass (a ~900-token pass crashes Safari's GPU process) and re-reads the whole chat every turn.
 * Same tier names as the iPhone and iPad app.
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
    id: 'litert:gemma-4-E2B',
    name: 'Gemma 4 E2B',
    tier: 'default',
    note: 'Quick and capable, about 2 GB',
    needMB: 2600,
    litert: { repo: 'litert-community/gemma-4-E2B-it-litert-lm' },
    fallback: 'Qwen3.5-2B-q4f16_1-MLC',
  },
  {
    id: 'litert:gemma-4-E4B',
    name: 'Gemma 4 E4B',
    tier: 'enhanced',
    note: 'Sharpest writing and reasoning',
    needMB: 4400,
    litert: { repo: 'litert-community/gemma-4-E4B-it-litert-lm' },
    fallback: 'gemma-4-E2B-it-q4f16_1-MLC',
  },
  { id: 'Qwen3.5-2B-q4f16_1-MLC', name: 'Qwen 3.5 2B', tier: 'more', note: 'Quick and capable', needMB: 2250, hidden: true },
  { id: 'gemma-4-E2B-it-q4f16_1-MLC', name: 'Gemma 4 E2B', tier: 'more', note: 'Sharpest writing and reasoning', needMB: 3390, hidden: true },
]
/** Default where Gemma 4 E2B won't fit. */
const FALLBACK_DEFAULT = 'Qwen3.5-0.8B-q4f16_1-MLC'

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
  {
    id: 'onnx:LFM2-1.2B',
    name: 'LFM 2 1.2B',
    tier: 'default',
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
/** Set when LiteRT-LM couldn't start in this tab; the Gemma tiers use their WebLLM fallbacks. */
let litertFailed = false

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
  const usable = m.litert && litertFailed ? (findModel(m.fallback!) ?? m) : m
  if (t === 'default' && !fits(usable)) return fallback()
  return usable
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
let litert: Worker | null = null
/** Which engine holds the loaded model. */
let loadedEngine: 'webllm' | 'onnx' | 'litert' | null = null
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
    const entries = await Promise.all(MODELS.map(async (m) => [m.id, m.litert ? !!(await cachedModel(m.litert.repo)) : await hasModelInCache(build(m.id))] as const))
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
const RETIRED_ONNX = ['onnx-community/Qwen3-1.7B-ONNX', 'onnx-community/Qwen3-4B-ONNX', 'onnx-community/LFM3-1.7B-ONNX']
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
  // Gemma runs in LiteRT-LM; if that can't start on this device, the tier's WebLLM model takes over.
  const m = findModel(id)
  if (m?.litert) {
    if (!litertFailed) {
      await unloadWebLLM()
      unloadOnnx()
      if (await loadLitert(m, false)) return
      if (isNetwork(lastLoadError)) return void useAI.setState({ status: 'error', error: NO_DOWNLOAD })
      litertFailed = true
    }
    return loadModel(m.fallback)
  }
  if (useAI.getState().loadedModel === id && engine) return
  // Only one model in memory at a time.
  if (loadedEngine === 'onnx') unloadOnnx()
  if (loadedEngine === 'litert') await unloadLitert()
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
async function unloadLitert() {
  if (!litert) return
  litert.terminate()
  litert = null
  if (loadedEngine === 'litert') {
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
const isNetwork = (e: unknown) => (typeof navigator !== 'undefined' && !navigator.onLine) || /failed to fetch|networkerror|network error|load failed|err_|fetch failed|timed? ?out|cut short|couldn’t download/i.test(message(e))

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

type LitertOut = OnnxOut | { type: 'unloaded' }
/** Send one request to the LiteRT-LM worker and follow its replies until `on` says it's finished. */
function litertCall(msg: object, on: (m: LitertOut) => boolean | void): Promise<void> {
  litert ??= new Worker(new URL('./litert.worker.ts', import.meta.url), { type: 'module' })
  const w = litert
  return new Promise((resolve, reject) => {
    const h = (e: MessageEvent<LitertOut>) => {
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

/** Tokens a LiteRT-LM conversation can hold; chats are fitted to it like WebLLM's. */
const LITERT_WINDOW = 4096

/** Load a Gemma model in LiteRT-LM. False if it couldn't start; `showError` puts that on screen. */
async function loadLitert(m: ModelInfo, showError: boolean): Promise<boolean> {
  while (loading) await loading
  if (useAI.getState().loadedModel === m.id && loadedEngine === 'litert') return true
  useAI.setState({ status: 'loading', progress: 0, progressText: 'Starting…', error: null })
  // A 2 GB download shouldn't be cleared when the browser runs short of space.
  void navigator.storage?.persist?.().catch(() => {})
  let ok = false
  loading = (async () => {
    try {
      await litertCall({ type: 'load', repo: m.litert!.repo, maxTokens: LITERT_WINDOW }, (r) => {
        if (r.type === 'progress') useAI.setState({ progress: Math.min(r.progress, 0.97), progressText: 'Downloading…' })
        if (r.type === 'warming') useAI.setState({ progress: 0.98, progressText: 'Almost ready…' })
        return r.type === 'ready'
      })
      loadedEngine = 'litert'
      ok = true
      useAI.setState({ status: 'ready', loadedModel: m.id, progress: 1 })
      refreshCache()
      void clearFallbacks()
    } catch (e) {
      lastLoadError = e
      await unloadLitert()
      // The stored file itself is bad (damaged on disk, or a broken download): remove it so the next try downloads it again.
      if (/magic number|litertlm header|corrupt|truncated/i.test(message(e))) await removeModel(m.litert!.repo).catch(() => {})
      useAI.setState(showError ? { status: 'error', error: isNetwork(e) ? NO_DOWNLOAD : message(e) } : { status: 'idle' })
    } finally {
      loading = null
    }
  })()
  await loading
  return ok
}

/** Once Gemma runs in LiteRT-LM here, its WebLLM fallbacks aren't needed: free their downloads (over 1 GB each). */
async function clearFallbacks() {
  try {
    const { deleteModelAllInfoInCache, hasModelInCache } = await import('@mlc-ai/web-llm')
    for (const f of MODELS.filter((x) => x.hidden))
      for (const b of [f.id, f.id.replace('q4f16_1', 'q4f32_1')]) if (await hasModelInCache(b).catch(() => false)) await deleteModelAllInfoInCache(b)
  } catch {
    /* nothing cached */
  }
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
  const lm = MODELS.find((m) => m.id === modelId && m.litert)
  if (lm) {
    if (useAI.getState().loadedModel === modelId) await unloadLitert()
    await removeModel(lm.litert!.repo)
    return refreshCache()
  }
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

/** Rough token count, on the safe side: about 3.2 characters a token (English is nearer 4). */
const tokensOf = (t: string) => Math.ceil(t.length / 3.2) + 4
/** Tokens a model can see at once. WebLLM's builds of all three tiers use 4,096. The other engine reads a prompt in one
 *  pass, which costs memory in proportion to its length, so it's kept shorter there. */
const windowOf = () => (loadedEngine === 'onnx' ? 2048 : loadedEngine === 'litert' ? LITERT_WINDOW : 4096)

/**
 * Fit a chat inside the model's window, leaving room for the answer. The system message and the newest question always
 * stay; older turns go oldest first (a pair at a time, so the chat still starts with a question); if the newest
 * question alone is too long, its middle is cut, keeping the opening paragraph and the end.
 */
export function fit(messages: Msg[], window: number, reserve: number): Msg[] {
  const budget = window - reserve - 48
  const sys = messages[0]?.role === 'system' ? messages[0] : null
  const rest = sys ? messages.slice(1) : messages
  if (!rest.length) return messages
  const last = rest[rest.length - 1]
  const used = (sys ? tokensOf(sys.content) : 0) + tokensOf(last.content)
  if (used > budget) {
    const room = Math.floor(Math.max(200, (budget - (sys ? tokensOf(sys.content) : 0)) * 3.2))
    // Keep the opening paragraph (instructions come first in some prompts) and the end (the question comes last in
    // chat); the middle, usually pasted material, is what gives way.
    const para = last.content.indexOf('\n\n')
    const head = para > 0 ? Math.min(para, Math.floor(room * 0.4)) : 0
    return [...(sys ? [sys] : []), { ...last, content: last.content.slice(0, head) + '\n…\n' + last.content.slice(-(room - head - 3)) }]
  }
  let total = used
  let from = rest.length - 1
  while (from > 0 && total + tokensOf(rest[from - 1].content) <= budget) total += tokensOf(rest[--from].content)
  while (from < rest.length - 1 && rest[from].role !== 'user') from++
  return [...(sys ? [sys] : []), ...rest.slice(from)]
}

/** The GPU went away (sleep, a driver reset, another tab using all its memory); the model has to be loaded again. */
const gpuLost = (e: unknown) => /device (was |is )?lost|devicelost|gpudevice|destroyed|instance reference no longer exists|dispose/i.test(message(e))
const tooLong = (e: unknown) => /exceed context window|context window size/i.test(message(e))

/** Stream a chat completion from the model running in this browser. Returns the full text. */
export async function chat(messages: Msg[], onToken?: (full: string) => void, opts: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  useAI.setState({ busy: true })
  const reserve = opts.maxTokens ?? 1024
  try {
    try {
      return await generate(fit(messages, windowOf(), reserve), onToken, opts)
    } catch (e) {
      if (opts.signal?.aborted) throw e
      // The estimate was short for this text (code, other scripts): try again with a much smaller share of the window.
      if (tooLong(e)) return await generate(fit(messages, Math.floor(windowOf() * 0.6), reserve), onToken, opts)
      // Load the same model again (from the browser's cache, no download) and answer once more.
      if (gpuLost(e) || !isReady()) {
        const id = useAI.getState().loadedModel
        await resetEngines()
        await loadModel(id ?? undefined)
        if (!isReady()) throw new Error('The assistant stopped and couldn’t restart. Reload the page to try again.')
        return await generate(fit(messages, windowOf(), reserve), onToken, opts)
      }
      throw e
    }
  } finally {
    useAI.setState({ busy: false })
  }
}

/** Drop both engines after the GPU was lost, so the next load starts clean. */
async function resetEngines() {
  webllmWorker?.terminate()
  webllmWorker = null
  engine = null
  onnx?.terminate()
  onnx = null
  litert?.terminate()
  litert = null
  loadedEngine = null
  useAI.setState({ status: 'idle', loadedModel: null })
}

async function generate(messages: Msg[], onToken: ((full: string) => void) | undefined, opts: { signal?: AbortSignal; temperature?: number; maxTokens?: number }): Promise<string> {
  if (loadedEngine === 'litert') {
    let full = ''
    const stop = () => litert?.postMessage({ type: 'stop' })
    opts.signal?.addEventListener('abort', stop)
    try {
      await litertCall({ type: 'chat', messages, maxTokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.6 }, (r) => {
        if (r.type === 'token' || r.type === 'done') {
          full = r.full
          onToken?.(clean(full))
        }
        return r.type === 'done'
      })
    } catch (e) {
      // Stopping mid-answer ends the stream with an error; what was written so far is the answer.
      if (opts.signal?.aborted) return clean(full)
      throw e
    } finally {
      opts.signal?.removeEventListener('abort', stop)
    }
    return clean(full)
  }
  if (loadedEngine === 'onnx') {
    const direct = useAI.getState().loadedModel?.startsWith('onnx:Qwen3')
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
  // Qwen thinks out loud by default; for notes and chat a direct answer is faster and just as good.
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
