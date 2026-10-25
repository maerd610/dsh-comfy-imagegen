/**
 * Import one of your own ComfyUI workflows as a template.
 *
 *   node scripts/template.mjs import "C:\\path\\to\\my-workflow.json" --label "我的模型"
 *
 * Point it at a single workflow or a whole folder; add --run to prove the
 * template actually renders before you rely on it. The template is written as
 * plain JSON, so afterwards it is yours to edit by hand.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ComfyClient } from '../lib/comfy.js'
import { checkTemplate, normalizeTemplate } from '../lib/templates.js'
import { applySlots } from '../lib/ui2api.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')

const USAGE = `导入自己的 ComfyUI 工作流作为生图模板

  node scripts/template.mjs import <工作流.json | 文件夹> [选项]

选项
  --out <目录>        写到哪里（默认 templates/，建议写到你自己的文件夹）
  --id <名字>         模板 id，默认取文件名
  --label <文字>      给人看的名字，默认同 id
  --strengths a,b,c   擅长什么，用于自动挑选模板
  --purposes a,b      purpose 标签：anime / typography / layout / art / edit，也可以自定义
  --dialect <名字>    提示词写法：caption（默认）/ instruction / tags / layout-json
  --notes <一句话>    模板说明，会显示在模板文件里
  --base-url <URL>    默认取环境变量 COMFY_URL，否则 http://127.0.0.1:8188
  --refresh           重新读取 /object_info，不用缓存
  --run               导入后立刻出一张图，验证模板真的能跑
  --prompt <文字>     --run 用的提示词
  --force             覆盖同名模板文件

例子
  node scripts/template.mjs import ./my-workflow.json --label "写实人像"
  node scripts/template.mjs import "C:\\Users\\me\\ComfyUI\\user\\default\\workflows" --out "C:\\Users\\me\\Pictures\\my-templates"
`

const argv = process.argv.slice(2)
const command = argv[0] === 'import' ? argv.shift() : undefined
if (command === undefined || argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE)
  process.exit(command === undefined ? 2 : 0)
}

/** `--flag value` pairs; a flag without a value is `true`. */
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}
const has = (name) => argv.includes(`--${name}`)
const list = (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : [])

const target = argv.find((arg) => !arg.startsWith('--') && arg !== command)
if (target === undefined) {
  console.error(`缺少要导入的文件或文件夹。\n\n${USAGE}`)
  process.exit(2)
}

const baseUrl = (typeof flag('base-url', process.env.COMFY_URL) === 'string' ? flag('base-url', process.env.COMFY_URL) : 'http://127.0.0.1:8188').replace(/\/+$/, '')
const outDir = resolve(typeof flag('out', undefined) === 'string' ? flag('out', undefined) : join(ROOT, 'templates'))

/** `/object_info` is megabytes and only changes when ComfyUI restarts. */
async function objectInfo() {
  const cached = join(CACHE, 'object_info.json')
  if (!has('refresh') && existsSync(cached)) {
    try {
      return JSON.parse(readFileSync(cached, 'utf8'))
    } catch {
      // A half-written cache is not worth an error: just fetch it again.
    }
  }
  const client = new ComfyClient({ baseUrl })
  let info
  try {
    info = await client.objectInfo()
  } catch (error) {
    console.error(`连不上 ComfyUI（${baseUrl}）：${error.message}`)
    console.error('确认 ComfyUI 开着、--base-url 或 COMFY_URL 填对了，再重试。')
    process.exit(1)
  }
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(cached, JSON.stringify(info))
  return info
}

/** Every *.json the caller pointed at, in a stable order. */
function workflowsOf(path) {
  const stats = statSync(path)
  if (stats.isFile()) return [path]
  if (!stats.isDirectory()) throw new Error(`${path} 既不是文件也不是文件夹`)
  return readdirSync(path)
    .filter((name) => extname(name).toLowerCase() === '.json')
    .sort()
    .map((name) => join(path, name))
}

const info = await objectInfo()
const targets = workflowsOf(target)
if (targets.length === 0) {
  console.error(`${target} 里没有 .json 工作流`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const written = []
for (const workflowPath of targets) {
  let raw
  try {
    raw = JSON.parse(readFileSync(workflowPath, 'utf8'))
  } catch (error) {
    console.error(`✗ ${basename(workflowPath)}: ${error.message}`)
    continue
  }
  if (!Array.isArray(raw.nodes)) {
    console.error(`✗ ${basename(workflowPath)}: 这不是 ComfyUI 画布导出的工作流（没有 nodes 数组），请在 ComfyUI 里用“导出（API）”或普通导出后重试`)
    continue
  }

  const converted = normalizeTemplate(raw, workflowPath, info)
  if (converted.problem !== undefined) {
    console.error(`✗ ${converted.problem}`)
    continue
  }
  const template = converted.template
  const id = (typeof flag('id', undefined) === 'string' && targets.length === 1 ? flag('id', undefined) : basename(workflowPath, extname(workflowPath)))
  const outPath = join(outDir, `${id}.json`)
  if (existsSync(outPath) && !has('force')) {
    console.error(`✗ ${outPath} 已存在，加 --force 才覆盖`)
    continue
  }

  const output = {
    id,
    label: typeof flag('label', undefined) === 'string' && targets.length === 1 ? flag('label', undefined) : id,
    strengths: list(flag('strengths', '')),
    purposes: list(flag('purposes', '')),
    dialect: typeof flag('dialect', undefined) === 'string' ? flag('dialect', undefined) : 'caption',
    ...(typeof flag('notes', undefined) === 'string' ? { notes: flag('notes', undefined) } : {}),
    size: template.size ?? {},
    defaults: template.defaults,
    slots: template.slots,
    graph: template.graph,
  }
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`)
  written.push({ id, path: outPath, template })

  const check = checkTemplate(template, info)
  console.log(`✓ ${basename(workflowPath)} → ${outPath}`)
  console.log(`  节点 ${Object.keys(template.graph).length} 个 · 原生尺寸 ${template.size?.native ?? '未知'} · 槽位 ${Object.keys(template.slots).join(', ')}`)
  console.log(`  默认值 ${Object.entries(template.defaults).map(([key, value]) => `${key}=${value}`).join(' · ') || '（无）'}`)
  if (!check.ok) {
    console.log('  ⚠ 这台机器目前跑不了它，缺：')
    for (const item of check.missing) console.log(`    · ${item.detail}`)
    console.log('    装好模型或节点后重新导入即可；也可以直接改模板里的文件名。')
  }
}

if (written.length === 0) process.exit(1)

if (has('run')) {
  const [first] = written
  const prompt = typeof flag('prompt', undefined) === 'string'
    ? flag('prompt', undefined)
    : 'A single red apple on a plain white table, soft daylight, photograph.'
  const values = { prompt, ...first.template.defaults, seed: Math.floor(Math.random() * 2 ** 32) }
  if (first.template.slots.image !== undefined) {
    console.error(`\n${first.id} 是改图模板，需要一张源图；跳过 --run。`)
    process.exit(0)
  }
  const client = new ComfyClient({ baseUrl })
  const prepared = applySlots(first.template.graph, first.template.slots, values)
  console.log(`\n→ 提交试跑：${prompt}`)
  const started = Date.now()
  const promptId = await client.submit(prepared.graph)
  console.log(`  prompt_id: ${promptId}`)
  const entry = await client.wait(promptId, { timeoutMs: 900_000 })
  const images = ComfyClient.images(entry)
  if (images.length === 0) {
    console.error('✗ 跑完了但没有图片，检查工作流里有没有保存节点')
    process.exit(1)
  }
  const bytes = await client.fetchImage(images[0])
  const canary = join(CACHE, `canary-${first.id}.png`)
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(canary, bytes)
  console.log(`✓ 试跑成功，用时 ${((Date.now() - started) / 1000).toFixed(1)}s，图片：${canary}`)
}

console.log(`\n下一步：把 ${outDir} 加进插件配置的 templateDirs，重启 DSH 后用 image_capabilities 看它是否 ✓。`)
console.log('  如果模板就放在 ComfyUI 里，也可以把配置项 comfyUiDir 指向 ComfyUI 根目录，插件会自动读取 user/default/workflows。')
