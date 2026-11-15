import { InterruptableStoppingCriteria, pipeline, TextStreamer, type TextGenerationPipeline } from '@huggingface/transformers'

/**
 * The second in-browser engine (Transformers.js + ONNX Runtime Web). It runs where WebLLM can't, such as Firefox,
 * whose WebGPU allows fewer storage buffers than WebLLM's kernels need, and on plain CPU (WebAssembly) when a
 * browser has no WebGPU at all.
 */
type In =
  | { type: 'load'; model: string; device: 'webgpu' | 'wasm'; dtype: string }
  | {
      type: 'chat'
      messages: { role: string; content: string }[]
      maxTokens: number
      temperature: number
      think: boolean
    }
  | { type: 'stop' }

let gen: TextGenerationPipeline | null = null
let loaded = ''
const stop = new InterruptableStoppingCriteria()

const fail = (e: unknown) =>
  self.postMessage({
    type: 'error',
    message: String((e as Error)?.message || e || 'Something went wrong'),
  })

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data
  if (m.type === 'stop') return stop.interrupt()
  if (m.type === 'load') {
    const key = `${m.model}|${m.device}|${m.dtype}`
    if (gen && loaded === key) return self.postMessage({ type: 'ready' })
    try {
      await gen?.dispose()
      gen = null
      gen = (await pipeline('text-generation', m.model, {
        device: m.device,
        dtype: m.dtype as 'q4f16',
        progress_callback: (p: { status: string; progress?: number; loaded?: number; total?: number }) => {
          if (p.status === 'progress_total')
            self.postMessage({
              type: 'progress',
              progress: (p.progress ?? 0) / 100,
              loaded: p.loaded,
              total: p.total,
            })
        },
      })) as TextGenerationPipeline
      // The first run compiles the GPU kernels; do it now so the first real answer isn't the slow one.
      self.postMessage({ type: 'warming' })
      await gen([{ role: 'user', content: 'Hi' }], {
        max_new_tokens: 1,
        tokenizer_encode_kwargs: { enable_thinking: false },
      } as object)
      loaded = key
      self.postMessage({ type: 'ready' })
    } catch (err) {
      gen = null
      loaded = ''
      fail(err)
    }
    return
  }
  if (m.type === 'chat') {
    if (!gen) return fail('The assistant is still getting ready.')
    stop.reset()
    let full = ''
    try {
      const streamer = new TextStreamer(gen.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (t: string) => {
          full += t
          self.postMessage({ type: 'token', full })
        },
      })
      await gen(m.messages, {
        max_new_tokens: m.maxTokens,
        do_sample: m.temperature > 0,
        temperature: m.temperature || undefined,
        top_p: 0.9,
        repetition_penalty: 1.05,
        streamer,
        stopping_criteria: stop,
        tokenizer_encode_kwargs: { enable_thinking: m.think },
      } as object)
      self.postMessage({ type: 'done', full })
    } catch (err) {
      fail(err)
    }
  }
}
