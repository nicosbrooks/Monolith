// LiteRT-LM model files, kept in this site's private storage (OPFS). Used by the LiteRT worker to store downloads and
// by the page to show what's downloaded and to remove a model. A model counts as cached only when its marker exists and
// the file is exactly the size the marker records, so an interrupted download is never mistaken for a finished one.

export const modelFileName = (repo: string) => `${repo.replace(/[^a-z0-9._-]+/gi, '__')}.litertlm`
const markerName = (repo: string) => `${modelFileName(repo)}.json`

interface Marker { size: number; url: string; sha256?: string; storedAt: number }

async function dir() {
  return navigator.storage.getDirectory()
}

/** The stored model file, or undefined if it isn't fully downloaded. */
export async function cachedModel(repo: string): Promise<File | undefined> {
  try {
    const d = await dir()
    const marker = JSON.parse(await (await (await d.getFileHandle(markerName(repo))).getFile()).text()) as Marker
    const file = await (await d.getFileHandle(modelFileName(repo))).getFile()
    return file.size === marker.size ? file : undefined
  } catch {
    return undefined
  }
}

/** Record that a model finished downloading. */
export async function markCached(repo: string, m: Omit<Marker, 'storedAt'>) {
  const d = await dir()
  const out = await (await d.getFileHandle(markerName(repo), { create: true })).createWritable()
  await out.write(JSON.stringify({ ...m, storedAt: Date.now() } satisfies Marker))
  await out.close()
}

/** Remove a model and its marker (the marker first, so a half-removed model never looks cached). */
export async function removeModel(repo: string) {
  const d = await dir()
  for (const name of [markerName(repo), modelFileName(repo)]) await d.removeEntry(name).catch(() => {})
}
