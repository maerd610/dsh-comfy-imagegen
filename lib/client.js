/**
 * dsh-comfy-imagegen — the GUI half of `image_generate`.
 *
 * Two jobs, both decorative:
 *   - while the tool call runs, hold the target aspect ratio open and play a
 *     "developing" frame (dot field, drifting aurora, a scan line that paints an
 *     abstract picture in) so a 50-second wait reads as work, not as a hang;
 *   - once it settles, show the picture itself — blurred into focus — so the
 *     result survives the block collapsing into a header row.
 *
 * Delivered as a `window.__ModuleLoader__` bundle: no build step, no JSX, no
 * runtime dependency beyond the `react` the shell already provides. When this
 * file fails to load, generation and the inline picture are unaffected.
 */
window.__ModuleLoader__.load({
  id: 'dsh-comfy-imagegen',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    const STYLE_ID = 'dsh-comfy-imagegen-styles'

    // Everything structural is inline on purpose: the shell may mount a tool
    // card somewhere the injected sheet cannot reach, and when the sheet was
    // missing the frame collapsed to zero height and images rendered at their
    // natural size. Inline styles survive that; the sheet only adds motion.
    const CARD_STYLE = {
      display: 'flex', flexDirection: 'column', gap: '10px',
      width: '400px', maxWidth: '100%', boxSizing: 'border-box',
      padding: '12px', borderRadius: '14px', border: '1px solid rgba(127,127,127,0.22)',
      background: 'rgba(127,127,127,0.055)', fontSize: '12.5px', color: 'inherit',
    }
    const PICTURE_CARD_STYLE = {
      width: '400px', maxWidth: '100%', boxSizing: 'border-box',
      borderRadius: '12px', overflow: 'hidden', lineHeight: 0,
    }
    const SHOTS_STYLE = { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start' }
    const HEAD_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
    const BADGE_STYLE = {
      display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 8px',
      borderRadius: '999px', background: 'rgba(127,127,127,0.16)', fontWeight: 600, letterSpacing: '0.02em',
    }
    const META_STYLE = { opacity: 0.66, fontVariantNumeric: 'tabular-nums' }
    const STAGE_STYLE = { display: 'flex', justifyContent: 'center' }
    const METER_STYLE = { display: 'flex', alignItems: 'center', gap: '8px' }
    const BAR_STYLE = {
      position: 'relative', flex: '1', height: '4px', borderRadius: '999px', overflow: 'hidden',
      background: 'rgba(127,127,127,0.16)',
    }
    const FILL_STYLE = {
      position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: '999px',
      background: 'linear-gradient(90deg, rgba(122,138,255,0.95), rgba(86,206,255,0.95))',
      boxShadow: '0 0 10px rgba(96,150,255,0.45)', transition: 'width 320ms ease',
    }
    const PCT_STYLE = { width: '34px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }
    const LINES_STYLE = { display: 'flex', flexDirection: 'column', gap: '4px' }

    // Palette stays in alpha space so the same sheet reads correctly on the
    // shell's light and dark themes: amber highlights, violet/teal latent fog.
    const CSS = `
.dsh-comfy-imagegen-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 14px;
  border: 1px solid rgba(127,127,127,0.22); background: rgba(127,127,127,0.055); font-size: 12.5px;
  color: inherit; max-width: 420px; }
.dsh-comfy-imagegen-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-comfy-imagegen-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px;
  background: rgba(127,127,127,0.16); font-weight: 600; letter-spacing: 0.02em; }
.dsh-comfy-imagegen-badge--ok { background: rgba(64,180,120,0.16); color: #2f9c6a; }
.dsh-comfy-imagegen-badge--err { background: rgba(220,80,80,0.16); color: #d15050; }
.dsh-comfy-imagegen-meta { opacity: 0.66; font-variant-numeric: tabular-nums; }
.dsh-comfy-imagegen-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.5;
  animation: dsh-comfy-imagegen-pulse 1.3s ease-in-out infinite; }

/* --- the developing frame ------------------------------------------------ */
.dsh-comfy-imagegen-stage { display: flex; justify-content: center; }
.dsh-comfy-imagegen-frame { position: relative; margin: 0 auto; border-radius: 12px; overflow: hidden;
  background: rgba(18,20,34,0.06); box-shadow: inset 0 0 0 1px rgba(127,127,127,0.18); isolation: isolate; }
.dsh-comfy-imagegen-frame > span { position: absolute; inset: 0; pointer-events: none; }
.dsh-comfy-imagegen-dots { opacity: 0.5;
  background-image: radial-gradient(circle at 1px 1px, rgba(126,136,178,0.55) 1px, transparent 1.2px);
  background-size: 12px 12px; animation: dsh-comfy-imagegen-drift 9s linear infinite; }
.dsh-comfy-imagegen-fog--a { filter: blur(16px);
  background: radial-gradient(circle at 30% 34%, hsla(258,86%,68%,0.52), transparent 62%);
  animation: dsh-comfy-imagegen-fog-a 9.5s ease-in-out infinite alternate; }
.dsh-comfy-imagegen-fog--b { filter: blur(18px);
  background: radial-gradient(circle at 72% 66%, hsla(196,90%,62%,0.46), transparent 60%);
  animation: dsh-comfy-imagegen-fog-b 12s ease-in-out infinite alternate; }
.dsh-comfy-imagegen-fog--c { filter: blur(20px);
  background: radial-gradient(circle at 58% 22%, hsla(38,94%,66%,0.34), transparent 46%);
  animation: dsh-comfy-imagegen-fog-c 7.5s ease-in-out infinite alternate; }
/* the abstract picture the scan line "paints": sun, two ridges, sky */
.dsh-comfy-imagegen-develop {
  background:
    radial-gradient(circle at 68% 30%, hsla(44,96%,80%,0.92) 0 6.5%, transparent 7.2%),
    conic-gradient(from 212deg at 44% 56%, hsla(262,72%,64%,0.82) 0 84deg, transparent 0),
    conic-gradient(from 204deg at 76% 68%, hsla(201,74%,58%,0.78) 0 98deg, transparent 0),
    linear-gradient(hsla(256,62%,72%,0.46), hsla(191,72%,60%,0.3));
  animation: dsh-comfy-imagegen-develop 3.8s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
.dsh-comfy-imagegen-frame .dsh-comfy-imagegen-scan { inset: 0 0 auto 0; height: 2px;
  background: linear-gradient(90deg, transparent, hsla(46,100%,74%,0.95), transparent);
  box-shadow: 0 0 14px 3px hsla(44,96%,70%,0.42);
  animation: dsh-comfy-imagegen-scan 3.8s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
.dsh-comfy-imagegen-vignette { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 -30px 46px -30px rgba(0,0,0,0.28); }

/* --- meter --------------------------------------------------------------- */
.dsh-comfy-imagegen-meter { display: flex; align-items: center; gap: 8px; }
.dsh-comfy-imagegen-bar { position: relative; flex: 1; height: 4px; border-radius: 999px; overflow: hidden;
  background: rgba(127,127,127,0.16); }
.dsh-comfy-imagegen-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit;
  background: linear-gradient(90deg, rgba(122,138,255,0.95), rgba(86,206,255,0.95));
  box-shadow: 0 0 10px rgba(96,150,255,0.45); transition: width 320ms ease; }
.dsh-comfy-imagegen-fill::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 45%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
  animation: dsh-comfy-imagegen-shine 1.5s linear infinite; }
.dsh-comfy-imagegen-fill--idle { width: 32%; animation: dsh-comfy-imagegen-slide 1.6s ease-in-out infinite; }
.dsh-comfy-imagegen-pct { width: 34px; text-align: right; font-variant-numeric: tabular-nums; opacity: 0.7; }
.dsh-comfy-imagegen-lines { display: flex; flex-direction: column; gap: 4px; }

/* --- the finished picture ------------------------------------------------ */
/* Geometry is inline (see Shot); only motion and the hover lift live here. */
.dsh-comfy-imagegen-shot { transition: transform 220ms ease, box-shadow 220ms ease;
  animation: dsh-comfy-imagegen-shot-in 720ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; }
.dsh-comfy-imagegen-shot:hover { transform: translateY(-2px);
  box-shadow: 0 2px 4px rgba(0,0,0,0.12), 0 16px 34px -14px rgba(0,0,0,0.48); }
.dsh-comfy-imagegen-error { color: #d15050; white-space: pre-wrap; }

@keyframes dsh-comfy-imagegen-pulse { 0%, 100% { opacity: 0.25; transform: scale(0.85); } 50% { opacity: 0.9; transform: scale(1.1); } }
@keyframes dsh-comfy-imagegen-slide { 0% { left: -34%; } 100% { left: 100%; } }
@keyframes dsh-comfy-imagegen-shine { 0% { transform: translateX(-115%); } 100% { transform: translateX(235%); } }
@keyframes dsh-comfy-imagegen-drift { 0% { background-position: 0 0; } 100% { background-position: 24px 24px; } }
@keyframes dsh-comfy-imagegen-fog-a { 0% { transform: translate3d(-6%, -4%, 0) scale(1.05); } 100% { transform: translate3d(8%, 6%, 0) scale(1.22); } }
@keyframes dsh-comfy-imagegen-fog-b { 0% { transform: translate3d(6%, 5%, 0) scale(1.12); } 100% { transform: translate3d(-7%, -6%, 0) scale(1.02); } }
@keyframes dsh-comfy-imagegen-fog-c { 0% { transform: translate3d(0, 4%, 0) scale(0.96); opacity: 0.55; } 100% { transform: translate3d(2%, -4%, 0) scale(1.1); opacity: 0.9; } }
@keyframes dsh-comfy-imagegen-develop {
  0% { clip-path: inset(0 0 100% 0); filter: blur(11px); opacity: 0.95; }
  62% { clip-path: inset(0 0 0 0); filter: blur(0); opacity: 0.95; }
  86% { clip-path: inset(0 0 0 0); filter: blur(0); opacity: 0.95; }
  100% { clip-path: inset(0 0 0 0); filter: blur(0); opacity: 0; }
}
@keyframes dsh-comfy-imagegen-scan {
  0% { top: 0; opacity: 1; }
  62% { top: 100%; opacity: 1; }
  70%, 100% { top: 100%; opacity: 0; }
}
@keyframes dsh-comfy-imagegen-shot-in {
  from { opacity: 0; transform: scale(1.035); filter: blur(14px); }
  to { opacity: 1; transform: scale(1); filter: blur(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-comfy-imagegen-dot, .dsh-comfy-imagegen-dots, .dsh-comfy-imagegen-fog--a, .dsh-comfy-imagegen-fog--b,
  .dsh-comfy-imagegen-fog--c, .dsh-comfy-imagegen-fill--idle,
  .dsh-comfy-imagegen-fill::after, .dsh-comfy-imagegen-scan { animation: none; }
  .dsh-comfy-imagegen-develop { animation: none; clip-path: none; filter: none; opacity: 0.7; }
  .dsh-comfy-imagegen-scan { opacity: 0; }
  .dsh-comfy-imagegen-fill--idle { width: 100%; opacity: 0.5; }
  .dsh-comfy-imagegen-shot { animation: none; }
}
`
    function injectStyles() {
      if (typeof document === 'undefined') return
      const current = document.getElementById(STYLE_ID)
      // The shell may hot-reload this bundle; an old sheet then lingers with the
      // previous geometry. Replace it whenever the text no longer matches.
      if (current !== null && current.textContent === CSS) return
      if (current !== null) current.remove()
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      ;(document.head ?? document.documentElement).appendChild(style)
    }

    function parseArgs(raw) {
      try {
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function batchOf(args) {
      const value = Number(args.batch)
      if (!Number.isFinite(value)) return 1
      return Math.min(Math.max(Math.trunc(value), 1), 4)
    }

    function seconds(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '0.0s'
      return `${(ms / 1000).toFixed(1)}s`
    }

    /** "1104x1960" (or a user's "9:16") → integer pixel box that fits maxW x maxH.
     *  Pixel sizes on purpose: a percentage width resolves to 0 inside a
     *  shrink-to-fit tool row, which would collapse the whole frame. */
    function boxStyle(sizeText, maxW, maxH) {
      const text = typeof sizeText === 'string' ? sizeText : ''
      const dims = /(\d+)\s*[x×]\s*(\d+)/.exec(text) ?? /(\d+)\s*:\s*(\d+)/.exec(text)
      const w = dims === null ? 3 : Number(dims[1])
      const d = dims === null ? 4 : Number(dims[2])
      const ratio = w > 0 && d > 0 ? w / d : 0.75
      let width = Math.min(maxW, Math.round(maxH * ratio))
      let height = Math.round(width / ratio)
      if (height > maxH) {
        height = maxH
        width = Math.max(24, Math.round(maxH * ratio))
      }
      return { width: `${width}px`, height: `${height}px` }
    }

    /** Real sampler ticks when the server sends them, otherwise the learned estimate. */
    function stepsLine(step, run, percent) {
      if (step !== undefined) return `${step.value} / ${step.max ?? '?'} 步`
      const total = Number.isFinite(run?.steps) ? `${run.steps} 步 · ` : ''
      if (percent !== undefined) return `${total}约 ${percent}% · 估算`
      return '等待第一步'
    }

    /** The status route is best-effort: any failure leaves the bar indeterminate. */
    function useRunStatus(live) {
      const [status, setStatus] = react.useState(null)
      react.useEffect(() => {
        if (!live) return undefined
        let cancelled = false
        const read = async () => {
          try {
            const response = await fetch('/imagegen/status', {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            if (!response.ok) return
            const data = await response.json()
            if (!cancelled && data !== null && typeof data === 'object') setStatus(data)
          } catch {
            // Offline, navigated away, or the host has no route — keep the spinner.
          }
        }
        read()
        const timer = setInterval(read, 1200)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [live])
      return status
    }

    /** Re-render on a timer so the elapsed readout moves without server traffic. */
    function useClock(live) {
      const [, bump] = react.useState(0)
      react.useEffect(() => {
        if (!live) return undefined
        const timer = setInterval(() => bump((n) => n + 1), 250)
        return () => clearInterval(timer)
      }, [live])
      return Date.now()
    }

    function DevelopingFrame(props) {
      const box = boxStyle(props.sizeText, props.maxWidth ?? 372, props.maxHeight ?? 300)
      const layer = { position: 'absolute', inset: 0, pointerEvents: 'none' }
      const style = {
        ...box,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '12px',
        isolation: 'isolate',
        // Vivid on purpose: the default theme is light "liquid glass", where a
        // faint wash over the glass reads as nothing at all.
        background: 'linear-gradient(152deg, rgba(124,92,255,0.72), rgba(56,189,248,0.60) 48%, rgba(186,104,240,0.66))',
        boxShadow: '0 10px 30px -14px rgba(70,40,140,0.60), inset 0 0 0 1px rgba(255,255,255,0.35)',
      }
      return h('div', { className: 'dsh-comfy-imagegen-frame', style }, [
        h('span', {
          key: 'dots',
          className: 'dsh-comfy-imagegen-dots',
          style: {
            ...layer,
            opacity: 0.7,
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.62) 1px, transparent 1.5px)',
            backgroundSize: '11px 11px',
          },
        }),
        h('span', {
          key: 'fog-a',
          className: 'dsh-comfy-imagegen-fog--a',
          style: {
            ...layer,
            filter: 'blur(14px)',
            background: 'radial-gradient(circle at 28% 30%, hsla(272,95%,78%,0.90), transparent 62%)',
          },
        }),
        h('span', {
          key: 'fog-b',
          className: 'dsh-comfy-imagegen-fog--b',
          style: {
            ...layer,
            filter: 'blur(16px)',
            background: 'radial-gradient(circle at 72% 66%, hsla(188,96%,62%,0.85), transparent 60%)',
          },
        }),
        h('span', {
          key: 'fog-c',
          className: 'dsh-comfy-imagegen-fog--c',
          style: {
            ...layer,
            filter: 'blur(18px)',
            background: 'radial-gradient(circle at 56% 18%, hsla(30,98%,66%,0.70), transparent 46%)',
          },
        }),
        h('span', {
          key: 'develop',
          className: 'dsh-comfy-imagegen-develop',
          style: {
            ...layer,
            background: 'radial-gradient(circle at 68% 28%, hsla(48,100%,88%,0.98) 0 6.5%, transparent 7.2%), '
              + 'conic-gradient(from 212deg at 44% 56%, hsla(268,85%,52%,0.95) 0 84deg, transparent 0), '
              + 'conic-gradient(from 204deg at 76% 68%, hsla(198,88%,48%,0.92) 0 98deg, transparent 0), '
              + 'linear-gradient(hsla(258,80%,66%,0.72), hsla(188,85%,52%,0.58))',
          },
        }),
        h('span', {
          key: 'scan',
          className: 'dsh-comfy-imagegen-scan',
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '2.5px',
            pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.98), transparent)',
            boxShadow: '0 0 18px 4px rgba(255,250,220,0.80)',
          },
        }),
        h('span', {
          key: 'vignette',
          className: 'dsh-comfy-imagegen-vignette',
          style: {
            ...layer,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.40), inset 0 -40px 60px -34px rgba(18,4,60,0.55)',
          },
        }),
      ])
    }

    function RunningCard(props) {
      const args = parseArgs(props.block?.argsRaw)
      const status = useRunStatus(true)
      const now = useClock(true)
      const mountedAt = react.useRef(Date.now())
      const run = Array.isArray(status?.runs) ? status.runs[0] : undefined
      const startedAt = Number.isFinite(run?.startedAt) ? run.startedAt : mountedAt.current
      const elapsed = now - startedAt
      const batch = run?.batch ?? batchOf(args)
      const sizeText = typeof run?.size === 'string' && run.size !== '' ? run.size : args.size
      const step = run?.progress
      const measured = Number.isFinite(step?.value) && Number.isFinite(step?.max) && step.max > 0
        ? Math.min(99, Math.round((step.value / step.max) * 100))
        : undefined
      // ComfyUI 0.42.5 tells outside sockets nothing while sampling, so fall back
      // to the throughput learned from this template's last finished run.
      const estimated = measured === undefined && Number.isFinite(run?.etaMs) && run.etaMs > 0
        ? Math.min(97, Math.max(2, Math.round((elapsed / run.etaMs) * 100)))
        : undefined
      const percent = measured ?? estimated

      const phase = run === undefined
        ? '连接 ComfyUI…'
        : run.phase === 'pending'
          ? (run.ahead > 0 ? `排队中 · 前面还有 ${run.ahead} 个任务` : '排队中')
          : run.phase === 'running'
            ? '采样中'
            : '收尾中'

      const detail = []
      if (typeof run?.label === 'string' && run.label !== '') detail.push(run.label)
      if (sizeText !== undefined && sizeText !== '') detail.push(String(sizeText))
      if (Number.isFinite(run?.seed)) detail.push(`seed ${run.seed}`)
      if (batch > 1) detail.push(`${batch} 张`)

      return h('div', { className: 'dsh-comfy-imagegen-card', style: CARD_STYLE }, [
        h('div', { key: 'head', className: 'dsh-comfy-imagegen-head', style: HEAD_STYLE }, [
          h('span', { key: 'badge', className: 'dsh-comfy-imagegen-badge', style: BADGE_STYLE }, [
            h('span', { key: 'dot', className: 'dsh-comfy-imagegen-dot' }),
            '正在生成',
          ]),
          h('span', { key: 'phase', className: 'dsh-comfy-imagegen-meta', style: META_STYLE }, phase),
          h('span', { key: 'elapsed', className: 'dsh-comfy-imagegen-meta', style: META_STYLE }, seconds(elapsed)),
        ]),
        h('div', { key: 'stage', className: 'dsh-comfy-imagegen-stage', style: STAGE_STYLE },
          h(DevelopingFrame, { sizeText, maxWidth: 340, maxHeight: 360 })),
        h('div', { key: 'meter', className: 'dsh-comfy-imagegen-meter', style: METER_STYLE }, [
          h('div', { key: 'bar', className: 'dsh-comfy-imagegen-bar', style: BAR_STYLE },
            percent === undefined
              ? h('div', {
                className: 'dsh-comfy-imagegen-fill dsh-comfy-imagegen-fill--idle',
                style: { ...FILL_STYLE, width: '32%' },
              })
              : h('div', { className: 'dsh-comfy-imagegen-fill', style: { ...FILL_STYLE, width: `${percent}%` } })),
          h('span', { key: 'pct', className: 'dsh-comfy-imagegen-pct', style: PCT_STYLE },
            percent === undefined ? '—' : `${percent}%`),
        ]),
        h('div', { key: 'lines', className: 'dsh-comfy-imagegen-lines', style: LINES_STYLE }, [
          h('span', { key: 'steps', className: 'dsh-comfy-imagegen-meta', style: META_STYLE }, stepsLine(step, run, percent)),
          detail.length > 0
            ? h('span', { key: 'detail', className: 'dsh-comfy-imagegen-meta', style: META_STYLE }, detail.join(' · '))
            : null,
        ]),
      ])
    }

    /** One picture: shown at the container's width with `height: auto`, so it
     *  is never cropped and never rounded to a guessed aspect ratio. Inline
     *  styles only — the injected sheet is a bonus, not a requirement. */
    function Shot(props) {
      const [missing, setMissing] = react.useState(false)
      const file = props.file ?? {}
      const url = typeof file.url === 'string' && file.url !== '' ? file.url : undefined
      const name = typeof file.filename === 'string' ? file.filename : `image ${props.index + 1}`
      const frame = {
        // 28% basis + wrap = three per row, then they grow to fill the line.
        flex: props.column ? '1 1 28%' : '0 0 auto',
        minWidth: 0,
        width: props.column ? undefined : '100%',
        boxSizing: 'border-box',
      }
      if (url === undefined || missing) {
        return h('div', {
          className: 'dsh-comfy-imagegen-shot',
          style: {
            ...frame,
            display: 'grid',
            placeItems: 'center',
            minHeight: '90px',
            padding: '10px',
            borderRadius: '10px',
            background: 'rgba(127,127,127,0.10)',
            fontSize: '11px',
            opacity: 0.6,
            wordBreak: 'break-all',
            textAlign: 'center',
          },
        }, name)
      }
      return h('a', {
        className: 'dsh-comfy-imagegen-shot',
        href: url,
        target: '_blank',
        rel: 'noreferrer',
        title: name,
        style: {
          ...frame,
          display: 'block',
          overflow: 'hidden',
          borderRadius: '10px',
          lineHeight: 0,
          textDecoration: 'none',
        },
      }, h('img', {
        src: url,
        alt: name,
        loading: 'lazy',
        decoding: 'async',
        onError: () => setMissing(true),
        style: { display: 'block', width: '100%', height: 'auto' },
      }))
    }

    function SettledCard(props) {
      const block = props.block ?? {}
      const meta = block.meta !== null && typeof block.meta === 'object' ? block.meta : undefined
      if (block.isError === true) {
        const reason = meta?.error ?? block.error?.name ?? '未知错误'
        return h('div', { className: 'dsh-comfy-imagegen-card', style: CARD_STYLE }, [
          h('div', { key: 'head', className: 'dsh-comfy-imagegen-head', style: HEAD_STYLE }, [
            h('span', {
              key: 'badge',
              className: 'dsh-comfy-imagegen-badge dsh-comfy-imagegen-badge--err',
              style: { ...BADGE_STYLE, background: 'rgba(220,80,80,0.16)', color: '#d15050' },
            }, '生成失败'),
          ]),
          h('div', { key: 'error', className: 'dsh-comfy-imagegen-error' }, String(reason)),
        ])
      }
      if (meta === undefined) {
        return h('div', { className: 'dsh-comfy-imagegen-card', style: CARD_STYLE }, [
          h('span', { className: 'dsh-comfy-imagegen-badge', style: BADGE_STYLE }, 'image_generate'),
        ])
      }
      const files = Array.isArray(meta.files) ? meta.files : []
      if (files.length === 0) {
        return h('div', { className: 'dsh-comfy-imagegen-card', style: CARD_STYLE }, [
          h('span', { className: 'dsh-comfy-imagegen-badge', style: BADGE_STYLE }, 'image_generate'),
        ])
      }
      const column = files.length > 1

      return h('div', {
        className: 'dsh-comfy-imagegen-card dsh-comfy-imagegen-card--picture',
        style: PICTURE_CARD_STYLE,
      }, h('div', { className: 'dsh-comfy-imagegen-shots', style: SHOTS_STYLE },
        files.map((file, index) => h(Shot, { key: `shot-${index}`, file, index, column }))))
    }

    function Card(props) {
      const block = props.block ?? {}
      return block.kind === 'tool-result' ? h(SettledCard, props) : h(RunningCard, props)
    }

    // A throw inside the card would otherwise unmount the whole tool row and
    // leave a blank line, which is indistinguishable from "the plugin is gone".
    const Guard = typeof react.Component === 'function'
      ? class CardGuard extends react.Component {
        constructor(props) {
          super(props)
          this.state = { failed: false }
        }

        static getDerivedStateFromError() {
          return { failed: true }
        }

        render() {
          if (this.state.failed) {
            return h('div', { className: 'dsh-comfy-imagegen-card', style: CARD_STYLE }, [
              h('span', {
                key: 'badge',
                className: 'dsh-comfy-imagegen-badge dsh-comfy-imagegen-badge--err',
                style: { ...BADGE_STYLE, background: 'rgba(220,80,80,0.16)', color: '#d15050' },
              }, '卡片渲染失败'),
            ])
          }
          return this.props.children ?? null
        }
      }
      : undefined

    function renderCard(props) {
      return Guard === undefined ? h(Card, props) : h(Guard, null, h(Card, props))
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(() => {
        injectStyles()
        return () => {}
      }, 'dsh-comfy-imagegen: styles')
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'image_generate',
        registrant: 'dsh-comfy-imagegen',
      }, (props) => renderCard(props)))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
