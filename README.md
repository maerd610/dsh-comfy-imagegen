# dsh-comfy-imagegen

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的生图插件：
你说想画什么，agent 把提示词写完整，插件在你本机的 ComfyUI 上跑图，出图直接回到对话里。

不联网、不调云端、没有 API key —— 用的就是你自己那台 ComfyUI 和里面的模型。

> 你：画一只在雨夜便利店里吃关东煮的猫
> agent：…（问清主体、构图、要不要文字）→ 扩写成一段完整描述
> agent：调用 `image_generate`，40 秒后图出现在对话里，同时落盘到 `outputDir`

下面这张是同一个工具给出的结果：拿一张现成的旅行海报，让它把王维《鹿柴》加进去，
除了那四列竖排的字，标题、山、湖、倒影、平涂质感一个没动。

![改图实测：往现成海报里加一首竖排古诗](preview/demo-poster.jpg)

## 它给你什么

- **`image_generate`** —— 出图。文本生图、改图（给一张源图）、一次多张、指定尺寸/种子/步数。
- **`image_capabilities`** —— 自查。这台机器能跑哪些模板、缺哪个模型文件、每个模板的默认参数和可选项。
- **两个技能**（随包带走，不用另外装）：`prompt-director` 负责把一句话扩成真能出好图的描述；
  `imagegen` 负责什么时候该问、该选哪个模板、出图后怎么展示和重生成。

进度是实时的：卡片先按目标比例占位，跑图时显示队列位置和耗时，出图后原地换成图。

## 装之前，先确认三件事

1. ComfyUI 能正常出图，而且知道它的地址（默认 `http://127.0.0.1:8188`）。
2. ComfyUI 里已经有能用的模型 —— 本插件只负责把你的工作流发过去跑，不带模型。
3. 你用的是 DSH Desktop，并且能从「设置 → 插件」看到插件列表。

## 安装

**推荐做法：把下面这句直接发给 DSH 里的 agent，让它替你装。**

> 帮我安装本地插件 D:\Harness\dsh-comfy-imagegen：把它 link 进当前 profile 的依赖、
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
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8188` | ComfyUI 地址，换了端口或跑在另一台机器上就改这里 |
| `outputDir` | `~/Pictures/dsh-comfy-imagegen` | 图和同名 `.json` 记录落在哪，按日期分子目录 |
| `templateDirs` | `[]` | 额外模板目录，写在前面的优先；同 id 时你目录里的盖掉内置的 |
| `comfyUiDir` | 空 | ComfyUI 根目录，设了就会自动读它的 `user/default/workflows` |
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
| 装完完全没反应 | 没重启到进程级 | 完全退出 DSH 再打开，别只关窗口 |

## 已知限制

- 一次只跑一个生成任务，排队等前一张。（这样显存不会被两份模型同时抢。）
- 批量出图共用同一个提示词和种子，图之间的差别只是采样噪声。
- 改图支持「给一张图改成什么」，还不支持蒙版局部重绘。
- 步数进度条只有部分 ComfyUI 版本会推送到外部连接，很多构建（包括作者测试的 0.42.5）不推送，
  这时只显示阶段和耗时 —— 不是卡住。
- ComfyUI 必须能被本机以 HTTP 访问；纯云端 API 不走这条路。

## 许可

MIT。内置的 5 个模板只是示例工作流，图和模型的权利归各自的模型作者与许可。
