import { chat, detectGPU, isReady, loadModel, modelForTier, useAI } from '../src/ai/llm'
import { auditPrompts, casePrompts, cases } from './assistant-cases'

const out = document.querySelector<HTMLPreElement>('#results')!
const buttons = [...document.querySelectorAll('button')]
const show = (result: unknown) => { out.textContent += JSON.stringify(result, null, 2) + '\n\n' }
const errors = (e: unknown) => e instanceof Error ? e.message : String(e)
const ms = (t: number) => Math.round(performance.now() - t)
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]

function audit() {
  out.textContent = ''
  for (const window of [4096, 2048]) {
    const checks = auditPrompts(window)
    const broad = median(checks.map((row) => row.broadTokens))
    const focused = median(checks.map((row) => row.focusedTokens))
    show({ window, medianEstimatedInputTokens: { broad, focused }, reductionPct: Math.round(100 * (1 - focused / broad)), checks })
  }
}

async function compare(tier: 'fast' | 'default') {
  audit()
  buttons.forEach((button) => { button.disabled = true })
  const unsubscribe = useAI.subscribe((state) => {
    if (state.status === 'loading') buttons.find((button) => button.id === tier)!.textContent = state.progressText
  })
  try {
    const start = performance.now()
    await detectGPU()
    const requested = modelForTier(tier)
    await loadModel(requested.id)
    if (!isReady()) throw new Error(useAI.getState().error || 'Model unavailable')
    show({ requested: requested.id, loaded: useAI.getState().loadedModel, modelLoadMs: ms(start) })
    // Warm up the loaded model first. Alternate the order to reduce bias from the first strategy in a pair.
    await chat([{ role: 'user', content: 'Reply with one word: ready.' }], undefined, { maxTokens: 20, temperature: 0 })
    for (const [index, test] of cases.entries()) {
      const strategies = index % 2 === 0 ? ['broad', 'focused'] as const : ['focused', 'broad'] as const
      for (const strategy of strategies) {
        const began = performance.now()
        let firstTextMs: number | undefined
        let metrics: unknown
        try {
          const answer = await chat((window, reserve) => casePrompts(test, strategy, window, reserve).messages, (text) => {
            if (text.trim() && firstTextMs === undefined) firstTextMs = ms(began)
          }, { maxTokens: test.action ? 800 : 500, temperature: 0, onMetrics: (m) => { metrics = m } })
          show({ case: test.name, strategy, loaded: useAI.getState().loadedModel, firstTextMs, totalMs: ms(began), metrics, expected: test.expected, answer })
        } catch (e) {
          show({ case: test.name, strategy, error: errors(e) })
        }
      }
    }
  } catch (e) {
    show({ error: errors(e) })
  } finally {
    unsubscribe()
    buttons.forEach((button) => { button.disabled = false })
    document.querySelector('#fast')!.textContent = 'Compare on Fast'
    document.querySelector('#default')!.textContent = 'Compare on Default'
  }
}
document.querySelector('#audit')!.addEventListener('click', audit)
document.querySelector('#fast')!.addEventListener('click', () => void compare('fast'))
document.querySelector('#default')!.addEventListener('click', () => void compare('default'))
