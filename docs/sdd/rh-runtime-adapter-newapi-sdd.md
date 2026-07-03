# SDD: 创作面板 2.0 能用版 - NewAPI 直连 + RunningHub 双渠道

> **状态**: 已确认方案 / 待实施
> **日期**: 2026-06-16
> **分支**: `codex/rh-creation-ui`
> **读者**: 后续接手的 AI 开发者、前端开发者、NewAPI / rh-adapter 维护者
> **本次范围**: 只升级 `CreationPanel` 创作面板。让 `docs/notes/` 中已配置到 NewAPI 渠道和价格的媒体模型能被创作面板承载、提交、轮询、展示。
> **明确非范围**: 不做 Canvas 画布，不接对话联动，不做完整 Pixelle-Video 式流水线，不做品牌包装，不做远期包装阶段，不隐藏 RunningHub / NewAPI / T8 等真实渠道。
> **外部参考结论**: 已对照 `AIDC-AI/Pixelle-Video` 当前架构。最终采用“两条执行渠道 + 一个模型契约层”，不 fork、不照搬 Pixelle 的流水线。

---

## 0. 核心结论

创作面板 2.0 本次目标不是“做大”，而是先“能用、能排障、参数不串线”。

最终架构不是复制 Pixelle-Video，而是吸收它的关键分层：

```text
source / route / upstreamFamily / apiStyle / contractStatus 分开
```

也就是说，创作面板仍然只有两条执行渠道，但所有模型在进入执行渠道前，必须先经过一层明确的模型契约：

```text
CreationPanel
  ↓
CreationModelRegistry / 模型契约层
  ↓
CreationRunPlan / 参数归一与强校验
  ↓
mediaTaskStore
  ↓
CreationMediaRuntime
  ├─ NewApiDirectRuntime
  └─ RunningHubRuntime → NewAPI RH channel → rh-adapter → RunningHub
```

本次只支持两大渠道：

```text
渠道 A：NewAPI 直连
  T8 / 火山引擎 / WorldRouter / 特朗普渠道 / 其他 OpenAI-compatible 媒体模型
  CreationPanel → ModelRegistry → RunPlan → mediaTaskStore → MediaRuntime → NewApiDirectRuntime → NewAPI → 上游
  不经过 rh-adapter

渠道 B：RunningHub
  RH 标准 API / RH AI App 工作流
  CreationPanel → ModelRegistry → RunPlan → mediaTaskStore → MediaRuntime → RunningHubRuntime → NewAPI RH channel → rh-adapter → RunningHub
```

必须长期坚持：

```text
rh-adapter 只服务 RunningHub 渠道。
直连 NewAPI / T8 / 火山 / 特朗普渠道模型，跟 rh-adapter 没有关系。
```

命名约定：

```text
NewApiDirectRuntime 是最终命名。
DirectNewApiRuntime 只作为旧讨论里的同义词，不再新建同名文件。
```

---

## 1. 用户体验目标

用户不需要理解 NewAPI、T8、RH adapter、endpoint、nodeInfoList。

用户看到的主路径应该是：

```text
选类型 → 选模型 → 上传参考素材 → 填提示词 → 选比例 / 分辨率 / 时长 → 生成 → 看结果
```

示例：

```text
图片 → GPT Image 2 · T8 直连 → 上传图 → 填提示词 → 16:9 → 2k → 生成
图片 → GPT2.0 · RunningHub → 上传图 → 填提示词 → 16:9 → 2k → 生成
视频 → Seedance 2.0 · 火山/直连 → 填提示词 → 9:16 → 720p → 生成
音频 → Suno v5.5 · RunningHub → 填歌曲描述 → 纯音乐开关 → 生成
```

生成前必须显示轻量摘要：

```text
T8 直连 · 图生图 · 参考图 1 张 · size=2048x1152
RunningHub 官方 API · 图生图 · 参考图 1 张 · aspectRatio=16:9 · resolution=2k
RunningHub 工作流 · 数字人 · 图片 1 张 · 音频 1 段
```

---

## 2. 本次不做什么

为了把当前创作面板先做扎实，本次明确不做：

- 不做 Canvas / `canvasMediaRuntime` 接入。
- 不改画布节点。
- 不做多步骤脚本、分镜、批量自动短视频流水线。
- 不做对话框生成文案后自动联动创作。
- 不做品牌包装隐藏真实渠道。
- 不做远期包装阶段。
- 不把 `rh-adapter` 泛化成所有媒体模型的 adapter。
- 不把直连 NewAPI 模型绕进 RunningHub。

---

## 3. 资料来源

本次模型与参数以 `docs/notes/` 为事实源，NewAPI 后台配置和价格由用户已完成。

重点资料：

```text
docs/notes/T8模型接口配置文档.md
docs/notes/T8gpt2.md
docs/notes/T8gemini.md
docs/notes/T8grok.md
docs/notes/T8 异步文档.md
docs/notes/T8suno 音乐模型文档.md
docs/notes/t8seedance.md
docs/notes/火山引擎seedance2.0.md
docs/notes/特朗普API.md
docs/notes/特朗普seedace2.md

docs/notes/runninghub-GPT-image-2.md
docs/notes/runninghub-banana.md
docs/notes/runninghub-grok-video-3文档.md
docs/notes/runninghub-seedance文档.md
docs/notes/runninghub-suno.md
docs/notes/runninghub 5个工作流模型参数.md
docs/notes/我的服务器运维手册.md
```

---

## 4. 目标架构

```text
CreationPanel
  收集用户输入，展示模型/渠道/参数/任务/结果
    ↓
CreationModelRegistry / 模型契约层
  承载 notes 中所有模型的 source、route、upstreamFamily、apiStyle、参数契约
    ↓
CreationRunPlan
  归一用户输入，生成提交摘要，做强校验，禁止路由串线
    ↓
mediaTaskStore
  创建任务、持久化、恢复轮询、失败回写
    ↓
CreationMediaRuntime
  读取模型 registry，生成 plan，按 route 分发
    ├─ NewApiDirectRuntime
    │    NewAPI 直连模型：T8 / 火山 / 特朗普 / WorldRouter / 普通 OpenAI-compatible
    │
    └─ RunningHubRuntime
         RH 模型：标准 API / AI App 工作流
           ↓
         NewAPI RH channel
           ↓
         rh-adapter
           ↓
         RunningHub 官方接口
```

本次建议新增或重构的前端边界：

```text
src/runtime/creation/creationMediaTypes.ts
src/runtime/creation/creationModelRegistry.ts
src/runtime/creation/creationMediaPlan.ts
src/runtime/creation/newApiDirectRuntime.ts
src/runtime/creation/runningHubRuntime.ts
src/runtime/creation/creationMediaRuntime.ts
```

说明：

- `src/api/media-generation.ts` 可以先保留为底层 API client，逐步瘦身。
- `mediaTaskStore` 仍是任务状态机唯一入口。
- `CreationPanel` 不直接判断是否进 rh-adapter。
- `CreationPanel` 只读取 spec / plan 渲染 UI，不根据模型名猜参数。
- `CreationMediaRuntime` 只按 `route` 分发，不根据 `upstreamFamily` 直接决定是否进 RH。

---

## 5. 身份字段与模型契约

旧字段 `provider: gateway-image/video/audio` 只能说明“走 NewAPI 媒体端点族”，不能表达真实渠道。

对照 Pixelle-Video 后，本方案明确采用五个身份字段，避免把来源、路由、上游供应商、接口风格混在一个字段里。

```ts
export type CreationSource =
  | 'newapi-direct'
  | 'runninghub'

export type CreationRoute =
  | 'newapi-direct'
  | 'runninghub-adapter'

export type CreationUpstreamFamily =
  | 't8'
  | 'volcengine'
  | 'worldrouter'
  | 'trump'
  | 'runninghub'
  | 'openai-compatible'
  | 'unknown'

export type CreationApiStyle =
  | 'openai-images'
  | 'openai-image-edits'
  | 'openai-videos'
  | 'newapi-task'
  | 'seedance-task'
  | 'suno-task'
  | 'rh-standard'
  | 'rh-aiapp'

export type CreationMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'video-edit'
  | 'text-to-audio'
  | 'lyrics'
  | 'digital-human'
  | 'voice-clone'
  | 'voice-design'
  | 'workflow'

export type CreationContractStatus =
  | 'verified'
  | 'partial'
  | 'unknown'
```

强约束：

```text
route = runninghub-adapter
  必须 source = runninghub
  必须 upstreamFamily = runninghub
  必须允许进入 rh-adapter

route = newapi-direct
  必须 source = newapi-direct
  禁止进入 rh-adapter
```

字段含义：

| 字段 | 作用 | 示例 |
|---|---|---|
| `source` | 创作面板看到的大来源 | `newapi-direct`, `runninghub` |
| `route` | Runtime 分发依据 | `newapi-direct`, `runninghub-adapter` |
| `upstreamFamily` | NewAPI 后面真实供应商/渠道族 | `t8`, `volcengine`, `worldrouter`, `trump`, `runninghub` |
| `apiStyle` | 参数映射和轮询契约 | `openai-images`, `seedance-task`, `rh-aiapp` |
| `contractStatus` | 当前参数契约可信度 | `verified`, `partial`, `unknown` |

UI 可以继续显示“渠道：T8 直连 / RunningHub 官方 API / RunningHub 工作流”，但代码里必须按上述字段区分。

---

## 6. 模型 registry 结构

建议用一张统一模型表承载 notes 中所有模型。它是前端事实源，不是价格源；真实扣费仍以 NewAPI 为准。

```ts
export interface CreationModelSpec {
  id: string                 // 前端唯一 ID，建议命名空间化
  model: string              // 提交给 NewAPI 的模型名
  label: string              // UI 展示名
  task: 'image' | 'video' | 'audio' | 'digital-human'
  source: CreationSource
  route: CreationRoute
  upstreamFamily: CreationUpstreamFamily
  apiStyle: CreationApiStyle
  mode: CreationMode
  contractStatus: CreationContractStatus
  price?: number             // 仅展示/核对，实际扣费以 NewAPI 为准
  endpoint: string           // NewAPI path，不是 RunningHub 官方域名
  poll?: {
    kind: 'none' | 'newapi-task' | 'rh-task' | 'suno-task' | 'seedance-task'
    pathTemplate?: string
  }
  files?: {
    images?: { min?: number; max?: number }
    videos?: { min?: number; max?: number }
    audios?: { min?: number; max?: number }
  }
  capabilities: {
    officialAbilityTypes: string[]     // 官方文档宣称的能力
    adapterAbilityTypes: string[]      // 当前 Runtime / adapter 已验证可用的能力
    inputModalities: Array<'text' | 'image' | 'video' | 'audio'>
    outputModalities: Array<'image' | 'video' | 'audio' | 'text'>
    ratios?: string[]
    resolutions?: string[]
    duration?: { min?: number; max?: number; allowedValues?: number[] }
    assetFlow: 'none' | 'newapi-upload' | 'seedance-asset' | 'rh-upload'
    resultExtractor: 'openai-image' | 'openai-video' | 'newapi-task' | 'suno' | 'rh-task' | 'generic-media'
  }
  fields: CreationFieldSpec[]
  aliases?: string[]         // 兼容价格表 / NewAPI alias / UI 中文名
  notes: string[]            // 对应 docs/notes 文件
  sourceUrls?: string[]       // 官方文档 / NewAPI 渠道文档 / RH 文档链接
  verifiedAt?: string         // 最近一次人工核对日期，YYYY-MM-DD
  contractIssues?: string[]   // 未确认或暂不支持的官方能力
}
```

ID 命名建议：

```text
newapi/t8/gpt-image-2
newapi/t8/grok-video-3
newapi/volcengine/doubao-seedance-2-0-260128
newapi/trump/seedance-2.0
runninghub/api/rh-gpt2-image
runninghub/api/rh-seedance2-image-video
runninghub/aiapp/rh-digital-human-fast
```

这样即使模型名相似，也不会把 T8 GPT Image 2 和 RH GPT2 混成一个模型。

### 6.1 能力契约双层声明

对照 Pixelle-Video 后，模型能力必须区分两层：

```text
officialAbilityTypes
  官方文档、渠道文档或 RH 文档宣称支持的能力。

adapterAbilityTypes
  当前韭菜盒子 Runtime / rh-adapter 已经映射、测试、可稳定提交的能力。
```

示例：

```ts
capabilities: {
  officialAbilityTypes: [
    'text_to_video',
    'image_to_video',
    'start_end_frame_i2v',
    'native_audio',
    'multi_shot',
  ],
  adapterAbilityTypes: [
    'text_to_video',
    'first_frame_i2v',
    'native_audio',
  ],
  inputModalities: ['text', 'image'],
  outputModalities: ['video'],
  // ...
}
```

规则：

- UI 默认只暴露 `adapterAbilityTypes` 对应的能力。
- `officialAbilityTypes` 只用于排障、契约说明和后续扩展，不代表本次已经支持。
- 如果官方支持但当前 adapter 未支持，必须写进 `contractIssues`，不能让用户误以为可用。

### 6.2 Registry 查询接口

`CreationPanel` 不直接遍历原始 registry，也不根据模型名猜渠道。它只通过查询接口拿可展示模型：

```ts
interface ListCreationModelsFilter {
  task?: 'image' | 'video' | 'audio' | 'digital-human'
  source?: 'all' | CreationSource
  mode?: CreationMode
  includeDisabled?: boolean
}

interface CreationModelListItem {
  id: string
  label: string
  task: CreationModelSpec['task']
  source: CreationSource
  upstreamFamily: CreationUpstreamFamily
  mode: CreationMode
  price?: number
  contractStatus: CreationContractStatus
  disabledReason?: string
  badges: string[]
}

function listCreationModels(filter: ListCreationModelsFilter): CreationModelListItem[]
```

UI 使用 `source` 做一级筛选，用 `upstreamFamily` 做模型卡片上的辅助标签或 tooltip，不把 Runtime 选择逻辑塞进组件。

### 6.3 Pixelle-Video 对照结论

Pixelle-Video 当前把能力分成三类：

```text
api        → 直连 OpenAI / DashScope / ARK / Kling / Seedance 等供应商
runninghub → 云端工作流，通过 workflow_id 执行
selfhost   → 本地 ComfyUI 工作流
```

它值得借鉴的是：

- UI 先选 source，再只展示该 source 下的模型/工作流。
- API 模型也被包装成 `api/provider/model` 形态，和工作流列表一样可选择。
- 每个 API 视频模型有 `capabilities / adapter_ability_types / api_contract_verified / contract_issues`。
- RunningHub 工作流文件只保存 `{ source: "runninghub", workflow_id: "..." }`，执行层再映射到 ComfyKit。

我们不照搬的是：

- 不引入 selfhost / 本地 ComfyUI，本次不做第三条渠道。
- 不让用户配置各供应商 API Key，统一走主 NewAPI Token。
- 不做 Pixelle 的脚本、分镜、TTS、合成视频流水线。
- 不把 RunningHub 工作流和 API 直连混到同一个 adapter。

最终吸收为本项目规则：

```text
Pixelle 的 source/provider/capability 思想 → 我们的 source/route/upstreamFamily/apiStyle/contractStatus。
Pixelle 的 api/provider/model key → 我们的命名空间化 CreationModelSpec.id。
Pixelle 的 api_contract_verified → 我们的 contractStatus。
```

### 6.4 外部反馈采纳结论

已采纳：

- `officialAbilityTypes / adapterAbilityTypes` 双层能力声明。
- UI 只用 source 级筛选：`全部 / 直连 / RunningHub`。
- `contractStatus / contractIssues` 在模型卡片和摘要区轻量展示。
- `listCreationModels()` 作为 UI 获取模型列表的统一入口。
- `contractStatus` 对应的 verified / partial / unknown 降级策略。
- `CreationTaskError` 错误分类、`planSnapshot`、`assetFlow` 可观测。

部分采纳：

- Pixelle 的“打印模型请求参数”思路：本次只通过 `CreationRunPlan.debug.normalizedParams` 和 `planSnapshot` 保留调试入口，不在小白 UI 中默认展示原始 payload。
- Pixelle 的 RunningHub 并发意识：本次 SDD 只要求任务状态和错误可恢复；客户端并发限流可作为后续增强，不进入能用版验收。

不采纳为本次目标：

- 内容安全自动改写并重试。原因：这会改变用户提示词语义，且属于生成策略，不属于本次“参数不串线、渠道能用”的核心范围。
- selfhost / 本地 ComfyUI。原因：第三条渠道会扩大架构面，本次明确只做 NewAPI 直连和 RunningHub。
- Pixelle 式脚本、分镜、TTS、合成视频流水线。原因：本次创作面板是原子媒体生成器，不是全自动短视频引擎。

---

## 7. 本次必须承载的模型清单

价格只作为前端核对和开发排障参考，真实扣费以 NewAPI 后台为准。

### 7.1 NewAPI 直连 - 图片

| 模型/别名 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| `gpt-image-2` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.15 | `T8gpt2.md` |
| `gpt2.0` | NewAPI 直连别名 | newapi-direct | 图片 | 0.15 | NewAPI alias |
| `grok-4.2-image` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.2 | `T8grok.md` |
| `gemini-3.1-flash-image-preview` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.1 | `T8gemini.md` |
| `gemini-3.1-flash-image-preview-2k` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.1 | `T8gemini.md` |
| `gemini-3-pro-image-preview` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.2 | `T8gemini.md` |
| `gemini-3-pro-image-preview-2k` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.4 | `T8gemini.md` |
| `gemini-3-pro-image-preview-4k` | T8 / NewAPI 直连 | newapi-direct | 文生图 / 图生图 | 0.5 | `T8gemini.md` |

图片直连参数规则：

- GPT Image 2 使用 `size`，如 `2048x1152`，不是 RH 的 `aspectRatio + resolution`。
- Grok Image 使用 `aspect_ratio`。
- Gemini / Banana 系列按 notes 支持比例时，用 `aspect_ratio` 或模型要求的字段。
- 图生图有参考图时必须走对应模型支持的编辑/生成接口；不能统一假设 `/v1/images/edits`。

### 7.2 NewAPI 直连 - 视频

| 模型/别名 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| `grok-video-3` | T8 / NewAPI 直连 | newapi-direct | 文生视频 / 图生视频 | 0.2 | `T8grok.md` |
| `grok-video-3-fast` | T8 / NewAPI 直连 | newapi-direct | 文生视频 / 图生视频 | 0.2 | `T8grok.md` |
| `veo3.1-fast` | T8 / NewAPI 直连 | newapi-direct | 文生视频 / 图生视频 | 0.4 | `T8模型接口配置文档.md` |
| `veo_3_1-fast` | NewAPI alias | newapi-direct | 文生视频 / 图生视频 | 0.4 | NewAPI alias |
| `seedance-2.0` | WorldRouter / 特朗普 | newapi-direct | 文生视频 / 图生视频 | 1 | `特朗普seedace2.md` |
| `seedance-2.0-fast` | WorldRouter / 特朗普 | newapi-direct | 文生视频 / 图生视频 | 1 | `特朗普seedace2.md` |
| `seedance-2-0` | T8 / 火山 | newapi-direct | 文生视频 / 图生视频 | 1 | `t8seedance.md` |
| `seedance-2-0-pro` | T8 / 火山 | newapi-direct | 文生视频 / 图生视频 | 1 | `t8seedance.md` |
| `seedance-2-0-fast` | T8 / 火山 | newapi-direct | 文生视频 / 图生视频 | 1 | `t8seedance.md` |
| `doubao-seedance-2-0-260128` | 火山引擎 | newapi-direct | 文生视频 / 图生视频 | 1.5 | `火山引擎seedance2.0.md` |

视频直连参数规则：

- T8 Grok 视频使用 `/v2/videos/generations` 风格；当前通过 NewAPI 代理时以 NewAPI 实际路径为准。
- Seedance 可能有三套路径：
  - NewAPI 兼容 `/v1/video/generations`
  - T8/火山代理 `/api/seedance/v1/videos`
  - WorldRouter/特朗普 `/api/v3/contents/generations/tasks`
- Runtime 必须按模型 spec 路由，不能只靠模型名里含 `seedance` 判断。

### 7.3 NewAPI 直连 - 音频

| 模型/能力 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| T8 Suno 自定义歌曲 | T8 / NewAPI 直连 | newapi-direct | 文生歌 | NewAPI 后台 | `T8suno 音乐模型文档.md` |
| T8 Suno 灵感模式 | T8 / NewAPI 直连 | newapi-direct | 文生歌 | NewAPI 后台 | `T8suno 音乐模型文档.md` |
| T8 Suno 歌词 | T8 / NewAPI 直连 | newapi-direct | 歌词 | NewAPI 后台 | `T8suno 音乐模型文档.md` |

本次能用版建议只先承载单次提交型音频能力：

- 自定义歌曲
- 灵感歌曲
- 歌词生成

T8 Suno 文档里的上传续写、Persona、曲声分离、Timing、拼接歌曲属于多步骤工作流。本次可先在 registry 中保留能力定义，但 UI 默认不暴露，等基础音频跑通后再打开。

### 7.4 RunningHub 标准 API - 图片

| 模型/别名 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| `rh-gpt2-image` | RunningHub | runninghub-adapter | 图生图 | 0.15 | `runninghub-GPT-image-2.md` |
| `rh-gpt2-text` | RunningHub | runninghub-adapter | 文生图 | 0.15 | `runninghub-GPT-image-2.md` |
| `z-image-turbo` | RunningHub | runninghub-adapter | 文生图 + LoRA | 0.05 | `runninghub-zimage-turbo模型.md` |
| `rh-image-v2` | RunningHub | runninghub-adapter | 文生图 | 0.3 | RH capabilities |
| `rh-pro-image` / 全能图片PRO | RunningHub | runninghub-adapter | 文生图 / 图生图 | NewAPI 后台 | `runninghub-banana.md` |

RH 图片参数规则：

- RH GPT2 使用 `resolution: 1k | 2k | 4k`。
- 支持比例时用 RH 官方字段 `aspectRatio`，不要错误映射为 GPT Image 的 `size`。
- 有参考图时传 `imageUrls` / adapter 兼容的 `images`，由 RH adapter 处理上传/官方 payload。

### 7.5 RunningHub 标准 API - 视频

| 模型/别名 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| `rh-video-v31-fast` / 全能视频V3.1-Fast | RunningHub | runninghub-adapter | 文生视频 / 图生视频 | 2 | RH capabilities |
| `rh-grok-text-video` / Grok Video 文生视频 | RunningHub | runninghub-adapter | 文生视频 | 0.08 | `runninghub-grok-video-3文档.md` |
| `rh-grok-image-video` | RunningHub | runninghub-adapter | 图生视频 | 0.08 | `runninghub-grok-video-3文档.md` |
| `rh-grok-video-edit` | RunningHub | runninghub-adapter | 视频编辑 | 0.08 | `runninghub-grok-video-3文档.md` |
| `rh-seedance2-text-video` | RunningHub | runninghub-adapter | 文生视频 | 1.5 | `runninghub-seedance文档.md` |
| `rh-seedance2-image-video` | RunningHub | runninghub-adapter | 图生视频 | 1.5 | `runninghub-seedance文档.md` |
| `rh-seedance2-multimodal-video` | RunningHub | runninghub-adapter | 多模态视频 | 1.5 | `runninghub-seedance文档.md` |
| `rh-seedance2` / Seedance 2.0 文生/图生/全能生视频 | RunningHub | runninghub-adapter | 聚合别名 | 1.5 | `runninghub-seedance文档.md` |

RH 视频参数规则：

- Grok 视频：`resolution: 720p | 480p`，`duration: 6-30`。
- RH Seedance：`resolution: 480p | 720p | native1080p | 1080p | 2k | 4k`，`duration: 4-15`，`ratio` 支持 `adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9`。
- 多模态视频支持图片、视频、音频参考，UI 必须能区分素材类型。

### 7.6 RunningHub 标准 API - 音频

| 模型/别名 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| `rh-suno-v55-single` | RunningHub | runninghub-adapter | 一句话成歌 | 1 | `runninghub-suno.md` |
| `rh-suno-v55-custom` | RunningHub | runninghub-adapter | 自定义成歌 | 1 | `runninghub-suno.md` |
| `rh-suno-lyrics` | RunningHub | runninghub-adapter | 歌词生成 | 0.02 | `runninghub-suno.md` |
| `rh-speech-hd` | RunningHub | runninghub-adapter | 语音合成 | 0.5 | RH capabilities |
| `rh-speech-turbo` | RunningHub | runninghub-adapter | 语音合成 | 0.5 | RH capabilities |
| `rh-music` | RunningHub | runninghub-adapter | 音乐生成 | 0.5 | RH capabilities |
| `rh-voice-clone` | RunningHub | runninghub-adapter | 声音克隆 | 0.15 | RH capabilities |
| `rh-voice-design` | RunningHub | runninghub-adapter | 声音设计 | 0.15 | RH capabilities |

### 7.7 RunningHub AI App / 工作流

| 模型/别名 | 渠道 | route | 模式 | 价格 | notes |
|---|---|---|---|---:|---|
| `rh-aiapp-fast-digital-human` / `rh-digital-human-fast` | RunningHub | runninghub-adapter | 极速数字人 | 0.5 / 0.15 | `runninghub 5个工作流模型参数.md` |
| `rh-aiapp-digital-human` / `rh-digital-human` | RunningHub | runninghub-adapter | 数字人 | 0.5 / 0.2 | `runninghub 5个工作流模型参数.md` |
| `rh-aiapp-director` | RunningHub | runninghub-adapter | 我是导演 | 0.5 | `runninghub 5个工作流模型参数.md` |
| `rh-aiapp-voice-clone` | RunningHub | runninghub-adapter | 声音克隆工作流 | 0.5 | `runninghub 5个工作流模型参数.md` |
| `rh-aiapp-voice-design` | RunningHub | runninghub-adapter | 声音设计工作流 | 0.5 | `runninghub 5个工作流模型参数.md` |

工作流规则：

- UI 不展示 `nodeInfoList` 编辑器。
- UI 展示小白字段：人物照片、驱动音频、文本、声音描述、画面值等。
- Runtime / adapter 负责把小白字段映射成 `nodeInfoList`。
- 数字人类至少支持图片 + 音频输入。

### 7.8 非创作面板目标

| 模型 | 原因 |
|---|---|
| `jina-search` | 搜索模型，不属于创作面板媒体生成。保留在对话搜索链路，不进入 CreationPanel。 |

---

## 8. UI 结构

沿用当前创作面板上下结构，不做复杂左右分栏。

```text
┌──────────────────────────────────────────────┐
│ 顶部：正在运行任务 / 结果画廊 / 历史资产        │
├──────────────────────────────────────────────┤
│ 中部：类型 / 模型 / 来源 / 上游标签 / 模式 / 参数 │
├──────────────────────────────────────────────┤
│ 底部：素材上传 / 提示词 / 提交摘要 / 生成按钮    │
└──────────────────────────────────────────────┘
```

### 8.1 顶部结果区

每张卡片显示：

```text
模型名 · 来源 · 模式 · 比例/分辨率/时长 · 状态
```

说明：

- 卡片主标签显示 source 级来源：`直连` / `RunningHub`。
- `upstreamFamily` 显示为次级小标签或 tooltip：`T8`、`火山`、`特朗普`、`WorldRouter`。
- 失败卡片必须显示来源、模型、关键参数和错误分类，不能只显示“生成失败”。

失败卡片必须保留失败原因，不允许转圈消失。

### 8.2 中部模型区

推荐三段式：

```text
类型 tabs: 图片 / 视频 / 音频 / 数字人
来源筛选: 全部 / 直连 / RunningHub
模型选择: 模型名 + 来源 + 上游标签 + 价格
```

规则：

- source 筛选只暴露 `全部 / 直连 / RunningHub`，保持小白路径简单。
- `T8 / 火山 / 特朗普 / WorldRouter` 不做一级筛选，只作为模型卡片辅助标签和排障信息。
- 模型卡片显示 `contractStatus`：
  - `verified`：低调显示“已验证”。
  - `partial`：显示“部分确认”，可展开查看 `contractIssues`。
  - `unknown`：显示“契约未知”，提示参数可能与预期不一致。

### 8.3 底部输入区

根据模型 fields 动态渲染：

- `prompt` → 大文本框。
- `image/images` → 图片上传。
- `video` → 视频上传。
- `audio` → 音频上传。
- `select` → 下拉。
- `boolean` → 开关。
- `number` → 数字输入。

生成按钮上方常驻显示 `CreationRunPlan.submitSummary`。有 `warnings` 时，在摘要下方显示轻量提醒；plan 校验失败时，生成按钮禁用并显示阻断原因。

---

## 9. 参数映射规则

### 9.0 契约状态与降级策略

参数归一化必须按 `contractStatus` 做不同强度的处理：

| contractStatus | 行为 | UI 表现 |
|---|---|---|
| `verified` | 严格按 spec 校验。字段、取值、文件数量、ratio、resolution、duration 不匹配时阻止提交。 | 直接显示阻断原因 |
| `partial` | 做已知字段校验；未验证字段使用默认值或忽略，并写入 `CreationRunPlan.warnings`。 | 可提交，但摘要区显示提醒 |
| `unknown` | 只做基本类型、必填、文件数量和安全校验；不做强参数承诺。 | 可提交，但模型卡片和摘要区提示“契约未知” |

禁止在 `partial` 或 `unknown` 状态下静默修正关键参数。任何默认值替换、字段忽略、ratio/resolution 回退都必须进入 `warnings`。

### 9.0.1 模型字段必须物化进 RunPlan

`CreationModelSpec.fields` 是创作面板参数事实源，不只是 UI 展示说明。每次提交前，`CreationPanel / useCreation` 必须把当前模型 fields 中的参数物化到 `buildCurrentCreationParams()`，再交给 `CreationRunPlan`。

规则：

- 用户显式填写/选择的字段值优先。
- 用户未填写时，使用该字段的 `defaultValue`。
- 没有 `defaultValue` 且字段必填时，`CreationRunPlan` 必须阻止提交或给出明确错误。
- 通用状态字段（如 `ratio / aspectRatio / resolution / duration / size`）可以继续来自 `cpState.ar / cpState.res / cpState.dur / cpState.size`，但模型专属字段不能只停留在 registry。
- `select / number / boolean / text / textarea` 都必须进入 params；`image / images / video / audio` 继续由素材上传区物化。
- Runtime 不允许自行猜测模型专属参数默认值；默认值只能来自 `CreationModelSpec.fields`。

典型反例：

```text
z-image-turbo fields 中声明 outputFormat defaultValue=png，
但 buildCurrentCreationParams() 没有输出 outputFormat，
导致 RunPlan / Runtime / rh-adapter 都拿不到该字段，
最终 RunningHub 报 field 'outputFormat' is required。
```

验收：

```text
切换到 runninghub/api/z-image-turbo 后，即使用户不手动改输出格式，
buildCurrentCreationParams() 也必须包含 outputFormat=png 和 lora_strength=1。

用户如果在 UI 中改为 jpeg，则 RunPlan / Runtime / adapter / RH payload 必须使用 jpeg。
```

### 9.1 图片比例与分辨率

UI 可以展示统一的“比例 / 分辨率”，但提交时必须按渠道转换。

```text
GPT Image 2 / T8:
  UI 16:9 + 2k → size=2048x1152
  UI 9:16 + 2k → size=1152x2048

RH GPT2:
  UI 16:9 + 2k → aspectRatio=16:9, resolution=2k

Grok Image:
  UI 16:9 → aspect_ratio=16:9
```

禁止：

```text
把 RH 的 aspectRatio/resolution 错传给 T8 GPT Image 2
把 T8 的 size 错传给 RH GPT2
```

### 9.2 视频参数

统一 UI 字段：

```text
ratio
resolution
duration
generateAudio
returnLastFrame
```

各渠道自行映射：

- T8 Grok: `ratio`, `resolution`, `duration`, `images`
- T8 / 火山 Seedance: `content` 或兼容代理字段
- WorldRouter / 特朗普 Seedance: `/api/v3/contents/generations/tasks`，图像参考需要 asset helper
- RH Seedance: `imageUrls`, `videoUrls`, `audioUrls`, `ratio`, `resolution`, `duration`

### 9.3 音频参数

Suno 一句话：

```text
title
description / prompt
make_instrumental
```

Suno 自定义：

```text
title
lyrics / prompt
tags
negative_tags
make_instrumental
```

歌词：

```text
prompt
```

### 9.4 工作流参数

极速数字人：

```text
image → nodeId 4 field image
audio → nodeId 3 field audio
value → nodeId 10 field value
```

声音克隆 / 声音设计 / 数字人 / 导演工作流按 `runninghub 5个工作流模型参数.md` 建立字段映射表。

---

## 10. Runtime plan

每次生成前必须生成 `CreationRunPlan`。

```ts
export interface CreationRunPlan {
  modelId: string
  model: string
  label: string
  task: 'image' | 'video' | 'audio' | 'digital-human'
  source: CreationSource
  route: CreationRoute
  upstreamFamily: CreationUpstreamFamily
  apiStyle: CreationApiStyle
  mode: CreationMode
  contractStatus: CreationContractStatus
  endpoint: string
  usesRhAdapter: boolean
  pollKind: 'none' | 'newapi-task' | 'rh-task' | 'suno-task' | 'seedance-task'
  assetFlow: 'none' | 'newapi-upload' | 'seedance-asset' | 'rh-upload'
  submitSummary: string
  price?: number
  warnings?: string[]
  debug: {
    referenceImageCount: number
    referenceVideoCount: number
    referenceAudioCount: number
    normalizedParams: Record<string, unknown>
  }
}
```

强校验：

```text
source !== runninghub → usesRhAdapter 必须是 false
route === runninghub-adapter → source 必须是 runninghub
route === runninghub-adapter → upstreamFamily 必须是 runninghub
route === newapi-direct → source 必须是 newapi-direct
route === newapi-direct → usesRhAdapter 必须是 false
endpoint 必须是 NewAPI path，不是官方 RunningHub 域名
apiStyle=openai-images / openai-image-edits → 不允许生成 RH 的 aspectRatio + resolution payload
apiStyle=rh-standard / rh-aiapp → 不允许生成 GPT Image 的 size payload
```

`CreationRunPlan` 是提交前最后一道关口。只要 plan 校验失败，UI 必须阻止提交并显示清楚原因。

提交摘要必须默认可见，不能只藏在 debug 面板里。摘要至少包含：

```text
来源 / 上游标签 / 模式 / 素材数量 / 关键参数 / pollKind / assetFlow
```

示例：

```text
直连 · T8 · 图生图 · 参考图 1 张 · size=2048x1152 · 同步返回
RunningHub · RH 官方 API · 图生图 · 参考图 1 张 · aspectRatio=16:9 · resolution=2k · rh-task
RunningHub · AI App 工作流 · 数字人 · 图片 1 张 · 音频 1 段 · rh-upload · rh-task
```

---

## 11. 任务与轮询

`mediaTaskStore` 继续作为唯一任务状态机：

```text
pending → running → success / failed / cancelled
```

任务必须保存：

```text
task.id
model / modelLabel
source / route / upstreamFamily / apiStyle / mode
planSnapshot
params snapshot
upstreamTaskId
pollUrl
pollKind
resultUrl / resultText
errorMsg
error.category
error.stage
```

建议错误结构：

```ts
export type CreationErrorCategory =
  | 'plan-validation'
  | 'upload'
  | 'newapi'
  | 'rh-adapter'
  | 'upstream-rh'
  | 'upstream-t8'
  | 'upstream-volcengine'
  | 'upstream-worldrouter'
  | 'upstream-trump'
  | 'network'
  | 'result-extract'
  | 'unknown'

export type CreationErrorStage =
  | 'validation'
  | 'upload'
  | 'submit'
  | 'poll'
  | 'result-extract'

export interface CreationTaskError {
  category: CreationErrorCategory
  stage: CreationErrorStage
  message: string
  upstreamCode?: string | number
  raw?: unknown      // 仅开发调试展示，普通 UI 不直接暴露
}
```

`planSnapshot` 保存提交当时的精简 plan。即使后续 registry 改了，历史任务卡片也必须能显示当时真实走了什么来源、什么参数、什么轮询方式。

失败展示规则：

- `plan-validation`：显示“参数计划校验失败”。
- `upload`：显示“素材上传失败”，并标出 `assetFlow`。
- `newapi`：显示“NewAPI 渠道请求失败”。
- `rh-adapter`：显示“RunningHub 适配器请求失败”。
- `upstream-*`：显示具体上游失败，如 RH 官方任务失败、T8 上游失败、火山上游失败。
- `result-extract`：显示“任务完成但结果解析失败”。
- `unknown`：保留原始 `message`，但不能让任务转圈消失。

轮询规则：

| pollKind | 用途 | 示例 |
|---|---|---|
| `none` | 同步返回图片/音频 | GPT Image 2 同步返回 URL |
| `newapi-task` | NewAPI 异步任务 | Grok / Veo |
| `seedance-task` | Seedance 专用异步任务 | 火山 / WorldRouter |
| `rh-task` | RunningHub adapter 轮询 | `/rh/tasks/{taskId}` |
| `suno-task` | Suno 任务 | `/suno/fetch/{taskId}` |

---

## 12. NewAPI 与价格

用户已在 NewAPI 后台配置模型、渠道与价格。

前端只使用价格做展示和排障，不做本地扣费：

```text
扣费：NewAPI
模型价格：NewAPI 后台
前端价格：只展示/核对，不参与计算
```

如果 `/api/creation/models` 返回某模型不可用：

- UI 可以显示但禁用，提示“渠道未启用 / 模型暂不可用”。
- 不允许提交后才报“无可用渠道”。

---

## 13. rh-adapter 边界

`rh-adapter` 只接 RunningHub 模型：

```text
rh-gpt2-image
rh-gpt2-text
z-image-turbo
rh-image-v2
rh-pro-image
rh-video-v31-fast
rh-grok-*
rh-seedance2-*
rh-suno-*
rh-speech-*
rh-music
rh-voice-*
rh-aiapp-*
rh-digital-human*
```

它不接：

```text
gpt-image-2
gpt2.0 direct
grok-4.2-image
grok-video-3 direct
seedance-2.0 direct
seedance-2-0 direct
doubao-seedance-2-0-260128
gemini-*
veo*
T8 Suno direct
```

adapter 职责：

- RH 模型映射。
- RH 官方 payload 生成。
- RH 文件上传。
- RH AI App `nodeInfoList` 生成。
- RH 任务提交。
- RH 单次 query。

不做：

- 用户鉴权。
- 计费。
- 直连 NewAPI 模型转发。
- 创作面板任务状态。

---

## 14. 本次实施阶段

### P0：冻结 SDD 与模型清单

输出：

- 本文档确认。
- 从 `docs/notes/` 形成 `CreationModelSpec` 初稿。
- 价格表进入 registry 参考字段。
- Pixelle-Video 对照结论进入 SDD，作为契约层设计依据。

验收：

- 文档不再包含 Canvas 范围。
- 文档不再包含远期包装阶段。
- RH 与直连 NewAPI 边界清楚。
- `source / route / upstreamFamily / apiStyle / contractStatus` 字段定义清楚。

### P1：模型契约 registry 与 RunPlan

输出：

- 所有本次模型进入 `CreationModelSpec`。
- 每个模型声明 `source / route / upstreamFamily / apiStyle / capabilities / contractStatus`。
- 每个模型声明 `officialAbilityTypes / adapterAbilityTypes / assetFlow / resultExtractor`。
- `CreationRunPlan` 能根据 spec 和用户输入生成提交摘要。
- RunPlan 有强校验测试，禁止直连模型进入 rh-adapter。

验收：

- notes 中图片、视频、音频、数字人模型均能在 UI 找到。
- `jina-search` 不进入创作面板。
- 模型卡片显示来源、上游辅助标签与参考价格。
- 每个模型都能输出 `usesRhAdapter` 和参数摘要。
- GPT Image 2 direct 与 RH GPT2 的 plan 参数形态不同且正确。
- `partial / unknown` 模型能输出 warnings，不静默吞掉未验证参数。

### P2：UI 承载模型契约

输出：

- UI 能按类型/来源筛选。
- 每个模型能按 `fields` 动态渲染字段。
- 不可用模型可显示禁用原因。
- 生成按钮上方显示 `CreationRunPlan.submitSummary`。
- `contractStatus !== verified` 时能显示轻量提示和 `contractIssues`。

验收：

- 用户不用理解 endpoint / nodeInfoList。
- 用户能看到真实来源、上游辅助标签和关键参数。
- UI 不根据模型名猜是否 RunningHub。
- 来源筛选只显示 `全部 / 直连 / RunningHub`，`T8 / 火山 / 特朗普 / WorldRouter` 只作为辅助标签。

### P3：NewApiDirectRuntime 跑通

输出：

- GPT Image 2 / Gemini / Grok Image。
- Grok Video / Veo。
- Seedance 直连。
- 基础 T8 Suno。

验收：

- 直连模型 `usesRhAdapter=false`。
- 请求不进入 `/rh/tasks`。
- GPT Image 2 的比例/分辨率映射为 `size`，生成结果比例正确。
- Seedance 直连按 `apiStyle` 选择正确 endpoint / pollKind。

### P4：RunningHubRuntime 跑通

输出：

- RH GPT2 图片。
- RH Grok / Seedance / 全能视频。
- RH Suno / speech / music。
- RH 工作流：数字人、声音克隆、声音设计、导演。

验收：

- RH 模型 `usesRhAdapter=true`。
- NewAPI RH channel 命中 rh-adapter。
- adapter 返回 taskId 后可轮询 `/rh/tasks/{taskId}`。
- RH GPT2 图生图 `aspectRatio + resolution` 不丢。
- RH AI App 工作流由小白字段映射到 `nodeInfoList`，UI 不暴露节点编辑器。

### P5：任务恢复、错误、冒烟

输出：

- 失败原因保留。
- 刷新后可恢复可恢复的异步任务。
- 任务持久化保存 `planSnapshot`。
- 失败任务保存 `CreationTaskError.category / stage / message`。
- 每类渠道至少一个冒烟样例。

验收：

- 图片：GPT Image 2 direct、RH GPT2。
- 视频：Seedance direct、RH Seedance、RH Grok。
- 音频：RH Suno single、RH lyrics。
- 工作流：RH 极速数字人。
- 任一失败都能看出属于 UI 参数、NewAPI 渠道、rh-adapter、还是上游。
- 刷新恢复轮询时按持久化的 `route / pollKind` 选择 runtime，不重新根据模型名猜渠道。

---

## 15. ADR

### ADR-001：本次只做创作面板，不做 Canvas

**状态**: Accepted

**Context**

Canvas 画布和创作面板都涉及媒体生成，但本次目标是先把创作面板跑通。把 Canvas 一起接入会扩大范围，增加调试面。

**Decision**

本次所有设计和实现只修改创作面板链路。Canvas 相关文件不在本次任务内。

**Consequences**

- 正面：范围清晰，更容易把 NewAPI 直连和 RH 两个渠道先做稳。
- 负面：Canvas 后续仍需单独对齐这套 runtime。

### ADR-002：rh-adapter 是 RunningHub-only

**状态**: Accepted

**Decision**

只有 `source=runninghub`、`upstreamFamily=runninghub` 且 `route=runninghub-adapter` 的模型可以进入 rh-adapter。

**Consequences**

- 直连 NewAPI / T8 / 火山 / 特朗普模型不会被错误路由到 RH。
- RH 问题和直连问题可以分开排障。

### ADR-003：本次目标是能用，不做远期包装

**状态**: Accepted

**Decision**

UI 保留真实渠道名：NewAPI 直连、T8、火山、特朗普、RunningHub。暂不包装成统一品牌。

**Consequences**

- 排障透明。
- 用户可能看到技术名词，但这是当前稳定期的合理代价。

### ADR-004：模型 spec 是唯一前端事实源

**状态**: Accepted

**Decision**

创作面板不再靠组件内部字符串猜渠道。模型参数、渠道、路径、轮询策略都从 `CreationModelSpec` 读取。

**Consequences**

- 新增模型流程固定。
- 参数串线概率下降。
- 初期需要把 notes 转成较完整的模型 spec。

### ADR-005：吸收 Pixelle-Video 的契约分层，但不复制流水线

**状态**: Accepted

**Context**

Pixelle-Video 同时支持直连 API 模型、RunningHub 云端工作流和本地 ComfyUI。它的可取之处是把 source、provider、capabilities、contract verified 分开管理，避免 UI 和执行层靠字符串猜模型能力。

**Decision**

本项目只吸收该分层思想，不 fork、不照搬 Pixelle 的脚本/分镜/TTS/合成视频流水线。本次创作面板仍只有 NewAPI 直连和 RunningHub 两条执行渠道，但必须增加模型契约层：

```text
source / route / upstreamFamily / apiStyle / capabilities / contractStatus
```

**Consequences**

- 正面：新增模型时先填契约，再接 UI 和 Runtime，参数串线概率更低。
- 正面：T8 GPT Image 2 与 RH GPT2 即使名称接近，也会走不同 `apiStyle` 和参数映射。
- 负面：第一阶段需要把 notes 整理成较完整的 `CreationModelSpec`，不能只追加一个模型名。

### ADR-006：创作任务必须保留可解释真相

**状态**: Accepted

**Context**

当前创作面板最伤用户信任的问题不是“功能少”，而是失败或参数串线时看不出真实原因。外部反馈也指出，仅保留 `errorMsg` 不足以支撑排障。

**Decision**

每次提交前必须生成可见的 `CreationRunPlan.submitSummary`。每个任务必须持久化 `planSnapshot`，失败时必须保存结构化 `CreationTaskError`。

UI 筛选保持 source 级别：

```text
全部 / 直连 / RunningHub
```

`upstreamFamily` 只作为辅助标签，不作为小白用户的一级筛选。

**Consequences**

- 正面：用户能看到“我选了什么、实际提交什么、失败在哪一段”。
- 正面：刷新恢复和历史任务展示不依赖当前 registry，减少旧任务解释错误。
- 负面：任务数据结构需要迁移或兼容旧任务的 `errorMsg`。

---

## 16. 最终验收标准

本次创作面板 2.0 完成时，必须满足：

- 创作面板不依赖 Canvas。
- notes 中的媒体模型能被模型 registry 承载。
- 每个模型有 `source / route / upstreamFamily / apiStyle / capabilities / contractStatus`。
- 每个模型区分 `officialAbilityTypes` 和 `adapterAbilityTypes`。
- 用户能按图片/视频/音频/数字人选择模型。
- 用户能看见来源、上游辅助标签、模式、价格、关键参数。
- UI 来源筛选只显示 `全部 / 直连 / RunningHub`。
- NewAPI direct 模型不经过 rh-adapter。
- RunningHub 模型经过 NewAPI RH channel 和 rh-adapter。
- `CreationRunPlan` 能阻止直连模型进入 rh-adapter。
- `CreationRunPlan.submitSummary` 默认可见，并展示 `warnings`。
- GPT Image 2 direct 的 `size` 映射正确。
- RH GPT2 的 `aspectRatio + resolution` 映射正确。
- Seedance direct 与 RH Seedance 不混路由。
- RH 工作流不暴露 `nodeInfoList` 给小白用户。
- 任务失败保留结构化原因：`category / stage / message`。
- 异步任务保存 `taskId / pollUrl / pollKind / planSnapshot`。
- 每类模型至少完成一个真实冒烟样例。

---

## 17. 下一步

下一步不直接大改 UI。

推荐顺序：

1. 先把 `CreationModelSpec` 写出来，覆盖本 SDD 的模型清单。
2. 做 `CreationRunPlan` 只读测试，确认每个模型的 `source / route / upstreamFamily / apiStyle / endpoint / usesRhAdapter`。
3. 再让创作面板读取 plan 展示渠道与摘要。
4. 最后逐步替换真实提交逻辑。

这样最稳，也最容易定位“比例不对 / 图片倒置 / 路由进错渠道”的问题。
