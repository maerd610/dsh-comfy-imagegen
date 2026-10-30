/**
 * dsh-comfy-imagegen — conversational image generation for DeepSeek Harness.
 *
 * One tool does the work: `image_generate`. It talks to a local ComfyUI,
 * renders through whichever template actually fits the request, saves the file
 * next to a sidecar describing how it was made, and hands the GUI a plain
 * http(s) URL so the picture shows up inline in the conversation.
 *
 * Deliberately boring on the outside:
 *   - no hardcoded model names: templates declare what they need and the
 *     server's own `/object_info` decides whether they can run here
 *   - every template is a JSON file the user can copy, edit, or replace
 *   - the two HTTP routes (`GET /imagegen/status`, `GET /imagegen/preview`) and
 *     the client card are decoration: if neither loads, generation still works
 *     and the picture still appears inline
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { mkdir, unlink, writeFile as writeFileAsync } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ComfyClient, ComfyError } from './comfy.js'
import { saveGenerated } from './output.js'
import { applySlots, optionList, requiredModels } from './ui2api.js'
import { checkTemplate, loadTemplates, resolveSize, selectTemplate } from './templates.js'

const BUNDLED_TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url))

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8188',
  outputDir: join(homedir(), 'Pictures', 'dsh-comfy-imagegen'),
  templateDirs: [],
  timeoutMs: 900_000,
}

/**
 * `~`, `$HOME` and `%USERPROFILE%` stand for the same folder: expand them
 * without a shell, because Windows users paste `%USERPROFILE%` and POSIX users
 * paste `~`, and both should work in the same field.
 */
function expandPath(value) {
  return String(value).trim()
    .replace(/^~(?=$|[\\/])/, homedir())
    .replace(/^\$(?:HOME|\{HOME\})(?=$|[\\/])/, homedir())
    .replace(/^%USERPROFILE%(?=$|[\\/])/i, homedir())
}

/**
 * Tool results must be lossless JSON: a single `undefined` value (an optional
 * field a template simply does not carry) invalidates the whole payload, so
 * absent keys are dropped rather than passed through.
 */
function prune(value) {
  if (Array.isArray(value)) return value.map(prune)
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = prune(entry)
  }
  return out
}

function normaliseConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  const outputDir = typeof config.outputDir === 'string' && config.outputDir !== ''
    ? expandPath(config.outputDir)
    : DEFAULTS.outputDir
  const comfyUiDir = typeof config.comfyUiDir === 'string' && config.comfyUiDir.trim() !== ''
    ? expandPath(config.comfyUiDir)
    : undefined
  const explicit = Array.isArray(config.templateDirs)
    ? config.templateDirs.filter((dir) => typeof dir === 'string' && dir.trim() !== '').map(expandPath)
    : []
  const templateMeta = config.templateMeta !== null && typeof config.templateMeta === 'object' && !Array.isArray(config.templateMeta)
    ? Object.fromEntries(Object.entries(config.templateMeta).filter(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value)))
    : {}
  return {
    baseUrl: String(config.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
    outputDir,
    // Ordered by priority: an earlier folder shadows a later one, and the
    // templates welded to this machine always lose to the user's own files.
    // `image_workflow write` saves into `<outputDir>/workflows`, so that folder
    // is searched as well: otherwise the template the tool just wrote could not
    // be read back, and the write would report a failure it did not have.
    templateDirs: [
      ...explicit,
      join(outputDir, 'workflows'),
      ...(comfyUiDir === undefined ? [] : [join(comfyUiDir, 'user', 'default', 'workflows')]),
      BUNDLED_TEMPLATES,
    ],
    // The user's own files are chosen before the bundled presets: this machine's
    // models and LoRAs are the ones worth rendering with.
    preferLocal: config.preferLocal !== false,
    templateMeta,
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULTS.timeoutMs,
  }
}

const seed = () => Math.floor(Math.random() * 4_294_967_295)

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Give an uploaded reference a name LoadImage will accept whatever it arrived as. */
function imageFilename(name, contentType) {
  const cleaned = String(name ?? '').replace(/[^\w.\-]+/g, '_').slice(-80) || 'source'
  const lower = cleaned.toLowerCase()
  if ([...IMAGE_EXTENSIONS].some((extension) => lower.endsWith(extension))) return cleaned
  const fromType = /image\/(png|jpe?g|webp)/i.exec(String(contentType ?? ''))?.[1]
  return `${cleaned}.${(fromType ?? 'png').toLowerCase().replace('jpg', 'jpeg')}`
}

/**
 * Read a source picture from disk or the web and put it where LoadImage looks.
 * @returns {Promise<{name: string, subfolder: string, type: string}>}
 */
async function uploadSource(client, source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`下载源图失败（HTTP ${response.status}）`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const fromUrl = decodeURIComponent(new URL(source).pathname.split('/').pop() ?? '')
    return { ...(await client.uploadImage(bytes, imageFilename(fromUrl, response.headers.get('content-type')))), bytes }
  }
  const bytes = new Uint8Array(await readFile(source))
  return { ...(await client.uploadImage(bytes, imageFilename(basename(source), undefined))), bytes }
}

/** Pixel size from encoded bytes (PNG / JPEG / WebP); undefined when unknown. */
function measureImage(bytes) {
  if (bytes === undefined || bytes.length < 24) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (ascii(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { width, height }
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let index = 2
    while (index + 9 < bytes.length) {
      if (bytes[index] !== 0xff) { index += 1; continue }
      const marker = bytes[index + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(index + 5), width: view.getUint16(index + 7) }
      }
      index += 2 + view.getUint16(index + 2)
    }
  }
  return undefined
}
function errorResult(message, detail) {
  return {
    ok: false,
    error: message,
    detail,
  }
}

function describeMissing(check, template) {
  const lines = [`模板 ${template.id}（${template.label}）在这台机器上跑不了：`]
  for (const item of check.missing) lines.push(`  · ${item.detail}`)
  lines.push('')
  lines.push('处理方式：装上缺的模型/节点后重试；或换一个模板；或把模板里的文件名改成你本地实际有的文件。')
  return lines.join('\n')
}

/**
 * Legal values for every slot whose input is a fixed list, keyed by knob name.
 * `params` writes straight into those inputs, so this is the difference between
 * "try a different sampler" and "pick one the server actually has".
 */
function knobChoices(template, objectInfo) {
  const choices = {}
  for (const [key, slot] of Object.entries(template.slots)) {
    const node = template.graph?.[slot.node]
    if (node === undefined) continue
    const options = optionList(objectInfo, node.class_type, slot.input)
    if (options !== undefined && options.length > 0) choices[key] = options
  }
  return choices
}

function markdown(value) {
  const blocks = []
  if (value.ok === false) {
    blocks.push({ type: 'text', text: value.error })
    return blocks
  }
  for (const image of value.images) {
    blocks.push({ type: 'text', text: `![image ${image.index}](${image.url})` })
  }
  const meta = [
    `template: ${value.template}`,
    `size: ${value.size}`,
    `seed: ${value.seed}`,
    `elapsed: ${(value.elapsedMs / 1000).toFixed(1)}s`,
  ].join(' · ')
  blocks.push({ type: 'text', text: meta })
  for (const image of value.images) blocks.push({ type: 'text', text: image.path })
  return blocks
}

export const name = 'dsh-comfy-imagegen'
export const inject = ['tools']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = normaliseConfig(rawConfig)
  const client = new ComfyClient({ baseUrl: config.baseUrl })

  /**
   * Live runs, keyed by prompt id and kept in submission order. The status
   * route and the card read this; nothing in the generation path depends on it
   * being read.
   */
  const runs = new Map()

  /**
   * Sampler throughput learned from finished runs, per template. ComfyUI 0.42.5
   * broadcasts no `progress` frames to outside sockets, so without this the card
   * could only ever show an indeterminate bar; one finished run is enough to
   * draw an honest "about 60%" estimate for the next one.
   */
  const timings = new Map()
  const timingsFile = join(config.outputDir, '.timings.json')

  // Estimate survives a restart: the first run after one is no longer blind.
  try {
    for (const [id, timing] of Object.entries(JSON.parse(readFileSync(timingsFile, 'utf8')))) {
      if (Number.isFinite(timing?.ms)) timings.set(id, { ms: timing.ms, steps: timing.steps, batch: timing.batch })
    }
  } catch {
    // nothing learned yet, or an unreadable file: estimates just stay off.
  }

  function saveTimings() {
    return mkdir(dirname(timingsFile), { recursive: true })
      .then(() => writeFileAsync(timingsFile, JSON.stringify(Object.fromEntries(timings), null, 2)))
      .catch(() => {})
  }

  function estimateMs(templateId, steps, batch) {
    const timing = timings.get(templateId)
    if (timing === undefined) return undefined
    let factor = 1
    if (Number.isFinite(steps) && timing.steps > 0) factor *= steps / timing.steps
    if (Number.isFinite(batch) && timing.batch > 0) factor *= batch / timing.batch
    return Math.round(timing.ms * factor)
  }

  /** The step count the graph will really run with, defaults included. */
  function effectiveSteps(template, graph) {
    const slot = template.slots?.steps
    if (slot === undefined) return undefined
    const value = graph?.[slot.node]?.inputs?.[slot.input]
    return Number.isFinite(value) ? value : undefined
  }

  // ---- workflow surgery ---------------------------------------------------
  // Two levels, both driven by `image_workflow` and by nothing else, so a plain
  // picture request never pays for them:
  //   · pins — node inputs retuned for one template, applied to the cloned graph
  //     right before submission. The workflow file stays exactly as the user
  //     wrote it, and `anima` keeps meaning that file.
  //   · derived templates — a graph edited structurally (nodes added, removed,
  //     rewired) saved as a new manifest template next to the user's workflows.
  const overridesFile = join(config.outputDir, '.workflow-overrides.json')
  /** @type {Record<string, Record<string, Record<string, unknown>>>} */
  let overrides = {}
  try {
    const parsed = JSON.parse(readFileSync(overridesFile, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed
  } catch {
    // nothing pinned yet
  }

  function pinnedFor(templateId) {
    const entry = overrides[templateId]
    return entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
  }

  async function saveOverrides() {
    try {
      await mkdir(dirname(overridesFile), { recursive: true })
      await writeFileAsync(overridesFile, JSON.stringify(overrides, null, 2))
    } catch (error) {
      console.error(`[imagegen] 覆盖文件写不进去：${error.message}`)
    }
  }

  /**
   * Where a structurally edited workflow gets written. Deliberately not the
   * user's ComfyUI folder: a manifest is a template for this plugin, and ComfyUI's
   * own workflow browser would offer it as a file it cannot open.
   */
  function writeDir() {
    return join(config.outputDir, 'workflows')
  }

  /**
   * Is `file` the one this tool could have written? Compared on resolved paths,
   * case-insensitively on Windows, with a trailing separator so `…/workflows-old`
   * can never pass for `…/workflows`.
   */
  function insideWriteDir(file) {
    const root = resolve(writeDir())
    const target = resolve(String(file))
    const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root
    const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
    return normalizedTarget.startsWith(normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep)
  }

  /** Write the pins into a prepared graph; returns what actually landed. */
  function applyPinned(graph, templateId) {
    const applied = []
    for (const [nodeId, inputs] of Object.entries(pinnedFor(templateId))) {
      const node = graph?.[nodeId]
      if (node === undefined || node.inputs === undefined || inputs === null || typeof inputs !== 'object') continue
      for (const [input, value] of Object.entries(inputs)) {
        if (value === undefined) continue
        // A pin may name an input the node does not have yet only when the pin
        // is a link to a node that does — otherwise writing it would make the
        // graph lie about what the node accepts.
        node.inputs[input] = value
        applied.push(`${nodeId}.${input}`)
      }
    }
    return applied
  }

  const isLink = (value) => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isFinite(Number(value[1]))

  /** Every link that points at a node nobody declares, which ComfyUI rejects. */
  function brokenLinks(graph) {
    const broken = []
    for (const [id, node] of Object.entries(graph)) {
      for (const [input, value] of Object.entries(node.inputs ?? {})) {
        if (!isLink(value)) continue
        if (graph[value[0]] === undefined) broken.push(`${value[0]} 不存在，被 ${id}.${input} 引用`)
      }
    }
    return broken
  }

  /**
   * One template flattened for reading and for editing: nodes in graph order,
   * each input carrying its current value, whether it is wired, and what the
   * server accepts there.
   */
  function describeWorkflow(template, info) {
    const pinned = pinnedFor(template.id)
    /** `nodeId/input` → the slot key the tool drives, so a reader can tell them apart. */
    const driven = {}
    for (const [key, slot] of Object.entries(template.slots ?? {})) {
      if (typeof slot?.input === 'string') driven[`${slot.node}/${slot.input}`] = key
    }
    const nodes = []
    for (const [id, node] of Object.entries(template.graph ?? {})) {
      const inputs = []
      for (const [input, value] of Object.entries(node.inputs ?? {})) {
        const pinnedValue = pinned[id]?.[input]
        const link = isLink(value)
        inputs.push({
          input,
          // A wired input is topology, not a value: report the wire, and the
          // value the pin puts over it if there is one.
          value: link ? undefined : value,
          link: link ? [value[0], Number(value[1])] : undefined,
          pinned: pinnedValue === undefined ? undefined : pinnedValue,
          slot: driven[`${id}/${input}`],
          options: link ? undefined : optionList(info, node.class_type, input),
        })
      }
      nodes.push({ id, class_type: node.class_type, inputs })
    }
    return {
      id: template.id,
      label: template.label,
      source: template.source,
      dialect: template.dialect,
      notes: template.notes,
      size: template.size?.native,
      slots: Object.keys(template.slots ?? {}),
      pinned,
      nodes,
    }
  }

  // Sampler ticks and latent previews arrive on the client's own socket — the
  // one whose id the `/prompt` body carries. A second socket here would evict
  // the first and leave both deaf, which is exactly what used to happen.
  ctx.effect(() => () => client.close(), 'dsh-comfy-imagegen: comfy socket')

  async function queueState() {
    try {
      const response = await fetch(`${config.baseUrl}/queue`, { signal: AbortSignal.timeout(4000) })
      if (!response.ok) return undefined
      const data = await response.json()
      const ids = (list) => (Array.isArray(list) ? list.map((entry) => String(entry?.[1] ?? '')) : [])
      return { running: ids(data.queue_running), pending: ids(data.queue_pending) }
    } catch {
      return undefined
    }
  }

  function runSnapshot(queue) {
    return [...runs.values()].map((run) => {
      const runningAt = queue?.running.indexOf(run.promptId) ?? -1
      const pendingAt = queue?.pending.indexOf(run.promptId) ?? -1
      const fromQueue = runningAt >= 0 ? 'running' : pendingAt >= 0 ? 'pending' : undefined
      // The socket knows the truth first; the queue read is only a backstop for
      // the moment before the server announces the run.
      const fromSocket = client.phase(run.promptId)
      const phase = fromSocket === 'error' ? 'error' : fromSocket === 'running' ? 'running' : (fromQueue ?? fromSocket ?? 'pending')
      const tick = client.progress(run.promptId)
      const preview = client.preview(run.promptId)
      return {
        promptId: run.promptId,
        template: run.template,
        label: run.label,
        size: run.size,
        seed: run.seed,
        batch: run.batch,
        startedAt: run.startedAt,
        elapsedMs: Date.now() - run.startedAt,
        phase,
        ahead: runningAt >= 0 ? 0 : Math.max(pendingAt, 0),
        steps: run.steps,
        etaMs: estimateMs(run.template, run.steps, run.batch),
        node: tick?.node,
        progress: tick === undefined ? undefined : { value: tick.value, max: tick.max, node: tick.node },
        // Retained latent frames, served by the route below. The `v` stamp is
        // the frame time, so the card can use it as a cache buster.
        preview: preview === undefined ? undefined : {
          url: `/imagegen/preview?promptId=${encodeURIComponent(run.promptId)}&v=${preview.at}`,
          mime: preview.mime,
          at: preview.at,
        },
      }
    })
  }

  // Routes ride a `webServer` sub-fiber: loader entries settle concurrently, so
  // reading the service at apply time would silently skip the mount whenever the
  // web server activates after this plugin. A headless host keeps the tools only.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const webServer = webCtx.get('webServer')
      if (webServer === undefined) return () => {}
      return webServer.register({
        kind: 'exact',
        path: '/imagegen/status',
        handler: async (req, res) => {
          const send = (status, payload) => {
            try {
              res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(payload))
            } catch {
              // The page navigated away mid-request.
            }
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            send(405, { ok: false, error: 'method not allowed' })
            return
          }
          try {
            send(200, { ok: true, baseUrl: config.baseUrl, runs: runSnapshot(await queueState()) })
          } catch (error) {
            send(200, { ok: false, error: String(error?.message ?? error), runs: [] })
          }
        },
      })
    }, 'dsh-comfy-imagegen: status route')
  })

  // Latent previews, straight from the sampler's own binary frames. They live
  // in memory only while a run is tracked, which is the same lifetime the card
  // needs them for.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const webServer = webCtx.get('webServer')
      if (webServer === undefined) return () => {}
      return webServer.register({
        kind: 'exact',
        path: '/imagegen/preview',
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            try {
              res.writeHead(405, { 'cache-control': 'no-store' })
              res.end()
            } catch {
              // The page navigated away mid-request.
            }
            return
          }
          let preview
          try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1')
            const promptId = url.searchParams.get('promptId') ?? ''
            preview = promptId === '' ? undefined : client.preview(promptId)
          } catch {
            preview = undefined
          }
          if (preview === undefined) {
            try {
              res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify({ ok: false, error: 'no preview for this run yet' }))
            } catch {
              // The page navigated away mid-request.
            }
            return
          }
          try {
            const bytes = preview.bytes
            res.writeHead(200, {
              'content-type': preview.mime,
              'content-length': bytes.byteLength,
              'cache-control': 'no-store',
            })
            res.end(req.method === 'HEAD' ? undefined : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
          } catch {
            // The page navigated away mid-request.
          }
        },
      })
    }, 'dsh-comfy-imagegen: preview route')
  })

  /** `/object_info` is 4-5MB and only changes when the server restarts. */
  let objectInfoCache
  async function objectInfo() {
    if (objectInfoCache === undefined) objectInfoCache = await client.objectInfo()
    return objectInfoCache
  }

  /**
   * Templates as this plugin sees them: the user's own workflows, then the
   * bundled presets, with the per-id tags from `config.templateMeta` on top.
   */
  function readTemplates(info) {
    return loadTemplates(config.templateDirs, info, { bundled: [BUNDLED_TEMPLATES], meta: config.templateMeta })
  }

  async function templates() {
    return readTemplates(await objectInfo())
  }

  ctx.tools.register({
    name: 'image_generate',
    description: [
      'Generate one or more images from a prompt with the local ComfyUI instance and show them in the conversation; while it runs the card streams sampler steps and the latent preview, so a long render reads as work.',
      'The prompt must already be the finished description of the picture, not the user\'s raw sentence: expand it first (the `imagegen` skill hands that step to `prompt-director`) — this tool never rewrites a prompt.',
      'Omit `template` unless the user names one — the tool then prefers this machine\'s own workflows (the ones saved in ComfyUI) over the bundled presets, and among them the one whose purpose fits the request.',
      'This tool only makes pictures. Changing how they are made — a LoRA weight, a sampler, a node, a brand-new workflow — is `image_workflow`, and a request for a picture must never call it.',
      'Returns absolute file paths plus the URLs used for display. Do not inspect or re-check the result unless the user asks.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Finished English paragraph describing the finished frame — subject, placement, light, texture, and any in-image copy. Quoted in-image text keeps its own script.' },
        image: {
          type: 'string',
          description: 'For edit templates: absolute path of a local picture, or an http(s) URL, to use as the source image. Unused by text-to-image templates.',
        },
        negative: { type: 'string', description: 'What to keep out of the frame. Optional; templates without a negative input ignore it.' },
        template: { type: 'string', description: 'Template id. Omit to let the tool choose.' },
        purpose: {
          type: 'string',
          description: 'What the picture is for; narrows template choice when several could work. Built-in hints: anime, typography, layout, art, edit — templates may declare their own tags too.',
        },
        size: { type: 'string', description: '`3:4`, `16:9`, `1024x1365`, or the words square/portrait/landscape. Defaults to the template native size.' },
        seed: { type: 'number', description: 'Fix the seed to reproduce a previous picture. Omit for a fresh random one.' },
        steps: { type: 'number', description: 'Sampling steps. Leave unset unless the user asks; templates ship with trained defaults.' },
        cfg: { type: 'number', description: 'Classifier-free guidance. Leave unset unless the user asks.' },
        batch: { type: 'number', description: 'How many images to make in one run, 1-4. Default 1.' },
        timeoutMs: { type: 'number', description: 'Give up after this many milliseconds. Default 900000.' },
        params: {
          type: 'object',
          description: [
            'Template-specific knobs, keyed by the slot names `image_capabilities --verbose` lists for that template',
            '(for example sampler_name, scheduler, denoise, or any other input the workflow exposes).',
            'Values must be what ComfyUI offers for that input. Wins over the same knob passed as a top-level argument.',
            'Keys the template does not expose are ignored and reported back.',
          ].join(' '),
          additionalProperties: true,
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          detail: { type: 'object' },
          promptId: { type: 'string' },
          template: { type: 'string' },
          label: { type: 'string' },
          origin: { type: 'string' },
          size: { type: 'string' },
          seed: { type: 'number' },
          elapsedMs: { type: 'number' },
          ignoredParams: { type: 'array', items: { type: 'string' } },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                path: { type: 'string' },
                url: { type: 'string' },
                filename: { type: 'string' },
                sidecar: { type: 'string' },
              },
              required: ['index', 'path', 'url', 'filename'],
              additionalProperties: false,
            },
          },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      render: (_args, value) => markdown(value),
      // Compact settled card in the GUI: what was made and how long it took.
      presentationMeta: (_args, value) => prune({
        ok: value.ok !== false,
        ...(value.ok === false ? { error: value.error, detail: value.detail } : {}),
        template: value.template,
        label: value.label,
        size: value.size,
        seed: value.seed,
        elapsedMs: value.elapsedMs,
        count: Array.isArray(value.images) ? value.images.length : 0,
        files: Array.isArray(value.images)
          ? value.images.map((image) => ({ filename: image.filename, path: image.path, url: image.url }))
          : [],
      }),
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: false,
    async execute(args, exec) {
      const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
      if (prompt === '') return errorResult('prompt 不能为空')

      let objectInfoValue
      let loaded
      try {
        objectInfoValue = await objectInfo()
        loaded = await readTemplates(objectInfoValue)
      } catch (error) {
        if (error instanceof ComfyError) return errorResult(`连不上 ComfyUI：${error.message}`, { baseUrl: config.baseUrl })
        throw error
      }
      if (loaded.templates.length === 0) {
        return errorResult('没有可用的模板', { problems: loaded.problems, dirs: config.templateDirs })
      }

      // One "can this machine run it" verdict per template, reused for the
      // selection itself and for the template it lands on.
      const checks = new Map(loaded.templates.map((entry) => [entry.id, checkTemplate(entry, objectInfoValue)]))

      const template = selectTemplate(loaded.templates, {
        template: args.template,
        purpose: args.purpose,
        prompt,
        usable: (entry) => checks.get(entry.id)?.ok === true,
        preferLocal: config.preferLocal,
      })
      if (template === undefined) {
        return errorResult(`没有 id 为 ${args.template} 的模板`, { available: loaded.templates.map((entry) => entry.id) })
      }

      const check = checks.get(template.id) ?? checkTemplate(template, objectInfoValue)
      if (!check.ok) return errorResult(describeMissing(check, template), { missing: check.missing })

      // Edit templates need a picture on the server before the graph can run.
      let upload
      if (template.slots.image !== undefined) {
        const source = typeof args.image === 'string' ? args.image.trim() : ''
        if (source === '') {
          return errorResult(
            `模板 ${template.id}（${template.label}）是改图模板，还需要一张源图：把本地图片的绝对路径或图片链接作为 image 参数传进来。`,
            { template: template.id },
          )
        }
        try {
          upload = await uploadSource(client, source)
        } catch (error) {
          return errorResult(`读不到源图：${error.message}`, { image: source })
        }
      }

      const requestedBatch = Number.isFinite(args.batch) ? Math.min(Math.max(Math.trunc(args.batch), 1), 4) : 1
      const requested = resolveSize(template, args.size)
      // Edit templates follow the source picture's shape, not the template default.
      const planned = (upload?.bytes === undefined ? undefined : measureImage(upload.bytes)) ?? requested

      // Precedence, low to high: template defaults → named arguments → params.
      // `params` is the escape hatch for whatever the template exposes beyond
      // the fixed arguments, so it is deliberate that it can override them.
      const params = args.params !== null && typeof args.params === 'object' && !Array.isArray(args.params) ? args.params : {}
      const values = {}
      for (const [key, value] of Object.entries(template.defaults ?? {})) values[key] = value
      const named = {
        prompt,
        negative: typeof args.negative === 'string' && args.negative !== '' ? args.negative : undefined,
        seed: Number.isFinite(args.seed) ? Math.trunc(args.seed) : undefined,
        width: requested.width,
        height: requested.height,
        batch: template.slots.batch === undefined ? undefined : requestedBatch,
        steps: Number.isFinite(args.steps) ? Math.trunc(args.steps) : undefined,
        cfg: Number.isFinite(args.cfg) ? args.cfg : undefined,
        image: upload?.name,
      }
      for (const [key, value] of Object.entries(named)) {
        if (value !== undefined) values[key] = value
      }
      const ignoredParams = []
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue
        if (template.slots[key] === undefined) {
          ignoredParams.push(key)
          continue
        }
        values[key] = value
      }
      if (Number.isFinite(values.batch)) {
        values.batch = Math.min(Math.max(Math.trunc(values.batch), 1), 4)
      }

      let actualSeed = Number.isFinite(values.seed) ? Math.trunc(values.seed) : seed()
      if (actualSeed > 2 ** 53 - 1) actualSeed %= 2 ** 53 - 1
      values.seed = actualSeed

      const prepared = applySlots(template.graph, template.slots, values)
      // Pins land last: they are the human's own hand on the graph, so a slot
      // value must not quietly undo what `image_workflow` was told to set.
      applyPinned(prepared.graph, template.id)
      if (template.slots.negative === undefined && args.negative) {
        // Not an error: this template simply cannot be steered away from anything.
        console.error('[imagegen] 该模板没有负向提示词槽位，negative 被忽略')
      }
      if (ignoredParams.length > 0) {
        console.error(`[imagegen] 模板 ${template.id} 没有这些槽位，params 被忽略：${ignoredParams.join(', ')}`)
      }
      /** What the graph was actually asked for, after params had their say. */
      const batch = Number.isFinite(values.batch) ? values.batch : requestedBatch

      const startedAt = Date.now()
      const timeoutMs = Number.isFinite(args.timeoutMs) ? args.timeoutMs : config.timeoutMs
      /** Prompt ids this call owns, so teardown never touches another session's run. */
      const runningIds = []
      try {
        const promptId = await client.submit(prepared.graph)
        runningIds.push(promptId)
        runs.set(promptId, {
          promptId,
          template: template.id,
          label: template.label,
          size: `${planned.width}x${planned.height}`,
          seed: actualSeed,
          batch,
          steps: effectiveSteps(template, prepared.graph),
          startedAt,
        })
        const entry = await client.wait(promptId, {
          timeoutMs,
          signal: exec?.signal,
          onProgress: process.env.DSH_IMAGEGEN_DEBUG === '1'
            ? (progress) => console.error(`[imagegen] ${progress.value}/${progress.max} ${progress.node ?? ''}`.trimEnd())
            : undefined,
        })
        const comfyImages = ComfyClient.images(entry)
        if (comfyImages.length === 0) return errorResult('任务结束了但没有产出图片', { promptId })

        const fetched = []
        for (const image of comfyImages) {
          fetched.push({ ...image, bytes: await client.fetchImage(image) })
        }
        const actual = measureImage(fetched[0].bytes) ?? planned
        const saved = await saveGenerated({
          outputDir: config.outputDir,
          prompt,
          seed: actualSeed,
          images: fetched,
          meta: {
            caption: prompt,
            negative: values.negative,
            template: template.id,
            size: `${actual.width}x${actual.height}`,
            requestedSize: `${planned.width}x${planned.height}`,
            source: upload?.name,
            cfg: prepared.applied.cfg,
            steps: effectiveSteps(template, prepared.graph),
            params: prepared.applied,
            batch,
            promptId,
            comfyFolder: comfyImages[0]?.subfolder ?? '',
          },
        })
        const elapsedMs = Date.now() - startedAt
        const steps = effectiveSteps(template, prepared.graph)
        timings.set(template.id, { ms: elapsedMs, steps, batch })
        void saveTimings()
        return prune({
          ok: true,
          promptId,
          template: template.id,
          label: template.label,
          origin: template.origin,
          size: `${actual.width}x${actual.height}`,
          seed: actualSeed,
          elapsedMs,
          ...(ignoredParams.length > 0 ? { ignoredParams } : {}),
          images: saved.map((item, index) => ({
            index: index + 1,
            path: item.path,
            url: client.viewUrl(comfyImages[index]),
            filename: item.filename,
            sidecar: item.sidecar,
          })),
        })
      } catch (error) {
        // A cancelled call is not a failed picture: let the host mark it stopped.
        if (exec?.signal?.aborted === true) throw error
        if (error instanceof ComfyError) {
          const message = String(error.message ?? '')
          const known = /^(生成失败|执行失败|等待超时|已取消等待|连不上 ComfyUI|ComfyUI (拒绝|没有返回))/.test(message)
          return errorResult(known ? message : `生成失败：${message}`, {
            template: template.id,
            promptId: error.promptId ?? error.body?.prompt_id,
          })
        }
        throw error
      } finally {
        // Whatever happened, the card must stop showing this run as live.
        for (const promptId of runningIds) {
          runs.delete(promptId)
          client.forget(promptId)
        }
      }
    },
  })

  ctx.tools.register({
    name: 'image_capabilities',
    description: [
      'Report which image-generation templates this machine can actually run: template id, label, what it is good at, native size, and anything missing (model files or node types).',
      'Call this when the user asks what models are available, or before telling them a kind of picture is impossible.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Re-read the server and the template folders instead of using the cached inspection.' },
        verbose: { type: 'boolean', description: 'Include per-template model files and slot names.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          baseUrl: { type: 'string' },
          outputDir: { type: 'string' },
          templateDirs: { type: 'array', items: { type: 'string' } },
          preferLocal: { type: 'boolean' },
          templates: { type: 'array', items: { type: 'object' } },
          problems: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
          detail: { type: 'object' },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      render(args, value) {
        const lines = [`ComfyUI: ${value.baseUrl}`, `输出目录: ${value.outputDir}`, '']
        // Runnable templates first: the point of the call is "what can I use",
        // and a fresh install is mostly templates this machine cannot run yet.
        const ordered = [...value.templates].sort((a, b) => Number(b.usable) - Number(a.usable))
        for (const entry of ordered) {
          const mark = entry.usable ? '✓' : '✗'
          const origin = entry.origin === 'bundled' ? '内置模板' : '本机工作流'
          lines.push(`${mark} ${entry.id} — ${entry.label}（${origin}）`)
          if (entry.strengths.length > 0) lines.push(`    擅长: ${entry.strengths.join('、')}`)
          if (entry.notes) lines.push(`    说明: ${entry.notes}`)
          if (entry.takesImage) lines.push('    改图: 需要一张源图（image 参数）')
          lines.push(`    原生尺寸: ${entry.size ?? '未知'}`)
          for (const item of entry.missing) lines.push(`    缺: ${item.detail}`)
          if (args?.verbose && entry.models !== undefined) {
            lines.push(`    模型: ${Object.entries(entry.models).map(([kind, files]) => `${kind}=${files.join(',')}`).join(' ')}`)
            lines.push(`    槽位: ${Object.keys(entry.slots).join(', ')}`)
            const defaults = Object.entries(entry.defaults ?? {})
            if (defaults.length > 0) lines.push(`    默认: ${defaults.map(([key, value]) => `${key}=${String(value)}`).join(' · ')}`)
            for (const [key, options] of Object.entries(entry.choices ?? {})) {
              if (options.length < 2) continue
              // A sampler list can be 50 entries long; the point is "these are
              // knobs you can turn", not printing the whole enum.
              const shown = options.slice(0, 12).join(' / ')
              lines.push(`    ${key} 可选: ${options.length > 12 ? `${shown} …（共 ${options.length} 项）` : shown}`)
            }
          }
        }
        if (value.problems.length > 0) {
          lines.push('', '模板读取问题:')
          for (const problem of value.problems) lines.push(`  · ${problem}`)
        }
        const usable = value.templates.filter((entry) => entry.usable).length
        if (value.templates.length > 0) {
          lines.push('', `可用 ${usable} 个 / 共 ${value.templates.length} 个模板。`)
          lines.push(value.preferLocal
            ? '不点名模板时：能跑的本机工作流优先，其次才是内置模板。'
            : '不点名模板时：内置模板优先（preferLocal 关掉了）。')
          if (usable < value.templates.length) {
            lines.push('缺模型的模板是这台机器装不了，不是插件坏了；换掉模板里的文件名或导入你自己的工作流即可。')
          }
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 120_000,
    isConcurrencySafe: true,
    async execute(args) {
      if (args?.refresh === true) objectInfoCache = undefined
      let objectInfoValue
      let loaded
      try {
        objectInfoValue = await objectInfo()
        loaded = await readTemplates(objectInfoValue)
      } catch (error) {
        if (error instanceof ComfyError) return errorResult(`连不上 ComfyUI：${error.message}`, { baseUrl: config.baseUrl })
        throw error
      }
      return prune({
        ok: true,
        baseUrl: config.baseUrl,
        outputDir: config.outputDir,
        templateDirs: config.templateDirs,
        preferLocal: config.preferLocal,
        templates: loaded.templates.map((template) => {
          const check = checkTemplate(template, objectInfoValue)
          return {
            id: template.id,
            label: template.label,
            origin: template.origin,
            strengths: template.strengths,
            purposes: template.purposes,
            dialect: template.dialect,
            notes: template.notes,
            size: template.size?.native,
            usable: check.ok,
            missing: check.missing,
            warnings: check.warnings,
            models: requiredModels(template.graph),
            slots: template.slots,
            defaults: template.defaults,
            // What `params` will accept for each knob that has a fixed list of
            // values, so the caller can pick a legal sampler instead of guessing.
            choices: knobChoices(template, objectInfoValue),
            takesImage: template.slots.image !== undefined,
          }
        }),
        problems: loaded.problems,
      })
    },
  })

  // The one modification surface. Deliberately a separate tool: a plain picture
  // request must not pay for graph surgery, and the model only reaches for this
  // when the user actually asks to change the machine rather than the picture.
  ctx.tools.register({
    name: 'image_workflow',
    description: [
      'Read and change the ComfyUI workflow that sits behind an image template: retune node inputs (LoRA file and weight, sampler, steps, cfg, resolution, text), add or rewire nodes, remove nodes, and save the result as a new template.',
      'Call this only when the user asks to change how images are made — "把 LoRA 降到 0.6", "加一个 ControlNet", "换个采样器", "这份工作流再存一版", "帮我写一份新工作流". A request for a picture needs `image_generate` alone, with no workflow arguments and no call to this tool.',
      'Read before writing: `action: inspect` lists every node with its class_type, current inputs, wires, and the values ComfyUI accepts for that input; `action: list` names every template.',
      '`action: set` pins inputs on an existing template and keeps them for every later run; `action: write` builds a new template from `graph` merged onto `base`, applies `remove`, refuses a graph that cannot run, and saves it where templates are read from.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'inspect', 'set', 'clear', 'write', 'delete'],
          description: 'list = templates and their ids; inspect = one template node by node; set = pin node inputs; clear = drop a template pins; write = save an edited or brand-new graph as a template; delete = remove a template this tool wrote.',
        },
        template: { type: 'string', description: 'Template id. Required by inspect, set, clear and delete; optional as `base` for write.' },
        overrides: {
          type: 'object',
          additionalProperties: true,
          description: 'action: set — `{节点id: {输入名: 值}}`. A null value lifts that pin. This is how a LoRA weight, a sampler, a resolution or a text input is retuned without touching the .json file.',
        },
        graph: {
          type: 'object',
          additionalProperties: true,
          description: 'action: write — node patch `{节点id: {class_type, inputs}}`. An existing id merges into that node inputs; a new id adds a node. A link is `["上游节点id", 输出序号]`, exactly as ComfyUI API format writes it; an input value of null deletes that input.',
        },
        remove: { type: 'array', items: { type: 'string' }, description: 'action: write — node ids to delete from the graph.' },
        base: { type: 'string', description: 'action: write — start from this template graph. Omit to build a graph from nothing but `graph`.' },
        save: { type: 'string', description: 'action: write — id of the template to save, which is also its file name. Reusing an existing id replaces the template this tool wrote before.' },
        label: { type: 'string', description: 'action: write — human-facing name. Defaults to the id.' },
        notes: { type: 'string', description: 'action: write — one line about what this variant is for; it shows up in image_capabilities.' },
        dialect: { type: 'string', enum: ['tags', 'caption'], description: 'action: write — what kind of prompt text this graph wants: `tags` for comma-separated tag prompts, `caption` for a prose sentence.' },
        slots: {
          type: 'object',
          additionalProperties: true,
          description: 'action: write — override which node input each tool knob drives, `{steps: {node: "3", input: "steps"}}`. Inferred from the graph when omitted.',
        },
        defaults: {
          type: 'object',
          additionalProperties: true,
          description: 'action: write — knob starting values, `{cfg: 3.2}`. The graph own values are used when omitted.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          message: { type: 'string' },
          error: { type: 'string' },
          detail: { type: 'object' },
          templateDirs: { type: 'array', items: { type: 'string' } },
          writeDir: { type: 'string' },
          file: { type: 'string' },
          templates: { type: 'array', items: { type: 'object' } },
          workflow: { type: 'object' },
          pinned: { type: 'object' },
          missing: { type: 'array', items: { type: 'object' } },
          warnings: { type: 'array', items: { type: 'string' } },
          available: { type: 'array', items: { type: 'string' } },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      render(args, value) {
        if (value.ok === false) return [{ type: 'text', text: `工作流操作失败：${value.error}` }]
        const lines = []
        if (value.message !== undefined) lines.push(value.message)
        for (const entry of value.templates ?? []) {
          const pins = entry.pinned > 0 ? `，${entry.pinned} 项固定` : ''
          const origin = entry.origin === 'bundled' ? '内置模板' : '本机工作流'
          lines.push(`${entry.usable === false ? '✗' : '✓'} ${entry.id} — ${entry.label}（${origin} · ${entry.nodes} 个节点${pins}）`)
          lines.push(`    文件: ${entry.source}`)
          for (const item of entry.missing ?? []) lines.push(`    缺: ${item.detail}`)
        }
        const workflow = value.workflow
        if (workflow !== undefined) {
          lines.push(`${workflow.id} — ${workflow.label}`, `文件: ${workflow.source}`, `原生尺寸: ${workflow.size ?? '未知'}`, '')
          for (const node of workflow.nodes) {
            lines.push(`#${node.id} ${node.class_type}`)
            for (const row of node.inputs) {
              const shown = row.link !== undefined ? `← ${row.link[0]}[${row.link[1]}]` : JSON.stringify(row.value)
              const tags = [row.slot === undefined ? '' : `槽位 ${row.slot}`, row.pinned === undefined ? '' : '已固定'].filter((item) => item !== '').join(' · ')
              lines.push(`    ${row.input} = ${shown}${tags === '' ? '' : `  （${tags}）`}`)
            }
          }
        }
        if (value.pinned !== undefined && Object.keys(value.pinned).length > 0) {
          lines.push('', '当前固定的输入:')
          for (const [nodeId, inputs] of Object.entries(value.pinned)) {
            for (const [input, pinned] of Object.entries(inputs)) lines.push(`  #${nodeId}.${input} = ${JSON.stringify(pinned)}`)
          }
        }
        if (value.action === 'write' && value.file !== undefined) {
          lines.push('', `已写入: ${value.file}`)
          if ((value.missing ?? []).length === 0) lines.push('这台机器能直接跑这份图。')
          else for (const item of value.missing) lines.push(`  缺: ${item.detail}`)
          for (const warning of value.warnings ?? []) lines.push(`  注意: ${warning}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 120_000,
    isConcurrencySafe: false,
    async execute(args) {
      const action = typeof args?.action === 'string' ? args.action : ''
      const wanted = typeof args?.template === 'string' ? args.template.trim() : ''

      let info
      let loaded
      try {
        info = await objectInfo()
        loaded = await readTemplates(info)
      } catch (error) {
        if (error instanceof ComfyError) return errorResult(`连不上 ComfyUI：${error.message}`, { baseUrl: config.baseUrl })
        throw error
      }
      const find = (id) => loaded.templates.find((template) => template.id === id)
      const available = loaded.templates.map((template) => template.id)
      const needsTemplate = () => {
        if (wanted === '') return errorResult('这个操作需要 template', { available })
        const found = find(wanted)
        if (found === undefined) return errorResult(`没有 id 为 ${wanted} 的模板`, { available })
        return undefined
      }

      if (action === 'list') {
        return prune({
          ok: true,
          action,
          templateDirs: config.templateDirs,
          writeDir: writeDir(),
          message: '模板一览（✓ 表示这台机器现在能跑）。',
          templates: loaded.templates.map((template) => {
            const check = checkTemplate(template, info)
            return {
              id: template.id,
              label: template.label,
              origin: template.origin,
              source: template.source,
              dialect: template.dialect,
              nodes: Object.keys(template.graph ?? {}).length,
              slots: Object.keys(template.slots ?? {}),
              pinned: Object.keys(pinnedFor(template.id)).length,
              usable: check.ok,
              missing: check.missing,
            }
          }),
          warnings: loaded.problems,
        })
      }

      if (action === 'inspect') {
        const problem = needsTemplate()
        if (problem !== undefined) return problem
        const workflow = describeWorkflow(find(wanted), info)
        return prune({ ok: true, action, workflow, pinned: workflow.pinned })
      }

      if (action === 'set') {
        const problem = needsTemplate()
        if (problem !== undefined) return problem
        const patch = args?.overrides
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          return errorResult('set 需要 overrides: {节点id: {输入名: 值}}')
        }
        const graph = find(wanted).graph
        const unknown = []
        const next = { ...pinnedFor(wanted) }
        for (const [nodeId, inputs] of Object.entries(patch)) {
          if (graph[nodeId] === undefined) { unknown.push(`#${nodeId} 不在这个模板里`); continue }
          if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) continue
          const merged = { ...(next[nodeId] ?? {}) }
          for (const [input, value] of Object.entries(inputs)) {
            if (value === null) { delete merged[input]; continue }
            if (value === undefined) continue
            merged[input] = value
          }
          if (Object.keys(merged).length === 0) delete next[nodeId]
          else next[nodeId] = merged
        }
        if (unknown.length > 0) return errorResult(unknown.join('；'), { available: Object.keys(graph) })
        if (Object.keys(next).length === 0) delete overrides[wanted]
        else overrides[wanted] = next
        await saveOverrides()
        return prune({
          ok: true,
          action,
          pinned: pinnedFor(wanted),
          message: `已固定 ${wanted} 的输入；下次生成开始生效，工作流文件本身没有改动。`,
        })
      }

      if (action === 'clear') {
        const problem = needsTemplate()
        if (problem !== undefined) return problem
        delete overrides[wanted]
        await saveOverrides()
        return { ok: true, action, pinned: {}, message: `已清空 ${wanted} 的所有固定值，回到文件里原本的参数。` }
      }

      if (action === 'delete') {
        if (wanted === '') return errorResult('delete 需要 template', { available })
        const target = find(wanted)
        if (target === undefined) return errorResult(`没有 id 为 ${wanted} 的模板`, { available })
        // Only a file this tool wrote, and this tool only ever writes into
        // `writeDir()`. "Carries an id and is not a canvas file" is NOT enough:
        // the bundled presets and any hand-written manifest look exactly like
        // that, and deleting one of those would quietly remove a template the
        // user never asked to touch. A path check cannot make that mistake.
        if (!insideWriteDir(target.source)) {
          return errorResult(`这份工作流不是 image_workflow 写的（它是内置模板或你的文件），这里不删；要删请自己删文件。`, { detail: { file: target.source, writeDir: writeDir() } })
        }
        let raw
        try {
          raw = JSON.parse(readFileSync(target.source, 'utf8'))
        } catch (error) {
          return errorResult(`读不到 ${target.source}：${error.message}`)
        }
        if (Array.isArray(raw?.nodes)) {
          return errorResult(`${target.source} 是一份 ComfyUI 画布工作流，不是 image_workflow 写的，这里不删；要删请自己删文件。`, { detail: { file: target.source } })
        }
        try {
          await unlink(target.source)
        } catch (error) {
          return errorResult(`删不掉 ${target.source}：${error.message}`)
        }
        delete overrides[wanted]
        await saveOverrides()
        return { ok: true, action, message: `已删除模板 ${wanted}。`, file: target.source }
      }

      if (action === 'write') {
        const saveId = typeof args?.save === 'string' ? args.save.trim() : ''
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(saveId)) {
          return errorResult('save 需要一个可当文件名的 id（字母或数字开头，1-80 个字符）')
        }
        const baseId = typeof args?.base === 'string' ? args.base.trim() : ''
        let graph = {}
        let baseTemplate
        if (baseId !== '') {
          baseTemplate = find(baseId)
          if (baseTemplate === undefined) return errorResult(`没有 id 为 ${baseId} 的 base 模板`, { available })
          graph = structuredClone(baseTemplate.graph)
        }
        const patch = args?.graph
        if (patch !== undefined && patch !== null) {
          if (typeof patch !== 'object' || Array.isArray(patch)) return errorResult('graph 需要是 {节点id: {class_type, inputs}}')
          for (const [nodeId, node] of Object.entries(patch)) {
            if (node === null) { delete graph[nodeId]; continue }
            const classType = typeof node?.class_type === 'string' && node.class_type !== ''
              ? node.class_type
              : graph[nodeId]?.class_type
            if (classType === undefined) return errorResult(`节点 #${nodeId} 没有 class_type，也不是已有节点`)
            if (info[classType] === undefined) {
              return errorResult(`服务端没有节点类型「${classType}」（#${nodeId}），装上对应的自定义节点再写`, { detail: { class_type: classType } })
            }
            const merged = { ...(graph[nodeId]?.inputs ?? {}) }
            for (const [input, value] of Object.entries(node.inputs ?? {})) {
              if (value === null) delete merged[input]
              else merged[input] = value
            }
            graph[nodeId] = { class_type: classType, inputs: merged }
          }
        }
        for (const nodeId of Array.isArray(args?.remove) ? args.remove : []) {
          delete graph[String(nodeId)]
        }
        if (Object.keys(graph).length === 0) return errorResult('图是空的：需要 base 或 graph')

        const broken = brokenLinks(graph)
        if (broken.length > 0) return errorResult(`连线断了：${broken.join('；')}`)
        const nodes = Object.values(graph)
        if (!nodes.some((node) => /SaveImage|PreviewImage/i.test(String(node.class_type)))) {
          return errorResult('图里没有 SaveImage/PreviewImage 节点，跑完拿不到图')
        }
        const slotsMerged = { ...(baseTemplate?.slots ?? {}), ...(args?.slots ?? {}) }
        const derived = { ...(baseTemplate?.defaults ?? {}), ...(args?.defaults ?? {}) }

        const file = join(writeDir(), `${saveId}.json`)
        try {
          const existing = JSON.parse(readFileSync(file, 'utf8'))
          if (Array.isArray(existing?.nodes)) {
            return errorResult(`${file} 是一份 ComfyUI 画布工作流，覆盖它会毁掉你的文件；换一个 save id。`, { file })
          }
        } catch {
          // no such file, or unreadable: writing a fresh manifest is fine
        }

        const manifest = prune({
          id: saveId,
          label: typeof args?.label === 'string' && args.label !== '' ? args.label : saveId,
          dialect: args?.dialect === 'tags' || args?.dialect === 'caption' ? args.dialect : baseTemplate?.dialect ?? 'caption',
          notes: typeof args?.notes === 'string' ? args.notes : baseTemplate?.notes,
          // Display-only metadata: keeping it stops the new variant from showing
          // up in `image_capabilities` as a template with no character at all.
          strengths: baseTemplate?.strengths ?? undefined,
          purposes: baseTemplate?.purposes ?? undefined,
          size: baseTemplate?.size?.native === undefined ? undefined : { native: baseTemplate.size.native },
          slots: Object.keys(slotsMerged).length === 0 ? undefined : slotsMerged,
          defaults: Object.keys(derived).length === 0 ? undefined : derived,
          graph,
        })
        try {
          await mkdir(dirname(file), { recursive: true })
          await writeFileAsync(file, `${JSON.stringify(manifest, null, 2)}\n`)
        } catch (error) {
          return errorResult(`写不进 ${file}：${error.message}`, { file })
        }

        // Read it back the way generation will, so a template that saves but
        // cannot run is caught here instead of at the next picture request.
        const reloaded = readTemplates(info)
        const saved = reloaded.templates.find((template) => template.id === saveId)
        if (saved === undefined) {
          return errorResult(`已写出 ${file}，但重新加载时没有读到它；检查文件是不是合法的模板 JSON。`, { file })
        }
        if (saved.slots.prompt === undefined) {
          return errorResult(`${file} 里没有能接提示词的节点（CLIPTextEncode 之类），生成时无法传入 prompt`, { file })
        }
        const check = checkTemplate(saved, info)
        return prune({
          ok: true,
          action,
          file,
          templates: [{ id: saved.id, label: saved.label, source: saved.source, nodes: Object.keys(saved.graph).length }],
          pinned: pinnedFor(saved.id),
          missing: check.missing,
          warnings: check.warnings,
          message: check.ok ? `已保存模板 ${saveId}，这台机器能直接跑。` : `已保存模板 ${saveId}，但还缺东西，暂时跑不了。`,
        })
      }

      return errorResult(`未知 action：${action || '(空)'}`, { detail: { available: ['list', 'inspect', 'set', 'clear', 'write', 'delete'] } })
    },
  })
}
