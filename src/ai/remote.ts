import { create } from 'zustand'

/**
 * Another of your devices that can answer for this one: a linked phone running its own model (link.ts registers it
 * while the phone is reachable and says it can). Kept in its own small module so the model code and the link code
 * don't load each other.
 */
export interface RemoteModel {
  /** "iPhone", as the phone calls itself. */
  device: string
  /** The model it runs, as it names it ("Gemma 3n", "Apple Intelligence"). */
  model: string
  ask(messages: { role: string; content: string }[], onText: (full: string) => void, opts: { signal?: AbortSignal; maxTokens?: number; temperature?: number }): Promise<string>
}

export const useRemote = create<{ remote: RemoteModel | null; lastUsed: boolean }>(() => ({ remote: null, lastUsed: false }))
export const setRemote = (remote: RemoteModel | null) => useRemote.setState({ remote })
