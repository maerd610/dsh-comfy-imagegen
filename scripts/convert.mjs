/**
 * Dev CLI: convert a ComfyUI canvas workflow into a plugin template and
 * (optionally) prove it on the live server.
 *
 *   node scripts/convert.mjs anima.json --id anima_t2i --label "Anima 动漫" \
 *        --strengths "二次元,角色插画" --dialect caption --run
 *
 * Writes templates/<id>.json = { meta…, slots, graph }. With --run it submits a
 * canary prompt, waits, saves the image to .cache/, and reports what landed.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ComfyClient } from '../lib/comfy.js'
import { convertGraphToApi, detectSlots, nativeSize, requiredModels, applySlots } from '../lib/ui2api.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
const WORKFLOWS = 'D:\\AI\\ComfyUI-aki-v1.7\\ComfyUI-aki-v1.7\\ComfyUI\\user\\default\\workflows'
const BASE_URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}
const isFlag = (name) => argv.includes(`--${name}`)

const file = argv.find((arg) => !arg.startsWith('--') && arg.includes('.json'))
if (file === undefined) {
  console.error('用法：node scripts/convert.mjs <workflow.json> --id <template id> [--label] [--strengths] [--dialect] [--run]')
  process.exit(2)
}

const workflowPath = existsSync(file) ? file : join(WORKFLOWS, file)
const graph = JSON.parse(readFileSync(workflowPath, 'utf8'))

mkdirSync(CACHE, { recursive: true })
const objectInfoPath = join(CACHE, 'object_info.json')
const client = new ComfyClient({ baseUrl: BASE_URL })
const objectInfo = existsSync(objectInfoPath)
  ? JSON.parse(readFileSync(objectInfoPath, 'utf8'))
  : await client.objectInfo()

const converted = convertGraphToApi(graph, objectInfo)
if (!converted.ok) {
  console.error(`✗ 转换失败：${converted.error}`)
  process.exit(1)
}
const slots = detectSlots(converted.workflow, objectInfo)
const size = nativeSize(converted.workflow, slots)
console.log(`✓ 转换成功：${basename(workflowPath)} → ${Object.keys(converted.workflow).length} 个节点`)
if (converted.warnings.length > 0) console.log(`  warnings: ${converted.warnings.join(' | ')}`)
console.log(`  slots: ${JSON.stringify(slots)}`)
console.log(`  native size: ${size ?? 'n/a'}`)
console.log(`  models: ${JSON.stringify(requiredModels(converted.workflow, objectInfo))}`)

const id = flag('id', basename(file, '.json').replace(/[^\w.-]+/g, '_'))
if (id !== true) {
  const template = {
    id,
    label: flag('label', id),
    strengths: String(flag('strengths', '')).split(',').map((s) => s.trim()).filter(Boolean),
    dialect: flag('dialect', 'caption'),
    size: size === undefined ? {} : { native: size },
    slots,
    graph: converted.workflow,
  }
  const outPath = join(ROOT, 'templates', `${id}.json`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(template, null, 2)}\n`)
  console.log(`✓ 模板写入 templates/${id}.json`)
}

if (!isFlag('run')) process.exit(0)

// ── live canary ────────────────────────────────────────────────────────────
const canary = flag('prompt', 'A single red apple on a plain white table, soft daylight, photograph.')
const values = { prompt: canary }
if (slots.seed !== undefined) values.seed = Math.floor(Math.random() * 2 ** 32)
const { graph: runnable, applied } = applySlots(converted.workflow, slots, values)
console.log(`\n→ 提交 canary：${canary}`)
console.log(`  applied: ${JSON.stringify(applied)}`)
const started = Date.now()
const promptId = await client.submit(runnable)
console.log(`  prompt_id: ${promptId}`)
const entry = await client.wait(promptId, { timeoutMs: 600000 })
console.log(`✓ 完成，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  status: ${JSON.stringify(entry?.status ?? null)}`)
const images = ComfyClient.images(entry)
console.log(`  images: ${JSON.stringify(images)}`)
if (images.length === 0) {
  console.error('✗ 没有产出图片')
  process.exit(1)
}
const bytes = await client.fetchImage(images[0])
const outPng = join(CACHE, `canary-${String(id)}.png`)
writeFileSync(outPng, bytes)
console.log(`✓ 图片已保存：${outPng}（${(bytes.length / 1024).toFixed(0)} KB）`)
