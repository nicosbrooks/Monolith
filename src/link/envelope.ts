/**
 * What every sealed message carries besides its content, so the relay can't misuse frames it can't read. Same rules as
 * apple/iOS/Link/Envelope.swift; checked by scripts/test-link.ts.
 *
 *   f  the sending device's id (random, chosen once per install)
 *   q  a number that only goes up for that device (microseconds since 1970, or one more than the last)
 *   _  padding, so a frame's size says little about what's in it
 *
 * A receiver turns away a frame with its own id (the relay bounced it back) or with a q it has already seen from that
 * sender (the relay replayed it). Devices from before this was added send neither field; their frames are taken until
 * that room has once sent stamped ones, after which unstamped frames are refused too.
 */

export interface Stamp {
  f?: string
  q?: number
  _?: string
}

/** The next q after `last`: the clock in microseconds, or one more if the clock went backwards. */
export const nextSeq = (last: number, now = Date.now()) => Math.max(last + 1, now * 1000)

export type Verdict = 'ok' | 'self' | 'replay' | 'unstamped'

/**
 * Whether to take a frame. `seen` holds the highest q taken from each sender and is updated when the answer is 'ok'.
 * `strict` means this room's other devices are known to stamp their frames.
 */
export function admit(seen: Map<string, number>, self: string, s: Stamp, strict: boolean): Verdict {
  if (typeof s.f !== 'string' || typeof s.q !== 'number' || !Number.isFinite(s.q)) return strict ? 'unstamped' : 'ok'
  if (s.f === self) return 'self'
  if (s.q <= (seen.get(s.f) ?? 0)) return 'replay'
  seen.set(s.f, s.q)
  return 'ok'
}

/** Small frames grow to the next 512 bytes; big ones (records, files) are left as they are. */
const BLOCK = 512
export function pad<T extends object>(msg: T): T & Stamp {
  const n = JSON.stringify(msg).length
  if (n >= 64 * 1024) return msg
  // `,"_":""` adds 7 characters before the padding itself.
  const fill = Math.ceil((n + 7) / BLOCK) * BLOCK - n - 7
  return { ...msg, _: '.'.repeat(fill) }
}
