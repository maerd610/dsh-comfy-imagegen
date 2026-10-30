/**
 * dsh-comfy-imagegen — the ComfyUI protocol client.
 *
 * One socket, not two, and it is opened once. ComfyUI keys its event fan-out on
 * `client_id` and keeps exactly one socket per id: `server.py` does
 * `self.sockets[sid] = ws` after popping any previous socket with the same
 * `clientId`, and every `progress` / `execution_*` frame is addressed to
 * `server_instance.client_id` — the id the `/prompt` request carried. Two
 * sockets sharing that id therefore take turns evicting each other, which is
 * why an image generator that "cannot see progress" usually just has a second
 * socket open.
 *
 * So this client owns the only socket, publishes what arrives as events
 * (`progress`, `preview`, `execution`, `status`, `open`, `close`), and keeps the
 * last sampler tick and the last latent preview per prompt id. Completion still
 * comes from `/history` polling: the docs are explicit that the stream is for
 * rendering progress and that polling is authoritative, and ComfyUI drops a
 * socket in the middle of a long run often enough that trusting the stream
 * would hang the tool.
 *
 * The socket is also how preview frames arrive — `PREVIEW_IMAGE_WITH_METADATA`
 * binary frames carrying the sampler's current latent, which is what makes a
 * 60-second wait show the picture growing instead of a spinner.
 */

const SOCKET_OPEN_TIMEOUT_MS = 5000
const SOCKET_RECONNECT_MAX_MS = 15000
const HISTORY_POLL_MS = 600
/** A preview frame is a resized latent, but never let a stray frame sit in memory. */
const PREVIEW_BYTES_MAX = 8 * 1024 * 1024

/** Binary frame tags, from ComfyUI's `protocol.py`. */
const BINARY_PREVIEW_IMAGE = 1
const BINARY_PREVIEW_IMAGE_WITH_METADATA = 4

export class ComfyError extends Error {
  constructor(message, { status, body, promptId } = {}) {
    super(message)
    this.name = 'ComfyError'
    this.status = status
    this.body = body
    this.promptId = promptId ?? (body !== null && typeof body === 'object' ? body.prompt_id : undefined)
  }
}

/**
 * ComfyUI rejects a bad graph with `{error, node_errors}`, but `error` is often
 * a nested object and the useful sentence is buried in a node's validation
 * error. Flatten it into something a person can read.
 */
export function describePromptError(body) {
  const parts = []
  const collect = (value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      parts.push(value.trim())
      return
    }
    if (value !== null && typeof value === 'object') {
      if (typeof value.message === 'string') parts.push(value.message)
      if (typeof value.details === 'string' && value.details !== value.message) parts.push(`（${value.details}）`)
    }
  }
  collect(body?.error)
  const nodeErrors = body?.node_errors
  if (nodeErrors !== null && typeof nodeErrors === 'object') {
    for (const [nodeId, entry] of Object.entries(nodeErrors)) {
      const errors = Array.isArray(entry?.errors) ? entry.errors : []
      for (const error of errors) {
        const message = typeof error?.message === 'string' ? error.message : String(error?.message ?? '')
        const details = typeof error?.details === 'string' && error.details !== '' ? `（${error.details}）` : ''
        if (message !== '') parts.push(`节点 ${nodeId}：${message}${details}`)
      }
    }
  }
  const unique = [...new Set(parts.filter((part) => part !== ''))]
  return unique.length > 0 ? unique.join('；') : 'ComfyUI 拒绝了这次请求，没有给出原因'
}

/** A history entry is finished when it says so, or has outputs and no status. */
function isFinished(entry) {
  if (entry === null || typeof entry !== 'object') return false
  const status = entry.status
  if (status !== null && typeof status === 'object') {
    if (status.completed === true) return true
    if (status.status_str === 'success' || status.status_str === 'error') return true
  }
  const outputs = entry.outputs
  return outputs !== null && typeof outputs === 'object' && Object.keys(outputs).length > 0
}

/** Pull the human sentence out of a failed history entry. */
function describeHistoryError(entry) {
  const messages = entry?.status?.messages
  if (Array.isArray(messages)) {
    for (const [kind, payload] of messages) {
      if (kind !== 'execution_error' && kind !== 'execution_interrupted') continue
      const message = payload?.exception_message ?? payload?.type ?? kind
      return String(message).trim()
    }
  }
  return '执行失败'
}

export class ComfyClient {
  #baseUrl
  #clientId
  #socket
  #reconnectTimer
  #reconnectDelay = 500
  #wantSocket = false
  #closed = false
  #listeners = new Map()
  #runs = new Map()
  #lastPromptId

  constructor({ baseUrl, clientId } = {}) {
    this.#baseUrl = String(baseUrl ?? 'http://127.0.0.1:8188').replace(/\/+$/, '')
    this.#clientId = typeof clientId === 'string' && clientId !== '' ? clientId : (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
  }

  get baseUrl() {
    return this.#baseUrl
  }

  /** The id every socket and every `/prompt` body must share. */
  get clientId() {
    return this.#clientId
  }

  get connected() {
    return this.#socket !== undefined && this.#socket.readyState === 1
  }

  get socketUrl() {
    const url = new URL(this.#baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = `?clientId=${encodeURIComponent(this.#clientId)}`
    return url.toString()
  }

  // --- events ---------------------------------------------------------------

  /** Subscribe to `progress` | `preview` | `execution` | `status` | `open` | `close` | `message`. */
  on(type, listener) {
    let set = this.#listeners.get(type)
    if (set === undefined) {
      set = new Set()
      this.#listeners.set(type, set)
    }
    set.add(listener)
    return () => set.delete(listener)
  }

  #emit(type, payload) {
    const set = this.#listeners.get(type)
    if (set === undefined) return
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch {
        // A listener that throws must not take the socket down with it.
      }
    }
  }

  // --- per-prompt state -----------------------------------------------------

  #run(promptId) {
    const id = String(promptId)
    let run = this.#runs.get(id)
    if (run === undefined) {
      run = { promptId: id, phase: 'pending' }
      this.#runs.set(id, run)
    }
    return run
  }

  /** Register a run before it has a tick, so `phase` reads sensibly from the start. */
  track(promptId, meta = {}) {
    const run = this.#run(promptId)
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined) run[key] = value
    }
    return run
  }

  progress(promptId) {
    const run = this.#runs.get(String(promptId))
    if (run === undefined || !Number.isFinite(run.value) || !Number.isFinite(run.max) || run.max <= 0) return undefined
    return { value: run.value, max: run.max, node: run.node, at: run.at }
  }

  /** The newest latent preview for a run: `{bytes, mime, at, node}`. */
  preview(promptId) {
    return this.#runs.get(String(promptId))?.preview
  }

  phase(promptId) {
    return this.#runs.get(String(promptId))?.phase
  }

  forget(promptId) {
    this.#runs.delete(String(promptId))
  }

  // --- socket ---------------------------------------------------------------

  /**
   * Open the socket if it is not open yet. Safe to call on every submit: the
   * point of a single long-lived socket is that the server already knows this
   * client id before the work starts, so no `progress` frame is lost to a race.
   */
  #ensureSocket() {
    this.#wantSocket = true
    if (this.#closed || this.#socket !== undefined) return
    if (typeof WebSocket !== 'function') {
      // Polling still works; progress simply stays unknown on this host.
      this.#emit('close', { url: this.socketUrl, reason: 'no WebSocket' })
      return
    }
    let socket
    try {
      socket = new WebSocket(this.socketUrl)
    } catch (error) {
      this.#emit('close', { url: this.socketUrl, reason: String(error?.message ?? error) })
      this.#scheduleReconnect()
      return
    }
    socket.binaryType = 'arraybuffer'
    this.#socket = socket

    const openTimer = setTimeout(() => {
      if (this.#socket === socket && socket.readyState !== 1) {
        try {
          socket.close()
        } catch {
          // Already closing.
        }
      }
    }, SOCKET_OPEN_TIMEOUT_MS)

    socket.addEventListener('open', () => {
      clearTimeout(openTimer)
      this.#reconnectDelay = 500
      // Tell the server this client can read previews that name their prompt.
      // It has to be the first message: the server only honours it then.
      try {
        socket.send(JSON.stringify({ type: 'feature_flags', data: { supports_preview_metadata: true } }))
      } catch {
        // The socket closed between open and send.
      }
      this.#emit('open', { url: this.socketUrl })
    })

    socket.addEventListener('message', (event) => {
      const data = event?.data
      if (typeof data === 'string') {
        this.#handleText(data)
        return
      }
      if (data instanceof ArrayBuffer) {
        this.#handleBinary(data)
        return
      }
      if (ArrayBuffer.isView(data)) {
        this.#handleBinary(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        return
      }
      if (data !== null && typeof data?.arrayBuffer === 'function') {
        data.arrayBuffer().then((buffer) => this.#handleBinary(buffer)).catch(() => {})
      }
    })

    socket.addEventListener('close', () => {
      clearTimeout(openTimer)
      if (this.#socket === socket) this.#socket = undefined
      this.#emit('close', { url: this.socketUrl })
      this.#scheduleReconnect()
    })

    // `error` is always followed by `close`; nothing to do but stay quiet.
    socket.addEventListener('error', () => {})
  }

  #scheduleReconnect() {
    if (this.#closed || !this.#wantSocket || this.#reconnectTimer !== undefined) return
    const delay = this.#reconnectDelay
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, SOCKET_RECONNECT_MAX_MS)
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      this.#ensureSocket()
    }, delay)
    // Never keep the process alive just to retry a socket.
    this.#reconnectTimer?.unref?.()
  }

  #handleText(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    const type = typeof message?.type === 'string' ? message.type : ''
    const data = message?.data

    if (type === 'status') {
      this.#emit('status', { queueRemaining: data?.status?.exec_info?.queue_remaining, sid: data?.sid })
      return
    }
    if (type === 'progress') {
      this.#noteProgress(data)
      return
    }
    if (type === 'execution_start') {
      const promptId = String(data?.prompt_id ?? '')
      if (promptId !== '') {
        const run = this.#run(promptId)
        run.phase = 'running'
        run.startedAt ??= Date.now()
      }
      this.#emit('execution', { state: 'start', promptId })
      return
    }
    if (type === 'execution_cached') {
      this.#emit('execution', { state: 'cached', promptId: String(data?.prompt_id ?? ''), nodes: data?.nodes })
      return
    }
    if (type === 'executing') {
      const promptId = String(data?.prompt_id ?? '')
      const node = data?.node
      if (node === null || node === undefined) {
        if (promptId !== '') this.#run(promptId).phase = 'done'
        this.#emit('execution', { state: 'end', promptId })
      } else {
        if (promptId !== '') this.#run(promptId).node = String(node)
        this.#emit('execution', { state: 'node', promptId, node: String(node) })
      }
      return
    }
    if (type === 'execution_error') {
      const promptId = String(data?.prompt_id ?? '')
      const message = String(data?.exception_message ?? data?.exception_type ?? '执行失败').trim()
      if (promptId !== '') this.#run(promptId).phase = 'error'
      this.#emit('execution', { state: 'error', promptId, message, detail: data })
      return
    }
    if (type === 'execution_success') {
      const promptId = String(data?.prompt_id ?? '')
      if (promptId !== '') this.#run(promptId).phase = 'done'
      this.#emit('execution', { state: 'success', promptId })
      return
    }
    if (type === 'executed') {
      this.#emit('execution', { state: 'node-done', promptId: String(data?.prompt_id ?? ''), node: String(data?.node ?? ''), output: data?.output })
      return
    }
    if (type === 'progress_state') {
      // Newer servers also broadcast a full snapshot; per-node ticks are enough.
      return
    }
    this.#emit('message', message)
  }

  #noteProgress(data) {
    const promptId = String(data?.prompt_id ?? '')
    if (promptId === '') return
    const run = this.#run(promptId)
    const value = Number(data?.value)
    const max = Number(data?.max)
    if (Number.isFinite(value)) run.value = value
    if (Number.isFinite(max)) run.max = max
    if (data?.node !== undefined && data?.node !== null) run.node = String(data.node)
    run.at = Date.now()
    if (run.phase !== 'done') run.phase = 'running'
    this.#emit('progress', { promptId, value: run.value, max: run.max, node: run.node, at: run.at })
  }

  #handleBinary(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) return
    const view = new DataView(buffer)
    const eventType = view.getUint32(0)

    if (eventType === BINARY_PREVIEW_IMAGE_WITH_METADATA) {
      const metaLength = view.getUint32(4)
      if (8 + metaLength > buffer.byteLength) return
      let meta
      try {
        meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, metaLength)))
      } catch {
        return
      }
      const bytes = new Uint8Array(buffer, 8 + metaLength).slice()
      const promptId = String(meta?.prompt_id ?? this.#lastPromptId ?? '')
      const mime = typeof meta?.image_type === 'string' ? meta.image_type : 'image/jpeg'
      this.#notePreview(promptId, bytes, mime, meta)
      return
    }

    if (eventType === BINARY_PREVIEW_IMAGE) {
      const imageType = view.getUint32(4)
      const bytes = new Uint8Array(buffer, 8).slice()
      this.#notePreview(String(this.#lastPromptId ?? ''), bytes, imageType === 2 ? 'image/png' : 'image/jpeg', {})
    }
  }

  #notePreview(promptId, bytes, mime, meta) {
    if (promptId === '' || bytes.byteLength === 0 || bytes.byteLength > PREVIEW_BYTES_MAX) return
    const run = this.#run(promptId)
    run.preview = {
      bytes,
      mime,
      at: Date.now(),
      node: meta?.node_id === undefined || meta.node_id === null ? undefined : String(meta.node_id),
    }
    this.#emit('preview', { promptId, mime, bytes: bytes.byteLength, at: run.preview.at })
  }

  // --- HTTP -----------------------------------------------------------------

  async #json(path, init = {}) {
    const url = `${this.#baseUrl}${path}`
    const { timeoutMs = 30000, signal, ...rest } = init
    const headers = { accept: 'application/json', ...(rest.body === undefined ? {} : { 'content-type': 'application/json' }), ...rest.headers }
    let response
    try {
      response = await fetch(url, {
        ...rest,
        headers,
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new ComfyError(`连不上 ComfyUI（${url}）：${error?.cause?.message ?? error?.message ?? error}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let body
      try {
        body = text === '' ? undefined : JSON.parse(text)
      } catch {
        body = undefined
      }
      throw new ComfyError(describePromptError(body ?? text), { status: response.status, body })
    }
    if (response.status === 204) return undefined
    const text = await response.text()
    if (text === '') return undefined
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  systemStats() {
    return this.#json('/system_stats')
  }

  objectInfo() {
    return this.#json('/object_info', { timeoutMs: 120000 })
  }

  models() {
    return this.#json('/models')
  }

  queue() {
    return this.#json('/queue')
  }

  historyEntry(promptId) {
    return this.#json(`/history/${encodeURIComponent(promptId)}`).then((all) => all?.[promptId])
  }

  /** Submit a graph. `client_id` must match the socket, or progress goes nowhere. */
  async submit(graph) {
    const body = await this.#json('/prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: graph, client_id: this.#clientId }),
      timeoutMs: 60000,
    })
    const promptId = body?.prompt_id
    if (typeof promptId !== 'string' || promptId === '') {
      throw new ComfyError('ComfyUI 没有返回 prompt_id', { body })
    }
    this.#lastPromptId = promptId
    this.#run(promptId).phase = 'pending'
    // Open the socket after the server has this id queued: the first progress
    // frame then has somewhere to land, and reconnects reuse the same id.
    this.#ensureSocket()
    return promptId
  }

  /**
   * Wait for a prompt to finish. `onProgress` and `onPreview` are conveniences
   * over the event bus; completion is decided by `/history`, never by the
   * stream, because a dropped socket must not look like a finished job.
   */
  wait(promptId, { timeoutMs = 900_000, signal, onProgress, onPreview, pollMs = HISTORY_POLL_MS } = {}) {
    const id = String(promptId)
    const startedAt = Date.now()
    this.#ensureSocket()

    const offs = []
    if (typeof onProgress === 'function') {
      offs.push(this.on('progress', (event) => {
        if (event.promptId === id) onProgress({ value: event.value, max: event.max, node: event.node })
      }))
    }
    if (typeof onPreview === 'function') {
      offs.push(this.on('preview', (event) => {
        if (event.promptId === id) onPreview(this.preview(id))
      }))
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let timer
      let abortListener

      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        for (const off of offs) off()
        if (signal !== undefined && abortListener !== undefined) signal.removeEventListener('abort', abortListener)
        fn(value)
      }

      const fail = (error) => settle(reject, error)
      const succeed = (entry) => {
        this.#run(id).phase = 'done'
        settle(resolve, entry)
      }

      if (signal !== undefined) {
        if (signal.aborted === true) {
          fail(new ComfyError(`已取消等待（${id}），任务可能仍在 ComfyUI 里跑`, { promptId: id }))
          return
        }
        abortListener = () => fail(new ComfyError(`已取消等待（${id}），任务可能仍在 ComfyUI 里跑`, { promptId: id }))
        signal.addEventListener('abort', abortListener, { once: true })
      }

      // The stream shortens the wait; it never decides the outcome.
      const offExecution = this.on('execution', (event) => {
        if (event.promptId !== id) return
        if (event.state === 'error') {
          fail(new ComfyError(`执行失败：${event.message ?? '未知原因'}`, { promptId: id, body: event.detail }))
          return
        }
        if (event.state === 'end' || event.state === 'success') void read()
      })
      offs.push(offExecution)

      const read = async () => {
        if (settled) return
        const elapsed = Date.now() - startedAt
        if (elapsed > timeoutMs) {
          fail(new ComfyError(`等待超时（${id}），已等 ${Math.round(elapsed / 1000)} 秒，任务可能仍在排队或模型太大`, { promptId: id }))
          return
        }
        let entry
        try {
          entry = await this.historyEntry(id)
        } catch {
          entry = undefined
        }
        if (settled) return
        if (entry !== undefined && entry !== null) {
          const status = entry.status?.status_str
          if (status === 'error') {
            fail(new ComfyError(`执行失败：${describeHistoryError(entry)}`, { promptId: id, body: entry.status }))
            return
          }
          if (isFinished(entry)) {
            succeed(entry)
            return
          }
        }
        timer = setTimeout(() => { void read() }, pollMs)
        timer?.unref?.()
      }

      void read()
    })
  }

  static images(entry) {
    const outputs = entry?.outputs
    if (outputs === null || typeof outputs !== 'object') return []
    const images = []
    for (const [node, output] of Object.entries(outputs)) {
      const list = output?.images
      if (!Array.isArray(list)) continue
      for (const image of list) {
        if (typeof image?.filename !== 'string') continue
        images.push({ node, filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' })
      }
    }
    return images
  }

  viewUrl(image) {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    })
    return `${this.#baseUrl}/view?${query.toString()}`
  }

  async fetchImage(image) {
    const response = await fetch(this.viewUrl(image))
    if (!response.ok) throw new ComfyError(`取图失败（HTTP ${response.status}）：${image.filename}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async uploadImage(bytes, filename) {
    const form = new FormData()
    form.append('image', new Blob([bytes]), filename)
    form.append('overwrite', 'true')
    const body = await this.#json('/upload/image', { method: 'POST', body: form, timeoutMs: 60000 })
    if (typeof body?.name !== 'string' || body.name === '') {
      throw new ComfyError('上传失败：ComfyUI 没有返回文件名', { body })
    }
    return { name: body.name, subfolder: body.subfolder ?? '', type: body.type ?? 'input' }
  }

  interrupt() {
    return this.#json('/interrupt', { method: 'POST', body: '{}' })
  }

  cancelQueued(promptId) {
    return this.#json('/queue', { method: 'POST', body: JSON.stringify({ delete: [promptId] }) })
  }

  /** Drop the socket and stop reconnecting. */
  close() {
    this.#closed = true
    this.#wantSocket = false
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    const socket = this.#socket
    this.#socket = undefined
    if (socket !== undefined) {
      try {
        socket.close()
      } catch {
        // Nothing left to close.
      }
    }
  }
}

export default ComfyClient
