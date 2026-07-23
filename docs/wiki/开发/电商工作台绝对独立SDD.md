# 电商工作台绝对独立 SDD

> 日期：2026-07-23
> 状态：设计冻结，待实施
> 范围：电商工作台独立运行时、Wiki 产物和公共媒体接线
> 替代关系：本文整体替代 `[[开发/电商工作台SDD]]` 中所有把电商绑定到 Chat、创模式、创模式会话、AI 协作记录、工具循环或 OpenCode 的设计和实施记录。旧文仅保留历史背景。

## 1. 一句话目标

电商工作台是一个独立产品工作台：用户提交信息和原始图片，指定 Skill 约束模型处理，得到结果并写入项目 Wiki；用户确认媒体计划后，使用公共媒体能力生成素材。

```text
用户字段 + 原始附件 + 选择的模型/Provider + 指定 Skill
  -> 一次直连模型请求（无工具）
  -> 电商 Wiki 运行记录与结果页
  -> 用户确认 MediaPlan
  -> 公共 CreationPanel -> mediaTaskStore
  -> 媒体结果链接回同一 Wiki 记录
```

电商不属于文、武、创、道中的任何一种模式，也不是 Chat 的子页面、会话视图或发送方式。

## 2. 根本边界

### 2.1 独立不是重复造轮子

以下是产品公共能力，电商可以直接使用；它们不是 Chat 的专属能力：

| 公共能力 | 电商用途 | 不允许带入的内容 |
| --- | --- | --- |
| 模型/Provider 注册与密钥解析 | 展示模型选择器，按用户选择发起请求 | Chat 当前消息、Chat 默认模式、OpenCode 配置投影 |
| Skill 包与受限 `workbench.json` | 本次领域规则和表单声明 | Skill 工具、Shell、网络调用、文件读写指令 |
| Direct Engine HTTP/SSE/原始附件合同 | 一次模型请求、流式文本、取消与真实错误 | 对话历史、工具循环、MCP、自动换模型 |
| 项目文件服务与 Wiki 存储 | 保存电商运行记录和结果 | 请求前扫描项目或读取 Wiki 内容 |
| `MediaPlanCard` / CreationPanel / mediaTaskStore | 用户确认后的付费媒体任务、轮询、落盘和画布 | 媒体任务自动进入模型上下文或 Chat 消息 |

共享实现不等于共享运行时。电商可复用这些稳定合同，但它的组件、状态和请求不能依赖任何模式实现。

### 2.2 绝对禁止的依赖

电商运行时、请求构造、状态仓库和 UI 不得导入、调用、订阅或以字符串约定依赖：

- `chatModeStore`、`useChat`、`ChatPanel`、Chat 消息、`conversationId`。
- `creativeSessionStore`、`creative_*`、创模式工具循环、创模式审批或创模式记忆。
- `openCodeSyncStore`、OpenCode `ses_*`、sidecar、文模式或武模式状态。
- 道模式状态、道模式历史或任何模式切换动作。
- `wiki/hot.md`、项目目录清单、最近任务、MCP、搜索、终端、Wiki 工具或未由用户本次选择的项目内容。

“删除文、武、创、道四个模式后电商仍可运行”是本 SDD 的架构验收，不是口号。

### 2.3 Skill 与直连的关系

直连的定义是模型请求没有 Agent 工具循环和隐式上下文，不是“系统提示词不能为空”。电商 Skill 是用户明确指定的静态领域规则，随本轮请求进入 `system` 内容；它不执行、不调用工具，也不能自行读取 Wiki。

因此电商请求允许一个受限 Skill，但必须满足：

1. `tools` 恒为 `[]`，`allowToolCalls` 恒为 `false`。
2. 一次用户动作最多一次模型请求；流结束即结束。
3. 只发送本轮表单字段、原始附件、选中的模型/Provider、Skill 内容和输出合同。
4. 模型不支持附件或请求失败时，显示当前 Provider 的真实错误；不换模型、不转交其他模式、不调用本地补位流程。

## 3. 独立运行时合同

### 3.1 入口与布局

Rail 的“电商”入口直接激活 `EcommerceWorkspace`，不设置 Chat mode，也不切换到创模式。电商页面是工作区的一个一级 surface；Chat 只是另一个独立 surface。

电商激活时不挂载 `ChatPanel`，也不初始化 `useChat()`。同样，进入 Chat 不会创建、恢复或清空电商运行。两者只共享应用壳、项目选择和公共产品服务。

电商页面包含：任务页签、模型选择器、Skill 对应的受限输入表单、素材预览、运行卡、Wiki 结果入口和媒体计划确认卡。不存在“AI 协作记录”“返回 Chat”或隐藏的消息时间线。

### 3.2 请求合同

```ts
interface EcommerceDirectRequest {
  runId: string
  action: string
  modelId: string
  providerId: string
  skill: { id: string; revision: string; content: string }
  input: {
    fields: Record<string, string | string[]>
    attachments: Array<{ id: string; name: string; mime: string; value: string }>
  }
  output: { kind: 'prompt' | 'analysis' | 'media-plan'; heading: string }
}

interface EcommerceDirectResult {
  runId: string
  status: 'succeeded' | 'failed' | 'cancelled'
  content: string
  output: string
  error?: string
}
```

`runId` 只标识一条电商运行，不能复用、映射或伪装为会话 ID。重试必建新 `runId`；“复用”只把用户选中的 Wiki 产物显式填入当前表单，不自动发送请求。

模型请求的消息形态固定为：一条受限 Skill 和输出合同组成的 system 消息，加一条本轮字段和原始附件组成的 user 消息。模型请求中不得出现此前运行结果，除非用户明确从某条 Wiki 运行记录选择了它作为本轮字段或附件。

### 3.3 取消、错误和并发

- 每个运行拥有独立 `AbortController`，取消只中止该 HTTP 请求。
- 同一个运行不可重复提交；不同素材的反推可以有限并发，但每张素材都是独立 `runId` 和独立 Wiki 记录。
- 失败和取消可被记录为运行状态，但不伪造助手答复，不创建 Chat 消息，不启动替代流程。
- 离开页面只取消尚未完成的直连请求；已确认提交的媒体任务继续由 `mediaTaskStore` 处理。

## 4. Wiki 是唯一电商历史

### 4.1 存储路径和归属

每次电商运行必须属于一个项目。没有项目时，工作台先要求用户选择或新建项目，不能在内存中产生无法归档的结果。

新运行记录写入：

```text
wiki/电商/运行/<run-id>.json
```

面向用户的最终结果写入：

```text
wiki/电商/结果/<run-id>.md
```

工作台可为 `wiki/电商/` 创建最小目录和索引，但不扫描、加载或改写其他 Wiki 页面。项目采用 `docs/wiki/` 时，由公共 Wiki 路径解析器决定实际根目录；工作台不写死桌面或 Web 的文件系统路径。

媒体二进制、上传素材和生成结果继续遵从已有 `jc-media`/项目资源合同。Wiki 只记录不可变的资源 ID、项目相对路径或 asset URI，绝不把 base64 图片复制进 Markdown/JSON。

### 4.2 运行记录合同

```ts
interface EcommerceWikiRunRecord {
  version: 1
  runId: string
  action: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'media-submitted' | 'media-succeeded' | 'media-failed'
  createdAt: string
  model: { id: string; providerId: string }
  skill: { id: string; revision: string }
  input: {
    fields: Record<string, string | string[]>
    attachments: Array<{ id: string; name: string; mime: string; assetRef: string }>
  }
  result: { wikiPath?: string; content?: string; error?: string }
  media?: { plan?: MediaPlan; taskId?: string; assetUri?: string; projectPath?: string; error?: string }
}
```

结果 Markdown 包含用户可读的最终内容、模型和 Skill 标注、输入素材链接、创建时间，以及可用时的媒体结果链接。运行 JSON 是机器可读的状态真相；Markdown 是 Wiki 可阅读、可搜索、可双链引用的业务结果。两者都以 `runId` 关联，不建立第二个历史数据库。

历史列表只扫描 `wiki/电商/运行/`。现有 `jc-media/ecommerce/*/record.json` 作为只读历史兼容来源保留，不能在用户未确认时批量迁移或删除。

### 4.3 媒体计划回写

模型只产出文本结果或可审阅的 `MediaPlan`，不得自行提交媒体任务。用户点击确认后：

```text
Ecommerce Wiki run
  -> validate MediaPlan
  -> preparePublicMediaPlan
  -> CreationPanel / mediaTaskStore
  -> task settled
  -> 更新同一 Ecommerce Wiki run
```

任务 ID、状态、项目路径、asset URI 和真实错误回写同一 `runId`。这些事件只在电商与公共媒体合同之间传递，不能写入 Chat、创模式会话或模型下一轮上下文。

## 5. UI 和输入

电商工作台 V1 保持现有三个真实入口：商品图、参考图反推、反推生图。未来自建工作台 Skill 仍要求显式 `workbench.json`，但声明只能定义受限字段和动作，不能定义前端代码、网络请求、Shell、密钥或工具。

每个入口都遵守同一结构：

```text
用户填写本次信息和上传素材
  -> 选择模型和一个 Skill
  -> 运行
  -> 显示最终结果与 Wiki 入口
  -> 可选：从结果创建媒体计划
```

用户能查看每次运行到底发送了哪些字段、附件、模型和 Skill；不能从 UI 看到或依赖隐藏对话、自动追加的项目材料、工具过程或模式名称。

## 6. 实施范围

### 6.1 需要做

1. 将 Rail 和工作区状态改为独立的 `EcommerceWorkspace` surface，移除进入电商时对 `chatModeStore` 的读写。
2. 将电商 store 改为 `runId`/表单草稿/媒体任务映射；删除 session、`creative_*`、`__ecommerce_pending__` 和 collaboration surface 语义。
3. 将 `singleTurnWorkbench` 收敛为电商可用的公共直连运行合同，保持单次请求、空工具和原始附件；名称不能暗示 Chat 会话依赖。
4. 新增电商 Wiki 输出存储，按本 SDD 写运行 JSON 和结果 Markdown；使用现有项目文件服务、Wiki 根路径解析和乐观并发保存。
5. 将 `MediaPlanCard` 从 `components/chat/` 移到中性公共目录，电商与其他工作台通过公共媒体桥接入 CreationPanel。
6. 删除电商中“AI 协作记录”“查看 Chat”“同会话”等 UI、事件、测试和文案。
7. 将当前电商 SDD 标为历史设计，并由本文成为唯一现行电商运行时合同。

### 6.2 明确不做

- 不改文、武、创、道本身的职责，也不把电商塞入任何一个模式。
- 不为电商新增第二套 HTTP/SSE 客户端、Provider 注册、媒体 API、任务轮询、画布或项目文件系统。
- 不让模型读取 Wiki、文件树或历史来“记住”用户；跨运行复用必须由用户显式选择 Wiki 产物。
- 不把电商结果复制到 Chat、会话存储、`.raw` 或模式专属数据库。
- 不自动更换模型、使用后备模型、调用工具或把失败改写为其他模式任务。

## 7. 验收标准

### 7.1 结构性隔离验收

1. 在电商运行时源码依赖图中，删除 `chatModeStore`、`useChat`、`ChatPanel`、所有模式 store、OpenCode store 和创模式运行时后，TypeScript、Web 构建与 Desktop 构建仍通过。
2. 电商入口和工作台组件没有上述 import、事件名、session ID 约定或字符串分支；`v-show` 隐藏 ChatPanel 不能作为通过证据。
3. 测试夹具中移除文、武、创、道四种模式的注册和 UI 后，用户仍可进入电商、选模型、选 Skill、上传图片、请求模型、查看 Wiki 结果、确认媒体计划并得到媒体任务结果。
4. 电商请求不会启动、连接或恢复 OpenCode sidecar/`ses_*`，不会创建 Chat 或创模式消息/会话。

### 7.2 直连请求验收

1. 请求仅含当次字段、原始附件、选择的模型/Provider、一个指定 Skill 和输出合同；不含 Chat 历史、项目文件、Wiki 内容、工具、MCP 或最近任务。
2. `tools` 为 `[]`，`allowToolCalls` 为 `false`；一次运行最多一次模型请求。
3. 图片以原始附件合同进入当前 Provider 请求；不转文件名、路径、摘要或抽帧结果。
4. 取消、HTTP、网络、超时、内容过滤和模型能力错误显示真实原因；不会自动切换模型或模式。

### 7.3 Wiki 与媒体验收

1. 成功、失败、取消和媒体任务状态均按 `runId` 可追溯到 `wiki/电商/运行/`；成功文本在 `wiki/电商/结果/` 可阅读和搜索。
2. 无项目时不得发送无法保存的电商运行；项目建立/选择后，Web 与 Desktop 都能落盘到同一项目 Wiki 合同。
3. 媒体计划必须经用户确认和公共参数校验，才进入 `CreationPanel -> mediaTaskStore`。
4. 媒体任务的结果或错误仅回写对应 Wiki run；后续模型请求不会自动读取它。

## 8. 回归范围

1. Web 和 Desktop：商品图、反推、反推生图、模型选择、取消、失败、重试、Wiki 查看和媒体确认。
2. 公共能力：模型配置、Skill 包解析、项目文件服务、Wiki 路径解析、MediaPlanCard、CreationPanel、mediaTaskStore、画布结果。
3. 保留的文、武、创、道若仍存在，分别验证其现有行为不因电商拆出而改变；但它们不是电商成功的前置条件。

## 9. 成功定义

在一个只保留应用壳、公共模型能力、公共 Skill 能力、项目/Wiki 服务和公共媒体任务能力的构建中，电商工作台仍能完成一次真实闭环：

```text
商品信息 + 图片 -> Skill 约束的模型直连 -> Wiki 结果 -> 用户确认 -> 媒体任务 -> Wiki 媒体结果
```

这条链成立时，电商才是绝对独立工作台。
