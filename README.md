# dsh-comfy-imagegen

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的生图插件：
你说想画什么，agent 把提示词写完整，插件在你本机的 ComfyUI 上跑图，出图直接回到对话里。

不联网、不调云端、没有 API key —— 用的就是你自己那台 ComfyUI 和里面的模型。

当前版本 **0.3.0**（这一版修好了「进度条永远不动」，卡片能显示真实的采样步数和潜空间预览），
逐版改动见 [CHANGELOG.md](CHANGELOG.md)。

> 你：画一只在雨夜便利店里吃关东煮的猫
> agent：…（问清主体、构图、要不要文字）→ 扩写成一段完整描述
> agent：调用 `image_generate`，40 秒后图出现在对话里，同时落盘到 `outputDir`

下面这张是同一个工具给出的结果：拿一张现成的旅行海报，让它把王维《鹿柴》加进去，
除了那四列竖排的字，标题、山、湖、倒影、平涂质感一个没动。

![改图实测：往现成海报里加一首竖排古诗](preview/demo-poster.jpg)

## 它给你什么

- **`image_generate`** —— 出图。文本生图、改图（给一张源图）、一次多张、指定尺寸/种子/步数。
- **`image_capabilities`** —— 自查。这台机器能跑哪些模板、缺哪个模型文件、每个模板的默认参数和可选项。
- **`image_workflow`** —— 改工作流本身。看某个模板的每个节点和输入、把 LoRA 权重/采样器/分辨率固定住、
  加节点换接线、把改好的另存成新模板。它和出图是两个工具：画图不会碰工作流，改工作流也不会顺手出图。
- **两个技能**（随包带走，不用另外装）：`prompt-director` 负责把一句话扩成真能出好图的描述；
  `imagegen` 负责什么时候该问、该选哪个模板、出图后怎么展示和重生成。

进度是实时的，而且是两条线：卡片先按目标比例占位，跑图时显示队列位置和每一步的采样进度，
采样中途的潜空间预览也在同步刷新（`GET /imagegen/preview?promptId=…`），跑完原地换成成图。
WebSocket 断了会自动重连，宿主没有 WebSocket 时退化成纯轮询。

## 装之前，先确认三件事

1. ComfyUI 能正常出图，而且知道它的地址（默认 `http://127.0.0.1:8188`）。
2. ComfyUI 里已经有能用的模型 —— 本插件只负责把你的工作流发过去跑，不带模型。
3. 你用的是 DSH Desktop，并且能从「设置 → 插件」看到插件列表。

## 安装

先把仓库放到本机任意目录：`git clone https://github.com/maerd610/dsh-comfy-imagegen.git`，
或者从 [Releases](https://github.com/maerd610/dsh-comfy-imagegen/releases) 下 zip 解压。位置随意，
插件本身不写死路径。

**推荐做法：把下面这句直接发给 DSH 里的 agent，让它替你装。**

> 帮我安装本地插件 <刚放好的那个目录>：把它 link 进当前 profile 的依赖、
> 加进 `dsh.profile.bundles`，然后把 ComfyUI 地址（我的是 http://127.0.0.1:8188）
> 写进 `imagegen` 那条配置。装完告诉我该重启了。

agent 会自己找 profile 目录、改 `package.json` 和 `cordis.yml`、建软链，装完还会回头核对一遍。
你只需要**完全退出 DSH 再重开**（不是关窗口，是退出进程）——启动图只在启动时构建一次。

**想自己动手**（agent 不在、或者你就是想看清楚）：在 profile 目录里做三件事即可 ——
用 `link:` 把本目录加进 `dependencies`；把 `dsh-comfy-imagegen` 加进 `dsh.profile.bundles`；
在 `profiles/<profile>/node_modules/` 里建一个指向本目录的软链（Windows 用 junction）。
profile 目录通常是 `%APPDATA%\dsh-desktop\harness\profiles\web`（macOS / Linux 在
`~/Library/Application Support/dsh-desktop` 之类的位置，找 `harness/profiles` 即可）。
Desktop 版的 `desktop` profile 由 Electron 独占，别往那儿装。

## 装完先验一下

让 agent 调一次 `image_capabilities`。看到类似这样就算通了：

- 最上面是 `ComfyUI: http://127.0.0.1:8188` 和你的输出目录；
- 中间列出每个模板一行，能用的打 ✓，缺模型的打 ✗ 并写明缺哪个文件；
- 最后一句「可用 N 个 / 共 M 个模板」。

**内置的 5 个模板在别人机器上大概率全是 ✗，这是正常的** —— 它们绑的是原作者那台机器的模型文件名
（anima、红船 KREA2、MOSS、Qwen-Image 等）。插件本身没问题，你要做的是换成自己的模型和工作流，见下一节。

不想开界面验证也行，在插件目录里 `npm run self-check` 会直接打印同样的一份报告。

如果只想知道「逐步进度和潜空间预览到底推不推」——这是卡片上进度条和模糊底图的来源——
跑 `npm run probe`：它绕过 DSH 直接连你的 ComfyUI，跑一张最小尺寸的图，把收到的每个采样 tick
和每一帧预览都打出来，最后一行是 `ticks N  previews M  images 1`。退出码 0 说明这条链路在你这台
机器上是通的；ComfyUI 关掉了 `/ws` 或者被反代挡了，这里会立刻显出来。

## 换成你自己的模型和工作流

有三种方式，从省事到讲究：

**一、让插件直接读你 ComfyUI 的工作流文件夹**（最省事）。把配置项 `comfyUiDir` 指向 ComfyUI 根目录，
插件会自动读 `<comfyUiDir>/user/default/workflows` 里所有 `.json`，你在 ComfyUI 里存过的图立刻就能用。
文件名就是模板名，改文件名的同时改模板名。

**二、把一个工作流做成正式模板**。想给它起个像样的名字、标上擅长什么、跑一张图验证能出图，
就让 agent 跑导入器（`node scripts/template.mjs import <你的工作流.json>`，还有 `--label`、`--strengths`、
`--purposes`、`--run` 几个开关）。它会告诉你这个工作流有几个节点、原生尺寸多大、能改哪些槽位、缺什么模型，
最后把整理好的模板写进你指定的目录。

**三、手工放进去**。`templateDirs` 里任意目录下丢一个 `.json` 就行：既可以是插件整理过的模板，
也可以是 ComfyUI 直接导出的原始工作流（带 `nodes` 数组的那种，插件会在加载时自动转换）。
模板里写了 `defaults` 就用你写的，没写就从工作流里现有的值反推。

> 判断标准只有一条：`image_capabilities` 里它是 ✓。✗ 说明这台机器缺东西，报错里会写清楚缺哪个文件、
> 该放进 ComfyUI 的哪个模型目录（checkpoints、loras、vae、text_encoders…）。

## 改工作流：`image_workflow`

出图改的是画面，改工作流改的是「图是怎么被造出来的」。这两件事被拆成两个工具，是为了让一句
「画一只猫」不必背上一整套图操作的上下文；agent 也只在你真的说「把 LoRA 降到 0.6」「换个采样器」
「这份工作流再存一版」时才用这个工具。

| `action` | 干什么 |
| --- | --- |
| `list` | 列出所有模板 id |
| `inspect` | 逐节点列出一个模板的 `class_type`、当前输入、连线和这个输入能吃哪些值 |
| `set` | 把某些节点输入固定住（`{节点id: {输入名: 值}}`，`null` 取消固定），一直生效到 `clear` |
| `clear` | 取消一个模板上的所有固定值，回到文件里原本的参数 |
| `write` | 加节点/删节点/改接线后另存为新模板；存完会重新加载校验一遍，跑不起来当场报错 |
| `delete` | 只删 `write` 写在 `<outputDir>/workflows/` 里的模板；内置模板、ComfyUI 画布文件、你 `templateDirs` 里的文件都不碰 |

两种东西落在哪，看这里：

- **固定值**（`set`）不动你的工作流文件，存在 `<outputDir>/.workflow-overrides.json`，
  提交前才套到克隆出来的图上。所以 `anima` 永远还是那个 `anima`，想还原就 `clear`。
- **另存的模板**（`write`）写在 `<outputDir>/workflows/` 下，是插件格式的模板文件，和 ComfyUI 的
  `user/default/workflows` 分开 —— 免得 DSH 生成的模板混进你在 ComfyUI 里自己存的那堆。
  这个目录插件自己会扫描（排在你的 `templateDirs` 之后、内置模板之前），写完当场就能拿来出图。

## 参数怎么调

常用参数直接给（agent 会自己填）：`prompt`、`negative`、`image`（改图用的源图）、`template`、
`purpose`（动漫 / 艺术 / 版式 / 打字 / 改图，用来挑模板）、`size`（`16:9`、`4:5` 或 `512x512`）、
`seed`、`steps`、`cfg`、`batch`（1–4 张）。

模板里更细的开关（采样器、调度器、denoise、放大倍率、任何节点上的输入）通过 `params` 传，
键名就是 `image_capabilities --verbose` 里「槽位」列出来的那些。`params` 优先级最高：
同名时盖掉上面的顶层参数；模板里没这个键的会被忽略，并在结果里列出来，不会静默失效。

所以「换个采样器看看」「把步数压到 4 试个构图」都是一句话的事，不用改模板文件。

## 配置

只有这几项，写在 profile 的 `cordis.yml` 里 `id: imagegen` 那一条的 `config` 下面：

```yaml
baseUrl: http://127.0.0.1:8188
outputDir: ~/Pictures/dsh-comfy-imagegen
templateDirs: []
comfyUiDir: ''
preferLocal: true
templateMeta: {}
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8188` | ComfyUI 地址，换了端口或跑在另一台机器上就改这里 |
| `outputDir` | `~/Pictures/dsh-comfy-imagegen` | 图和同名 `.json` 记录落在哪，按日期分子目录；`image_workflow` 的固定值和另存模板也在这里 |
| `templateDirs` | `[]` | 额外模板目录，写在前面的优先；同 id 时你目录里的盖掉内置的 |
| `comfyUiDir` | 空 | ComfyUI 根目录，设了就会自动读它的 `user/default/workflows` |
| `preferLocal` | `true` | 自动挑模板时优先用你自己的工作流（`templateDirs`、`comfyUiDir`、`<outputDir>/workflows` 里的），内置示例只在没有可用的本地模板时上场。改成 `false` 就反过来 |
| `templateMeta` | `{}` | 按模板 id 补标签：`{anima_paint: {label: '我的厚涂', strengths: ['人像'], purposes: ['anime'], dialect: 'tags'}}`，工作流文件不用改 |
| `timeoutMs` | `900000` | 单次出图最多等多久 |

改完配置要重启 DSH 才生效（不用重装）。

## 出问题的时候

| 现象 | 多半是 | 怎么办 |
| --- | --- | --- |
| 连不上 ComfyUI | 没开、端口不对、开了防火墙 | 浏览器打开 `baseUrl` 看看能不能进 |
| 模板全 ✗ | 内置模板绑的是作者的模型 | 正常，按上面「换成你自己的」做一遍 |
| 某个模板 ✗ 且写明缺文件 | ComfyUI 里确实没有这个模型 | 装上，或把模板里的文件名改成你有的 |
| 提交后服务端 400 / 校验失败 | 工作流里有自定义节点没装 | 看报错里的节点类型，去 ComfyUI 装对应插件 |
| 跑到一半超时 | 模型太大、显存不够、在换页 | 调大 `timeoutMs`，或降尺寸/步数 |
| 出图没问题但步数没变 | `params` 里的键名拼错了 | 用 `image_capabilities --verbose` 核对槽位名 |
| 卡片只有转圈、没有逐步进度 | 这个构建不推 `progress`，或者 `/ws` 被反代挡住了 | 插件会自动退化成轮询，图照样出来，只是没有进度条 |
| 装完完全没反应 | 没重启到进程级 | 完全退出 DSH 再打开，别只关窗口 |

## 已知限制

- 一次只跑一个生成任务，排队等前一张。（这样显存不会被两份模型同时抢。）
- 批量出图共用同一个提示词和种子，图之间的差别只是采样噪声。
- 改图支持「给一张图改成什么」，还不支持蒙版局部重绘。
- 采样进度和潜空间预览走 ComfyUI 的 WebSocket。关掉 `/ws`、走反代、或用极旧的构建时，
  卡片只剩阶段和耗时 —— 图本身不受影响。
- ComfyUI 必须能被本机以 HTTP 访问；纯云端 API 不走这条路。
- `image_workflow` 的 `write` 只做结构改动（增删节点、改接线、改输入）。它不替你补模型权重，
  所以写完会重新加载校验一次，但真正的把关还是跑一张图。

## 许可

MIT。内置的 5 个模板只是示例工作流，图和模型的权利归各自的模型作者与许可。
