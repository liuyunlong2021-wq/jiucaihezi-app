# 创模式原生附件直连合同 SDD

> 日期：2026-07-21
> 状态：设计已确认，待实施
> 范围：Web / Desktop 创模式的云端直连模型；不改文、武模式
> 核心原则：模型原生能力优先，产品能力补位，Skill 和工具按需增强；工具不能成为模型原生能力的门槛。
> 默认策略：智能媒体增强默认开启；主模型不支持当前媒体时，由 Gemini 3.5 Flash 读取原件，主模型综合回答，精确工具按需验证。

## 1. 一句话目标

用户在创模式上传或引用图片、视频、音频、文件后，**原始附件必须优先进入具备真实输入能力的模型**；当前主模型不能读取时，默认由已验证的 Gemini 3.5 Flash 媒体专家读取原件，再把结构化理解交回主模型。媒体生成计划和精确工具只能继续增强，不能把原始附件截成元数据摘要，也不能阻止模型理解。

### 1.1 创模式只有一个运行时

创模式不是“对话模型 + 媒体面板 + Skill”三套互相抢任务的系统。它只有一条主链和一个模型循环：

```text
用户点击发送
  -> ChatPanel 冻结本轮文字、附件身份、项目/画布素材快照
  -> 能力解析器读取“当前模型 + 当前渠道”的已验证输入能力
  -> 主模型原生支持：原始附件直接交给主模型
  -> 主模型不支持 + 智能媒体增强开启：Gemini 3.5 Flash 读取原件
       -> 媒体理解结果进入同一轮主模型上下文
  -> buildCreativeContext() 组装项目记忆和会话上下文
  -> buildDirectMessages() 生成唯一 messages 请求
  -> runDirectChatCompletion() 进入唯一模型循环
       -> 模型直接回答：显示并保存最终回复
       -> 模型要求工具：权限检查 -> 执行工具 -> 结果回模型 -> 继续循环
       -> 模型要求媒体生成：形成媒体计划 -> 显示确认卡 -> 用户确认
            -> Creation Runtime 执行 -> 结果登记为同一会话素材
```

文、武模式继续使用 OpenCode；本 SDD 不改变它们。Gemini 媒体专家只是 Direct Runtime 内的一次受控模型协作，不是第二个 Agent Runtime，也不让 CreationPanel、Skill 或 MCP 变成新的调度中心。

### 1.2 用户点击发送后的唯一时序

1. **接收输入**：`ChatPanel` 接收用户文字和附件，只冻结本轮素材身份与快照，不分析意图、不启动工具、不创建媒体任务。
2. **判断读取模型**：根据已验证的“模型 ID + 渠道 + 输入模态”能力决定读取路径。主模型支持时原件直传主模型；不支持且智能媒体增强开启时，把用户目标与原始媒体交给 Gemini 3.5 Flash。这里按能力路由，不按关键词猜任务。
3. **媒体专家理解**：Gemini 只负责读取媒体并返回可追溯的摘要、时间线、对白、观察事实和不确定项。它默认不替换用户选择的主模型，也不直接承担最终表达。
4. **构造一次主请求**：`buildCreativeContext()` 和 `buildDirectMessages()` 把用户目标、原生附件或 Gemini 媒体理解结果组装为主模型的唯一请求。当前模型支持 function calling 时附带已连接、已授权且兼容的候选工具。
5. **主模型做决定**：请求进入 `runDirectChatCompletion()`。主模型可以直接回答，也可以要求精确工具验证、调用其他能力或提出媒体生成计划；产品不通过关键词在主模型之前启动 FFmpeg、转写或 OCR。
6. **工具循环**：主模型返回普通工具调用时，运行时执行现有权限检查。允许后执行 Skill、项目文件、终端或 MCP 工具，把结构化结果追加回同一轮消息，再交给同一个主模型继续判断，直到返回最终回答。用户拒绝或工具失败也作为结果返回模型。
7. **媒体生成分支**：主模型提出图片、视频或音频生成计划时，产品只负责校验模型、素材、参数和价格并显示确认卡。用户确认后才由现有 Creation Runtime 付费执行；成功结果进入同一会话素材池，可在下一轮继续引用。CreationPanel 是执行与查看界面，不是第二个大脑。
8. **持久化结果**：会话保存用户消息、模型回复、模型协作说明、工具结果和可恢复的素材身份；不保存媒体 Base64，不把 Gemini 或工具结果伪装成主模型原生读取。

### 1.3 七层职责

| 层 | 主要组件 | 只负责什么 | 明确不负责什么 |
|---|---|---|---|
| 输入层 | `ChatPanel`、`FileUploader` | 接收文字/附件，冻结本轮素材身份 | 不判断意图，不运行 FFmpeg，不创建媒体计划 |
| 能力路由层 | 模型目录、渠道合同、附件解析器 | 判断主模型能否原生读取，并按用户设置选择直传或媒体专家 | 不静默替换主模型，不按关键词选择工具 |
| 媒体专家层 | Gemini 3.5 Flash 协作器 | 读取主模型不支持的原始媒体，返回结构化理解 | 不写最终回答，不执行媒体生成，不默认运行精确工具 |
| 上下文层 | `buildCreativeContext()`、`buildDirectMessages()` | 生成主模型唯一上下文与消息合同 | 不维护第二套会话，不隐藏实际读取模型 |
| 模型循环层 | `runDirectChatCompletion()` | 完成“模型 -> 工具请求 -> 工具结果 -> 模型”循环 | 不用关键词代替模型决策 |
| 能力执行层 | 核心工具、Skill、MCP、媒体计划、Creation Runtime | 执行模型明确请求且已获授权的动作 | 不能成为普通模型请求的门槛 |
| 展示持久层 | 消息气泡、确认卡、CreationPanel、会话存储 | 展示回复/状态/费用，保存可恢复身份 | 不保存媒体字节，不产生另一份事实流 |

### 1.4 三种结果分支

```text
模型直接回答
  -> 普通消息气泡

主模型不支持媒体
  -> Gemini 3.5 Flash 读取原件 -> 结构化理解回主模型
  -> 主模型直接回答，或继续要求精确工具验证

模型调用普通工具
  -> 权限门 -> 执行 -> 工具结果回模型 -> 模型最终回答

模型提出媒体生成
  -> 受控媒体计划 -> 用户确认卡 -> Creation Runtime
  -> 任务结果进入对话和项目素材 -> 后续继续引用
```

一句话分工：**主模型是总导演；Gemini 3.5 Flash 是默认媒体专家；Direct Runtime 是唯一调度循环；Skill、MCP、FFmpeg、转写和 OCR 是按需精确验证的候选手脚；CreationPanel 是受控媒体执行界面。**

## 2. 成功标准

本 SDD 完成只能在以下事实全部成立后宣称：

1. 一个真实小型 MP4 在生产 NewAPI 和已验证支持视频输入的对话模型上，最终请求体包含原始视频 data URL 或模型可访问 URL，不是文件名、时长、尺寸摘要。
2. 同一请求同时带视频和 `tools` 时，模型仍能读取视频；模型不支持 function calling 时只省略 `tools`，附件不丢失。
3. 图片、视频、音频、文件共用一份直连附件合同；Web 和 Desktop 共用同一消息构造器，只保留素材读取和 HTTP 传输差异。
4. 普通“分析这个视频”不创建媒体生成计划、不打开创作面板、不要求 Skill，也不启动 FFmpeg、Whisper 或终端。
5. 用户明确要求“用这张图生成视频”时，同一素材可以进入媒体编排确认卡；确认卡失败不影响模型已经完成的普通理解。
6. 不支持、过大、超时和用户取消都有明确结果；系统不得悄悄退化成只发送元数据摘要。
7. GPT、Claude、Grok 或 DeepSeek 等主模型遇到不支持的音视频时，默认由 Gemini 3.5 Flash 读取原件，界面明确显示“媒体由 Gemini 读取，最终由当前主模型回答”。
8. 用户说“不要使用工具”时允许模型协作但禁止 Skill、MCP、终端、FFmpeg、转写和 OCR；用户说“只用当前模型”时才禁止 Gemini 协作。
9. Gemini 结果不足时，主模型可以按需调用精确工具做时间点、镜头或逐字稿验证；简单问题不得无条件双跑工具。
10. 自动测试与真实请求证据都通过。仅有模型回复、界面显示附件或构建通过，不算原生附件验收。

## 3. 根因链路

### 3.1 原始附件在进入模型前被替换

`src/components/chat/FileUploader.vue` 对音频和视频先调用 `cacheMediaFileForLocalProcessing()`，再把附件写成文件名、类型、大小、时长、画面尺寸和缓存路径组成的 `textContent`。

这段逻辑最初服务本地媒体工具，本身有合理用途；错误在于它后来成为了模型能看到的唯一附件内容。产品补位越权替代了模型原生输入。

### 3.2 直连消息合同只有文字和图片

`src/utils/directMessageBuilder.ts` 的 `DirectApiMessageContent` 只允许：

- `text`
- `image_url`

视频、音频和通用文件没有模型输入类型。`ChatMessage.files` 又只保存提取后的文字，因此即使上游模型支持视频，公共发送函数也不可能把视频交给它。

### 3.3 媒体编排拿到视频，但没有交给对话模型

`50415c89` 为原生媒体编排增加了 `mediaReferenceValue`。外部视频会额外读取成 data URL，再进入 `mediaReferenceInputs`，供媒体生成计划使用。

同一轮发送中：

```text
视频原件 -> mediaReferenceInputs -> 媒体生成计划
视频摘要 -> files[] -> 对话模型
```

这造成两个错误：

1. 原件被生成计划占有，普通模型理解只收到摘要。
2. 外部视频可能被本地缓存和 `simpleReadDataURL()` 重复读取，文件越大，等待和内存占用越明显。

### 3.4 工具无条件进入请求，但与附件能力没有解耦

`src/composables/creativeChat.ts` 当前每轮都调用 `buildCreativeToolDefinitions()`，没有根据当前模型的 function calling 能力决定是否发送 `tools`。

工具本身不是视频丢失的首要根因；真正的问题是“模型输入能力”和“工具能力”没有独立判断。支持媒体但不支持工具的模型，不应因此失去整次请求。

### 3.5 根因定性

问题不是引用按钮、确认卡或某一个模型的局部 Bug，而是创模式缺少一份真正的原生附件发送合同。修复必须落在共享消息边界，不能继续给引用、Skill 或媒体面板打补丁。

## 4. 设计决策

### 4.1 保留现有 Direct Runtime

继续复用：

- `buildCreativeContext()`：上下文容量与项目记忆；
- `buildDirectMessages()`：唯一消息构造器；
- `runDirectChatCompletion()`：模型与工具循环；
- `safeFetch()` / Web fetch：双端传输适配；
- `ProjectFileService`：项目、画布和任务素材读取；
- `mediaReference.ts` / `mediaPlan.ts`：媒体生成素材身份和确认计划。

不接入 OpenCode sidecar，不引入 AI SDK，不新增第二个 Agent Runtime。

### 4.2 三种附件用途必须分开

同一个素材可以有三种用途，但三者不得互相替代：

| 用途 | 数据 | 谁消费 | 是否可以拦截模型输入 |
|---|---|---|---|
| 模型理解 | `modelAttachments` | `buildDirectMessages()` | 不可以 |
| 媒体生成 | `mediaReferences` | 媒体计划与 CreationPanel | 不可以 |
| 本地加工 | `localToolAttachments` | 终端、FFmpeg、Whisper | 不可以 |

处理顺序固定为：

```text
用户文本 + 原始附件
  -> 冻结本轮素材身份
  -> 按主模型/渠道能力判断原始字节能否直传
  -> 能直传：原始附件进入主模型 modelAttachments
  -> 不能直传 + 智能媒体增强开启：Gemini 媒体专家读取同一原件
       -> MediaUnderstandingResult 进入主模型上下文
  -> 构造一份主模型请求
  -> 主模型直接答复，或按需调用精确工具验证
  -> 只有用户要求生成媒体时，才从同一素材身份生成 mediaReferences 和确认卡
  -> 产品不静默替换主模型，也不在主模型决定前启动 FFmpeg、转写或 OCR
```

### 4.3 请求态和持久态分开

媒体字节不得写入 SQLite、普通消息 JSON、Wiki 或日志。

持久态只保存可恢复的素材身份与元数据：

```ts
interface DirectAttachmentRef {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'file'
  source: 'upload' | 'project' | 'canvas' | 'task'
  resource?: ProjectResource
  cachePath?: string
  remoteUrl?: string
}
```

请求前才解析成短生命周期载荷：

```ts
interface ResolvedDirectAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'file'
  value: string
}
```

`value` 只在当前请求内存在，可以是 data URL 或模型可访问 URL。不得把整段 Base64 持久化到创作会话。

### 4.4 只读取一次

本轮素材冻结后，每个附件最多解析一次：

- 模型请求复用该结果；
- 用户随后要求媒体生成时复用素材身份，确认前按既有媒体引用合同重新读取；
- 本地工具只有真的被模型调用时才解析 `localToolAttachments`，不能成为发送前置步骤。

当前上传阶段“先缓存一次，再为媒体引用读取一次”的双重 Base64 路径必须删除。若实现阶段无法在不扩大范围的前提下完成工具懒加载，第一阶段允许保留一个受大小限制的本地缓存，但模型请求和媒体引用必须复用同一读取结果，不能重复读取。

### 4.5 NewAPI 直连协议

先以生产环境真实验收为准。当前 NewAPI 上游 `GeneralOpenAIRequest` 已定义下列 Chat Completions 内容类型：

```text
图片 -> { type: "image_url", image_url: { url } }
视频 -> { type: "video_url", video_url: { url } }
音频 -> { type: "input_audio", input_audio: { data, format } }
文件 -> { type: "file", file: { filename, file_data } }
```

这只是上游代码事实，不等于当前生产 NewAPI 版本和每个渠道都已支持。实施前必须用真实 Token、真实生产域名和极小测试文件验证，不能仅凭上游类型写代码。

`DirectApiMessageContent` 扩展为上述最小联合类型，不增加 Provider Adapter、Factory 或新依赖。

### 4.6 主模型、媒体专家和工具能力独立

在现有 `ModelEntry` 上补充输入模态，不新建第二份模型能力目录：

```ts
inputModalities?: Array<'text' | 'image' | 'video' | 'audio' | 'file'>
```

来源优先级：

1. Gateway 模型目录真实返回的输入模态；
2. 生产合同测试已经证明的现有模型声明；
3. 无证据时只承诺已经确认的输入类型，不猜测视频能力。

工具规则：

- 模型支持 function calling：提供现有核心工具和用户已连接的候选 MCP 工具，由模型决定是否调用；
- 模型不支持 function calling：请求不带 `tools`，文本、原生附件或已完成的 Gemini 协作结果继续发送；媒体协作不依赖 function calling；
- 模型同时支持媒体与工具：同一个请求同时包含媒体 part 和 `tools`；
- 不用关键词路由替模型猜“这一轮是否需要工具”。“按需”指模型按任务决定调用，不是 App 先扣下工具或附件。

媒体协作不是普通工具调用，不依赖主模型是否支持 function calling。它发生在主模型请求构造前，只解决“谁能真实读取原始媒体”：

1. 主模型与渠道原生支持当前模态：直接把原件交给主模型，不额外调用 Gemini；
2. 主模型不支持、智能媒体增强开启且用户未锁定当前模型：Gemini 读取原件，主模型接收结构化理解；
3. 主模型原生支持但用户要求交叉验证，或主模型判断媒体理解存在关键不确定性：可以再请求 Gemini 协作；
4. Gemini 完成整体理解后，是否调用 FFmpeg、转写、视觉或 OCR 做精确验证，仍由主模型按任务需要决定；
5. 用户锁定当前模型时不调用 Gemini；工具是否可用再按用户的工具约束独立判断。

### 4.7 智能媒体增强与 Gemini 媒体专家

#### 4.7.1 默认策略

`智能媒体增强` 默认开启，不逐轮弹窗确认。处理期间在输入框上方显示轻量状态，完成后在本轮助手消息的模型信息中保留同一来源说明：

```text
本轮视频由 Gemini 3.5 Flash 读取，最终由 GPT-5.6 Terra 回答
```

这条状态必须真实反映本轮读取模型和最终回答模型，不能改变主模型选择器，也不能只在日志中记录。设置中允许关闭智能媒体增强；关闭后不再调用媒体专家，但不会关闭普通工具。

Gemini 3.5 Flash 必须先通过本 SDD Task 0 的生产渠道合同测试，才能成为默认媒体专家。未通过前只保留候选身份，不得上线默认路由。

#### 4.7.2 协作结果合同

Gemini 不返回面向用户的自由文本终稿，而是返回给主模型使用的结构化媒体理解：

```ts
interface MediaUnderstandingResult {
  assetId: string
  specialistModel: 'gemini-3.5-flash'
  modality: 'image' | 'video' | 'audio' | 'file'
  summary: string
  observations: string[]
  timeline?: Array<{
    startMs: number
    endMs: number
    description: string
    dialogue?: string
  }>
  transcript?: string
  uncertainties: string[]
}
```

`observations` 只写从媒体中看到或听到的事实，推测必须进入 `uncertainties`。主模型负责结合用户目标、项目记忆和对话上下文形成最终回答。协作结果可以进入本轮上下文，但原始媒体字节仍遵守请求态边界，不写入会话数据库。

#### 4.7.3 用户约束优先级

| 用户表达 | Gemini 媒体专家 | 普通工具 | 结果 |
|---|---:|---:|---|
| 未特别限制 | 默认允许 | 主模型按需调用 | 最强默认路径 |
| “不要使用任何工具” | 允许 | 禁止 | Gemini 读取，主模型直接综合，不运行 FFmpeg/OCR/Skill/MCP |
| “只用当前模型” | 禁止 | 允许 | 当前模型原生读取；不支持时可按需用工具补位 |
| “只用当前模型，也不准工具” | 禁止 | 禁止 | 当前模型不支持时明确无法真实分析 |
| “必须用 Gemini 分析” | 必须 | 仍按用户其他限制 | 原件交给 Gemini，最终回答模型按用户是否要求切换决定 |
| “必须用工具验证” | 按能力需要 | 必须 | 先完成模型理解，再执行对应精确工具并回主模型 |

“不要使用工具”不能被解释成“只用当前模型”；模型协作与普通工具必须在产品文案、状态和执行合同中分开。

#### 4.7.4 精确工具不是默认双跑

- 整体内容、主题、人物、情绪和剧情结构优先由媒体模型理解；
- 精确镜头时长、逐字对白、帧级证据、OCR 文本或文件结构需要时，主模型再调用对应工具；
- 简单问题不得为了“看起来更强”无条件执行 Gemini + FFmpeg + 转写全套流程；
- 主模型必须能看到 Gemini 的 `uncertainties`，并据此决定补验证、说明限制或直接回答。

### 4.8 2026-07-21 OpenRouter 五家模型能力快照

本表直接取自 `https://openrouter.ai/models` 对应的实时 `https://openrouter.ai/api/v1/models`，只保留本次指定的 GPT、Claude、Gemini、DeepSeek、Grok 五家大语言模型。`file` 是 OpenRouter 的通用文件输入声明，不自动等于韭菜盒子当前渠道已经支持所有 PDF、Office 或任意二进制文件。

| 家族 | 当前代表模型 | OpenRouter 输入模态 | 创模式当前判断 |
|---|---|---|---|
| OpenAI GPT | `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` | text + image + file | 可作为文字、图片、文件候选；不得宣称原生视频或音频。 |
| Anthropic Claude | `claude-sonnet-5`、`claude-fable-5`、`claude-opus-4.8` | text + image + file | 可作为文字、图片、文件候选；不得宣称原生视频或音频。 |
| Google Gemini | `gemini-3.5-flash` | text + image + file + audio + video | 五家中唯一被 OpenRouter 明确标注原生音频、视频输入的当前模型；作为第一阶段全附件直连首选候选。 |
| DeepSeek | `deepseek-v4-pro`、`deepseek-v4-flash` | text | 只按文字模型处理；媒体理解必须由模型按需调用候选工具补位。 |
| xAI Grok | `grok-4.5` | text + image + file | 可作为文字、图片、文件候选；不得宣称原生视频或音频。 |

这张表只用于缩小真实验收范围，不能直接写成生产能力白名单。最终能力必须同时满足：

1. 当前模型公开输入模态包含该类型；
2. 韭菜盒子实际使用的 NewAPI/RH 渠道接受对应 content part；
3. 真实小文件合同测试证明模型确实读取了内容，而不是只收到文件名或摘要。

同一模型经不同渠道可能能力不同。运行时记录的应是“模型 ID + 渠道 + 输入模态”的已验证组合，不能只按模型名称猜测。

### 4.9 第一阶段范围

第一阶段只保证：

- Web / Desktop 创模式；
- 韭菜盒子云端 NewAPI；
- 生产合同测试明确支持对应输入模态的对话模型；
- 当前附件、项目素材、画布素材和同会话任务素材进入同一 `DirectAttachmentRef` 合同。

第一阶段不承诺：

- Ollama 和自定义 OpenAI-compatible Provider 的视频/音频协议；
- 大文件上传服务、断点续传或云端媒体存储；
- 自动安装或强制使用 FFmpeg、Whisper；
- Pi 统一工具事实流、会话树、自动压缩；
- 修改媒体生成接口、模型注册表或 CreationPanel 提交协议。

## 5. 文件职责

| 文件 | 最小职责 |
|---|---|
| `src/components/chat/FileUploader.vue` | 保留原始附件身份；停止把音视频摘要当作唯一模型输入；停止重复 Base64 读取。 |
| `src/components/chat/ChatPanel.vue` | 一次冻结 `modelAttachments`、`mediaReferences` 和 `localToolAttachments`；普通理解不触发媒体计划。 |
| `src/composables/useChat.ts` | 给 `ChatMessage` / `SendMessageOptions` 增加轻量附件引用，不持久化媒体字节。 |
| `src/runtime/direct/creativeMemory.ts` | 上下文筛选保留附件引用；token 估算只计算文字和固定附件开销，不扫描 Base64。 |
| `src/runtime/direct/mediaSpecialist.ts` | 执行共享的智能媒体增强政策；调用已验证的 Gemini 媒体专家并返回 `MediaUnderstandingResult`，不生成最终回答。 |
| `src/utils/directMessageBuilder.ts` | 成为唯一的 text/image/video/audio/file 请求 part 构造器。 |
| `src/composables/creativeChat.ts` | Desktop 复用共享媒体专家政策，再提供工具执行和 HTTP 传输；按主模型能力决定是否传 `tools`。 |
| `src/composables/web/chatCloud.ts` | Web 调用同一媒体专家与消息合同；只保留 OPFS/Blob 读取与浏览器传输差异。 |
| `src/stores/agentStore.ts` | 在现有模型条目承载 `inputModalities`，并保存唯一已验证媒体专家身份，不建立第二份模型目录。 |
| `src/runtime/workbench/mediaReference.ts` | 继续负责媒体生成引用；不得改写或消费 `modelAttachments`。 |

不新增 Store、数据库表、Rust 媒体引擎、服务端上传服务或第三方依赖。

## 6. 错误合同

| 情况 | 产品行为 |
|---|---|
| 主模型不支持该输入模态 | 智能媒体增强开启且未锁定主模型时，由已验证的 Gemini 媒体专家读取原件，结果交回主模型；不得伪装成主模型原生读取。 |
| Gemini 媒体专家不可用或超时 | 保留附件和主模型选择；允许工具时由主模型决定是否使用精确工具补位，否则明确说明媒体专家暂不可用。不得静默更换第三个模型。 |
| 用户关闭智能媒体增强或要求“只用当前模型” | 不调用 Gemini；当前模型原生支持则直传，不支持时按工具约束补位或明确失败。 |
| 用户要求“不使用工具” | 仍可执行已开启的 Gemini 模型协作，但不得调用 Skill、MCP、终端、FFmpeg、转写、视觉或 OCR。 |
| 请求体过大 / HTTP 413 | 明确提示附件超过当前直传上限；不得自动重试同一大请求。 |
| 上游拒绝媒体协议 / HTTP 400、415 | 显示模型或渠道不支持；保留附件；不得删除媒体后偷偷重试。 |
| 上游超时 / HTTP 524 | 显示渠道超时并保留附件；不得自动改成纯文本请求。 |
| 工具不受支持 | 省略 `tools`；主模型原生附件和 Gemini 协作结果继续正常进入主请求。 |
| 本地缓存失败 | 只影响后续本地工具；若原始附件仍可直传，不得阻止模型请求。 |
| 用户取消 | 中止读取与请求，附件仍留在输入区供用户处理。 |

错误文案不得把“生成模型”“对话模型”“媒体引用”“模型理解”混为一谈。

## 7. 实施顺序

### Task 0：先验证生产真实协议

在不改运行代码的前提下，使用脱敏脚本或浏览器网络面板记录以下请求结果：

1. 当前默认 `gpt-5.6-terra` + 纯文本、极小图片、极小文件；
2. `gpt-5.6-terra` + 极小 MP4 和极小音频，确认渠道是否按预期拒绝，不把失败误记成支持；
3. `gemini-3.5-flash` + 极小图片、MP4、音频和文件；
4. `gemini-3.5-flash` + 同一 MP4 + 一个无副作用工具定义；
5. `deepseek-v4-pro` 或 `deepseek-v4-flash` + 同一 MP4，验证附件身份进入模型、原始视频不被伪装成已读取，并允许模型按需请求候选工具；
6. 渠道已提供时，再补 `claude-sonnet-5` / `claude-fable-5` / `claude-opus-4.8` 与 `grok-4.5` 的图片和文件合同测试。

记录：模型 ID、渠道、内容 part 类型、MIME、字节数、是否含 tools、HTTP 状态、首个错误、模型是否引用了附件真实内容；不记录 Token 和媒体 Base64。

如果当前默认模型或渠道不接受 `video_url`，第一阶段必须先证明 `gemini-3.5-flash` 在生产渠道真实读取视频和音频，才能启用默认智能媒体增强。主模型身份保持不变，界面明确显示 Gemini 负责读取媒体；不得通过改前端伪造支持。

验收：拿到至少一个真实成功的视频/音频请求和一个真实不支持请求，形成“模型 ID + 渠道 + 输入模态”的可重复协议事实。

### Task 1：先写失败测试固定原生附件合同

新增测试证明当前代码失败：

1. 视频必须生成 `video_url` part，而不是 `[本地媒体文件]` 文本；
2. 图片、视频、音频、文件能和文字共存；
3. 媒体 part 与 `tools` 可同时存在；
4. 工具能力为 false 时只省略 tools；
5. `buildCreativeContext()` 不因 Base64 长度丢弃当前用户附件；
6. 媒体引用创建失败不改变模型附件；
7. 同一外部视频不会执行两次完整文件读取。
8. GPT-5.6 Terra + 视频在智能媒体增强开启时调用 Gemini，Gemini 结果进入 GPT 主请求，最终回答仍标记为 GPT。
9. “不要使用工具”允许 Gemini 协作但不会执行普通工具；“只用当前模型”不会调用 Gemini。
10. Gemini 不确定项可以触发主模型请求精确工具；简单媒体问答不会无条件双跑工具。

验收：测试先在现状下失败，失败点准确指向消息合同，不使用源码字符串代替行为断言。

### Task 2：建立单一附件引用

1. 为 `ChatMessage` / `SendMessageOptions` 增加 `attachments` 引用。
2. `FileUploader` 输出原始引用、显示元数据和可选本地处理信息；显示摘要不再进入模型正文。
3. 项目、画布、任务和本轮上传统一转成 `DirectAttachmentRef`。
4. 当前轮发送前解析成 `ResolvedDirectAttachment`，解析完成后再清空输入区。

验收：用户消息 UI 仍显示附件；持久化消息不含 Blob、File、ArrayBuffer 或媒体 Base64。

### Task 3：扩展共享直连消息构造器

1. 在 `directMessageBuilder.ts` 增加 NewAPI 已实测通过的媒体 part。
2. 最新用户消息保留文字和全部原生附件；历史消息只使用仍可恢复的附件引用。
3. Web 和 Desktop 都调用同一构造器，不各自拼一套 `video_url`。
4. 请求诊断只记录附件 kind、MIME、大小和来源，不记录 value。

验收：同一标准化输入在 Web / Desktop 生成相同的 `messages` 与 `tools`，平台差异只存在于读取和 fetch。

### Task 4：建立智能媒体增强与 Gemini 协作

1. 新增共享 `mediaSpecialist` 政策：智能媒体增强默认开启，媒体专家固定为通过 Task 0 的 `gemini-3.5-flash` 渠道。
2. 主模型原生支持当前模态时不调用媒体专家；不支持且用户未锁定当前模型时，先把用户目标和原始媒体交给 Gemini。
3. Gemini 返回 `MediaUnderstandingResult`；主模型请求只接收结构化结果和素材身份，不把 Gemini 自由文本冒充用户终稿。
4. Desktop 与 Web 复用同一协作判断、结果合同和错误合同；不各自实现模型切换。
5. 本轮消息显示“媒体由 Gemini 读取，最终由当前主模型回答”的轻量状态；不逐轮弹窗。
6. 分别实现“禁止工具”“锁定当前模型”“禁止工具并锁定模型”的独立约束，用户明确指令优先于默认设置。
7. Gemini 失败时不静默改用其他模型；允许工具则把失败和附件身份交给主模型决定补位，否则明确结束。

验收：GPT-5.6 Terra 分析视频时由 Gemini 读取原件、GPT 输出终稿；选择 Gemini 3.5 Flash 作为主模型时直接读取，不发生重复协作；关闭智能媒体增强后不调用 Gemini。

### Task 5：解耦媒体编排和工具

1. 普通理解始终先构造模型请求。
2. 只有模型基于用户目标提出合法的图片、视频或音频生成计划时，才解析计划并显示确认卡；产品不使用关键词在模型前面创建计划。
3. 媒体计划引用复用素材 ID，不持有模型请求 Base64。
4. `creativeChat.ts` 和 `chatCloud.ts` 按当前模型 function calling 能力决定 `tools` 字段；不支持工具时仍完成原生媒体请求。

验收：“分析视频”只有模型答复；“基于这个视频生成新视频”才出现确认卡；两者都不要求先选 Skill。

### Task 6：结果级验证

自动验证：

```text
定向附件合同测试
Direct Runtime 测试
创模式双端调用测试
媒体计划回归测试
pnpm run test:focused
pnpm exec vue-tsc -b
pnpm run build
pnpm run build:desktop
git diff --check
```

真实人工矩阵：

| 场景 | Desktop | Web |
|---|---:|---:|
| 小图片原生理解 | 必测 | 必测 |
| 小视频原生理解 | 必测 | 必测 |
| 小音频原生理解 | 必测 | 必测 |
| 小文件原生理解 | 必测 | 必测 |
| 小视频 + tools 同请求 | 必测 | 必测 |
| GPT/Claude/Grok/DeepSeek + 视频自动使用 Gemini | 必测 | 必测 |
| Gemini 主模型不重复调用媒体专家 | 必测 | 必测 |
| “不要使用工具”仍允许 Gemini、禁止普通工具 | 必测 | 必测 |
| “只用当前模型”禁止 Gemini、允许普通工具 | 必测 | 必测 |
| Gemini 结果不足后主模型按需精确验证 | 必测 | 必测 |
| Gemini 不可用且工具被禁用 | 必测 | 必测 |
| 超限附件 | 必测 | 必测 |
| 项目/画布素材进入理解 | 必测 | 必测 |
| 同一素材随后生成视频 | 必测 | 必测 |
| 取消、重试、新会话 | 必测 | 必测 |

Windows、Intel Mac、Apple Silicon 的正式安装包至少各完成一次小视频直连；不能用开发态 Mac 验收代替三平台结果。

## 8. 明确不做

- 不把视频理解重新做成 Skill。
- 不把 FFmpeg、Whisper 或终端设为所有视频请求的必经路径。
- 不在主模型判断之前自动运行 FFmpeg、转写、视觉或 OCR。
- 不静默替换用户选择的主模型；智能媒体增强只能透明委托 Gemini 读取媒体，最终回答模型必须明确。
- 不把 Gemini 与精确工具无条件双跑；简单媒体理解只走必要的最短路径。
- 不因为媒体生成需要引用，就强制普通理解进入媒体计划。
- 不把 Base64 写进 SQLite、项目 Wiki、日志或错误文案。
- 不用模型名称关键词无限猜能力；没有生产证据就不宣称支持。
- 不为兼容未知 Provider 编写第二套附件 Adapter。
- 不在本 SDD 中执行 [[Pi统一事实流升级SDD]]；它解决工具生命周期，不解决原始附件输入，应在本合同闭环后再实施。

## 9. 风险与取舍

### 9.1 NewAPI 上游支持不等于生产渠道支持

风险最大。`video_url` 可能被生产 NewAPI 接收，却在具体 Claude、GPT、Gemini 或代理渠道转换时失败。因此 Task 0 是实施门槛，不是可选测试。

### 9.2 data URL 有体积和内存成本

第一阶段不建设上传服务。直传上限必须由生产实测决定，并明显低于 Cloudflare、NewAPI 和上游中最小限制。超限时明确停止，不允许卡死或自动删附件重试。

### 9.3 历史会话附件恢复

只持久化引用意味着临时上传文件被清理后可能无法重新发送。第一阶段优先使用项目资源、画布资源、任务结果或 App 媒体缓存作为可恢复来源；找不到原件时明确要求用户重新选择，不从旧摘要伪造附件。

### 9.4 工具可见不等于工具已使用

模型支持 function calling 时，把工具定义放进请求只是提供候选能力。只有模型真正返回 tool call 才算使用工具。产品不额外增加关键词路由器。

### 9.5 模型协作增加成本、延迟和跨渠道传输

主模型不支持媒体时会增加一次 Gemini 调用。产品必须显示实际参与的模型，并在设置中说明媒体会发送给 Gemini 渠道。不得因为默认开启就隐藏跨模型传输、费用或失败。第一阶段不做多媒体专家竞价或自动选择第三个模型，只使用一个已验证的 Gemini 3.5 Flash 专家槽位。

### 9.6 媒体专家结果不是原始媒体的永久替代品

`MediaUnderstandingResult` 是本轮协作证据，不等于主模型亲自读取原件，也不能替代项目中的真实素材身份。后续需要精确时间点、逐字稿或帧级证据时，必须从同一素材身份重新按需调用确定性工具，不能只在 Gemini 摘要上继续猜测。

## 10. 完成后的架构关系

```text
                         +-> 主模型原生支持 -> 主模型直接理解
用户文本 + 原始附件 ----+
                         +-> 主模型不支持 -> Gemini 读取原件 -> 结果回主模型
                                                   +-> 主模型直接回答
                                                   +-> 按需精确工具验证
                         +-> 主模型按需调用 Skill / 文件 / 终端 / MCP
                         +-> 用户要求生成媒体 -> 媒体计划 -> 确认 -> CreationPanel
```

所有分支共享同一素材身份和 Direct Runtime。Gemini 是默认媒体专家，不是第二个会话；精确工具与媒体生成都不能成为普通回答的固定前置门槛。

## 11. 依据

- [[架构/产品架构]]：创模式核心原则与当前实现缺口。
- [[创作模式双端统一SDD]]：单一共享发送链路、真实媒体请求与双端合同。
- [[创作工作台架构SDD]]：工作台只组织任务，不取代模型原生输入。
- [[韭菜盒子原生媒体编排能力SDD]]：受控素材身份、确认卡与唯一媒体执行链。
- [[创模式MCP工具接入SDD]]：MCP 候选工具池和 function calling 边界。
- `src/components/chat/FileUploader.vue`、`ChatPanel.vue`、`src/utils/directMessageBuilder.ts`、`src/composables/creativeChat.ts`、`src/composables/web/chatCloud.ts`：当前真实实现。
- Git `69ca8216`、`2f3def3d`、`50415c89`：本地媒体摘要、直连多模态与原生媒体编排的演进证据。
- NewAPI 上游 `dto/openai_request.go`：`image_url`、`video_url`、`input_audio`、`file` 内容类型；只作协议候选，最终以生产实测为准。
- OpenCode 上游 `provider/transform.ts`：以模型 input modalities 判断 image/audio/video/pdf 是否可读；本项目只翻译“能力独立判断”原则，不接入其运行时。
- OpenRouter `https://openrouter.ai/models` 与 `https://openrouter.ai/api/v1/models`（读取日期 2026-07-21）：GPT、Claude、Gemini、DeepSeek、Grok 五家当前模型名称与 `architecture.modality`；只作候选能力快照，生产能力仍以韭菜盒子渠道合同测试为准。
