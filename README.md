# dsh-comfy-imagegen

Conversational image generation for DeepSeek Harness, backed by your own local
ComfyUI. You say what you want, the agent writes the prompt, the plugin renders
it and the picture lands in the conversation.

Two tools, two skills, zero runtime dependencies.

## What it looks like

```
你：画一只在雨夜便利店里吃关东煮的猫
agent：…（必要时问 2-3 个关键问题）…→ 扩写成一段完整 caption
agent：image_generate({ prompt: "…", purpose: "art", size: "4:5" })
→ 47s 后，图出现在对话里，落盘 <outputDir>/2026-10-24/<slug>-<seed>.png
```

生成期间那张工具卡先按目标尺寸（整数像素，不用百分比宽度）占住位置，并播放一段
“扫描显影”动效（点阵场 + 漂移极光 + 一条自上而下把画面刷出来的扫描线）；出图后同一
张卡里直接给图，不写标签、不写尺寸、不列文件：单张按卡片宽度等比缩放，多张并排
（三张一行），图片本身不做裁切，点一下开原图。整张卡仍然渲染在工具块里，宿主折叠
这个块时会一起收起——插件没有 message 级的插槽可用。

卡片的结构性样式（尺寸、位置、圆角、背景）全部写成内联样式，注入的 `<style>` 只负责
`@keyframes` 与 `prefers-reduced-motion`：即使宿主把样式表挡在卡片之外，占位框依然是
一块看得见的彩色画框，图片也依然按比例显示，而不是露出左上角一小块。

想不跑一次生成就先看动效，用浏览器打开 `preview/card.html`：它加载的就是真实的
`lib/client.js`，外面只套了一层极简 react shim。

## Install

The plugin is an ordinary npm package that carries a bundle patch; the DSH
loader picks up `dsh.bundle.patch` from any package present in the profile's
`node_modules`.

```powershell
dsh plugin --profile web add link:D:/path/to/dsh-comfy-imagegen
# then restart DeepSeek Harness so the profile graph is rebuilt
```

`link:` keeps your working copy editable — template changes then need only a
restart, not a republish.

### On the Desktop app

The Desktop build keeps its own profile, so `dsh` must be pointed at it. The
launcher already exports `DSH_HOME`, which is what makes the command land in the
right place:

```
DSH_HOME=%APPDATA%\dsh-desktop\harness
DSH_PROFILE_DIR=%APPDATA%\dsh-desktop\harness\profiles\web
```

`add link:...` writes three things into that profile: a `dependencies` entry, an
override to the linked folder, and the package name in `dsh.profile.bundles`.
The bundle list is what the loader walks — a `node_modules` entry alone is not
enough. Restart the app afterwards; the boot graph is built once at launch.

Two gotchas worth knowing:

- The Desktop runner re-projects installed plugins around every pnpm command
  ("excluded N generation projection(s)"), so check `dsh --profile web
  --dump-config | Select-String imagegen` afterwards — you should see one
  `# == dsh-comfy-imagegen` block with `name: dsh-comfy-imagegen`.
- If `harness\.env` contains `http_proxy`/`https_proxy`/`no_proxy`, the CLI
  refuses to start ("only the launching environment may set"). Move the file
  aside for the command and put it back.

## Configure

Everything lives in the `config` block of `cordis.patch.yml`, or in your
profile's `cordis.patch.yml` after install. Only `baseUrl` usually matters.

| key | default | meaning |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8188` | your ComfyUI |
| `outputDir` | `~/Pictures/dsh-comfy-imagegen` | where PNGs and sidecars land |
| `templateDirs` | `[]` | extra folders of templates, searched **before** the bundled ones |
| `timeoutMs` | `900000` | give up after this long |

## Templates

A template is one JSON file in `templates/`. It declares what it is good at and
which graph to run:

```json
{
  "id": "anima_t2i",
  "label": "Anima 动漫",
  "strengths": ["二次元", "角色插画"],
  "purposes": ["anime"],
  "dialect": "caption",
  "size": { "native": "1760x1224" },
  "slots": { "prompt": { "node": "4", "input": "text" }, "seed": { "node": "8", "input": "seed" } },
  "graph": { "4": { "class_type": "CLIPTextEncode", "inputs": { "text": "…" } } }
}
```

`slots` is where the plugin is allowed to write: prompt, negative, seed, steps,
cfg, width, height, batch, save. Anything not listed is never touched.

### Adding one from your own ComfyUI

`templates/` also accepts a **raw ComfyUI workflow** (the JSON you get from
*Workflow → Export* / *Save*). Anything with a top-level `nodes` array is
converted on load, so the fastest path to a new model is:

1. build and test the workflow in ComfyUI until the picture is right;
2. drop the exported `.json` into `templates/`;
3. restart Harness — `image_capabilities` tells you whether its models exist here.

To bake one in properly (correct id, label, dialect and known-good slots):

```powershell
node scripts/convert.mjs 'D:\AI\ComfyUI\user\default\workflows\anima.json' `
  --id anima_t2i --label "Anima 动漫" --strengths "二次元,角色插画" `
  --dialect caption --run --prompt "A red apple on a white table."
node scripts/annotate.mjs   # fills in editorial metadata for known ids
```

Conversion notes worth knowing when a graph of yours comes out wrong:

- **Subgraphs are flattened.** A reusable subgraph node is expanded in place;
  its inner nodes get ids like `459:474`, and promoted inputs/outputs become
  ordinary links.
- **Widget values are aligned by name.** The canvas stores an extra control-mode
  string (`randomize`, `fixed`, …) right after a seed, so a naive positional zip
  shifts every later value — the converter skips that one value.
- **Canvas viewers are dropped.** Nodes like `ImageCompare` declare a socketless
  required input the API prompt cannot satisfy and produce no output, so they are
  skipped with a warning instead of failing validation.
- **Serve defaults fill the gaps.** Any declared input the canvas omits takes the
  server-side `default` from `/object_info`.

### Why a template can be "unusable"

Nothing is hardcoded. At startup the plugin asks the server for `/object_info`
and compares every loader input against the file lists ComfyUI itself
advertises. A missing model or node type hides nothing — `image_capabilities`
marks the template ✗ with the exact file name, and `image_generate` refuses to
submit a graph that would fail server-side. On someone else's machine the
answer simply differs; that is the point.

## Skills

Both ship inside this package, so there is nothing else to install:

- `prompt-director` — writes the actual caption (triage, density, target
  profiles, no quality-booster filler).
- `imagegen` — the operating discipline: when to ask instead of guess, which
  template fits, how to present and re-roll.

## Current limits

- One blocking call per generation: the tool card holds the target aspect ratio
  open and plays a "developing" frame (scan line revealing the picture) with the
  live phase (queue position, sampling) and elapsed time, then shows the finished
  image itself and nothing else — no caption, no badges, no file list; one image
  scaled to the card, several side by side, never cropped. Step counts
  (`value / max`) appear only if your ComfyUI actually broadcasts `progress`
  frames to outside sockets — many builds, including the AKI 0.42.5 tested here,
  do not.
- Edit templates take a source picture: pass a local absolute path or an image
  URL as `image`, and the result keeps the source's shape (the sidecar records
  both the real output size and the requested one). Inpaint masks are not
  exposed yet.
- A batch shares one prompt and one seed, so its images differ only by sampler
  noise.

## Troubleshooting

- **`连不上 ComfyUI`** — is ComfyUI running and is `baseUrl` right? The plugin
  only talks to it over HTTP; no cloud fallback by design.
- **`模板 … 在这台机器上跑不了`** — the message names the missing file. Install
  it, or edit the template to point at a file you do have.
- **Takes minutes and then times out** — raise `timeoutMs`; large models on
  12 GB of VRAM swap to system RAM.
