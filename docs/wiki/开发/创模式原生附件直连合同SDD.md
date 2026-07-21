# 创模式原生附件直连合同 SDD

> 日期：2026-07-21
> 状态：设计已确认，待实施
> 范围：Web / Desktop 创模式的云端直连模型；不改文、武模式
> 核心原则：模型原生能力优先，产品能力补位，Skill 和工具按需增强；工具不能成为模型原生能力的门槛。

## 1. 一句话目标

用户在创模式上传或引用图片、视频、音频、文件后，**原始附件必须先按当前模型与渠道的真实协议进入模型请求**；媒体生成计划和工具只能复用同一素材继续工作，不能把原始附件截成元数据摘要，也不能阻止普通模型理解。

## 2. 成功标准

本 SDD 完成只能在以下事实全部成立后宣称：

1. 一个真实小型 MP4 在生产 NewAPI 和已验证支持视频输入的对话模型上，最终请求体包含原始视频 data URL 或模型可访问 URL，不是文件名、时长、尺寸摘要。
2. 同一请求同时带视频和 `tools` 时，模型仍能读取视频；模型不支持 function calling 时只省略 `tools`，附件不丢失。
3. 图片、视频、音频、文件共用一份直连附件合同；Web 和 Desktop 共用同一消息构造器，只保留素材读取和 HTTP 传输差异。
4. 普通“分析这个视频”不创建媒体生成计划、不打开创作面板、不要求 Skill，也不启动 FFmpeg、Whisper 或终端。
5. 用户明确要求“用这张图生成视频”时，同一素材可以进入媒体编排确认卡；确认卡失败不影响模型已经完成的普通理解。
6. 不支持、过大、超时和用户取消都有明确结果；系统不得悄悄退化成只发送元数据摘要。
7. 自动测试与真实请求证据都通过。仅有模型回复、界面显示附件或构建通过，不算原生附件验收。

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
  -> 按模型/渠道协议解析 modelAttachments
  -> 构造一份创模式模型请求
  -> 模型直接答复，或在支持 function calling 时按需调用工具
  -> 只有用户要求生成媒体时，才从同一素材身份生成 mediaReferences 和确认卡
  -> 原生输入不支持或超限时，才进入产品预处理
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

### 4.6 模型能力和工具能力独立

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
- 模型不支持 function calling：请求不带 `tools`，文本和原始附件继续发送；
- 模型同时支持媒体与工具：同一个请求同时包含媒体 part 和 `tools`；
- 不用关键词路由替模型猜“这一轮是否需要工具”。“按需”指模型按任务决定调用，不是 App 先扣下工具或附件。

### 4.7 第一阶段范围

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
| `src/utils/directMessageBuilder.ts` | 成为唯一的 text/image/video/audio/file 请求 part 构造器。 |
| `src/composables/creativeChat.ts` | Desktop 只提供素材解析、工具执行和 HTTP 传输；按模型能力决定是否传 `tools`。 |
| `src/composables/web/chatCloud.ts` | Web 调用同一消息合同；只保留 OPFS/Blob 读取与浏览器传输差异。 |
| `src/stores/agentStore.ts` | 在现有模型条目承载 `inputModalities`，不建立新能力表。 |
| `src/runtime/workbench/mediaReference.ts` | 继续负责媒体生成引用；不得改写或消费 `modelAttachments`。 |

不新增 Store、数据库表、Rust 媒体引擎、服务端上传服务或第三方依赖。

## 6. 错误合同

| 情况 | 产品行为 |
|---|---|
| 模型不支持该输入模态 | 明确告诉用户当前模型不支持，并保留附件供切换模型重试；不得发送摘要冒充理解。 |
| 请求体过大 / HTTP 413 | 明确提示附件超过当前直传上限；不得自动重试同一大请求。 |
| 上游拒绝媒体协议 / HTTP 400、415 | 显示模型或渠道不支持；保留附件；不得删除媒体后偷偷重试。 |
| 上游超时 / HTTP 524 | 显示渠道超时并保留附件；不得自动改成纯文本请求。 |
| 工具不受支持 | 省略 `tools` 后正常发送原始附件。 |
| 本地缓存失败 | 只影响后续本地工具；若原始附件仍可直传，不得阻止模型请求。 |
| 用户取消 | 中止读取与请求，附件仍留在输入区供用户处理。 |

错误文案不得把“生成模型”“对话模型”“媒体引用”“模型理解”混为一谈。

## 7. 实施顺序

### Task 0：先验证生产真实协议

在不改运行代码的前提下，使用脱敏脚本或浏览器网络面板记录以下请求结果：

1. 当前默认对话模型 + 纯文本；
2. 当前默认对话模型 + 极小图片；
3. 当前默认对话模型 + 极小 MP4 `video_url`；
4. 同一 MP4 + 一个无副作用工具定义；
5. 一个明确不支持视频的模型 + 同一 MP4。

记录：模型 ID、内容 part 类型、MIME、字节数、是否含 tools、HTTP 状态、首个错误；不记录 Token 和媒体 Base64。

如果当前默认模型或渠道不接受 `video_url`，必须选择一个生产实测支持视频输入的对话模型作为第一阶段目标；不得通过改前端伪造支持。

验收：拿到至少一个真实成功视频请求和一个真实不支持请求，形成可重复的协议事实。

### Task 1：先写失败测试固定原生附件合同

新增测试证明当前代码失败：

1. 视频必须生成 `video_url` part，而不是 `[本地媒体文件]` 文本；
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

1. 在 `directMessageBuilder.ts` 增加 NewAPI 已实测通过的媒体 part。
2. 最新用户消息保留文字和全部原生附件；历史消息只使用仍可恢复的附件引用。
3. Web 和 Desktop 都调用同一构造器，不各自拼一套 `video_url`。
4. 请求诊断只记录附件 kind、MIME、大小和来源，不记录 value。

验收：同一标准化输入在 Web / Desktop 生成相同的 `messages` 与 `tools`，平台差异只存在于读取和 fetch。

### Task 4：解耦媒体编排和工具

1. 普通理解始终先构造模型请求。
2. 只有用户意图要求生成图片、视频或音频时，才解析模型返回的媒体计划并显示确认卡。
3. 媒体计划引用复用素材 ID，不持有模型请求 Base64。
4. `creativeChat.ts` 和 `chatCloud.ts` 按当前模型 function calling 能力决定 `tools` 字段；不支持工具时仍完成原生媒体请求。

验收：“分析视频”只有模型答复；“基于这个视频生成新视频”才出现确认卡；两者都不要求先选 Skill。

### Task 5：结果级验证

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
| 小视频 + tools 同请求 | 必测 | 必测 |
| 不支持视频的模型 | 必测 | 必测 |
| 超限附件 | 必测 | 必测 |
| 项目/画布素材进入理解 | 必测 | 必测 |
| 同一素材随后生成视频 | 必测 | 必测 |
| 取消、重试、新会话 | 必测 | 必测 |

Windows、Intel Mac、Apple Silicon 的正式安装包至少各完成一次小视频直连；不能用开发态 Mac 验收代替三平台结果。

## 8. 明确不做

- 不把视频理解重新做成 Skill。
- 不把 FFmpeg、Whisper 或终端设为所有视频请求的必经路径。
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

## 10. 完成后的架构关系

```text
                         +-> 模型原生理解 -> 普通回答
用户文本 + 原始附件 ----+
                         +-> 模型按需调用 Skill / 文件 / 终端 / MCP
                         +-> 用户要求生成媒体 -> 媒体计划 -> 确认 -> CreationPanel
```

三条分支共享素材身份，但没有一条可以成为另一条的前置门槛。

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
