import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

/**
 * WebLLM asks for 10 storage buffers per shader up front and refuses to start below that. Firefox 160 offers 9,
 * though the models' shaders fit in fewer. So WebLLM is shown the number it wants, and the device is created with
 * what the GPU really has. A shader that truly needs more would fail on its own, and the app falls back.
 */
type Limits = Record<string, number>
type Adapter = { limits: Limits; requestDevice(d?: { requiredLimits?: Limits }): Promise<unknown> }
const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<Adapter | null> } }).gpu
if (gpu) {
  const request = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (o?: unknown) => {
    const a = await request(o)
    const real = a?.limits.maxStorageBuffersPerShaderStage ?? 10
    if (!a || real >= 10) return a
    const limits = new Proxy(a.limits, { get: (l, k) => (k === 'maxStorageBuffersPerShaderStage' ? 10 : Reflect.get(l, k)) })
    return new Proxy(a, {
      get(t, k) {
        if (k === 'limits') return limits
        if (k === 'requestDevice')
          return (d?: { requiredLimits?: Limits }) => {
            if (d?.requiredLimits && d.requiredLimits.maxStorageBuffersPerShaderStage > real) d.requiredLimits.maxStorageBuffersPerShaderStage = real
            return t.requestDevice(d)
          }
        const v = Reflect.get(t, k)
        return typeof v === 'function' ? v.bind(t) : v
      },
    })
  }
}

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg)
