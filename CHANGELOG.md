# 更新记录

## 0.3.0

卡片终于能显示**真实**的采样进度和正在成形的画面，技能也终于能被宿主看见。

**修复**

- 进度一直不动的真正原因找到了，不是 ComfyUI 不推：`server.py` 的 `/ws` 对同一个
  `clientId` 只保留一条 socket（`self.sockets[sid] = ws` 前先 pop 掉旧的），而旧实现里有两条
  —— `ComfyClient` 自己的、`ProgressTracker` 自己再开一条 —— 它们不停把对方顶下线，谁也收不到
  `progress`。现在全插件只有一条连接，`/prompt` 带的 `client_id` 就是它，采样步数实时到达。
  `lib/progress.js` 随之删除。
- `skills/imagegen/SKILL.md` 的 frontmatter 不是合法 YAML（描述里有 `changed: "…"` 这种冒号加空格），
  `skill-filesystem` 解析失败后只打一条 warning 就把技能丢了 —— 这个技能从来没在会话里出现过。
  改成 `>-` 折叠块，现在能在技能目录里看到。`prompt-director` 的描述压到 500 字符以内，
  不再被目录截断。

**新的**

- 卡片显示 ComfyUI 推来的**潜空间预览**：采样中途的画面每步刷新，转圈换成看得见的成形过程。
  `GET /imagegen/preview?promptId=…` 发这些帧，只在内存里留最新一张，任务结束即丢。
- 客户端按官方 SDK 的 job/events 模型重写：一条 socket + `progress` / `preview` / `execution` /
  `status` 事件，`wait()` 仍以 `/history` 为准（文档明确流只用来画进度，轮询才是权威）。
  断线自动重连，没有 WebSocket 时退化为纯轮询。
- `scripts/probe-progress.mjs`：不开 DSH 也能验证「进度和预览真的在来」，跑完打印每步 tick 和
  预览帧大小。`npm run probe` 就是它。

**改的**

- 文档补上 `image_workflow`（这个工具 0.2.0 的包里就有，但 README 一个字没写，用的人根本不知道
  存在）：六种 `action`、两种落盘位置（固定值在 `<outputDir>/.workflow-overrides.json`，另存的模板在
  `<outputDir>/workflows/`），以及它和 `image_generate` 为什么必须是两个工具。
- README 的配置表补上 `templateMeta`；「进度是实时的」一句改成实际的两条线（采样步数 + 潜空间预览）；
  「已知限制」里那条「步数进度条只有部分构建会推」在 0.3.0 已经不成立，改成讲 WebSocket 的前提。
- `imagegen` 技能重写为固定四步循环：读需求 → **必须**用 `prompt-director` 扩写 → `image_generate`
  → 用图和一两句话收尾。明确写了不自动质检、不额外问「要不要我看看效果」、每一轮都重走一遍。
- `image_generate` 的描述跟着改：传的是扩写后的成稿段落，不是用户的原始句子；并说明出图后不必再
  自行检查结果。

**修复（上一轮未发布）**

- `image_capabilities` 在真实 DSH 里每次调用都被宿主打回：`templateDirs` 没写进输出 schema，
  `additionalProperties: false` 判它非法，正文和卡片都出不来。schema 补上 `templateDirs`。
- 两个工具的错误回执（`ok: false` + `error` + `detail`）同样漏在 schema 外，真出错时会被宿主
  改写成笼统的 “returned invalid output”，看不到真正原因。`error` / `detail` 已声明。
- `scripts/smoke.mjs` 现在按宿主规则校验输出 schema：这类「自检能过、宿主拒收」的错位会在
  `npm run self-check` 里直接失败。
- `image_workflow` 的 `write` 写完读不回来：另存的模板落在 `<outputDir>/workflows/`，而这个目录
  不在模板搜索路径里，于是工具永远报「已写出但重新加载时没有读到它」。该目录现在是模板目录之一
  （排在你的 `templateDirs` 之后、内置模板之前），写完当场就能出图。
- `image_workflow` 的 `delete` 会删掉内置模板：守卫只判断「不是画布文件且 id 对得上」，而随包发布的
  模板本来就是带 id 的 manifest，于是 `delete anima_t2i` 真的把 `templates/anima_t2i.json` 删了。
  现在只认 `write` 实际写入的位置：文件必须解析后落在 `<outputDir>/workflows/` 下，否则拒绝。
- `expandPath` 的注释说支持 `%USERPROFILE%`，代码只处理 `~`。现在 `~`、`$HOME`、`${HOME}`、
  `%USERPROFILE%` 都展开 —— 用户从 Windows 资源管理器复制的路径能直接贴进配置。

## 0.2.0

导出成能给别人的插件仓库：装上去能接着用，也能换成自己的模型和工作流。

**新的**

- `image_generate` 多了 `params`：模板里的任何槽位（采样器、调度器、denoise……）都能一次一调，
  不用改模板文件。没被模板声明的键会被忽略，并在结果里列出来，不静默吃掉。
- 模板可以写 `defaults`。没写的，从工作流里现有的值反推 —— 出图前就能在
  `image_capabilities` 里看到「默认: steps=30 · cfg=4 · …」。
- 新配置项 `comfyUiDir`：指向 ComfyUI 根目录，自动把 `user/default/workflows` 纳入模板搜索。
- `scripts/template.mjs import`：把 ComfyUI 工作流整理成正式模板（id、标签、擅长、方言、槽位、默认值一次到位），
  跑完直接告诉你缺什么模型。取代了原来的 `convert.mjs` 与 `inspect-graph.mjs`。
- `npm run self-check`：不开 DSH 也能自检模板和 ComfyUI 连通性。

**改的**

- 模板搜索顺序按配置顺序来，先出现的优先 —— 之前用户目录盖不掉内置模板（注释和实现不一致）。
- 原始 ComfyUI 工作流的模板名取文件名，不再被工作流自带的 uuid 顶掉。
- `image_capabilities` 输出可用的排在前面，末尾给「可用 N 个 / 共 M 个模板」；
  不再让人误以为「全是 ✗」是插件坏了。
- ComfyUI 0.42.5 这类不推送采样进度的构建，卡片只显示阶段和耗时，不再假装有个进度条。
- 内置 `prompt-director` 技能更新到 0.3.0。

**清理**

- 删掉写死作者本机路径的调试脚本（`convert`、`inspect-graph`、`probe`、`annotate`）。
- 预览页里的本机路径改成了占位路径。
- 补上 LICENSE（MIT）。

## 0.1.0

第一版：`image_generate` / `image_capabilities` 两个工具，5 个模板，两张技能，流式进度卡片。
