export interface Entry {
  path: string // relative to source root
  rev: string
  id?: string
  dir?: boolean
}

export class ConflictError extends Error {
  constructor() {
    super('Changed elsewhere since it was last synced')
  }
}
export class AuthError extends Error {}

/** Per-file providers (folder, Drive) save each file as it changes. */
export interface FileProvider {
  batch?: false
  list(): Promise<Entry[]>
  read(e: Entry): Promise<string>
  /** Create or overwrite. With `prev` (and no `force`), fail with ConflictError if the remote changed since. */
  write(path: string, text: string, prev?: Entry, force?: boolean): Promise<Entry>
  remove(e: Entry): Promise<void>
  rename?(e: Entry, newPath: string): Promise<Entry>
  /** Binary files beside the docs (pictures and attachments in `assets/`). Only providers that can store them. */
  readFile?(path: string): Promise<Blob | null>
  writeFile?(path: string, data: Blob): Promise<void>
}

/** Batch providers (GitHub) collect changes and commit them together. */
export interface BatchProvider {
  batch: true
  readOnly: boolean
  list(): Promise<Entry[]>
  read(e: Entry): Promise<string>
  commit(changes: { path: string; text: string | null; prevRev?: string }[], message: string): Promise<Record<string, string>>
}

export type Provider = FileProvider | BatchProvider
export const MD = /\.(md|markdown)$/i
