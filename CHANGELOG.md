# 更新记录

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
