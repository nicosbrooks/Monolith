import { ExternalLink } from 'lucide-react'

/** The models Monolith can download, each used under the licence on its page. */
const MODELS: [string, string][] = [
  ['Gemma 4 E2B and E4B (Google)', 'litert-community/gemma-4-E2B-it-litert-lm'],
  ['EmbeddingGemma (Google)', 'litert-community/embeddinggemma-2-text-270m-litert-lm'],
  ['Qwen 3.5 and Qwen 3 (Alibaba)', 'mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC'],
  ['LFM2 (Liquid AI)', 'onnx-community/LFM2-1.2B-ONNX'],
  ['Moonshine (Useful Sensors)', 'onnx-community/moonshine-base-ONNX'],
  ['Whisper (OpenAI)', 'onnx-community/whisper-large-v3-turbo'],
]

/**
 * Settings › About: the version, what leaves this device (exactly, and when), and the licences of the code and models
 * Monolith is built on.
 */
export function About() {
  return (
    <section className="about">
      <h3>About</h3>
      <p className="about-version">
        <b>Monolith {__APP_VERSION__}</b>
        <span className="muted small">Built {__BUILD_DATE__}</span>
      </p>
      <details className="advanced">
        <summary>Privacy</summary>
        <div className="about-body">
          <p>Your notes, files, recordings and calendar stay on this device. The assistant, transcription and search all run here; nothing you write is sent to an AI service. There are no analytics, no tracking and no ads.</p>
          <p>Monolith only goes online for these, and only when they’re needed:</p>
          <ul>
            <li><b>Models.</b> The first time you use the assistant, search by meaning or transcription, its model is downloaded from Hugging Face and its runtime from jsDelivr. They see an ordinary download, not what you’re doing with it.</li>
            <li><b>Location and weather,</b> only if you turn them on: your rough position goes to BigDataCloud (place name) and Open-Meteo (forecast).</li>
            <li><b>Your phone,</b> if you link one: changes pass through Monolith’s relay sealed with a key only your devices have, so the relay can’t read them.</li>
            <li><b>Storage you connect</b> (a GitHub repository or Google Drive): Monolith talks to it directly from this browser. Signing in to GitHub exchanges a one-time code through Monolith’s server, which keeps nothing.</li>
            <li><b>Calendars you subscribe to</b> are fetched from the address you give, through the relay when the calendar’s server doesn’t allow browsers.</li>
          </ul>
          <p>With a passcode set, everything stored here is encrypted with it, files and backups included.</p>
        </div>
      </details>
      <details className="advanced">
        <summary>Licences</summary>
        <div className="about-body">
          <p>
            Monolith is built on open-source software.{' '}
            <a href="/licenses.txt" target="_blank" rel="noopener">Every package and its licence <ExternalLink size={12} /></a>
          </p>
          <p>Models are downloaded from their publishers and used under their own licences:</p>
          <ul>
            {MODELS.map(([name, repo]) => (
              <li key={repo}>
                <a href={`https://huggingface.co/${repo}`} target="_blank" rel="noopener noreferrer">{name} <ExternalLink size={12} /></a>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  )
}
