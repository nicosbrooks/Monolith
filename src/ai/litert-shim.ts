// LiteRT-LM loads its runtime with `importScripts` when it sees a worker, but in a module worker (which the app's
// bundler builds) `importScripts` exists and throws. This stand-in does the same job: fetch the script (synchronous
// requests are allowed in workers) and run it in the worker's global scope, where it defines `ModuleFactory` as
// LiteRT-LM expects. A worker has no script tag to tell the runtime where its `.wasm` file is, so `Module.locateFile`
// points it at the script's own folder.
const g = self as unknown as { importScripts: (...urls: string[]) => void; Module?: { locateFile: (path: string) => string } }
g.importScripts = (...urls: string[]) => {
  for (const url of urls) {
    g.Module = { locateFile: (path) => new URL(path, url).href }
    const req = new XMLHttpRequest()
    req.open('GET', url, false)
    req.send()
    if (req.status !== 200) throw new Error(`The assistant’s runtime couldn’t download (${req.status}).`)
    ;(0, eval)(req.responseText)
  }
}
export {}
