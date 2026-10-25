/**
 * Step progress for whatever ComfyUI is currently sampling.
 *
 * The server broadcasts every sampler tick on its websocket, one `progress`
 * message per step, tagged with the prompt id. A single long-lived socket is
 * therefore enough to know how far *any* queued job is — no per-call socket,
 * and the number survives the moment the tool's own wait() turns its own
 * socket off.
 *
 * This is decoration only: nothing here decides whether a run finished. When
 * the socket is down the card falls back to an indeterminate bar.
 */

const RETRY_MS = 3000

export class ProgressTracker {
  /** promptId → { value, max, node, at } */
  progress = new Map()

  #url
  #socket
  #retryTimer
  #stopped = false

  /** @param {string} url websocket URL including the `clientId` query */
  constructor(url) {
    this.#url = url
    this.#connect()
  }

  /** Latest step report for one prompt, or undefined while it has not started sampling. */
  get(promptId) {
    return this.progress.get(promptId)
  }

  /** Drop one prompt's record so a reused id cannot inherit a stale percentage. */
  forget(promptId) {
    this.progress.delete(promptId)
  }

  dispose() {
    this.#stopped = true
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer)
    this.#retryTimer = undefined
    const socket = this.#socket
    this.#socket = undefined
    try {
      socket?.close()
    } catch {
      // A socket that never opened has nothing to clean up.
    }
    this.progress.clear()
  }

  #connect() {
    if (this.#stopped) return
    let socket
    try {
      socket = new WebSocket(this.#url)
    } catch {
      // WebSocket missing (very old Node) — progress stays empty, that is all.
      return
    }
    this.#socket = socket
    const lost = () => {
      if (this.#socket === socket) this.#socket = undefined
      this.#scheduleRetry()
    }
    socket.addEventListener('message', (event) => this.#onMessage(event))
    socket.addEventListener('close', lost)
    socket.addEventListener('error', lost)
  }

  #onMessage(event) {
    if (typeof event.data !== 'string') return // binary preview frames
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    const data = message?.data
    if (message?.type !== 'progress' || typeof data?.value !== 'number' || typeof data?.prompt_id !== 'string') return
    this.progress.set(data.prompt_id, {
      value: data.value,
      max: typeof data.max === 'number' && data.max > 0 ? data.max : undefined,
      node: typeof data.node === 'string' ? data.node : undefined,
      at: Date.now(),
    })
  }

  #scheduleRetry() {
    if (this.#stopped || this.#retryTimer !== undefined) return
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      this.#connect()
    }, RETRY_MS)
    this.#retryTimer.unref?.()
  }
}
