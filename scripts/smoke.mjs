/**
 * Host-free self-check: drives the plugin exactly the way the tool registry
 * does, without starting DeepSeek Harness.
 *
 *   node scripts/smoke.mjs                     # capabilities only
 *   node scripts/smoke.mjs --verbose           # …plus knobs, defaults, models
 *   node scripts/smoke.mjs --generate 'prompt' # one real generation
 *   node scripts/smoke.mjs --generate 'prompt' --params '{"steps":12}'
 */
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'

const args = process.argv.slice(2)
const generateAt = args.indexOf('--generate')
const prompt = generateAt === -1 ? undefined : args[generateAt + 1]
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const registered = new Map()
const ctx = {
  effect(run) { return run() },
  // Without a host there is no webserver to mount the status route on; the card
  // is decoration, so the tool must still work with `inject` never firing.
  inject() {},
  tools: { register(definition) { registered.set(definition.name, definition); return () => {} } },
}
apply(ctx, {
  baseUrl: process.env.COMFY_URL ?? 'http://127.0.0.1:8188',
  outputDir: fileURLToPath(new URL('../.cache/out/', import.meta.url)),
  ...(value('--template-dir') === undefined ? {} : { templateDirs: [value('--template-dir')] }),
})
console.error(`registered: ${[...registered.keys()].join(', ')}`)

const capabilities = registered.get('image_capabilities')
const verbose = args.includes('--verbose')
const report = await capabilities.execute({ verbose })
console.log(capabilities.output.render({ verbose }, report).map((block) => block.text).join('\n'))

if (prompt !== undefined) {
  const generate = registered.get('image_generate')
  const startedAt = Date.now()
  const result = await generate.execute({
    prompt,
    purpose: value('--purpose'),
    template: value('--template'),
    image: value('--image'),
    size: value('--size'),
    seed: value('--seed') === undefined ? undefined : Number(value('--seed')),
    batch: value('--batch') === undefined ? 1 : Number(value('--batch')),
    params: value('--params') === undefined ? undefined : JSON.parse(value('--params')),
  })
  console.log(JSON.stringify(result, null, 2))
  console.log(generate.output.render({}, result).map((block) => block.text).join('\n'))
  console.error(`wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

// The progress socket keeps the event loop alive; the host tears it down via ctx.effect.
process.exit(0)
