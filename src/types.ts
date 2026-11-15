/** `note` is legacy: notes were merged into docs. Older data and older devices may still send it; it's turned into `doc` on the way in. */
export type ItemKind = 'note' | 'doc' | 'lecture'

export interface Segment {
  start: number // seconds
  end: number
  text: string
}

export interface LectureData {
  duration: number
  transcript: Segment[]
  hasAudio: boolean
  status: 'idle' | 'recording' | 'transcribing' | 'done'
  course?: string
}

export interface Item {
  id: string
  kind: ItemKind
  title: string
  content: string // HTML
  folderId: string | null
  parentId: string | null // nested docs
  emoji?: string
  pinned: boolean
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
  eventId?: string
  lecture?: LectureData
  /** Set when this doc is backed by a file in a connected source */
  sourceId?: string
  file?: FileMeta
}

export type SourceKind = 'folder' | 'gdrive' | 'github'

export interface Source {
  id: string
  kind: SourceKind
  name: string
  lastSync?: number
  config: {
    owner?: string
    repo?: string
    branch?: string
    base?: string // sub-folder inside the repo
    rootId?: string // Drive folder id
    readOnly?: boolean
  }
}

export interface FileMeta {
  path?: string // relative to the source root; unset until first written
  lastPath?: string // where it lived before it was deleted, so a restore puts it back
  rev?: string // provider revision (mtime, Drive version, git blob sha)
  id?: string // Drive file id
  dir?: boolean
  baseHtml: string // content as last synced, to detect local edits
  baseTitle: string
  front?: string // YAML front matter, preserved verbatim
  h1?: boolean // title lives in a leading "# " line (else it is the file name)
  conflict?: boolean
  error?: string
  pulls?: number // bumps when remote content replaces the local copy
}

export interface Folder {
  id: string
  name: string
  icon?: string
}

export interface CalEvent {
  id: string
  title: string
  start: number
  end: number
  color: string
  allDay?: boolean
  location?: string
  notes?: string
  linkedItemId?: string
  /** Set on events from a subscribed calendar (read-only). */
  calId?: string
}

export type Section = 'home' | 'tasks' | 'docs' | 'lectures' | 'calendar' | 'trash'

export interface Suggestion {
  id: string
  icon: 'calendar' | 'check' | 'sparkles' | 'clock' | 'book' | 'list'
  title: string
  detail?: string
  action?: { label: string; run: () => void }
  source: 'rule' | 'ai'
  /** Calendar suggestions: what, when and exactly where it was found, so Home can show its source. */
  found?: { what: string; when: string; itemId: string; docTitle: string; line: string; add: () => string }
}
