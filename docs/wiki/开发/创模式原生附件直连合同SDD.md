# 创模式原生附件直连合同 SDD

> 日期：2026-07-21
> 状态：设计已确认，待实施
> 范围：Web / Desktop 创模式的云端直连模型与 Desktop 本地模型；不改文、武模式
> 核心原则：模型原生能力优先，产品能力补位，Skill 和工具按需增强；工具不能成为模型原生能力的门槛。
> 分阶段策略：先独立闭环原生附件发送合同，再启用 Gemini 媒体专家；前者未通过真实验收时，不实施后者。
> 默认策略：第二阶段的智能媒体增强默认推荐开启；只有用户当前选中的 Provider/K 内存在并已验证 Gemini 3.5 Flash 时才能协作。没有则征得用户同意后用现有本地工具补位，工具不可用或用户拒绝时明确失败。
> 计费边界：韭菜盒子不提供公共 Gemini、不代付费、不读取其他分组或其他 Provider 的 K；所有模型调用只走用户当前选中的 Provider/K。

## 1. 一句话目标

用户在创模式上传或引用图片、视频、音频、文件后，**原始附件必须优先进入具备真实输入能力的模型**；当前主模型不能读取时，只能在用户当前 Provider/K 的可用模型中寻找已验证的 Gemini 3.5 Flash。找不到时，经用户同意后使用现有本地工具补位；两者都不可用时明确说明限制。媒体生成计划和精确工具只能继续增强，不能把原始附件截成元数据摘要，也不能阻止模型理解。

### 1.1 创模式只有一个运行时

创模式不是“对话模型 + 媒体面板 + Skill”三套互相抢任务的系统。它只有一条主链和一个模型循环：

```text
用户点击发送
  -> ChatPanel 冻结本轮文字、附件身份、项目/画布素材快照
  -> 能力解析器读取“当前模型 + 当前渠道”的已验证输入能力
  -> 主模型原生支持：原始附件直接交给主模型
  -> 主模型不支持 + 当前 Provider/K 有已验证 Gemini + 智能媒体增强开启：Gemini 读取原件
       -> 媒体理解结果进入同一轮主模型上下文
  -> 当前 Provider/K 没有 Gemini：询问是否使用现有本地工具
       -> 同意：工具结果进入同一轮主模型上下文
       -> 拒绝或工具不可用：明确无法真实读取
  -> buildCreativeContext() 组装项目记忆和会话上下文
  -> buildDirectMessages() 生成唯一 messages 请求
  -> runDirectChatCompletion() 进入唯一模型循环
       -> 模型直接回答：显示并保存最终回复
       -> 模型要求工具：权限检查 -> 执行工具 -> 结果回模型 -> 继续循环
       -> 模型要求媒体生成：形成媒体计划 -> 显示确认卡 -> 用户确认
            -> Creation Runtime 执行 -> 结果登记为同一会话素材
```

文、武模式继续使用 OpenCode；本 SDD 不改变它们。可用的 Gemini 媒体专家只是 Direct Runtime 内的一次受控模型协作，不是第二个 Agent Runtime，也不让 CreationPanel、Skill 或 MCP 变成新的调度中心。韭菜盒子不提供公共媒体模型服务。

上图是两个阶段全部完成后的目标架构，不代表两项能力必须同时落地。第一阶段只修“原始附件能否进入支持它的主模型”；该合同通过真实请求验收后，第二阶段才增加 Gemini 补位。两个阶段分别可测试、可提交、可回滚。

### 1.2 用户点击发送后的唯一时序

1. **接收输入**：`ChatPanel` 接收用户文字和附件，只冻结本轮素材身份与快照，不分析意图、不启动工具、不创建媒体任务。
2. **判断读取模型**：根据已验证的“当前 Provider/K + 模型 ID + 输入模态”能力决定读取路径。主模型支持时原件直传主模型；不支持时，只能在当前 Provider/K 已返回的模型目录中寻找已验证的 Gemini 3.5 Flash。这里按能力路由，不按关键词猜任务，不跨 Provider、分组或 K。
3. **补位理解**：当前 Provider/K 内有可用 Gemini 且用户已开启智能媒体增强时，Gemini 只负责读取媒体并返回可追溯的摘要、时间线、对白、观察事实和不确定项。没有 Gemini 时，产品先询问是否使用现有本地工具；用户拒绝或工具不可用就明确失败。
4. **构造一次主请求**：`buildCreativeContext()` 和 `buildDirectMessages()` 把用户目标、原生附件或 Gemini 媒体理解结果组装为主模型的唯一请求。当前模型支持 function calling 时附带已连接、已授权且兼容的候选工具。
5. **主模型做决定**：请求进入 `runDirectChatCompletion()`。主模型可以直接回答，也可以要求精确工具验证、调用其他能力或提出媒体生成计划；产品不通过关键词在主模型之前启动 FFmpeg、转写或 OCR。
6. **工具循环**：主模型返回普通工具调用时，运行时执行现有权限检查。允许后执行 Skill、项目文件、终端或 MCP 工具，把结构化结果追加回同一轮消息，再交给同一个主模型继续判断，直到返回最终回答。用户拒绝或工具失败也作为结果返回模型。
7. **媒体生成分支**：主模型提出图片、视频或音频生成计划时，产品只负责校验模型、素材、参数和价格并显示确认卡。用户确认后才由现有 Creation Runtime 付费执行；成功结果进入同一会话素材池，可在下一轮继续引用。CreationPanel 是执行与查看界面，不是第二个大脑。
8. **持久化结果**：会话保存用户消息、模型回复、模型协作说明、工具结果和可恢复的素材身份；不保存媒体 Base64，不把 Gemini 或工具结果伪装成主模型原生读取。

### 1.3 七层职责

| 层 | 主要组件 | 只负责什么 | 明确不负责什么 |
|---|---|---|---|
| 输入层 | `ChatPanel`、`FileUploader` | 接收文字/附件，冻结本轮素材身份 | 不判断意图，不运行 FFmpeg，不创建媒体计划 |
| 能力路由层 | 当前 Provider 模型目录、渠道合同、附件解析器 | 判断主模型能否原生读取，并在同一 Provider/K 内选择可用媒体专家 | 不跨 Provider、分组或 K，不按关键词选择工具 |
| 媒体补位层 | 可用 Gemini 协作器、现有本地工具 | Gemini 可用时读取原件；不可用时经用户同意执行本地工具 | 不提供公共模型，不代计费，不默认运行本地工具 |
| 上下文层 | `buildCreativeContext()`、`buildDirectMessages()` | 生成主模型唯一上下文与消息合同 | 不维护第二套会话，不隐藏实际读取模型 |
| 模型循环层 | `runDirectChatCompletion()` | 完成“模型 -> 工具请求 -> 工具结果 -> 模型”循环 | 不用关键词代替模型决策 |
| 能力执行层 | 核心工具、Skill、MCP、媒体计划、Creation Runtime | 执行模型明确请求且已获授权的动作 | 不能成为普通模型请求的门槛 |
| 展示持久层 | 消息气泡、确认卡、CreationPanel、会话存储 | 展示回复/状态/费用，保存可恢复身份 | 不保存媒体字节，不产生另一份事实流 |

### 1.4 三种结果分支

```text
模型直接回答
  -> 普通消息气泡

主模型不支持媒体
  -> 当前 Provider/K 有已验证 Gemini -> Gemini 读取原件 -> 结果回主模型
  -> 没有 Gemini -> 用户同意后执行现有本地工具 -> 结果回主模型
  -> 两者都不可用 -> 明确失败

模型调用普通工具
  -> 权限门 -> 执行 -> 工具结果回模型 -> 模型最终回答

模型提出媒体生成
  -> 受控媒体计划 -> 用户确认卡 -> Creation Runtime
  -> 任务结果进入对话和项目素材 -> 后续继续引用
```

一句话分工：**主模型是总导演；用户当前 Provider/K 内可用的 Gemini 是优选媒体专家；本地工具是需用户同意的后备；Direct Runtime 是唯一调度循环；CreationPanel 是受控媒体执行界面。**

## 2. 成功标准

本 SDD 完成只能在以下事实全部成立后宣称：

1. 一个真实小型 MP4 在生产 NewAPI 和已验证支持视频输入的对话模型上，最终请求体包含原始视频 data URL 或模型可访问 URL，不是文件名、时长、尺寸摘要。
2. 同一请求同时带视频和 `tools` 时，模型仍能读取视频；模型不支持 function calling 时只省略 `tools`，附件不丢失。
3. 图片、视频、音频、文件共用一份直连附件合同；Web 和 Desktop 共用同一消息构造器，只保留素材读取和 HTTP 传输差异。
4. 普通“分析这个视频”不创建媒体生成计划、不打开创作面板、不要求 Skill，也不启动 FFmpeg、Whisper 或终端。
5. 用户明确要求“用这张图生成视频”时，同一素材可以进入媒体编排确认卡；确认卡失败不影响模型已经完成的普通理解。
6. 不支持、过大、超时和用户取消都有明确结果；系统不得悄悄退化成只发送元数据摘要。
7. GPT、Claude、Grok 或 DeepSeek 等主模型遇到不支持的音视频时，只在当前 Provider/K 存在已验证 Gemini 时协作；否则询问用户是否使用本地工具，不得调用公共账号或其他分组。
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
  -> 不能直传 + 当前 Provider/K 有 Gemini + 智能媒体增强开启：Gemini 读取同一原件
       -> MediaUnderstandingResult 进入主模型上下文
  -> 当前 Provider/K 无 Gemini：取得用户同意后才运行现有本地工具
       -> 工具结果进入主模型上下文；拒绝或不可用则明确失败
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

### 4.5 当前用户 K 的生产 NewAPI 直连协议

上游 NewAPI `GeneralOpenAIRequest` 定义了 `image_url`、`video_url`、`input_audio` 和 `file`，但生产渠道并不等价支持。2026-07-21 使用桌面端当前用户 K 和极小自生成素材实测后，第一阶段采用的最小合同为：

```text
图片 -> { type: "image_url", image_url: { url } }
视频/音频/文件 -> { type: "file", file: { filename, file_data } }
```

`file_data` 使用当前请求态 data URL。实测中 `gemini-3.5-flash` 通过 `file` 正确识别 2.2KB 红色视频和 31KB 880Hz 音频；同一视频改用 `video_url` 时回答“没有提供”。因此第一阶段不得发送 `video_url`，也不得把上游 DTO 类型当作生产成功证据。

`DirectApiMessageContent` 只扩展为已实测通过的 `image_url` 和 `file` 最小联合类型，不增加 Provider Adapter、Factory 或新依赖。

### 4.6 主模型、媒体专家和工具能力独立

第一阶段不建立跨渠道的第二份模型能力目录。只在现有模型条目中记录**当前 Provider 下**已经验证的输入模态：

```ts
inputModalities?: Array<'text' | 'image' | 'video' | 'audio' | 'file'>
```

第一阶段的能力键固定为现有 `(modelProviderId, modelId)`。云端以用户当前 K 调用的生产 NewAPI 为真实验收对象；Desktop 本地模型只按本地 Provider 自己已经验证的能力处理。`inputModalities` 不得在 NewAPI、RH、Ollama 或自定义 Provider 之间复制。同一 Provider 内如果网关还会切换不同上游渠道，而模型目录不能返回实际渠道能力，则该模态视为未验证，不增加新的猜测型注册表。

来源优先级：

1. Gateway 模型目录真实返回的输入模态；
2. 生产合同测试已经证明，且绑定当前 `modelProviderId + modelId + 实际渠道` 的现有模型声明；
3. 无证据时只承诺已经确认的输入类型，不猜测视频能力。

工具规则：

- 模型支持 function calling：提供现有核心工具和用户已连接的候选 MCP 工具，由模型决定是否调用；
- 模型不支持 function calling：请求不带 `tools`，文本、原生附件或已完成的 Gemini 协作结果继续发送；媒体协作不依赖 function calling；
- 模型同时支持媒体与工具：同一个请求同时包含媒体 part 和 `tools`；
- 不用关键词路由替模型猜“这一轮是否需要工具”。“按需”指模型按任务决定调用，不是 App 先扣下工具或附件。

媒体协作不是普通工具调用，不依赖主模型是否支持 function calling。它发生在主模型请求构造前，只解决“谁能真实读取原始媒体”：

1. 主模型与渠道原生支持当前模态：直接把原件交给主模型，不额外调用 Gemini；
2. 主模型不支持、智能媒体增强开启、用户未锁定当前模型，且当前 Provider/K 确实存在已验证 Gemini：Gemini 读取原件，主模型接收结构化理解；
3. 主模型原生支持但用户要求交叉验证，或主模型判断媒体理解存在关键不确定性：可以再请求 Gemini 协作；
4. Gemini 完成整体理解后，是否调用 FFmpeg、转写、视觉或 OCR 做精确验证，仍由主模型按任务需要决定；
5. 当前 Provider/K 没有 Gemini 时不跨组寻找；询问用户是否允许现有本地工具补位。用户拒绝、工具缺失或平台不支持时明确无法真实分析；
6. 用户锁定当前模型时不调用 Gemini；工具是否可用再按用户的工具约束独立判断。

### 4.7 智能媒体增强与 Gemini 媒体专家

#### 4.7.1 默认策略

`智能媒体增强` 默认推荐开启，但只能使用当前 Provider/K 模型目录中真实存在、并通过该渠道合同测试的 Gemini。首次需要把媒体交给用户当前未选择的 Gemini 时，必须在发送前进行一次明确的跨模型知情确认，说明仍使用当前 K 计费、实际媒体接收模型和可关闭位置。用户同意后记住选择，不逐轮弹窗；用户尚未选择或拒绝时，本轮不得把媒体发送给 Gemini。

获得一次同意后，处理期间在输入框上方显示轻量状态，完成后在本轮助手消息的模型信息中保留同一来源说明：

```text
本轮视频由 Gemini 3.5 Flash 读取，最终由 GPT-5.6 Terra 回答
```

这条状态必须真实反映本轮读取模型和最终回答模型，不能改变主模型选择器，也不能只在日志中记录。设置中允许撤回跨模型同意或关闭智能媒体增强；关闭后不再调用媒体专家，但不会关闭普通工具。

Gemini 3.5 Flash 必须同时满足“当前 Provider/K 的模型目录真实返回”和“该 Provider/K 的 Task 0 合同测试通过”，才能成为本次会话的媒体专家。未通过时按不可用处理；不得改用平台账号、其他 Provider 或其他分组的 K。

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
| 未特别限制 | 当前 Provider/K 可用时允许 | 主模型按需调用 | 同一 K 内走最强可用路径 |
| “不要使用任何工具” | 当前 Provider/K 可用时允许 | 禁止 | Gemini 可用则读取；不可用则明确失败 |
| “只用当前模型” | 禁止 | 允许 | 当前模型原生读取；不支持时可按需用工具补位 |
| “只用当前模型，也不准工具” | 禁止 | 禁止 | 当前模型不支持时明确无法真实分析 |
| “必须用 Gemini 分析” | 当前 Provider/K 有则必须 | 仍按用户其他限制 | 没有 Gemini 时明确不可用，不跨组寻找 |
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
- 用户当前 K 对应的韭菜盒子云端 NewAPI；
- Desktop 本地模型不会因媒体补位自动上传云端；
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
| `src/runtime/direct/mediaSpecialist.ts` | 只负责从当前 Provider/K 模型目录判断专家是否可用、构造协作请求并解析结果；通过平台注入的现有直连发送函数调用，不拥有 K、不跨 Provider、不提供第二套鉴权、fetch、重试或错误处理。 |
| `src/utils/directMessageBuilder.ts` | 成为唯一的 text/image/video/audio/file 请求 part 构造器。 |
| `src/composables/creativeChat.ts` | Desktop 复用共享媒体专家政策，再提供工具执行和 HTTP 传输；按主模型能力决定是否传 `tools`。 |
| `src/composables/web/chatCloud.ts` | Web 调用同一媒体专家与消息合同；只保留 OPFS/Blob 读取与浏览器传输差异。 |
| `src/stores/agentStore.ts` | 在当前 Provider 的现有模型条目承载 `inputModalities`；媒体专家只能从当前 Provider 实时可用模型中选择，不保存跨 Provider 的固定专家身份。 |
| `src/runtime/workbench/mediaReference.ts` | 继续负责媒体生成引用；不得改写或消费 `modelAttachments`。 |

不新增 Store、数据库表、Rust 媒体引擎、服务端上传服务或第三方依赖。

## 6. 错误合同

| 情况 | 产品行为 |
|---|---|
| 主模型不支持该输入模态 | 当前 Provider/K 有已验证 Gemini、智能媒体增强已获同意并开启时才协作；否则进入本地工具许可分支。不得跨 Provider、分组或 K。 |
| 当前 Provider/K 没有 Gemini | 明确提示当前账号没有可用媒体模型，询问是否使用现有本地工具；同意才执行，拒绝或工具不可用则明确失败。 |
| Gemini 媒体专家超时 | 保留附件和主模型选择；允许工具时由主模型决定或由产品显示本地工具许可提示，否则明确说明媒体专家暂不可用。不得静默更换第三个模型。 |
| 只使用本地模型 | 本地模型原生支持则直传；不支持则询问本地工具许可。不得自动把媒体上传云端。 |
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

实施基线固定为 Git `c48e95b1`。后续每个阶段单独形成可审查差异；不得把该基线之前的工作区修改混入本 SDD 的实现提交。

### Task 0：先验证生产真实协议

在不改运行代码的前提下，使用脱敏脚本或浏览器网络面板记录以下请求结果：

1. 当前默认 `gpt-5.6-terra` + 纯文本、极小图片、极小文件；
2. `gpt-5.6-terra` + 极小 MP4 和极小音频，确认渠道是否按预期拒绝，不把失败误记成支持；
3. 当前 Provider/K 的模型目录是否真实包含 `gemini-3.5-flash`；不包含时记录“不具备媒体专家”，不得换 K 继续测试；
4. 目录包含时，测试 `gemini-3.5-flash` + 极小图片、MP4、音频、文件，以及同一 MP4 + 一个无副作用工具定义；
5. `deepseek-v4-pro` 或 `deepseek-v4-flash` + 同一 MP4，验证附件身份进入模型、原始视频不被伪装成已读取，并允许模型按需请求候选工具；
6. 渠道已提供时，再补 `claude-sonnet-5` / `claude-fable-5` / `claude-opus-4.8` 与 `grok-4.5` 的图片和文件合同测试。

记录：模型 ID、渠道、内容 part 类型、MIME、字节数、是否含 tools、HTTP 状态、首个错误、模型是否引用了附件真实内容；不记录 Token 和媒体 Base64。

Task 0 实测结果（2026-07-21，当前桌面用户 K）：

- `/v1/models` 返回 74 个模型，包含 `gemini-3.5-flash`、`gpt-5.6-terra` 等，但不返回输入模态字段；目录只能证明可调用，不能证明媒体能力。
- `gemini-3.5-flash + image_url` 正确回答 160x120 红色 PNG 为“红色”。
- `gemini-3.5-flash + video_url(data URL)` 对 2.2KB 红色 MP4 回答“没有提供”，该协议判定失败。
- `gemini-3.5-flash + file(file_data)` 对同一 MP4 正确回答“红色”，对 31KB 880Hz WAV 正确回答“电子音”。
- `gemini-3.5-flash + file + tools` 仍正确回答视频为“红色”，未错误调用无副作用工具。
- `gpt-5.6-terra + file` 对同一 MP4 回答“无法判断”，不得登记为视频输入支持。

如果当前 Provider/K 不返回 `gemini-3.5-flash`，本次环境只实施原生附件合同和本地工具降级，不启用 Gemini 协作。如果目录包含 Gemini，则必须先证明它使用同一 Provider/K 真实读取视频和音频，才能启用智能媒体增强。不得换平台账号、其他分组或其他 Provider 的 K 补测试结果。

验收：形成“当前 Provider/K 可见模型 + 模型 ID + 输入模态”的可重复协议事实。目录有 Gemini 时拿到至少一个真实成功的视频/音频请求和一个真实不支持请求；目录没有 Gemini 时，以模型目录响应作为不可用证据，第二阶段只走本地工具分支。

### 第一阶段：只闭环原生附件发送合同

本阶段只执行 Task 1-3。完成标准是：用户直接选择已经验证支持对应模态的模型时，原始附件真实进入该主模型。不得在本阶段新增 Gemini 自动协作、跨模型设置或媒体专家 UI。

### Task 1：先写失败测试固定原生附件合同

新增测试证明当前代码失败：

1. 视频必须生成生产实测通过的 `file.file_data` part，而不是 `video_url` 或 `[本地媒体文件]` 文本；
2. 图片、视频、音频、文件能和文字共存；
3. 媒体 part 与 `tools` 可同时存在；
4. 工具能力为 false 时只省略 tools；
5. `buildCreativeContext()` 不因 Base64 长度丢弃当前用户附件；
6. 媒体引用创建失败不改变模型附件；
7. 同一外部视频不会执行两次完整文件读取。

验收：测试先在现状下失败，失败点准确指向消息合同，不使用源码字符串代替行为断言。

### Task 2：建立单一附件引用

1. 为 `ChatMessage` / `SendMessageOptions` 增加 `attachments` 引用。
2. `FileUploader` 输出原始引用、显示元数据和可选本地处理信息；显示摘要不再进入模型正文。
3. 项目、画布、任务和本轮上传统一转成 `DirectAttachmentRef`。
4. 当前轮发送前解析成 `ResolvedDirectAttachment`，解析完成后再清空输入区。

验收：用户消息 UI 仍显示附件；持久化消息不含 Blob、File、ArrayBuffer 或媒体 Base64。

### Task 3：扩展共享直连消息构造器

1. 在 `directMessageBuilder.ts` 增加 NewAPI 已实测通过的 `image_url` 与 `file.file_data` part。
2. 最新用户消息保留文字和全部原生附件；历史消息只使用仍可恢复的附件引用。
3. Web 和 Desktop 都调用同一构造器，不各自拼一套媒体 part。
4. 请求诊断只记录附件 kind、MIME、大小和来源，不记录 value。

验收：同一标准化输入在 Web / Desktop 生成相同的 `messages` 与 `tools`，平台差异只存在于读取和 fetch。

第一阶段门禁：Task 0 的当前 Provider/K 证据与 Task 1-3 自动测试通过。当前 Provider/K 有已验证视频/音频模型时，必须补该模型作为主模型读取小文件的双端真实请求；没有时必须证明不会把原件伪装成已读取，并返回明确的“不支持”结果，第二阶段再接本地工具许可分支。不得换 K 制造成功证据，也不得用自动 Gemini 补位掩盖附件合同缺陷。

### 第二阶段：增加 Gemini 媒体专家补位

只有第一阶段门禁通过后，才执行 Task 4-6。

### Task 4：建立智能媒体增强与 Gemini 协作

1. 新增共享 `mediaSpecialist` 政策：智能媒体增强默认推荐开启；媒体专家只从当前 Provider/K 返回并通过 Task 0 的模型中选择 `gemini-3.5-flash`，找不到就返回明确的 `unavailable`，不读取其他凭据。
2. 主模型原生支持当前模态时不调用媒体专家；不支持且用户未锁定当前模型时，先把用户目标和原始媒体交给 Gemini。
3. Gemini 返回 `MediaUnderstandingResult`；主模型请求只接收结构化结果和素材身份，不把 Gemini 自由文本冒充用户终稿。
4. Desktop 与 Web 复用同一协作判断、结果合同和错误合同；不各自实现模型切换。Gemini 请求必须复用当前主模型已经解析出的 Provider 配置、同一个 K、平台直连 HTTP 传输、取消信号和错误合同，通过回调注入 `mediaSpecialist`；禁止重新调用默认 Provider、读取其他 K，或在该模块内再写一套 Provider Client。
5. 首次跨模型发送前显示一次知情确认；同意后，本轮消息显示“媒体由 Gemini 读取，最终由当前主模型回答”的轻量状态，不逐轮弹窗。拒绝或未选择时不得发送给 Gemini。
6. 分别实现“禁止工具”“锁定当前模型”“禁止工具并锁定模型”的独立约束，用户明确指令优先于默认设置。
7. 当前 Provider/K 没有 Gemini 或 Gemini 失败时不静默改用其他模型；显示本地工具许可提示。用户同意后执行现有本地处理能力并把结果交回主模型，拒绝或不可用则明确结束。

验收：当前 Provider/K 同时包含 GPT-5.6 Terra 与 Gemini 时，首次获得跨模型同意后由同一 K 调用 Gemini、GPT 输出终稿；没有 Gemini 时只出现本地工具许可分支，不产生任何 Gemini 请求；选择 Gemini 作为主模型时直接读取，不发生重复协作。

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
| GPT/Claude/Grok/DeepSeek + 视频在已同意后使用 Gemini | 必测 | 必测 |
| Gemini 主模型不重复调用媒体专家 | 必测 | 必测 |
| 当前 Provider/K 没有 Gemini 时不跨组调用 | 必测 | 必测 |
| 纯本地模型不自动上传云端 | 必测 | 必测 |
| 没有 Gemini 时同意/拒绝本地工具 | 必测 | 必测 |
| 首次跨模型发送前知情确认，拒绝后不发送 | 必测 | 必测 |
| 撤回跨模型同意后不再发送 | 必测 | 必测 |
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
- 不提供公共 Gemini，不代用户付费，不跨 Provider、分组或 K 寻找媒体专家。
- 不把纯本地模型的附件自动上传到云端。
- 不把 Gemini 与精确工具无条件双跑；简单媒体理解只走必要的最短路径。
- 不因为媒体生成需要引用，就强制普通理解进入媒体计划。
- 不把 Base64 写进 SQLite、项目 Wiki、日志或错误文案。
- 不用模型名称关键词无限猜能力；没有生产证据就不宣称支持。
- 不为兼容未知 Provider 编写第二套附件 Adapter。
- 不在本 SDD 中执行 [[Pi统一事实流升级SDD]]；它解决工具生命周期，不解决原始附件输入，应在本合同闭环后再实施。

## 9. 风险与取舍

### 9.1 NewAPI 上游支持不等于生产渠道支持

风险最大。当前生产 NewAPI 已证明 `video_url` 被接收但媒体没有到达 Gemini，而 `file.file_data` 成功。其他模型、K 或渠道仍可能不同，因此 Task 0 是实施门槛，不是可选测试；失败时不得静默换 part 重试。

### 9.2 data URL 有体积和内存成本

第一阶段不建设上传服务。直传上限必须由生产实测决定，并明显低于 Cloudflare、NewAPI 和上游中最小限制。超限时明确停止，不允许卡死或自动删附件重试。

### 9.3 历史会话附件恢复

只持久化引用意味着临时上传文件被清理后可能无法重新发送。第一阶段优先使用项目资源、画布资源、任务结果或 App 媒体缓存作为可恢复来源；找不到原件时明确要求用户重新选择，不从旧摘要伪造附件。

### 9.4 工具可见不等于工具已使用

模型支持 function calling 时，把工具定义放进请求只是提供候选能力。只有模型真正返回 tool call 才算使用工具。产品不额外增加关键词路由器。

### 9.5 模型协作增加成本、延迟和跨渠道传输

主模型不支持媒体时可能增加一次同一 Provider/K 内的 Gemini 调用。产品必须在首次跨模型发送前取得一次明确同意，显示实际参与的模型、仍由当前 K 计费并允许撤回。当前 Provider/K 没有 Gemini 时不得调用平台账号、其他分组或其他 Provider；只允许用户同意后的本地工具补位。第二阶段不做公共服务、多媒体专家竞价或自动选择第三个模型。

### 9.6 媒体专家结果不是原始媒体的永久替代品

`MediaUnderstandingResult` 是本轮协作证据，不等于主模型亲自读取原件，也不能替代项目中的真实素材身份。后续需要精确时间点、逐字稿或帧级证据时，必须从同一素材身份重新按需调用确定性工具，不能只在 Gemini 摘要上继续猜测。

## 10. 完成后的架构关系

```text
                         +-> 主模型原生支持 -> 主模型直接理解
用户文本 + 原始附件 ----+
                         +-> 主模型不支持 -> 当前 Provider/K 有 Gemini -> 结果回主模型
                         |                    +-> 主模型直接回答或按需精确验证
                         +-> 当前 Provider/K 无 Gemini -> 用户同意本地工具 -> 结果回主模型
                                                      +-> 拒绝/不可用 -> 明确失败
                         +-> 主模型按需调用 Skill / 文件 / 终端 / MCP
                         +-> 用户要求生成媒体 -> 媒体计划 -> 确认 -> CreationPanel
```

所有分支共享同一素材身份和 Direct Runtime。Gemini 只是当前 Provider/K 内可用时的优选媒体专家，不是公共服务或第二个会话；本地工具必须获得用户许可，精确工具与媒体生成都不能成为普通回答的固定前置门槛。

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
