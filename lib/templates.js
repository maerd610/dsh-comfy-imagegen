/**
 * Template store: load, validate, select.
 *
 * A template is any of
 *   1. a converted API graph  — `{ id, label, strengths, dialect, size, slots, graph }`
 *   2. a raw ComfyUI *UI* workflow — anything with a top-level `nodes` array;
 *      it is converted on load, so a user can point the plugin at their own
 *      `user/default/workflows` folder and get it working without a build step.
 *
 * Nothing here assumes a particular model set. Availability is decided against
 * the server's own `/object_info`, which is the only authoritative answer to
 * "can this machine run this graph".
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { convertGraphToApi, detectSlots, modelRefs, nativeSize, optionList } from './ui2api.js'

/** Where a loader's files live, for human-facing error messages. */
const FOLDER_OF = {
  CheckpointLoaderSimple: 'checkpoints',
  UNETLoader: 'diffusion_models',
  UnetLoaderGGUF: 'diffusion_models',
  CLIPLoader: 'text_encoders',
  DualCLIPLoader: 'text_encoders',
  TripleCLIPLoader: 'text_encoders',
  QuadrupleCLIPLoader: 'text_encoders',
  VAELoader: 'vae',
  LoraLoader: 'loras',
  LoraLoaderModelOnly: 'loras',
  ControlNetLoader: 'controlnet',
  UpscaleModelLoader: 'upscale_models',
  CLIPVisionLoader: 'clip_vision',
}

function stem(path) {
  return basename(path, extname(path))
}

/**
 * Knobs the tool sets for itself. They are read from the graph too, but as
 * *defaults* they would be wrong: a pinned seed would make every run identical,
 * and a stale prompt would fight the caller's.
 */
const NOT_A_DEFAULT = new Set(['prompt', 'negative', 'image', 'seed', 'batch', 'width', 'height', 'save'])

/**
 * Starting values for a template's knobs.
 *
 * Derived from the graph (whatever the author's workflow had) so `params` has
 * something honest to report, then overridden by an explicit `defaults` object
 * in the template file for anything the author wants to pin.
 */
function templateDefaults(graph, slots, explicit) {
  const derived = {}
  for (const [key, slot] of Object.entries(slots)) {
    if (NOT_A_DEFAULT.has(key)) continue
    const value = graph?.[slot.node]?.inputs?.[slot.input]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') derived[key] = value
  }
  if (explicit !== null && typeof explicit === 'object' && !Array.isArray(explicit)) {
    for (const [key, value] of Object.entries(explicit)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') derived[key] = value
    }
  }
  return derived
}

/**
 * Convert one file's JSON into a template. Returns `{ template }` or `{ problem }`
 * so a single broken file never hides the rest of the folder.
 */
export function normalizeTemplate(raw, filePath, objectInfo) {
  const fallbackId = stem(filePath)
  if (raw === null || typeof raw !== 'object') {
    return { problem: `${basename(filePath)}: 不是有效的 JSON 对象` }
  }
  let graph
  let slots
  if (Array.isArray(raw.nodes)) {
    const converted = convertGraphToApi(raw, objectInfo)
    if (!converted.ok) return { problem: `${basename(filePath)}: ${converted.error}` }
    graph = converted.workflow
    slots = detectSlots(graph, objectInfo)
  } else if (raw.graph !== null && typeof raw.graph === 'object') {
    graph = raw.graph
    // Detection runs first so a template written before a slot existed still
    // gains it; the file's own map wins wherever it disagrees.
    slots = { ...detectSlots(graph, objectInfo), ...(raw.slots ?? {}) }
  } else {
    return { problem: `${basename(filePath)}: 既不是 ComfyUI 工作流也不是已转换模板` }
  }
  const native = raw.size?.native ?? nativeSize(graph, slots)
  // A raw ComfyUI workflow carries its own `id` and `label` in its metadata —
  // that is ComfyUI's workflow identity, not ours, so the filename names it.
  const converted = !Array.isArray(raw.nodes)
  return {
    template: {
      id: converted && typeof raw.id === 'string' && raw.id !== '' ? raw.id : fallbackId,
      label: converted && typeof raw.label === 'string' && raw.label !== '' ? raw.label : fallbackId,
      strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((s) => typeof s === 'string') : [],
      dialect: typeof raw.dialect === 'string' ? raw.dialect : 'caption',
      purposes: Array.isArray(raw.purposes) ? raw.purposes.filter((s) => typeof s === 'string') : [],
      notes: typeof raw.notes === 'string' ? raw.notes : undefined,
      source: filePath,
      size: native === undefined ? undefined : { native },
      defaults: templateDefaults(graph, slots, raw.defaults),
      slots,
      graph,
    },
  }
}

/**
 * Read every `*.json` in `dir` (non-recursive). Earlier folders win on id clash,
 * so the first templateDirs entry shadows everything after it and a local edit
 * shadows a bundled preset.
 */
export function loadTemplates(dirs, objectInfo) {
  const templates = new Map()
  const problems = []
  for (const dir of dirs) {
    if (typeof dir !== 'string' || !existsSync(dir)) continue
    let entries
    try {
      entries = readdirSync(dir)
    } catch (error) {
      problems.push(`${dir}: ${error.message}`)
      continue
    }
    for (const name of entries.sort()) {
      if (extname(name).toLowerCase() !== '.json') continue
      const path = join(dir, name)
      try {
        if (!statSync(path).isFile()) continue
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        const result = normalizeTemplate(raw, path, objectInfo)
        if (result.problem !== undefined) problems.push(result.problem)
        else if (!templates.has(result.template.id)) templates.set(result.template.id, result.template)
      } catch (error) {
        problems.push(`${name}: ${error.message}`)
      }
    }
  }
  return { templates: [...templates.values()], problems }
}

/**
 * What this machine is missing for a template.
 * Node types come from `/object_info` keys; model files come from the combo
 * options of the loader input that names them.
 * @returns {{ok: boolean, missing: {kind: string, detail: string}[], warnings: string[]}}
 */
export function checkTemplate(template, objectInfo) {
  const missing = []
  const warnings = []
  for (const [id, node] of Object.entries(template.graph)) {
    if (objectInfo[node.class_type] === undefined) {
      missing.push({ kind: 'node', detail: `缺少节点类型 ${node.class_type}` })
    }
    void id
  }
  for (const ref of modelRefs(template.graph)) {
    const options = optionList(objectInfo, ref.classType, ref.input)
    if (options === undefined) continue
    if (options.some((option) => option === ref.value)) continue
    const folder = FOLDER_OF[ref.classType] ?? 'comfyui/models'
    missing.push({ kind: 'model', detail: `${ref.value}（${folder}）` })
  }
  if (template.slots.prompt === undefined) warnings.push('模板没有文本提示词槽位')
  return { ok: missing.length === 0, missing, warnings }
}

/** Purposes a prompt hints at, used only when the caller did not pick a template. */
const PURPOSE_HINTS = [
  { purpose: 'anime', pattern: /anime|manga|二次元|动漫|插画|character|galgame|漫画/i },
  { purpose: 'typography', pattern: /poster|海报|logo|标题|排版|文字|text|typography|封面|banner/i },
  { purpose: 'layout', pattern: /layout|版式|构图|info|图表|infographic|卡片|menu|菜单/i },
  { purpose: 'art', pattern: /photo|写实|胶片|cinematic|质感|氛围|editorial|电影感|portrait/i },
]

/**
 * Pick a template. Explicit `template` wins; then purpose match on declared
 * `purposes`/`strengths`; then prompt hints; then the first usable template.
 */
export function selectTemplate(templates, { template, purpose, prompt } = {}) {
  if (templates.length === 0) return undefined
  if (typeof template === 'string' && template !== '') {
    return templates.find((entry) => entry.id === template)
  }
  const wanted = []
  if (typeof purpose === 'string' && purpose !== '') wanted.push(purpose)
  for (const hint of PURPOSE_HINTS) {
    if (typeof prompt === 'string' && hint.pattern.test(prompt)) wanted.push(hint.purpose)
  }
  for (const want of wanted) {
    const hit = templates.find((entry) =>
      [...(entry.purposes ?? []), ...(entry.strengths ?? [])].some((tag) => tag.toLowerCase() === want.toLowerCase()))
    if (hit !== undefined) return hit
  }
  for (const want of wanted) {
    const hit = templates.find((entry) =>
      [...(entry.purposes ?? []), ...(entry.strengths ?? [])].some((tag) => tag.toLowerCase().includes(want.toLowerCase())))
    if (hit !== undefined) return hit
  }
  return templates[0]
}

/** ComfyUI-friendly multiple. */
function snap(value) {
  return Math.max(64, Math.round(value / 8) * 8)
}

/**
 * Turn a size request into latent width/height.
 * Accepts `1024x1365`, `1024*1365`, `3:4`, `16:9`, or the words
 * `square|portrait|landscape`, and keeps the template's pixel budget so a
 * 1760x1224 template still renders at its trained area.
 */
export function resolveSize(template, size) {
  const native = template.size?.native
  const parsed = typeof native === 'string' ? native.split('x').map(Number) : []
  const base = parsed.length === 2 && parsed.every((n) => Number.isFinite(n) && n > 0) ? parsed : [1024, 1024]
  const budget = base[0] * base[1]
  const fallback = { width: snap(base[0]), height: snap(base[1]) }
  if (typeof size !== 'string' || size.trim() === '') return fallback
  const text = size.trim().toLowerCase()

  const named = { square: 1, '1:1': 1, portrait: 3 / 4, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16, landscape: 4 / 3, '4:3': 4 / 3, '16:9': 16 / 9, '3:2': 3 / 2 }
  const aspect = named[text]
  if (aspect !== undefined) {
    return { width: snap(Math.sqrt(budget * aspect)), height: snap(Math.sqrt(budget / aspect)) }
  }
  const dims = text.match(/^(\d{2,5})\s*[x*×]\s*(\d{2,5})$/)
  if (dims !== null) return { width: snap(Number(dims[1])), height: snap(Number(dims[2])) }
  const ratio = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (ratio !== null) {
    const a = Number(ratio[1])
    const b = Number(ratio[2])
    if (a > 0 && b > 0) return { width: snap(Math.sqrt((budget * a) / b)), height: snap(Math.sqrt((budget * b) / a)) }
  }
  return fallback
}
