// Prints how a ComfyUI canvas file nests subgraphs, for the converter's P3 work.
import fs from 'node:fs'

const file = process.argv[2]
const wf = JSON.parse(fs.readFileSync(file, 'utf8'))
const subs = wf.definitions?.subgraphs ?? []
console.log(`${file}\n  nodes=${wf.nodes?.length ?? 0} subgraphs=${subs.length}`)

for (const sub of subs) {
  console.log(`  subgraph ${sub.id} name=${sub.name} nodes=${sub.nodes?.length ?? 0} links=${sub.links?.length ?? 0}`)
  console.log(`    inputs: ${(sub.inputs ?? []).map((i) => `${i.name}:${i.type ?? (i.widget ? `w:${i.widget.name}` : '?')}`).join(' | ')}`)
  console.log(`    outputs: ${(sub.outputs ?? []).map((o) => o.name).join(' | ')}`)
  for (const node of sub.nodes ?? []) {
    console.log(`    - #${node.id} ${node.type} ${JSON.stringify(node.widgets_values ?? null)}`)
  }
}

const ids = new Set(subs.map((sub) => sub.id))
for (const node of wf.nodes ?? []) {
  if (!ids.has(node.type)) continue
  console.log(`  instance #${node.id} -> subgraph ${node.type}`)
  console.log(`    inputs: ${(node.inputs ?? []).map((i) => `${i.name}=${JSON.stringify(i.link)}`).join(' | ')}`)
  console.log(`    outputs: ${(node.outputs ?? []).map((o) => `${o.name}=${JSON.stringify(o.links)}`).join(' | ')}`)
  console.log(`    widgets: ${JSON.stringify(node.widgets_values ?? null)}`)
}
