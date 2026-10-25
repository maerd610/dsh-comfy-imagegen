/**
 * ComfyUI UI-graph (the JSON the canvas saves) → API graph (what POST /prompt
 * accepts), plus slot discovery.
 *
 * The UI graph stores widget values positionally; recent frontends also write
 * `widgets_values_named`, which we prefer, falling back to zipping
 * `widgets_values` onto the node's own `inputs[].widget.name` order. Only
 * inputs the server actually declares survive, so extension widgets
 * (`control_after_generate`, `speak_and_recognation`) never reach the server.
 *
 * Approach follows ComfyUI's frontend conversion (and dsh-comfyui's
 * convert.js, MIT): wired inputs become [nodeId, slot] pairs, Reroute and
 * bypassed (mode 4) nodes pass through, UI-only decoration is skipped.
 */

/** Node types that exist only in the canvas and carry no data flow. */
const UI_ONLY = new Set([
  'Note',
  'MarkdownNote',
  'Reroute',
  'PrimitiveNode',
  'Fast Groups Bypasser (rgthree)',
  'Fast Groups Muter (rgthree)',
])

/** Widget values the canvas keeps that the server has no input for. */
const UI_ONLY_INPUTS = new Set(['control_after_generate', 'speak_and_recognation', 'videopreview', 'upload'])

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function declaredInputs(objectInfo, classType) {
  const input = objectInfo?.[classType]?.input
  if (!isObject(input)) return null
  const names = new Set()
  for (const group of ['required', 'optional']) {
    const fields = isObject(input[group]) ? input[group] : {}
    for (const name of Object.keys(fields)) names.add(name)
  }
  return names
}

/** Normalise both legacy positional link rows and frontend object entries. */
function normalizeLinks(rawLinks) {
  const links = new Map()
  for (const raw of rawLinks) {
    if (Array.isArray(raw) && raw.length >= 5) {
      links.set(raw[0], { id: raw[0], source: raw[1], sourceSlot: raw[2], target: raw[3], targetSlot: raw[4], type: raw[5] })
      continue
    }
    if (isObject(raw) && raw.id !== undefined) {
      links.set(raw.id, {
        id: raw.id,
        source: raw.origin_id ?? raw.source,
        sourceSlot: raw.origin_slot ?? raw.sourceSlot,
        target: raw.target_id ?? raw.target,
        targetSlot: raw.target_slot ?? raw.targetSlot,
        type: raw.type,
      })
    }
  }
  return links
}

/** Widgets the canvas stores one extra value behind (the seed's control mode). */
const CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize'])
const SEED_WIDGETS = new Set(['seed', 'noise_seed'])

/**
 * Pair `inputs[].widget` names with `widgets_values` positions.
 *
 * The canvas writes an extra control-mode string (`randomize`, `fixed`, …)
 * right after a seed widget, without a matching input entry — plain positional
 * zipping would shift every later value by one.
 */
function zipWidgets(inputs, values) {
  const out = []
  let index = 0
  for (const entry of Array.isArray(inputs) ? inputs : []) {
    const name = entry?.widget?.name
    if (typeof name !== 'string' || name === '') continue
    if (index >= values.length) break
    const value = values[index]
    index += 1
    if (SEED_WIDGETS.has(name) && typeof values[index] === 'string' && CONTROL_VALUES.has(values[index])) index += 1
    out.push([name, value])
  }
  return out
}
/**
 * Canvas viewers (ImageCompare and friends) declare a socketless required input
 * the API prompt cannot supply, and they produce nothing either — dropping them
 * keeps the graph valid without changing the picture.
 */
function isViewerNode(objectInfo, classType) {
  const spec = objectInfo[classType]
  if (!isObject(spec) || (Array.isArray(spec.output) && spec.output.length > 0)) return false
  for (const group of ['required', 'optional']) {
    for (const entry of Object.values(spec.input?.[group] ?? {})) {
      if (isObject(entry?.[1]) && entry[1].socketless === true) return true
    }
  }
  return false
}

/** Widget defaults the server would apply anyway, for values the canvas omits. */
function defaultInputs(objectInfo, classType) {
  const spec = objectInfo[classType]
  const out = {}
  for (const group of ['required', 'optional']) {
    for (const [name, entry] of Object.entries(spec?.input?.[group] ?? {})) {
      const options = Array.isArray(entry) ? entry[1] : undefined
      if (!isObject(options) || options.default === undefined) continue
      out[name] = options.default
    }
  }
  return out
}
function widgetValues(node, classType, objectInfo) {
  const declared = declaredInputs(objectInfo, classType)
  const keep = (name, value) => {
    if (UI_ONLY_INPUTS.has(name)) return false
    if (declared !== null && !declared.has(name)) return false
    if (value === undefined) return false
    // Canvas-only bookkeeping objects (e.g. {hidden:true}) never reach the server.
    if (isObject(value) && (value.hidden === true || 'videopreview' in value)) return false
    return true
  }
  const out = {}
  if (isObject(node.widgets_values_named)) {
    for (const [name, value] of Object.entries(node.widgets_values_named)) {
      if (keep(name, value)) out[name] = value
    }
    return out
  }
  const values = node.widgets_values
  if (Array.isArray(values)) {
    for (const [name, value] of zipWidgets(node.inputs, values)) {
      if (keep(name, value)) out[name] = value
    }
    return out
  }
  if (isObject(values)) {
    for (const [name, value] of Object.entries(values)) {
      if (keep(name, value)) out[name] = value
    }
  }
  return out
}

/** Subgraph definitions the canvas keeps next to its top-level nodes. */
function subgraphDefinitions(graph) {
  const defs = new Map()
  for (const sub of Array.isArray(graph?.definitions?.subgraphs) ? graph.definitions.subgraphs : []) {
    if (isObject(sub) && typeof sub.id === 'string') defs.set(sub.id, sub)
  }
  return defs
}

/**
 * Expand subgraph instances into one flat canvas.
 *
 * The canvas nests reusable subgraphs and wires them with sentinel endpoints:
 * `-10` means "the instance's promoted input N", `-20` means "the instance's
 * output N". Every real node gets a globally unique id (`459:474`) and every
 * input is resolved to either an upstream node + slot or a literal promoted
 * value, so the rest of the converter never has to know subgraphs exist.
 *
 * @returns {{nodes: {id: string, raw: object, inputs: {name: string, source?: object, value?: unknown}[]}[], outputs: Map<number, object>}}
 */
function flattenCanvas(graph, defs, warnings) {
  /** Results of instance outputs, keyed `<instance global id>:<slot>`. */
  const instanceOutputs = new Map()
  /** Every node from every scope, in one shared list: nested scopes emit here. */
  const allNodes = []

  const scope = (rawNodes, rawLinks, prefix, external) => {
    const links = normalizeLinks(Array.isArray(rawLinks) ? rawLinks : [])
    const nodes = []
    const outputs = new Map()
    const emit = (entry) => { nodes.push(entry); allNodes.push(entry) }

    const resolveLink = (link) => {
      if (link === undefined) return undefined
      if (link.source === -10) return external?.(Number(link.sourceSlot))
      if (link.source === -20) return undefined
      const viaInstance = instanceOutputs.get(`${prefix}${link.source}:${Number(link.sourceSlot)}`)
      if (viaInstance !== undefined) return viaInstance
      return { node: `${prefix}${link.source}`, slot: Number(link.sourceSlot) }
    }

    // Pass 1: expand instances first, so their outputs can be referenced by nodes
    // that the canvas happens to store earlier in the node list.
    const plain = []
    for (const raw of rawNodes) {
      if (!isObject(raw)) continue
      if (!defs.has(raw.type)) {
        plain.push(raw)
        continue
      }
      const globalId = `${prefix}${raw.id}`
      const inputs = []
      const widgets = new Map(zipWidgets(raw.inputs, Array.isArray(raw.widgets_values) ? raw.widgets_values : []))
      for (const entry of Array.isArray(raw.inputs) ? raw.inputs : []) {
        const name = typeof entry?.name === 'string' ? entry.name : ''
        const isWidget = isObject(entry?.widget)
        const widgetValue = isWidget ? widgets.get(name) : undefined
        const wired = entry?.link === null || entry?.link === undefined ? undefined : resolveLink(links.get(entry.link))
        if (wired !== undefined) {
          if (name !== '') inputs.push({ name, source: wired })
          continue
        }
        if (isWidget && widgetValue !== undefined && name !== '') inputs.push({ name, value: widgetValue })
      }
      const sub = defs.get(raw.type)
      const promoted = (index) => {
        const name = sub.inputs?.[index]?.name
        const found = inputs.find((entry) => entry.name === name)
        if (found === undefined) return undefined
        return found.source !== undefined ? found.source : { value: found.value }
      }
      const child = scope(sub.nodes ?? [], sub.links ?? [], `${globalId}:`, promoted)
      for (const [slot, source] of child.outputs) instanceOutputs.set(`${globalId}:${slot}`, source)
    }

    // Pass 2: ordinary nodes.
    for (const raw of plain) {
      const globalId = `${prefix}${raw.id}`
      const inputs = []
      const widgets = new Map(zipWidgets(raw.inputs, Array.isArray(raw.widgets_values) ? raw.widgets_values : []))
      for (const entry of Array.isArray(raw.inputs) ? raw.inputs : []) {
        const name = typeof entry?.name === 'string' ? entry.name : ''
        const isWidget = isObject(entry?.widget)
        const widgetValue = isWidget ? widgets.get(name) : undefined
        const wired = entry?.link === null || entry?.link === undefined ? undefined : resolveLink(links.get(entry.link))
        if (wired !== undefined) {
          if (name !== '') inputs.push({ name, source: wired })
          continue
        }
        if (isWidget && widgetValue !== undefined && name !== '') inputs.push({ name, value: widgetValue })
      }
      emit({ id: globalId, raw, inputs })
    }

    for (const link of links.values()) {
      if (link.target !== -20) continue
      const source = resolveLink(link)
      if (source !== undefined) outputs.set(Number(link.targetSlot), source)
      else warnings.push(`子图输出 ${link.targetSlot} 没有解析到上游节点`)
    }
    return { nodes, outputs }
  }

  const outputs = scope(Array.isArray(graph.nodes) ? graph.nodes : [], graph.links, '', undefined)
  return { nodes: allNodes, outputs }
}

/**
 * @param {object} graph    parsed UI-format workflow
 * @param {object} objectInfo  /object_info response
 * @returns {{ok:true, workflow:object, warnings:string[]} | {ok:false, error:string}}
 */
export function convertGraphToApi(graph, objectInfo) {
  if (!isObject(graph) || !Array.isArray(graph.nodes)) return { ok: false, error: '不是 ComfyUI 画布格式（缺少 nodes 数组）' }
  const defs = subgraphDefinitions(graph)
  const warnings = []
  const flat = flattenCanvas(graph, defs, warnings)
  const nodesById = new Map(flat.nodes.map((entry) => [entry.id, entry]))

  const resolveOrigin = (nodeId, seen = new Set()) => {
    const entry = nodesById.get(String(nodeId))
    if (entry === undefined) return { missing: '连线指向不存在的节点' }
    if (seen.has(entry.id)) return { missing: '连线成环' }
    seen.add(entry.id)
    const raw = entry.raw
    if (raw.type === 'Reroute' || raw.mode === 4) {
      const pass = entry.inputs.find((item) => item.source !== undefined)
      if (pass === undefined) return { missing: `上游 ${raw.type} 节点（id ${entry.id}）没有可直通的连线` }
      return resolveSource(pass.source, seen)
    }
    if (objectInfo[raw.type] === undefined) {
      // Unregistered UI-only value source: inline its first widget value.
      const value = entry.inputs.find((item) => item.value !== undefined)?.value
        ?? (Array.isArray(raw.widgets_values) ? raw.widgets_values[0] : undefined)
      if (value === undefined) return { missing: `上游是未注册节点「${raw.type}」（id ${entry.id}），没有可内联的值` }
      return { value }
    }
    return { id: entry.id }
  }

  const resolveSource = (source, seen) => {
    if (source.value !== undefined) return source
    return resolveOrigin(source.node, seen)
  }

  const workflow = {}
  for (const entry of flat.nodes) {
    const type = typeof entry.raw.type === 'string' ? entry.raw.type : ''
    if (type === '' || UI_ONLY.has(type)) continue
    if (entry.raw.mode === 4) continue
    if (isViewerNode(objectInfo, type)) {
      warnings.push(`画布查看节点 ${type}（id ${entry.id}）不参与生成，已忽略`)
      continue
    }
    if (objectInfo[type] === undefined) {
      if (type.startsWith('Primitive') || type.startsWith('workflow')) continue
      return { ok: false, error: `工作流含未知节点类型「${type}」（id ${entry.id}）：服务端没有这个节点，通常是缺自定义节点包` }
    }
    const declared = declaredInputs(objectInfo, type)
    const inputs = {}
    for (const item of entry.inputs) {
      const name = item.name
      const dynamic = declared !== null && !declared.has(name) && name.includes('.')
      if (declared !== null && !declared.has(name) && !dynamic) continue
      if (item.value !== undefined) {
        inputs[name] = item.value
        continue
      }
      const resolved = resolveSource(item.source)
      if (resolved.value !== undefined) {
        inputs[name] = resolved.value
      } else if (resolved.id !== undefined) {
        inputs[name] = [String(resolved.id), Number(item.source.slot)]
      } else {
        warnings.push(`节点 ${type}（id ${entry.id}）的输入 ${name} 无法解析：${resolved.missing}`)
      }
    }
    for (const [name, value] of Object.entries(widgetValues(entry.raw, type, objectInfo))) {
      // A wired or promoted input wins over the stale widget value it shadows.
      if (name in inputs) continue
      inputs[name] = value
    }
    for (const [name, value] of Object.entries(defaultInputs(objectInfo, type))) {
      if (name in inputs) continue
      inputs[name] = value
    }
    workflow[entry.id] = { class_type: type, inputs }
  }

  if (Object.keys(workflow).length === 0) return { ok: false, error: '转换结果为空（图中没有可执行节点）' }

  // Prune nodes that no output can reach (parked model loaders, idle loaders):
  // they would otherwise make the `requires` check demand files nobody uses.
  const roots = Object.keys(workflow).filter((id) => {
    const type = workflow[id].class_type
    return objectInfo[type]?.output_node === true || /^(SaveImage|PreviewImage|SaveImageAdvanced|PreviewImage)/.test(type)
  })
  if (roots.length > 0) {
    const reachable = new Set(roots)
    const stack = [...roots]
    while (stack.length > 0) {
      const node = workflow[stack.pop()]
      for (const value of Object.values(node.inputs)) {
        if (!Array.isArray(value) || value.length !== 2) continue
        const upstream = String(value[0])
        if (workflow[upstream] === undefined || reachable.has(upstream)) continue
        reachable.add(upstream)
        stack.push(upstream)
      }
    }
    for (const id of Object.keys(workflow)) {
      if (reachable.has(id)) continue
      warnings.push(`节点 ${workflow[id].class_type}（id ${id}）没有连到任何输出，已丢弃`)
      delete workflow[id]
    }
  }

  for (const [id, node] of Object.entries(workflow)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (!Array.isArray(value) || value.length !== 2) continue
      if (workflow[String(value[0])] === undefined) {
        return { ok: false, error: `节点 ${node.class_type}（id ${id}）的输入 ${name} 引用了被跳过的节点 ${value[0]}——请确认该上游节点没有被绕过` }
      }
    }
  }
  return { ok: true, workflow, warnings }
}

const POSITIVE_TEXT_INPUTS = ['prompt', 'text', 'positive_prompt']
const NEGATIVE_TEXT_INPUTS = ['negative_prompt', 'negative', 'text', 'prompt']

/**
 * Which input of `node` carries the caption for one side of the sampler.
 * A single encoder can serve both sides (TextEncodeQwenImage21 exposes
 * `prompt` *and* `negative_prompt`), so the preference order depends on side.
 */
function textFieldOf(node, objectInfo, preferred) {
  if (node === undefined) return undefined
  const declared = declaredInputs(objectInfo, node.class_type)
  const usable = (name) => name in node.inputs && (declared === null || declared.has(name))
  for (const name of preferred) {
    if (usable(name)) return name
  }
  // Last resort: a node rewritten to use an unconventional caption field.
  if (declared !== null) {
    for (const name of declared) {
      if (POSITIVE_TEXT_INPUTS.includes(name) && usable(name)) return name
    }
  }
  return undefined
}

const LATENT_TYPES = new Set(['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage', 'EmptyLatentImageSDXL', 'EmptyHunyuanLatentVideo'])

/**
 * Find the inputs worth exposing as tool parameters.
 * Positive/negative are traced from the sampler, so renamed nodes and wrapper
 * nodes (ConditioningZeroOut, LoraLoader chains) stay correct.
 * @returns {object} slots map: `{ prompt, negative, width, height, batch, seed, steps, cfg, latent, sampler, save }`
 */
export function detectSlots(workflow, objectInfo) {
  const slots = {}
  const nodes = Object.entries(workflow)
  const samplers = nodes.filter(([, node]) =>
    node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced' || node.class_type === 'SamplerCustom',
  )
  const sampler = samplers[0]
  if (sampler !== undefined) {
    const [samplerId, samplerNode] = sampler
    slots.sampler = { node: samplerId }
    for (const field of ['seed', 'noise_seed', 'steps', 'cfg', 'denoise', 'sampler_name', 'scheduler']) {
      if (field in samplerNode.inputs) slots[field === 'noise_seed' ? 'seed' : field] = { node: samplerId, input: field }
    }
    for (const [side, key, preferred] of [
      ['positive', 'prompt', POSITIVE_TEXT_INPUTS],
      ['negative', 'negative', NEGATIVE_TEXT_INPUTS],
    ]) {
      const reference = samplerNode.inputs[side]
      if (!Array.isArray(reference)) continue
      const source = workflow[String(reference[0])]
      const field = textFieldOf(source, objectInfo, preferred)
      if (field !== undefined) slots[key] = { node: String(reference[0]), input: field }
    }
    // Breadth-first from the sampler (any wired input) so switch nodes, caches
    // and wrapper nodes between the sampler and the latent stay traversable.
    const queue = [samplerId]
    const visited = new Set(queue)
    while (queue.length > 0) {
      const id = queue.shift()
      const node = workflow[id]
      if (node === undefined) continue
      if (id !== samplerId && LATENT_TYPES.has(node.class_type) && 'width' in node.inputs && 'height' in node.inputs) {
        slots.width = { node: id, input: 'width' }
        slots.height = { node: id, input: 'height' }
        if ('batch_size' in node.inputs) slots.batch = { node: id, input: 'batch_size' }
        break
      }
      for (const value of Object.values(node.inputs)) {
        if (!Array.isArray(value) || value.length < 2) continue
        const next = String(value[0])
        if (visited.has(next) || workflow[next] === undefined) continue
        visited.add(next)
        queue.push(next)
      }
    }
  }
  for (const [id, node] of nodes) {
    if (node.class_type === 'SaveImage' || node.class_type === 'SaveImageAdvanced') {
      slots.save = { node: id, input: 'filename_prefix' }
      break
    }
  }
  // An edit workflow needs a picture to work on; the loader that feeds the
  // encoder is the one whose file we replace before submitting.
  for (const [id, node] of nodes) {
    if (node.class_type === 'LoadImage' && 'image' in node.inputs) {
      slots.image = { node: id, input: 'image' }
      break
    }
  }
  return slots
}

/** Native output size of a template, read from its latent node. */
export function nativeSize(workflow, slots) {
  if (slots.width === undefined || slots.height === undefined) return undefined
  const node = workflow[slots.width.node]
  const width = node?.inputs?.[slots.width.input]
  const height = node?.inputs?.[slots.height.input]
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  return `${width}x${height}`
}

/** Files a converted graph needs, each tied to the loader input that names it. */

/** class → [input names that hold a model filename]. */
const MODEL_INPUTS = {
  CheckpointLoaderSimple: ['ckpt_name'],
  UNETLoader: ['unet_name'],
  UnetLoaderGGUF: ['unet_name'],
  CLIPLoader: ['clip_name'],
  DualCLIPLoader: ['clip_name1', 'clip_name2'],
  TripleCLIPLoader: ['clip_name1', 'clip_name2', 'clip_name3'],
  QuadrupleCLIPLoader: ['clip_name1', 'clip_name2', 'clip_name3', 'clip_name4'],
  VAELoader: ['vae_name'],
  LoraLoader: ['lora_name'],
  LoraLoaderModelOnly: ['lora_name'],
  ControlNetLoader: ['control_net_name'],
  UpscaleModelLoader: ['model_name'],
  CLIPVisionLoader: ['clip_name'],
}

/**
 * Every model file a converted graph loads, with the class/input that names it.
 * `options` in `/object_info` are the authoritative file lists, so this doubles
 * as the environment self-check: an option list that lacks the file means the
 * template cannot run here.
 * @returns {{node: string, classType: string, input: string, value: string}[]}
 */
export function modelRefs(workflow) {
  const refs = []
  for (const [id, node] of Object.entries(workflow)) {
    for (const input of MODEL_INPUTS[node.class_type] ?? []) {
      const value = node.inputs[input]
      if (typeof value === 'string' && value !== '') {
        refs.push({ node: id, classType: node.class_type, input, value })
      }
    }
  }
  return refs
}

/** Model files a converted graph needs, grouped by the folder they live in. */
export function requiredModels(workflow) {
  const needed = {}
  const add = (kind, name) => {
    if (typeof name !== 'string' || name === '') return
    const list = needed[kind] ?? (needed[kind] = [])
    if (!list.includes(name)) list.push(name)
  }
  for (const node of Object.values(workflow)) {
    const inputs = node.inputs
    switch (node.class_type) {
      case 'CheckpointLoaderSimple':
        add('checkpoints', inputs.ckpt_name)
        break
      case 'UNETLoader':
      case 'UnetLoaderGGUF':
        add('diffusion_models', inputs.unet_name)
        break
      case 'CLIPLoader':
      case 'DualCLIPLoader':
      case 'TripleCLIPLoader':
      case 'QuadrupleCLIPLoader':
        for (const key of ['clip_name', 'clip_name1', 'clip_name2', 'clip_name3', 'clip_name4']) add('text_encoders', inputs[key])
        break
      case 'VAELoader':
        add('vae', inputs.vae_name)
        break
      case 'LoraLoader':
      case 'LoraLoaderModelOnly':
        add('loras', inputs.lora_name)
        break
      case 'ControlNetLoader':
        add('controlnet', inputs.control_net_name)
        break
      case 'UpscaleModelLoader':
        add('upscale_models', inputs.model_name)
        break
      case 'CLIPVisionLoader':
        add('clip_vision', inputs.clip_name)
        break
      default:
    }
  }
  return needed
}

/** The file options the server advertises for one loader input, if any. */
export function optionList(objectInfo, classType, input) {
  const spec = objectInfo?.[classType]?.input
  for (const group of [spec?.required, spec?.optional]) {
    const entry = group?.[input]
    const options = Array.isArray(entry) ? entry[0] : undefined
    if (Array.isArray(options)) return options.filter((option) => typeof option === 'string')
  }
  return undefined
}

/** Deep clone so per-run slot injection never mutates the cached template. */
export function cloneGraph(workflow) {
  return structuredClone(workflow)
}

/** Write values into a cloned graph, leaving slots that were not provided alone. */
export function applySlots(workflow, slots, values) {
  const graph = cloneGraph(workflow)
  const applied = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    const slot = slots[key]
    if (slot === undefined) continue
    // `sampler` is a node reference, not an input; writing it would invent an
    // input called "undefined".
    if (typeof slot.input !== 'string') continue
    const node = graph[slot.node]
    if (node === undefined) continue
    node.inputs[slot.input] = value
    applied[key] = value
  }
  return { graph, applied }
}
