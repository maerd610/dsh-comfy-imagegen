/**
 * Host-free smoke test: drives the plugin exactly the way the tool registry
 * does, without starting DeepSeek Harness.
 *
 *   node scripts/smoke.mjs                     # capabilities only
 *   node scripts/smoke.mjs --generate 'prompt' # one real generation
 */
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'

const args = process.argv.slice(2)
const generateAt = args.indexOf('--generate')
const prompt = generateAt === -1 ? undefined : args[generateAt + 1]

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
})
console.error(`registered: ${[...registered.keys()].join(', ')}`)

const capabilities = registered.get('image_capabilities')
const report = await capabilities.execute({})
console.log(capabilities.output.render({}, report).map((block) => block.text).join('\n'))

if (prompt !== undefined) {
  const generate = registered.get('image_generate')
  const startedAt = Date.now()
  const result = await generate.execute({
    prompt,
    purpose: args.includes('--purpose') ? args[args.indexOf('--purpose') + 1] : undefined,
    template: args.includes('--template') ? args[args.indexOf('--template') + 1] : undefined,
    image: args.includes('--image') ? args[args.indexOf('--image') + 1] : undefined,
    size: args.includes('--size') ? args[args.indexOf('--size') + 1] : undefined,
    batch: args.includes('--batch') ? Number(args[args.indexOf('--batch') + 1]) : 1,
  })
  console.log(JSON.stringify(result, null, 2))
  console.log(generate.output.render({}, result).map((block) => block.text).join('\n'))
  console.error(`wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

// The progress socket keeps the event loop alive; the host tears it down via ctx.effect.
process.exit(0)

