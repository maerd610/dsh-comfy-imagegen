# dsh-comfy-imagegen 设计稿 v1

> 目标：让 DeepSeek Harness 获得对话式生图能力。用户说一句话 → agent 澄清并扩写 → 调本地 ComfyUI → 图出现在对话里。
> 原则：**只做这条流程，不加别的**。不做画布、不做参数面板、不做队列管理、不做预设包。

---

## 1. 主流程（严格对齐 `dsh_image.txt`）

| # | 谁做 | 做什么 |
|---|---|---|
| 1 | 用户 | 给提示词，可能只有一句大方向 |
| 2 | agent + `image-gen` skill | 判断信息是否够。**太短、只有大方向**才问 2–3 个关键问题（要传达什么信息／必须出现什么／布局／视觉风格）；细节问题不问 |
| 3 | agent + `prompt-director` skill | 写出成品 caption：一段连续英文 + 空行 + 元数据（`ratio: 3:4`、`model: …`） |
| 4 | agent | 按性格表选模板，把 `ratio` 换算成 `WxH`，调 `image_generate` |
| 5 | 插件 | 自检模板可用 → 注入槽位 → `POST /prompt` → WS 等完成 → 取图 → 落盘 → 返回 markdown 图 + 回执 |
| 6 | agent | 把图贴给用户；用户说"改成…" → 走编辑模板或重生 |

**扩写是核心优势，插件不重复造它。** 插件只负责把"已经写好的 caption"正确地喂给对的模型。

## 2. 工具契约（唯一工具）

```ts
image_generate({
  prompt: string,              // 已扩写的成品 caption（画面内文字保持原语言）
  template: string,            // 模板 id，agent 按性格表决定，必填
  negative?: string,
  size?: string,               // "WxH"，缺省用模板原生尺寸
  count?: number,              // 默认 1；>1 时每次独立 seed 串行提交
  seed?: number,               // 缺省随机（0..2^32-1，避开 JS 精度区）
  reference_images?: string[], // 工作区相对路径，仅 edit 类模板
  output_name?: string
})
```

**只注册这一个工具。** 没有 `image_capabilities()`：能力表写进 skill，运行时可用性由 `image_generate` 的报错兜底（报错里直接列出当前可用模板 + 缺什么）。

返回：图片 markdown 绝对 URL + 落盘路径 + `prompt_id` + 生效参数回执（模板／尺寸／seed／步数／cfg）。

## 3. 模板系统（泛用性的落点）

模板 = **API 格式的 ComfyUI graph** + 一层薄元数据。两个文件合一，loader 两种形态都吃：

```jsonc
{
  "id": "anima_t2i",
  "label": "Anima 动漫",
  "strengths": ["二次元", "角色插画", "同人图"],
  "dialect": "caption",                      // caption | tags | layout-json
  "size": { "native": "1760x1224" },
  "requires": {                              // 启动自检，缺则隐藏该模板并给人话提示
    "checkpoints": ["anima-preview.safetensors"],
    "nodes": ["KSampler", "CLIPTextEncode"]
  },
  "slots": {                                 // 转换时自动发现，也可手改
    "prompt":   { "node": "4", "input": "text" },
    "negative": { "node": "6", "input": "text" },
    "width":    { "node": "12", "input": "width" },
    "height":   { "node": "12", "input": "height" },
    "seed":     { "node": "15", "input": "seed" },
    "batch":    { "node": "12", "input": "batch_size" }
  },
  "graph": { "4": { "class_type": "CLIPTextEncode", "inputs": { … } }, … }
}
```

- loader 若发现顶层没有 `graph` 键，就**把整个文件当 graph**——用户直接从 ComfyUI「Export (API)」存出来的裸 JSON 可以直接丢进 `templates/`。
- `slots` 由转换脚本按 `class_type` + 输入名自动识别（`CLIPTextEncode.text`、`EmptyLatentImage.width/height/batch_size`、`KSampler.seed`），识别不到就留空、由 agent 用 `--` 手填；不要求使用者手写。
- `requires` 在插件启动时对着 `/object_info` + `/models` 校验一次，缓存 5 分钟。

**换环境 = 换 `templates/` 里的 JSON。** 代码不动，模型和 LoRA 全在声明里。

## 4. 内置模板（v1 五个）

| id | 来源工作流 | 原生尺寸 | 步数/cfg | 定位 |
|---|---|---|---|---|
| `anima_t2i` | `anima.json` | 1760×1224 | 30 / 4 | 二次元、角色插画 |
| `qwen_t2i` | `qwen.json` | 1144×1328 | 30 / 1 | 中文文字、海报、透明素材 |
| `qwen_edit` | `image_qwen_image_2_1_image_edit.json`（UNET 改 bf16） | 跟随参考图 | 30 / 1 | 改图、多参考图 |
| `krea2_t2i` | `KREA2.json` | 1160×1968 | 12 / 1 | 艺术质感、风格化、写真 |
| `moss_t2i` | `moss.json` | 1120×1552 | 25 / 4.5 | 版式可控、文字精确摆放 |

flux3、sdxl 不入 v1（sdxl 那个文件 LoRA 名还对不上）。

## 5. 配置

```yaml
- insert:
    - id: imagegen
      name: dsh-comfy-imagegen
      config:
        baseUrl: http://127.0.0.1:8188          # ComfyUI 地址
        outputDir: ~/Pictures/dsh-comfy-imagegen # 落盘目录（工具拿不到 cwd，默认在用户目录）
        templateDirs: []                        # 额外模板目录（其他用户自己的模型放这）
        timeoutMs: 900000
```

## 6. 展示

**v1：markdown 绝对 URL，零前端、零代理。**

```
![](http://127.0.0.1:8188/view?filename=xxx.png&subfolder=&type=output)
```

成立依据（已核实）：宿主全部包无 `Content-Security-Policy`/`img-src` 限制；`dsh-client-ui-primitives` 的 `remoteImageUrl` 放行 http/https；ComfyUI `/view` 无鉴权 200。落盘到工作区的副本作为归档，不作为展示源。

**不做的事**：自建 `/comfyui/media` 路由、`tapIndex` 注入学 origin、客户端卡片——那是远程/局域网访问才需要的，等真有人这么用再说。届时照抄 dsh-comfyui 的 `proxy.js`（127 行）+ origin 探测（约 40 行）。

## 7. 包结构（零运行时依赖）

```
dsh-comfy-imagegen/
  package.json          # dsh.bundle.patch, engines node ^22.19 || >=24
  cordis.patch.yml      # 两段：插件本体 + skill-filesystem 挂载 skills/
  lib/index.js          # cordis 插件：加载模板、自检、ctx.tools.register
  lib/comfy.js          # 薄客户端：submit / wait / fetchImage / upload（323 行，已验证）
  lib/ui2api.js         # 画布 JSON → API 图 + 槽位识别（转换器本体）
  lib/templates.js      # 加载（含原始工作流现转）+ 自检 + 选模板 + 尺寸换算
  lib/output.js         # 落盘 <日期>/<slug>-<seed>.png + sidecar json
  templates/*.json      # 已转换模板，元数据在 annotate.mjs 里维护
  skills/prompt-director/  # 扩写技能（并入，不再单独安装）
  skills/imagegen/         # 流程纪律：何时问、选模板、展示、重跑
  scripts/convert.mjs   # 用户自备工作流 → 模板（支持 --run 真机 canary）
  scripts/annotate.mjs  # 给模板补 label/strengths/purposes/dialect/notes
  scripts/smoke.mjs     # 不起宿主直接跑通 apply → 工具 → 出图
  README.md
```

**为什么不用 `comfyui-node`**：它带 `sharp` 原生二进制（别人机器上装不上就废）；我们只用 5 个端点（`/prompt`、`/ws`、`/history/{id}`、`/view`、`/upload/image`）。Node 22.19+ 自带 `fetch` 和 `WebSocket`，零依赖就够。**流程照抄官方 Recommended 那套**（`client_id` 与 `?clientId=` 同值 → `POST /prompt` → WS 收到 `executing` 且 `node===null` → `/history` 取 `outputs[*].images[]` → `/view` 取字节），不自创协议。

**wait() 的两条教训**：正确性必须落在 `/history` 轮询上，WebSocket 只做加速与进度上报（WS 可能连不上、可能先于提交就结束）；任何"超时"常量都要在单位上自证一次（第一版把已是毫秒的 `WS_TIMEOUT_MS` 又乘了 1000，整段预算被一个 5,000,000ms 定时器吃掉）。

## 8. 分期与验收（按 m00230 修正后）

用户 m00230 定了三条硬约束：① 前端生成动画在范围内 ② `prompt-director` 并入本包，一次安装 ③ 用户必须能自己改工作流／加 LoRA／换模型。

- **P0 · 转换与真机验证** ✅ 完成：`lib/ui2api.js` + `scripts/convert.mjs` 把 anima / moss / krea2 / qwen 转成 API 图并自动识别槽位；真机各出过图；`wait()` 修好后一次生成 48.6s 正常返回（anima 3:4 → 1272×1696）。
- **P1 · 插件骨架** ✅ 完成：`image_generate` / `image_capabilities` 两个工具 + 5 个模板 + 自检 + 落盘 + markdown 展示；`scripts/smoke.mjs` 在不起宿主的情况下跑通全链路，包已 link 进 web profile 并可 `import('dsh-comfy-imagegen')`。
- **P2 · 生成动画** ✅ 完成：`lib/client.js` 注册 `tool.call.toolview`。运行态按 `run.size` 算出**整数像素**画框占位（不用百分比宽度——shrink-to-fit 的工具行里会解析成 0，整块塌掉；这也是动画曾经"不显示"的原因），框内叠点阵场 + 漂移极光 + 一条自上而下"显影"出抽象画面的扫描线（原先还有一条斜向光扫，用户嫌循环接缝跳帧，已删掉——要加回来就用整块 `translateX` 从框左外侧移到框右外侧，别用 `background-position` 扫，两端都必须完全离屏才无缝），下方给相位、计时与学习式估算进度。结算态**只出图**：单张按卡片宽度 `height: auto` 等比缩放，多张并排（三张一行），不写标签/尺寸/文件名，不裁切，点击开原图。**结构性样式全部内联，注入的 `<style>` 只留 `@keyframes` 与 `prefers-reduced-motion`**——因为出现过"卡片被挂到样式表够不到的位置"：图层没有 CSS 就零高度、`<img>` 以 1760px 自然尺寸被 `overflow:hidden` 裁掉只剩左上角。内联样式让这两件事退化成"少一段动画"，而不是"整块不可见"。配色也按默认的浅色液态玻璃主题加重（饱和 violet/teal/amber + 白描边）。已知限制：卡片只能渲染在工具块内，宿主把块折叠时随块收起；`dshmarket` 里可见的插槽只有 `tool.call.toolview` / `shell.overlay` / `settings.*` / `sidebar.panellist` / `plugins.*`，没有 message 级可挂点，所以"折叠后仍可见"做不到，除非另开 `shell.overlay` 浮层。宿主 `GET /imagegen/status` 提供快照。`preview/card.html` 是离线预览页：直接加载真实 `lib/client.js` 并套一层极简 react shim，不跑生成也能看动效。
- **⚠️ 本机 ComfyUI 0.42.5 不向外部 socket 推事件**：Python(aiohttp) 与 Node(undici) 两条独立探针、带不带 `clientId`、带不带 `Origin` 与 `feature_flags` 首帧，**都只收到握手时那条 `status`**；`/history` 里 `execution_*` 齐全，`/queue` 与 `/api/jobs` 都不带步数，也没有任何 SSE 路由。所以卡片当前走"不确定态进度条"（扫光 + 耗时 + 排队位置），有 `progress` 帧时自动升级成 `value/max` 步数——换一台正常广播的 ComfyUI 就自动有百分比，不改代码。
- **P3 · 编辑链路** ✅ 完成：`flattenCanvas` 展开子图（子节点全局 id `459:474`，`-10`/`-20` 哨兵端点解析成普通连线）；`ImageCompare` 这类画布查看节点（`socketless` 必填输入 + 无输出）自动丢弃；`widgets_values` 按名字对齐并跳过 seed 后的 `control_after_generate` 值；`templates/qwen_edit.json` 真机跑通（源图上传 → `/upload/image` → `LoadImage`），输出沿用源图长宽比（实测 1280×1696，sidecar 记 `size` + `requestedSize` + `source`）。
- **P4 · 其余**：多图画廊、批量种子、`moss` 的 layout-json 方言落地；`image_capabilities` 已区分「文生图」与「需要源图的改图模板」（`takesImage`）。

## 9. 明确不做

- 不做参数面板（ComfyUI 自带节点面板）
- 不做画布／预设包／队列面板
- 不做附件（attachment）展示路线
- 不做云 API（用户全部本地）
- 不自建鉴权
- 不内置模型定位表以外的东西：模板只声明"我擅长什么"，谁能跑由 `/object_info` 现场决定

