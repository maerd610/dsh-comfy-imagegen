/**
 * Patch the human-facing metadata of already-converted templates.
 *
 * `convert.mjs` produces the graph and slots mechanically; what a template is
 * *for* is editorial, so it lives here and is merged in place (key order is
 * preserved and the graph is untouched).
 *
 *   node scripts/annotate.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../templates/', import.meta.url)

const META = {
  anima_t2i: {
    label: 'Anima 动漫',
    strengths: ['二次元', '角色插画', '动漫'],
    purposes: ['anime'],
    dialect: 'caption',
    notes: 'CircleStone Labs 的 2B 动漫模型，1760x1224 原生横幅，适合角色插画与日系风格。',
  },
  krea2_t2i: {
    label: 'Krea 2 质感',
    strengths: ['艺术质感', '风格化', '写真'],
    purposes: ['art'],
    dialect: 'caption',
    notes: '美学与风格控制见长，1160x1968 竖幅，带 Detailer-KREA2 LoRA。无负向提示词输入。',
  },
  qwen_t2i: {
    label: 'Qwen-Image 2.1 文字',
    strengths: ['文字', '海报', '排版'],
    purposes: ['typography'],
    dialect: 'caption',
    notes: '文字渲染与排版最强，1144x1328 竖幅，适合海报、封面、带字画面。',
  },
  moss_t2i: {
    label: 'MOSS 版式',
    strengths: ['版式', '中文文字', '构图'],
    purposes: ['layout'],
    dialect: 'layout-json',
    notes: '支持自然语言/标签序列/JSON layout（bbox 控位置），1120x1552 竖幅，中文文字分组整齐。',
  },
  qwen_edit: {
    label: 'Qwen 改图',
    strengths: ['改图', '参考图', '身份保持'],
    purposes: ['edit'],
    dialect: 'caption',
    notes: '需要一张源图（image 参数）；输出沿用源图长宽比。提示词用「改成…/保留…」并写 <image1> 指代源图。',
  },
}

for (const name of readdirSync(DIR)) {
  if (!name.endsWith('.json')) continue
  const path = join(DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1'), name)
  const template = JSON.parse(readFileSync(path, 'utf8'))
  const meta = META[template.id]
  if (meta === undefined) {
    console.log(`- ${template.id}: 无元数据，跳过`)
    continue
  }
  const next = {}
  for (const key of Object.keys(template)) {
    if (key === 'label' || key === 'strengths' || key === 'dialect' || key === 'purposes' || key === 'notes') continue
    next[key] = template[key]
    if (key === 'id') Object.assign(next, {
      label: meta.label,
      strengths: meta.strengths,
      purposes: meta.purposes,
      dialect: meta.dialect,
      notes: meta.notes,
    })
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✓ ${template.id} → ${meta.label}`)
}
