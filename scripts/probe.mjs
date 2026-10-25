/**
 * Probe ComfyUI UI-format workflows: structure, node types, and the nodes that
 * matter for slot injection. Dev-only helper, not shipped at runtime.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'D:\\AI\\ComfyUI-aki-v1.7\\ComfyUI-aki-v1.7\\ComfyUI\\user\\default\\workflows'
const WANT = process.argv[2] ?? null

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.json'))
const objectInfo = JSON.parse(readFileSync('D:\\Harness\\dsh-comfy-imagegen\\.cache\\object_info.json', 'utf8'))

const INTERESTING = /CLIPTextEncode|KSampler|EmptyLatent|EmptySD3|CheckpointLoader|UNETLoader|LoraLoader|TextEncode|SaveImage|LoadImage|VAELoader|CLIPLoader|SetLatent|Conditioning|Latent|Primitive|ModelSampling|ImageScale|Batch/

for (const file of files) {
  if (WANT !== null && !file.includes(WANT)) continue
  let json
  try {
    json = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  } catch (e) {
    console.log(`\n### ${file}  <parse error: ${e.message}>`)
    continue
  }
  const nodes = Array.isArray(json.nodes) ? json.nodes : []
  const subgraphs = json?.definitions?.subgraphs
  const types = new Map()
  for (const n of nodes) types.set(n.type, (types.get(n.type) ?? 0) + 1)
  const unknown = [...types.keys()].filter((t) => objectInfo[t] === undefined)
  console.log(`\n### ${file}`)
  console.log(`  keys: ${Object.keys(json).join(', ')}`)
  console.log(`  nodes: ${nodes.length}  links: ${Array.isArray(json.links) ? json.links.length : 'n/a'}`)
  console.log(`  subgraphs: ${Array.isArray(subgraphs) ? subgraphs.length + ' -> ' + subgraphs.map((s) => s.id ?? s.name).join(', ') : 'none'}`)
  console.log(`  types: ${[...types.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}×${c}`).join(' ')}`)
  if (unknown.length > 0) console.log(`  UNREGISTERED types: ${unknown.join(', ')}`)
  for (const n of nodes) {
    if (!INTERESTING.test(String(n.type))) continue
    const wv = n.widgets_values
    const wire = (n.inputs ?? []).filter((i) => i.link !== null && i.link !== undefined).map((i) => `${i.name}<-L${i.link}`)
    console.log(`  #${n.id} ${n.type}${n.mode === 4 ? ' [BYPASSED]' : ''} widgets=${JSON.stringify(wv)?.slice(0, 220)}${wire.length ? ' wired=[' + wire.join(' ') + ']' : ''}`)
  }
}
