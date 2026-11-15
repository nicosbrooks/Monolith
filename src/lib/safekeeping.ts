import { create } from 'zustand'
import { SAMPLE_IDS, useStore } from '../store'
import { toast } from '../components/Toast'
import { openBackup } from './backup'

/**
 * Keeping work safe in a browser. Two things can lose it: the browser clearing site data when the disk is nearly full
 * (or, in Safari, after weeks without a visit), and the device itself. Monolith asks the browser to keep its data once
 * there's something worth keeping, shows in Settings › Storage whether it agreed, and every so often suggests a backup
 * file when there's real work that exists only in this browser.
 */
export const useSafekeeping = create<{ persisted: boolean | null }>(() => ({ persisted: null }))

const DAY = 86_400_000
/** Suggest a backup when the newest is older than this (sooner if the browser may clear data)… */
const STALE = 14 * DAY
const STALE_UNKEPT = 7 * DAY
/** …and there are at least this many docs only this browser has… */
const MIN_DOCS = 5
/** …at most this often. */
const NUDGE_EVERY = 7 * DAY

/** Docs, recordings and the rest that live only here: not samples, not from connected storage, not deleted. */
export function ownItems() {
  return useStore.getState().items.filter((i) => !i.sourceId && !i.deletedAt && !SAMPLE_IDS.has(i.id))
}

async function checkPersisted() {
  const s = navigator.storage
  if (!s?.persisted) return useSafekeeping.setState({ persisted: null })
  let kept = await s.persisted().catch(() => false)
  // Ask once there's work worth keeping (Chrome and Edge decide quietly; Firefox may ask the person).
  if (!kept && ownItems().length > 0 && s.persist) kept = await s.persist().catch(() => false)
  useSafekeeping.setState({ persisted: kept })
}

export function backupDue(now = Date.now()): boolean {
  const { settings } = useStore.getState()
  const own = ownItems()
  if (own.length < MIN_DOCS) return false
  if (settings.backupNudgedAt && now - settings.backupNudgedAt < NUDGE_EVERY) return false
  const stale = useSafekeeping.getState().persisted === false ? STALE_UNKEPT : STALE
  // Never backed up: count from when the oldest of this work was made.
  const since = settings.lastBackup ?? Math.min(...own.map((i) => i.createdAt))
  return now - since > stale
}

function nudge() {
  if (!backupDue()) return
  useStore.getState().setSettings({ backupNudgedAt: Date.now() })
  const kept = useSafekeeping.getState().persisted !== false
  toast(kept ? 'Your work is only in this browser. Save a backup file to keep a copy.' : 'This browser may clear its data when space runs low. Save a backup file to keep a copy.', {
    ms: 15_000,
    action: { label: 'Back up', run: () => openBackup('export') },
  })
}

export function startSafekeeping() {
  void checkPersisted()
  // Not at launch, when attention is on what was opened; then once a day for a tab left open.
  setTimeout(nudge, 60_000)
  setInterval(() => void checkPersisted().then(nudge), DAY)
}
