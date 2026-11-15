import { Loader2, Square, Volume2 } from 'lucide-react'
import { speak, useVoice } from '../ai/voice'

/** Read something aloud. Same button stops it. */
export function Listen({ id, text, className = 'tb', label }: { id: string; text: () => string; className?: string; label?: string }) {
  const on = useVoice((s) => s.speaking === id)
  const starting = useVoice((s) => s.speaking === id && s.starting)
  const Icon = starting ? Loader2 : on ? Square : Volume2
  return (
    <button className={className} onClick={() => speak(id, text())} title={on ? 'Stop' : 'Listen'} aria-label={on ? 'Stop reading' : 'Listen'}>
      <Icon size={label ? 11 : 17} className={starting ? 'spin' : undefined} />
      {label && (on ? 'Stop' : label)}
    </button>
  )
}
