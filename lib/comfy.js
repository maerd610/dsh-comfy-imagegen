/**
 * Thin ComfyUI client: submit / wait / fetch image / upload image.
 *
 * Deliberately zero-dependency: Node 22.19+ ships global `fetch` and global
 * `WebSocket`, and we only need five endpoints:
 *   POST /prompt · WS /ws?clientId= · GET /history/{id} · GET /view · POST /upload/image
 *
 * The flow is the one ComfyUI's own api-examples mark as Recommended:
 *   one clientId shared by HTTP and WS → POST /prompt → wait for
 *   `executing` with `node === null` and a matching prompt_id → read
 *   /history output slots → download bytes from /view.
 */

const WS_TIMEOUT_MS = 5000

const DEBUG = process.env.DSH_IMAGEGEN_DEBUG === '1'
const DEBUG_T0 = Date.now()
function debug(...parts) {
  if (DEBUG) {
    const at = ((Date.now() - DEBUG_T0) / 1000).toFixed(2)
    console.error(`[imagegen +${at}s]`, ...parts)
  }
}

export class ComfyError extends Error {
  constructor(message, { status, body } = {}) {
    super(message)
    this.name = 'ComfyError'
    this.status = status
    this.body = body
  }
}

/** Turn a /prompt rejection body into a human sentence the agent can act on. */
function describePromptError(body) {
  const parts = []
  if (typeof body?.error === 'string') parts.push(body.error)
  else if (body?.error?.message) parts.push(body.error.message)
  const nodeErrors = body?.node_errors
  if (nodeErrors && typeof nodeErrors === 'object') {
    for (const [nodeId, info] of Object.entries(nodeErrors)) {
      const errors = Array.isArray(info?.errors) ? info.errors : []
      for (const error of errors) {
        const detail = error?.details ? `（${error.details}）` : ''
        parts.push(`节点 ${nodeId} ${info?.class_type ?? ''}: ${error?.message ?? '未知错误'}${detail}`)
      }
    }
  }
  return parts.length > 0 ? parts.join('；') : 'ComfyUI 拒绝了这次请求，没有给出原因'
}

export class ComfyClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl  e.g. http://127.0.0.1:8188
   * @param {string} [options.clientId]
   */
  constructor({ baseUrl, clientId }) {
    this.baseUrl = String(baseUrl ?? 'http://127.0.0.1:8188').replace(/\/+$/, '')
    this.clientId = clientId ?? globalThis.crypto.randomUUID()
    /** Absolute URL of the last error-free websocket attempt; null when WS is unusable. */
    this.wsUrl = null
  }

  /** WebSocket URL for this client id (same query value the HTTP calls use). */
  get socketUrl() {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = `?clientId=${encodeURIComponent(this.clientId)}`
    return url.toString()
  }

  async #json(path, init) {
    let response
    try {
      response = await fetch(`${this.baseUrl}${path}`, init)
    } catch (cause) {
      throw new ComfyError(`连不上 ComfyUI（${this.baseUrl}${path}）：${cause?.message ?? cause}`, { body: cause })
    }
    const text = await response.text()
    let body
    try {
      body = text === '' ? undefined : JSON.parse(text)
    } catch {
      body = text
    }
    if (!response.ok) {
      throw new ComfyError(describePromptError(body) || `HTTP ${response.status}`, { status: response.status, body })
    }
    return body
  }

  /** Server liveness + queue depth, used by the plugin's startup self-check. */
  async systemStats() {
    return this.#json('/system_stats')
  }

  async objectInfo() {
    return this.#json('/object_info')
  }

  /** Model file lists, keyed by folder (`checkpoints`, `loras`, `diffusion_models`, …). */
  async models() {
    return this.#json('/models')
  }

  /** @returns {Promise<string>} prompt_id */
  async submit(graph) {
    const body = await this.#json('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: this.clientId }),
    })
    if (typeof body?.prompt_id !== 'string') {
      throw new ComfyError('ComfyUI 没有返回 prompt_id', { body })
    }
    return body.prompt_id
  }

  /**
   * Wait for a prompt to finish.
   *
   * Correctness comes from polling `/history`; the websocket only accelerates
   * completion and supplies progress. That ordering matters: polling also
   * covers "finished before the socket opened" and servers where the socket
   * stays open without ever reporting the end.
   * @param {string} promptId
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {AbortSignal} [options.signal] cancels the wait (the server-side run is left alone)
   * @param {(progress: {value:number,max:number,node?:string}) => void} [options.onProgress]
   * @returns {Promise<object>} the /history entry (`{ outputs, status, … }`)
   */
  async wait(promptId, { timeoutMs = 900000, signal, onProgress } = {}) {
    const budgetMs = Number(timeoutMs)
    const deadline = Date.now() + budgetMs
    const controller = new AbortController()
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    let watcherSettled = false
    const watcher = this.#watch(promptId, controller.signal, onProgress).then(
      (entry) => {
        watcherSettled = true
        return entry
      },
      (error) => {
        watcherSettled = true
        debug('ws watcher failed:', error?.message)
        this.wsUrl = null
        return undefined
      },
    )
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted === true) throw new ComfyError(`已取消等待（${promptId}），任务可能仍在 ComfyUI 里跑`)
        const entry = await this.historyEntry(promptId)
        if (entry !== undefined && isFinished(entry)) return entry
        if (watcherSettled) await sleep(1000)
        else await Promise.race([sleep(400), watcher])
      }
      throw new ComfyError(`等待超时（${promptId}），已等 ${Math.round(budgetMs / 1000)} 秒，任务可能仍在排队或模型太大`)
    } finally {
      signal?.removeEventListener('abort', onOuterAbort)
      controller.abort()
      await watcher
    }
  }

  /** The `/history` entry for one prompt, or `undefined` while it is still running. */
  async historyEntry(promptId) {
    const history = await this.#json(`/history/${encodeURIComponent(promptId)}`)
    return history?.[promptId]
  }

  /**
   * Watch one prompt over the websocket: report progress, resolve once the run
   * ends. Rejects only when the socket cannot be established at all; aborting
   * resolves it, and the poller in {@link wait} stays the source of truth.
   */
  #watch(promptId, signal, onProgress) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.socketUrl)
      let opened = false
      let settled = false
      const settle = (fn) => {
        if (settled) return
        settled = true
        clearTimeout(openTimer)
        signal.removeEventListener('abort', onAbort)
        socket.removeEventListener('message', onMessage)
        socket.removeEventListener('error', onError)
        socket.removeEventListener('close', onClose)
        try {
          socket.close()
        } catch {
          /* already closing */
        }
        fn()
      }
      const openTimer = setTimeout(() => {
        if (!opened) settle(() => reject(new ComfyError('WebSocket 连接超时')))
      }, WS_TIMEOUT_MS)
      const onAbort = () => settle(() => resolve(undefined))
      const onError = () => settle(() => reject(new ComfyError('WebSocket 连接失败')))
      const onClose = () => settle(() => resolve(undefined))
      const finish = () => {
        void this.historyEntry(promptId)
          .then((entry) => settle(() => resolve(entry)))
          .catch((error) => settle(() => reject(error)))
      }
      const onMessage = (event) => {
        if (typeof event.data !== 'string') return // binary preview frames
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        const data = message?.data ?? {}
        switch (message?.type) {
          case 'progress':
            onProgress?.({ value: Number(data.value) || 0, max: Number(data.max) || 0, node: data.node })
            return
          case 'executing':
            if (data.node === null && (data.prompt_id === undefined || data.prompt_id === promptId)) finish()
            return
          case 'execution_error':
            if (data.prompt_id !== undefined && data.prompt_id !== promptId) return
            settle(() => reject(new ComfyError(`执行失败：${data.exception_message ?? data.exception_type ?? '未知错误'}`)))
            return
          case 'execution_success':
            if (data.prompt_id !== undefined && data.prompt_id !== promptId) return
            finish()
            return
          default:
        }
      }
      socket.addEventListener('open', () => {
        opened = true
        this.wsUrl = this.socketUrl
        debug('ws open')
        // `executing` may already have fired before this socket existed.
        void this.historyEntry(promptId).then((entry) => {
          if (entry !== undefined && isFinished(entry)) settle(() => resolve(entry))
        }, () => {})
      })
      socket.addEventListener('message', onMessage)
      socket.addEventListener('error', onError)
      socket.addEventListener('close', onClose)
      signal.addEventListener('abort', onAbort)
    })
  }

  /** Every image slot the run produced, in node order. */
  static images(entry) {
    const images = []
    for (const [nodeId, output] of Object.entries(entry?.outputs ?? {})) {
      for (const image of Array.isArray(output?.images) ? output.images : []) {
        if (typeof image?.filename !== 'string') continue
        images.push({
          node: nodeId,
          filename: image.filename,
          subfolder: image.subfolder ?? '',
          type: image.type ?? 'output',
        })
      }
    }
    return images
  }

  /** Absolute URL that both a browser and this process can fetch. */
  viewUrl({ filename, subfolder = '', type = 'output' }) {
    const params = new URLSearchParams({ filename, subfolder, type })
    return `${this.baseUrl}/view?${params.toString()}`
  }

  /** @returns {Promise<Uint8Array>} */
  async fetchImage(image) {
    const response = await fetch(this.viewUrl(image))
    if (!response.ok) {
      throw new ComfyError(`取图失败（HTTP ${response.status}）：${image.filename}`, { status: response.status })
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  /**
   * Upload a local file into ComfyUI's input folder so LoadImage can see it.
   * @param {Uint8Array} bytes
   * @param {string} filename
   */
  async uploadImage(bytes, filename) {
    const form = new FormData()
    form.append('image', new Blob([bytes]), filename)
    form.append('overwrite', 'true')
    const body = await this.#json('/upload/image', { method: 'POST', body: form })
    if (typeof body?.name !== 'string') throw new ComfyError('上传失败：ComfyUI 没有返回文件名', { body })
    return { name: body.name, subfolder: body.subfolder ?? '', type: body.type ?? 'input' }
  }

  /** Stop what is running; queued prompts need `cancelQueued`. */
  async interrupt() {
    await this.#json('/interrupt', { method: 'POST', body: '' })
  }

  /** Remove a still-queued prompt (`/interrupt` cannot reach those). */
  async cancelQueued(promptId) {
    await this.#json('/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    })
  }
}

function isFinished(entry) {
  const status = entry?.status
  if (status?.completed === true || status?.status_str === 'success') return true
  if (status?.status_str === 'error') return true
  // Older builds write outputs without a status block.
  return status === undefined && entry?.outputs !== undefined && Object.keys(entry.outputs).length > 0
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


