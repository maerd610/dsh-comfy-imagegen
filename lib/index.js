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
 *   - the one HTTP route (`GET /imagegen/status`) and the client card are
 *     decoration: if neither loads, generation still works and the picture
 *     still appears inline
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { mkdir, writeFile as writeFileAsync } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ComfyClient, ComfyError } from './comfy.js'
import { ProgressTracker } from './progress.js'
import { saveGenerated } from './output.js'
import { applySlots, requiredModels } from './ui2api.js'
import { checkTemplate, loadTemplates, resolveSize, selectTemplate } from './templates.js'

const BUNDLED_TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url))

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8188',
  outputDir: join(homedir(), 'Pictures', 'dsh-comfy-imagegen'),
  templateDirs: [],
  timeoutMs: 900_000,
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
    ? config.outputDir.replace(/^~(?=$|[\\/])/, homedir())
    : DEFAULTS.outputDir
  return {
    baseUrl: String(config.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
    outputDir,
    // User folders are searched first so a local edit shadows a bundled preset.
    templateDirs: [
      ...(Array.isArray(config.templateDirs) ? config.templateDirs.filter((dir) => typeof dir === 'string') : []),
      BUNDLED_TEMPLATES,
    ],
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

  /** Sampler step ticks, shared by every run on this ComfyUI. */
  let tracker
  function progress() {
    if (tracker === undefined) tracker = new ProgressTracker(client.socketUrl)
    return tracker
  }
  ctx.effect(() => () => {
    tracker?.dispose()
    tracker = undefined
  }, 'dsh-comfy-imagegen: progress socket')

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
      const phase = runningAt >= 0 ? 'running' : pendingAt >= 0 ? 'pending' : 'done'
      const tick = progress().get(run.promptId)
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
        progress: tick === undefined ? undefined : { value: tick.value, max: tick.max },
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

  /** `/object_info` is 4-5MB and only changes when the server restarts. */
  let objectInfoCache
  async function objectInfo() {
    if (objectInfoCache === undefined) objectInfoCache = await client.objectInfo()
    return objectInfoCache
  }

  async function templates() {
    return loadTemplates(config.templateDirs, await objectInfo())
  }

  ctx.tools.register({
    name: 'image_generate',
    description: [
      'Generate one or more images from a prompt with the local ComfyUI instance, and show them in the conversation.',
      'The prompt should already be a finished, self-contained description of the picture (use the imagegen-prompt skill); this tool does not rewrite it.',
      'Omit `template` unless the user names one — the tool picks a template that fits the request and the models installed here.',
      'Returns absolute file paths plus the URLs used for display.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Finished English image description. Quoted in-image text keeps its own script.' },
        image: {
          type: 'string',
          description: 'For edit templates: absolute path of a local picture, or an http(s) URL, to use as the source image. Unused by text-to-image templates.',
        },
        negative: { type: 'string', description: 'What to keep out of the frame. Optional; templates without a negative input ignore it.' },
        template: { type: 'string', description: 'Template id. Omit to let the tool choose.' },
        purpose: {
          type: 'string',
          enum: ['anime', 'typography', 'layout', 'art', 'edit'],
          description: 'What the picture is for; narrows template choice when several could work.',
        },
        size: { type: 'string', description: '`3:4`, `16:9`, `1024x1365`, or the words square/portrait/landscape. Defaults to the template native size.' },
        seed: { type: 'number', description: 'Fix the seed to reproduce a previous picture. Omit for a fresh random one.' },
        steps: { type: 'number', description: 'Sampling steps. Leave unset unless the user asks; templates ship with trained defaults.' },
        cfg: { type: 'number', description: 'Classifier-free guidance. Leave unset unless the user asks.' },
        batch: { type: 'number', description: 'How many images to make in one run, 1-4. Default 1.' },
        timeoutMs: { type: 'number', description: 'Give up after this many milliseconds. Default 900000.' },
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
          promptId: { type: 'string' },
          template: { type: 'string' },
          label: { type: 'string' },
          size: { type: 'string' },
          seed: { type: 'number' },
          elapsedMs: { type: 'number' },
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
        loaded = await loadTemplates(config.templateDirs, objectInfoValue)
      } catch (error) {
        if (error instanceof ComfyError) return errorResult(`连不上 ComfyUI：${error.message}`, { baseUrl: config.baseUrl })
        throw error
      }
      if (loaded.templates.length === 0) {
        return errorResult('没有可用的模板', { problems: loaded.problems, dirs: config.templateDirs })
      }

      const template = selectTemplate(loaded.templates, { template: args.template, purpose: args.purpose, prompt })
      if (template === undefined) {
        return errorResult(`没有 id 为 ${args.template} 的模板`, { available: loaded.templates.map((entry) => entry.id) })
      }

      const check = checkTemplate(template, objectInfoValue)
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

      const batch = Number.isFinite(args.batch) ? Math.min(Math.max(Math.trunc(args.batch), 1), 4) : 1
      const requested = resolveSize(template, args.size)
      // Edit templates follow the source picture's shape, not the template default.
      const planned = (upload?.bytes === undefined ? undefined : measureImage(upload.bytes)) ?? requested
      const actualSeed = Number.isFinite(args.seed) ? Math.trunc(args.seed) : seed()
      const values = {
        prompt,
        negative: typeof args.negative === 'string' && args.negative !== '' ? args.negative : undefined,
        seed: actualSeed,
        width: requested.width,
        height: requested.height,
        batch: template.slots.batch === undefined ? undefined : batch,
        steps: Number.isFinite(args.steps) ? Math.trunc(args.steps) : undefined,
        cfg: Number.isFinite(args.cfg) ? args.cfg : undefined,
        image: upload?.name,
      }
      if (template.slots.seed !== undefined && (actualSeed > 2 ** 53 - 1)) values.seed = actualSeed % (2 ** 53 - 1)

      const prepared = applySlots(template.graph, template.slots, values)
      if (template.slots.negative === undefined && args.negative) {
        // Not an error: this template simply cannot be steered away from anything.
        console.error('[imagegen] 该模板没有负向提示词槽位，negative 被忽略')
      }

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
            requestedSize: `${requested.width}x${requested.height}`,
            source: upload?.name,
            cfg: prepared.applied.cfg,
            steps: effectiveSteps(template, prepared.graph),
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
          size: `${actual.width}x${actual.height}`,
          seed: actualSeed,
          elapsedMs,
          images: saved.map((item, index) => ({
            index: index + 1,
            path: item.path,
            url: client.viewUrl(comfyImages[index]),
            filename: item.filename,
            sidecar: item.sidecar,
          })),
        })
      } catch (error) {
        if (error instanceof ComfyError) {
          return errorResult(`生成失败：${error.message}`, { template: template.id, promptId: error.body?.promptId })
        }
        throw error
      } finally {
        // Whatever happened, the card must stop showing this run as live.
        for (const promptId of runningIds) {
          runs.delete(promptId)
          progress().forget(promptId)
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
          templates: { type: 'array', items: { type: 'object' } },
          problems: { type: 'array', items: { type: 'string' } },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      render(args, value) {
        const lines = [`ComfyUI: ${value.baseUrl}`, `输出目录: ${value.outputDir}`, '']
        for (const entry of value.templates) {
          const mark = entry.usable ? '✓' : '✗'
          lines.push(`${mark} ${entry.id} — ${entry.label}`)
          if (entry.strengths.length > 0) lines.push(`    擅长: ${entry.strengths.join('、')}`)
          if (entry.takesImage) lines.push('    改图: 需要一张源图（image 参数）')
          lines.push(`    原生尺寸: ${entry.size ?? '未知'}`)
          for (const item of entry.missing) lines.push(`    缺: ${item.detail}`)
          if (args?.verbose && entry.models !== undefined) {
            lines.push(`    模型: ${Object.entries(entry.models).map(([kind, files]) => `${kind}=${files.join(',')}`).join(' ')}`)
            lines.push(`    槽位: ${Object.keys(entry.slots).join(', ')}`)
          }
        }
        if (value.problems.length > 0) {
          lines.push('', '模板读取问题:')
          for (const problem of value.problems) lines.push(`  · ${problem}`)
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
        loaded = await loadTemplates(config.templateDirs, objectInfoValue)
      } catch (error) {
        if (error instanceof ComfyError) return errorResult(`连不上 ComfyUI：${error.message}`, { baseUrl: config.baseUrl })
        throw error
      }
      return prune({
        ok: true,
        baseUrl: config.baseUrl,
        outputDir: config.outputDir,
        templates: loaded.templates.map((template) => {
          const check = checkTemplate(template, objectInfoValue)
          return {
            id: template.id,
            label: template.label,
            strengths: template.strengths,
            purposes: template.purposes,
            dialect: template.dialect,
            size: template.size?.native,
            usable: check.ok,
            missing: check.missing,
            warnings: check.warnings,
            models: requiredModels(template.graph),
            slots: template.slots,
            takesImage: template.slots.image !== undefined,
          }
        }),
        problems: loaded.problems,
      })
    },
  })
}
