/**
 * Makes a picture a sensible size for a doc, off the main thread: at most `max` pixels on its longest side, re-encoded
 * as WebP (JPEG where WebP can't be written). Phone photos usually go from several MB to a few hundred KB. Animated
 * GIFs and SVGs are kept as they are, and so is any image the re-encode wouldn't make smaller.
 */
self.onmessage = async (e: MessageEvent<{ file: Blob; max: number }>) => {
  const { file, max } = e.data
  const done = (blob: Blob) => self.postMessage({ blob })
  try {
    if (/gif|svg/.test(file.type)) return done(file)
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    // Already small in both senses: nothing to gain.
    if (scale === 1 && file.size < 700_000) return done(file)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    let out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    // Browsers that can't write WebP hand back PNG; JPEG is far smaller for photos (PNG keeps transparency).
    if (out.type !== 'image/webp' && file.type === 'image/jpeg') out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 })
    done(out.size < file.size ? out : file)
  } catch {
    done(file)
  }
}
