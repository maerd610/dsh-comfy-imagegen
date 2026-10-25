/**
 * Where generated files land.
 *
 * Layout:
 *   <outputDir>/<YYYY-MM-DD>/<slug>-<seed>[-n].png
 *   <outputDir>/<YYYY-MM-DD>/<slug>-<seed>[-n].json   ← sidecar: how it was made
 *
 * The sidecar matters: the image alone cannot tell anyone which template, seed
 * or prompt produced it, and re-rolling a good result needs exactly that.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** A filesystem-safe stub of the prompt, so folders are browsable by eye. */
export function slugify(prompt, maxLength = 48) {
  const ascii = String(prompt ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii.length >= 3) return ascii.slice(0, maxLength).replace(/-+$/, '')
  return 'image'
}

/** Local calendar date, `YYYY-MM-DD`. */
export function dayStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function uniquePath(dir, base, extension) {
  let path = join(dir, `${base}${extension}`)
  for (let index = 2; existsSync(path); index += 1) {
    path = join(dir, `${base}-${index}${extension}`)
  }
  return path
}

/**
 * Write every image of one generation plus its sidecar.
 * @param {{outputDir: string, prompt: string, seed: number|string, images: {bytes: Uint8Array, filename?: string}[], meta: object}} input
 * @returns {Promise<{path: string, filename: string, sidecar: string, bytes: number}[]>}
 */
export async function saveGenerated({ outputDir, prompt, seed, images, meta }) {
  const dir = join(outputDir, dayStamp())
  await mkdir(dir, { recursive: true })
  const slug = slugify(meta?.caption ?? prompt)
  const saved = []
  for (const [index, image] of images.entries()) {
    const extension = '.png'
    const base = images.length > 1 ? `${slug}-${seed}-${index + 1}` : `${slug}-${seed}`
    const path = uniquePath(dir, base, extension)
    const sidecar = path.replace(/\.png$/i, '.json')
    await writeFile(path, image.bytes)
    await writeFile(sidecar, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      prompt: meta?.caption ?? prompt,
      negative: meta?.negative,
      template: meta?.template,
      size: meta?.size,
      requestedSize: meta?.requestedSize,
      source: meta?.source,
      seed,
      steps: meta?.steps,
      cfg: meta?.cfg,
      batch: meta?.batch,
      // Every slot value that actually went into the graph, so a re-roll can
      // copy the numbers instead of guessing which knob made the difference.
      params: meta?.params,
      promptId: meta?.promptId,
      comfy: { folder: meta?.comfyFolder, filename: image.filename },
    }, null, 2)}\n`)
    saved.push({ path, filename: image.filename ?? base + extension, sidecar, bytes: image.bytes.length })
  }
  return saved
}
