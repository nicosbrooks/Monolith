/**
 * Turns PDFs and Office files into plain text. Loaded only when one is attached, so the app's startup code
 * doesn't carry it (pdf.js and the zip reader are large).
 */

/** Text of a PDF, page by page. Scanned pages with no text layer come back empty. */
export async function pdfText(buf: ArrayBuffer): Promise<{ text: string; pages: number; empty: number }> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const out: string[] = []
  let empty = 0
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 300); p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      let line = ''
      const lines: string[] = []
      for (const it of tc.items) {
        if (!('str' in it)) continue
        line += it.str
        if (it.hasEOL) {
          lines.push(line)
          line = ''
        }
      }
      if (line) lines.push(line)
      const t = lines.join('\n').trim()
      if (!t) empty++
      else out.push(`Page ${p}\n${t}`)
    }
  } finally {
    void doc.cleanup()
  }
  return { text: out.join('\n\n'), pages: doc.numPages, empty }
}

const xml = (s: string) =>
  s
    .replace(/<\/(w:p|a:p|text:p|row)>/g, '\n')
    .replace(/<\/(w:tc|c)>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')

/** Text of a .docx, .pptx, .xlsx or .odt: they are zip files of XML. */
export async function officeText(buf: ArrayBuffer, name: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /\.xml$/.test(f.name) && f.originalSize < 20_000_000 })
  const get = (p: string) => (files[p] ? strFromU8(files[p]) : '')
  const num = (p: string) => Number(p.match(/(\d+)\.xml$/)?.[1] ?? 0)
  if (/\.docx$/i.test(name)) return xml(get('word/document.xml'))
  if (/\.odt$/i.test(name)) return xml(get('content.xml'))
  if (/\.pptx$/i.test(name))
    return Object.keys(files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b))
      .map((p, i) => `Slide ${i + 1}\n${xml(get(p).replace(/<\/a:p>/g, '</a:p>')).trim()}`).join('\n\n')
  if (/\.xlsx$/i.test(name)) {
    const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xml(m[1]).trim())
    const names = [...get('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1])
    return Object.keys(files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b)).map((p, i) => {
      const rows = [...get(p).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
        [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
          const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ''
          return /t="s"/.test(c[1]) ? (shared[Number(v)] ?? '') : xml(v)
        }).join('\t'))
      return `Sheet: ${names[i] ?? i + 1}\n${rows.join('\n')}`
    }).join('\n\n')
  }
  return ''
}
