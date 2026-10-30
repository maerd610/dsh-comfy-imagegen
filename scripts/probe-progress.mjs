#!/usr/bin/env node
/**
 * Verify the one thing a card can lie about: that live sampler progress and
 * latent previews actually arrive. Runs without DSH in the loop — it submits a
 * real graph from the bundled templates and prints every tick it hears.
 *
 *   npm run probe
 *   node scripts/probe-progress.mjs --base-url http://127.0.0.1:8188 --template anima_t2i
 *
 * Exit 0 when the run finished with both a tick stream and at least one
 * preview frame; 1 when no template can run here; 2 when the run produced no
 * image; 3 when progress never arrived (the socket is not being heard).
 */
import { fileURLToPath } from 'node:url'
import { ComfyClient } from '../lib/comfy.js'
import { checkTemplate, loadTemplates } from '../lib/templates.js'
import { applySlots } from '../lib/ui2api.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && typeof args[at + 1] === 'string' ? args[at + 1] : fallback
}

const baseUrl = option('base-url', process.env.COMFY_BASE_URL ?? 'http://127.0.0.1:8188')
const wanted = option('template', '')
const prompt = option('prompt', 'a single red apple on a worn wooden table, soft window light from the left, shallow depth of field')
const templatesDir = fileURLToPath(new URL('../templates/', import.meta.url))

const log = (...parts) => console.log(...parts)
const client = new ComfyClient({ baseUrl })

let ticks = 0
let previews = 0
let previewBytes = 0
client.on('open', () => log(`socket open  ${client.socketUrl}`))
client.on('close', () => log('socket closed'))
client.on('progress', (event) => {
  ticks += 1
  if (ticks <= 3 || ticks % 5 === 0) log(`progress     ${event.value}/${event.max}  node ${event.node}`)
})
client.on('preview', (event) => {
  previews += 1
  previewBytes = client.preview(event.promptId)?.bytes.byteLength ?? previewBytes
  log(`preview      #${previews}  ${event.mime}  ${previewBytes} bytes`)
})

try {
  const info = await client.objectInfo()
  const { templates } = await loadTemplates([templatesDir], info)
  const runnable = templates.filter((template) => template.slots?.image === undefined && checkTemplate(template, info).ok)
  if (wanted !== '') {
    const named = runnable.find((template) => template.id === wanted)
    if (named === undefined) {
      log(`no runnable template "${wanted}" here; usable: ${runnable.map((template) => template.id).join(', ') || 'none'}`)
      process.exit(1)
    }
    runnable.unshift(named)
  }
  const template = runnable[0]
  if (template === undefined) {
    log(`no runnable text-to-image template; templates found: ${templates.map((entry) => entry.id).join(', ') || 'none'}`)
    process.exit(1)
  }
  log(`template     ${template.id} (${template.label ?? ''})`)

  const values = { ...(template.defaults ?? {}), prompt, seed: 7, batch: 1 }
  const prepared = applySlots(template.graph, template.slots, values)
  const startedAt = Date.now()
  const promptId = await client.submit(prepared.graph)
  log(`submitted    ${promptId}`)

  const entry = await client.wait(promptId, { timeoutMs: 600_000 })
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  const images = ComfyClient.images(entry)
  log(`finished     ${elapsed}s   ticks ${ticks}   previews ${previews}   images ${images.length}`)
  for (const image of images) log(`image        ${client.viewUrl(image)}`)

  if (images.length === 0) process.exit(2)
  if (ticks === 0) {
    log('no progress frames arrived: the socket is connected but not addressed by the server')
    process.exit(3)
  }
  process.exit(0)
} catch (error) {
  log(`failed: ${error?.message ?? error}`)
  process.exit(1)
} finally {
  client.close()
}
