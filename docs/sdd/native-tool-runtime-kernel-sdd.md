# 原生工具运行内核 SDD

日期：2026-06-03  
状态：SDD v2，已按 CLAUDE.md / RuntimeConnection 总架构校准；Phase 0、Phase 1、Phase 2、Phase 3、Phase 5 已完成；Phase 6 P1 已完成；Phase 4 Job 慢工具接入继续推进  
关联方向：Odysseus 工具串联方式、Codex-like 原生工具体验、韭菜盒子纯手动 AI 工作台  
核心结论：核心工具必须内置在 APP 内；MCP 只作为外挂扩展；Tool Runtime Kernel 只能作为 `ToolConnection` 下面的执行层，不能成为第二个总协调。

---

## 1. 一句话定案

韭菜盒子 Studio 不做 MCP-first，不把核心能力交给外部工具链。  

目标架构是：

```text
用户显式选择 Skill / Knowledge / Tool / Model
  ↓
ChatPanel 保持现有 UI
  ↓
ConversationContextEngine 冻结本轮会话上下文
  ↓
RuntimeConnection 组装本轮运行配置
  ├─ SkillConnection
  ├─ KnowledgeConnection
  ├─ ToolConnection
  └─ LlmConnection
  ↓
LLM 请求：只暴露 ToolConnection 允许的 tool definitions
  ↓
LLM 返回 tool_calls 时
  ↓
Tool Runtime Kernel 执行已被允许的工具
  ├─ Core Native Tools：Skill 创建/评审、文件、浏览器、开发项目、文档、画布
  ├─ Job Runner：测试、benchmark、OCR、仓库分析、素材转 Skill
  ├─ Artifact Store：HTML、文档、图片、日志、评审页、产物打开
  └─ MCP Bridge：用户主动挂载的外部工具包
  ↓
工具结果回写原会话
  ↓
LLM 生成最终结果
```

用户看到的产品仍然是简单的：

```text
选择能力
输入需求
等待执行
查看结果
确认保存或继续修改
```

底层改变的是工具执行方式：从分散在 `useChat.ts` 的串行分发，升级为一个稳定、可复用、可后台运行的原生工具内核。

### 1.1 与总协调的关系

本项目已有总协调协议：`RuntimeConnection`。

`RuntimeConnection` 的职责是：

```text
组装 Skill / Knowledge / Tool / LLM
决定本轮暴露哪些工具定义
记录 Connection trace
生成本轮 prompt sections
```

`Tool Runtime Kernel` 的职责是：

```text
只执行已经被 ToolConnection 暴露并被 LLM 请求的工具
校验工具参数
检查工具权限和本地能力是否就绪
调度 instant/job/artifact/mcp 执行器
把结果回写给原会话
```

因此它不是新的总协调，不负责：

```text
选择 Skill
选择 Knowledge
选择 Model
拼装 prompt
决定本轮 Tool 是否开启
自动启用 MCP
自动写入知识库
跨会话调度任务
```

一句话：`RuntimeConnection` 决定“本轮能用什么”，`Tool Runtime Kernel` 只负责“把允许用的工具执行好”。

---

## 2. 背景

用户实测 Skill 创建流程时出现了三个严重体验问题：

1. 工具调用慢，很多步骤像卡死。
2. 评审页会重复生成，而且部分打开失败。
3. 对话工具链容易磕磕绊绊，用户不知道系统是真在工作还是停住了。

这些问题不能靠给用户增加“审计页”解决。用户真正需要的是：

```text
工具本身执行快
状态反馈稳定
失败可恢复
产物能打开
核心能力安装 APP 后就可用
```

Odysseus 值得借鉴的不是 Python/FastAPI 形态本身，而是它的组织方式：

- 中心应用统一串联 AI interaction、tool manager、MCP、vault、email、notes、webhook 等能力。
- MCP 是能力来源之一，不是所有工具的底座。
- 核心能力由应用自己掌控，外部工具通过边界接入。

韭菜盒子应吸收这个结构，但实现必须贴合桌面应用：

- 不新增常驻 FastAPI 服务。
- 不要求小白用户安装第三方 MCP。
- 不暴露端口、命令行、Python venv 等概念给用户。
- Tauri/Rust/TS 侧直接管理核心工具生命周期。

---

## 3. 当前现状

### 3.1 已有基础

当前项目已经具备可迁移的基础能力：

| 能力 | 当前文件 | 现状 |
|---|---|---|
| 工具卡片注册 | `src/utils/toolRegistry.ts` | 已有工具 id、名称、分类、风险级别和 alias |
| 工具暴露决策 | `src/runtime/connection/toolConnectionAdapter.ts` | 根据用户输入、Skill、Tool 开关决定暴露哪些 tools |
| 本地能力中心 | `src/utils/localCapabilities.ts`、`src/components/settings/LocalCapabilitySetup.vue` | 已统一检测浏览器、文件系统、Shell、源码项目、ffmpeg 等能力是否就绪 |
| MCP 工具转换 | `src/runtime/connection/mcpToolAdapter.ts` | MCP schema 可转成 OpenAI tools，并可调用 |
| 工具执行分发 | `src/composables/useChat.ts` | `executeToolCall()` 内部 if/else 调用各类执行器 |
| 工具活动状态 | `src/stores/toolStore.ts`、`src/utils/toolActivity.ts` | 已能记录 running/done/error |
| Skill 官方生命周期工具 | `src/utils/skillTestRunner.ts` | validate、run tests、benchmark、review、description improve、package |
| 素材转 Skill 文本工具 | `src/utils/skillBuilderTools.ts` | 已能从文本生成 Skill 草稿 |
| 本地内容工具 | `src/utils/localContentTools.ts` | 文档、附件、媒体处理工具已存在 |
| 开发项目工具 | `src/utils/devProjectTools.ts` | 项目读写、搜索、命令执行已有安全边界 |
| 浏览器工具 | `src/utils/browserTools.ts` | 可见 Chrome 控制已有 |

### 3.2 核心问题

当前问题不是“没有工具”，而是“工具没有统一运行内核”：

1. `useChat.ts` 同时负责 SSE、上下文、工具暴露、工具执行、工具结果回传，职责过重。
2. 工具定义、工具卡片、工具执行器分散，缺少一个一手注册表。
3. 工具调用在聊天循环里串行执行，慢任务会阻塞用户感知。
4. MCP 工具和原生工具在暴露层混在一起，边界不够清楚。
5. Skill Creator 虽然有官方生命周期工具，但现在仍依赖模型自由决定何时调用，流程不够稳定。
6. 产物打开、复用、持久化逻辑分散，评审页这类文件容易出现重复和打不开。

### 3.3 不能新增第二个协调器

`CLAUDE.md` 已经定死产品主链路：

```text
用户显式选择 Skill / Knowledge / Tool / Model
  ↓
ConversationContextEngine 构建本轮上下文工作集
  ↓
RuntimeConnection 组装 Skill / Knowledge / Tool / LLM
  ↓
PromptAssembler 生成本轮请求
  ↓
LLM 调用已暴露工具
```

所以 Tool Runtime Kernel 不能再承担“总协调”职责。它只能嵌入在下面这个位置：

```text
RuntimeConnection.tools
  ↓
ToolConnection.availableToolNames
  ↓
LLM tool_calls
  ↓
Tool Runtime Kernel
  ↓
Native executor / Job / Artifact / MCP Bridge
```

如果某个设计让 Tool Runtime Kernel 去读 Skill、召回 Knowledge、选择 Model、拼系统 Prompt，说明设计已经越界，必须退回 RuntimeConnection。

---

## 4. 产品原则

### 4.1 必须坚持

1. 核心工具内置：用户下载安装 APP 后，Skill 创建、知识库、文件转换、评审页、画布核心能力应可直接使用。
2. 纯手动工作台：用户显式选择 Skill、Knowledge、Tool、Model，LLM 只按当前配置执行。
3. UI 尽量不改：继续使用现有聊天区、工具仓库、Skill 仓库、知识库面板。
4. MCP 是外挂：用户可以主动挂载 MCP 或工具包，但核心产品不依赖它。
5. 小白友好：不要求用户理解端口、stdio、SSE、Python、MCP server、命令行安装。
6. 慢任务后台化：测试、OCR、素材构建、仓库分析这类任务必须变成可持续反馈的 Job。
7. 结果一等化：HTML 评审页、生成文档、Skill 包、转换结果都进入 Artifact Store，统一打开和复用。

### 4.2 明确不做

1. 不做通用自主 Agent。
2. 不把所有工具迁移成 MCP。
3. 不新增给用户看的“工具审计后台”。
4. 不强迫用户安装外部依赖后才能用核心 Skill 能力。
5. 不在 P1 重做聊天 UI。
6. 不在 P1 搬 Odysseus 的 Python monolith。

---

## 5. 用户体验目标

### 5.1 普通工具

用户操作保持现状：

```text
打开工具
输入任务
模型需要时调用工具
聊天中显示“正在执行”
执行完直接给结果或文件按钮
```

区别在底层：

| 现在 | 改完后 |
|---|---|
| 工具执行散落在 `useChat.ts` | 统一走 Tool Runtime Kernel |
| 慢任务占住聊天循环 | 慢任务进入 Job Runner，聊天只订阅状态 |
| 产物打开逻辑各写各的 | 统一 Artifact Store 打开 |
| MCP 和原生工具边界模糊 | 原生工具优先，MCP 只走 bridge |

### 5.2 Skill Creator

用户操作不增加复杂度：

```text
选择 Skill Creator
说要创建或修改什么 Skill
系统起草
系统自动校验
系统运行测试
系统生成评审页
用户确认修改意见
系统修改或保存
```

底层变化：

```text
旧：LLM 自由决定调哪些工具
新：应用控制官方生命周期，LLM 只负责起草、解释、根据反馈改写
```

官方生命周期固定为：

```text
draft
  ↓
validate
  ↓
run_skill_tests
  ↓
aggregate_benchmark
  ↓
open_eval_review
  ↓
wait_user_feedback
  ↓
improve_or_package
  ↓
save_skill
```

### 5.3 素材转 Skill

用户操作保持独立，不合并进 Skill Creator：

```text
选择“素材转 Skill”
拖入资料 / 粘贴文字 / P2 支持 PDF、文档 URL、GitHub、本地代码目录
系统整理成 Skill 草稿和 references
系统测试
用户确认
保存到我的 Skill
```

P1 先把文本和已上传附件链路做稳；P2 再接 Skill Seekers 或其它外部资料编译器。OpenAPI、Notion、Confluence、视频等来源放到 P3。

---

## 6. 目标架构

### 6.1 总体架构

```text
ChatPanel.vue
  ↓
useChat.ts
  - 负责消息、SSE、停止、持久化
  - 调用 RuntimeConnection 组装
  - 调用 Tool Kernel 执行 tool_calls
  ↓
RuntimeConnection
  - 组装 Skill / Knowledge / Tool / Model
  - 记录本轮暴露了哪些工具以及原因
  - 是唯一运行总协调
  ↓
LLM Stream
  - 返回文本或 tool_calls
  ↓
Tool Runtime Kernel
  - 只消费已暴露 tool_calls
  - 不读 Skill / Knowledge / Model 配置
  ├─ ToolRegistry
  ├─ ToolPolicy
  ├─ ToolExecutor
  ├─ ToolJobRunner
  ├─ ArtifactStore
  └─ McpBridge
```

### 6.1.1 三层边界

为了避免重复造一个协调系统，后续实现必须按三层分工：

| 层级 | 现有/新增模块 | 职责 | 禁止 |
|---|---|---|---|
| 总协调层 | `RuntimeConnection`、`ChatRuntimeConnection` | 组装 Skill、Knowledge、Tool、LLM，产出 prompt 和 tools | 执行本地工具 |
| 能力就绪层 | `localCapabilities.ts`、`LocalCapabilitySetup.vue`、`mcpStore.ts` | 检测和配置浏览器、文件、Shell、项目、ffmpeg、MCP server | 参与本轮 prompt 组装 |
| 工具执行层 | `Tool Runtime Kernel` | 执行 ToolConnection 已允许的工具，管理 Job 和 Artifact | 选择 Skill/Knowledge/Model，自动开启工具 |

关系是：

```text
LocalCapabilitySetup 让能力就绪
ToolConnection 决定本轮暴露什么
Tool Runtime Kernel 执行被暴露且被调用的工具
RuntimeConnection 保持唯一总协调
```

### 6.2 模块职责

| 模块 | 文件建议 | 职责 |
|---|---|---|
| ToolRegistry | `src/runtime/tools/registry.ts` | 单一工具注册表，绑定 definition、card、risk、executor、mode |
| ToolKernel | `src/runtime/tools/kernel.ts` | 统一执行入口 `executeToolCall()` |
| ToolPolicy | `src/runtime/tools/policy.ts` | 判断工具是否可执行、是否需要用户批准、是否属于 MCP |
| JobRunner | `src/runtime/tools/jobRunner.ts` | 运行慢任务，记录状态，支持取消 |
| ArtifactStore | `src/runtime/tools/artifacts.ts` | 保存、去重、打开 HTML/文档/媒体/Skill 包 |
| SkillCreatorRuntime | `src/runtime/tools/skillCreatorRuntime.ts` | 官方 Skill Creator 状态机 |
| SkillBuilderRuntime | `src/runtime/tools/skillBuilderRuntime.ts` | 素材转 Skill 状态机 |
| MCP Bridge | `src/runtime/tools/mcpBridge.ts` | 包装现有 `mcpToolAdapter`，只处理外挂工具 |
| Tauri Commands | `src-tauri/src/lib.rs` 后续拆分 | 对真正本地进程、文件打开、长任务提供稳定 IPC |

不新增“Tool Orchestrator”这类独立产品层命名，避免和 RuntimeConnection 抢职责。代码命名建议统一使用 `kernel`、`executor`、`jobRunner`、`artifactStore`，表达它只是执行层。

### 6.2.1 与本地能力中心的关系

`localCapabilities.ts` 已经是统一本地能力管理入口。它继续负责：

```text
浏览器是否配置
文件系统是否可用
Shell 是否确认
源码项目根目录是否选择
ffmpeg 是否就绪
```

Tool Runtime Kernel 只读取能力状态，不替代能力中心：

```text
用户在设置中配置能力
  ↓
localCapabilities 返回 ready / pending / unavailable
  ↓
ToolPolicy 判断当前工具是否能执行
  ↓
不能执行时返回明确错误和配置入口提示
```

例如：

| 工具 | 依赖能力 | 未就绪时 |
|---|---|---|
| `browser_open` | `browser` | 返回 `LOCAL_CAPABILITY_NOT_READY`，提示去配置浏览器操控 |
| `dev_run_command` | `devproject` + `shell` | 返回 `DEV_PROJECT_ROOT_REQUIRED` 或 Shell 未确认 |
| `local_media_process` | `ffmpeg` | 返回 ffmpeg 未就绪，不伪造处理结果 |
| `document_to_markdown` | `filesystem` | 非 Tauri 环境降级或提示桌面端使用 |

### 6.3 工具类型

```ts
type NativeToolMode = 'instant' | 'job' | 'artifact' | 'mcp'

interface NativeToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  cardId: string
  source: 'core' | 'cloud' | 'mcp'
  risk: 'safe' | 'approval' | 'write'
  mode: NativeToolMode
  execute: NativeToolExecutor
}
```

解释：

- `instant`：几十毫秒到几秒内返回，例如读取附件、校验 Skill。
- `job`：可能耗时较长，例如测试、OCR、仓库分析、素材构建。
- `artifact`：会生成文件产物，例如评审页、Office 文档、Skill 包。
- `mcp`：外挂工具，必须经过 MCP Bridge。

### 6.4 执行结果契约

所有工具统一返回结构化结果，再由 `useChat.ts` 转成 OpenAI tool message：

```ts
interface ToolExecutionResult {
  status: 'ok' | 'error' | 'running'
  toolName: string
  callId: string
  message?: string
  data?: unknown
  artifactIds?: string[]
  jobId?: string
  errorCode?: string
  errorMessage?: string
}
```

慢任务首次返回：

```json
{
  "status": "running",
  "toolName": "run_skill_tests",
  "jobId": "job_skill_tests_...",
  "message": "正在运行 Skill 测试"
}
```

任务完成后，JobRunner 把结果写回当前会话：

```json
{
  "status": "ok",
  "toolName": "run_skill_tests",
  "jobId": "job_skill_tests_...",
  "data": {
    "summary": "...",
    "benchmark": "..."
  }
}
```

---

## 7. 核心设计决策

### 7.1 为什么不是 MCP-first

MCP 适合外挂和第三方生态，但不适合作为核心产品能力的默认底座：

| MCP-first 问题 | 产品影响 |
|---|---|
| 用户可能需要安装 server | 小白用户无法理解 |
| stdio/SSE 服务生命周期复杂 | 失败点多 |
| 工具 schema 外部决定 | 产品体验不可控 |
| 工具调用延迟不可控 | 用户感知慢 |
| 权限边界不统一 | 安全和信任成本高 |

因此核心工具必须原生内置。MCP 只承担：

- 高级用户扩展。
- 第三方服务接入。
- 可分发外挂包。
- 后续生态能力。

### 7.2 为什么不增加用户可见审计页

内部可以记录耗时、错误和事件，但用户不需要看“审计”。  

用户需要看到的是：

```text
正在读取文件
正在运行测试
正在生成评审页
已完成，打开评审页
失败了，点击重试
```

所以 P1 只把事件用于：

- UI 当前状态。
- 调试定位。
- Job 恢复。
- 单元测试断言。

不新增独立审计功能。

### 7.3 为什么 Skill Creator 要状态机化

Skill Creator 是核心产品力，不能完全交给模型自由调用工具。  

模型适合做：

- 起草 `SKILL.md`
- 根据用户反馈改写
- 解释测试结果
- 生成测试用例建议

应用必须控制：

- 是否已校验
- 是否已测试
- 是否已生成评审页
- 是否等待用户反馈
- 是否允许保存

这能减少“工具乱调、漏调、重复调、跳步骤”的问题。

### 7.4 为什么慢任务必须 Job 化

Codex/Claude Code 的工具体验快，不只是因为模型快，还因为工具是明确的本地操作，执行过程不需要让模型每一步重新思考。  

我们的慢点主要来自：

```text
LLM 决策一次
工具执行很久
结果回传
LLM 再决策
工具又执行
```

Job 化后：

```text
LLM 请求一次
Kernel 启动 Job
Job 自己完成确定性步骤
UI 订阅状态
完成后再交给 LLM 解释
```

这样速度和稳定性都会提升。

---

## 8. 分阶段落地

### Phase 0：锁定边界，不改 UI

状态：✅ 已完成，2026-06-03

目标：先把工具运行边界写清楚，避免继续往 `useChat.ts` 堆逻辑。

修改：

- 新增 `src/runtime/tools/types.ts`
- 新增 `src/runtime/tools/registry.ts`
- 新增 `src/runtime/tools/kernel.ts`
- 新增 `src/runtime/tools/__tests__/kernel.test.ts`
- 修改 `src/runtime/connection/__tests__/architectureGuards.test.ts`

验收：

- 当前所有已有工具仍能通过旧路径执行。
- 新 kernel 能代理执行至少 3 类工具：Skill Creator、local content、MCP。
- `useChat.ts` 行为不变，只是调用入口变薄。
- architecture guard 明确禁止 `src/runtime/tools/**` 直接导入 `skillConnectionAdapter`、`knowledgeConnectionAdapter`、`chatRuntimeConnection`、`ConversationContextEngine`。
- architecture guard 明确要求 `useChat.ts` 仍通过 `buildChatRuntimeConnection()` 获得本轮 tools，而不是让 Tool Kernel 自己决定暴露工具。

### Phase 1：抽离 `executeToolCall()`

状态：✅ 已完成，2026-06-03

目标：把 `useChat.ts` 中的主工具执行器搬到 Tool Kernel。

迁移顺序：

1. todo tools
2. dev project tools
3. local content tools
4. browser tools
5. office tools
6. skill creator tools
7. skill builder tools
8. MCP bridge

修改：

- `src/composables/useChat.ts`
- `src/runtime/tools/kernel.ts`
- `src/runtime/tools/nativeExecutors.ts`
- `src/runtime/tools/types.ts`

实际落地：

- `useChat.ts` 继续负责 SSE、工具循环、进度 UI、消息写入。
- `RuntimeConnection` 继续负责生成本轮 `chatConnection.tools`，并传入 `exposedToolNames`。
- `ToolRuntimeKernel` 负责 allowlist 校验、JSON 参数校验、执行器分发和结构化错误。
- `nativeExecutors.ts` 保留原工具执行顺序，但只接收依赖函数，不直接导入 `agentStore`、`vaultStore` 或 RuntimeConnection。
- Skill Creator 业务函数暂留 `useChat.ts`，作为依赖传给 native executor；Phase 3 再迁入官方状态机，避免现在突破 runtime/tools 边界。

验收：

- `pnpm exec vue-tsc -b`
- `pnpm run test:focused:build`
- `pnpm run test:focused:run`
- 重点测试 `useChatSendMessage.test.ts`、`toolConnection.test.ts`、`skillTestRunner.test.ts`
- Kernel 入口必须接收 `exposedToolNames` 或等价 allowlist；未暴露工具一律返回 `TOOL_NOT_EXPOSED`。

### Phase 2：Artifact Store 统一产物打开

状态：✅ 已完成，2026-06-03

目标：评审页、Office 文档、Skill 包、媒体处理结果统一通过 Artifact Store 管理。

修改：

- 新增 `src/runtime/tools/artifacts.ts`
- 修改 `src/utils/skillCreatorWorkspace.ts`
- 修改 `src/components/chat/MessageToolSummary.vue`
- 修改 `src/utils/officeDownloads.ts`
- 修改 `src/composables/useChat.ts`，保存 Skill 后将本地 `skill-package.json` manifest 暴露为统一产物。

规则：

- 同一个 `test_id` 的评审页必须复用。
- 本地文件优先用 Tauri shell open。
- `asset://localhost/...` 必须能反查成本地路径再打开。
- Artifact 必须有 `id`、`kind`、`path`、`mimeType`、`createdAt`；本地 `asset://localhost/...` 额外提供 `localPath`，`path` 统一指向实际打开目标。
- 本地 Skill 包只允许打开 `/skills/.../skill-package.json` manifest，不放开任意 JSON 下载。

验收：

- 重复点击评审页不会生成多个 HTML。
- 评审页能在桌面端打开。
- 非 Tauri 环境能降级为浏览器打开。

### Phase 3：Skill Creator 官方状态机

状态：✅ 已完成，2026-06-03

目标：把 Skill Creator 从“模型自由调工具”改成“应用控制生命周期”。

新增：

- `src/runtime/tools/skillCreatorRuntime.ts`
- `src/runtime/tools/__tests__/skillCreatorRuntime.test.ts`

状态：

```text
idle
drafting
validated
testing
review_ready
waiting_user_feedback
improving
package_ready
saved
error
```

规则：

- 未 `validate` 不允许 `run_skill_tests`。
- 未测试不允许 `open_eval_review`。
- 未进入 `waiting_user_feedback` 不允许保存。
- 用户明确“保存”后才能 `save_skill`。
- 用户说“不满意、继续改、优化描述、命中不准”进入 `improving`。

验收：

- 模型乱调工具时返回明确错误和下一步。
- 用户只说“继续”时，能从当前会话状态继续。
- 每个会话状态严格隔离，不能串到其它会话。
- `Skill缔造` 直接 `save_skill` 会被拦截；完成 validate → tests → review 且用户明确保存后才允许保存。
- `素材转Skill` 保持独立，不套官方 Skill Creator 状态机。
- `test_id` 已纳入官方 lifecycle tools schema，用于同会话内多任务隔离。

### Phase 4：Job Runner

状态：🟡 进行中，2026-06-03 已完成 `JobStore/JobRunner` 内核；P1 慢工具接入待执行。

目标：慢任务不阻塞聊天循环，且能显示稳定工作状态。

新增：

- `src/runtime/tools/jobRunner.ts`
- `src/runtime/tools/jobStore.ts`
- `src/runtime/tools/__tests__/jobRunner.test.ts`

P1 Job：

- `run_skill_tests`
- `skill_creator_aggregate_benchmark`
- `skill_creator_open_eval_review`
- `document_to_markdown` 大文件模式

状态：

```text
queued
running
succeeded
failed
cancelled
```

事件：

```ts
interface ToolJobEvent {
  jobId: string
  at: number
  stage: string
  message: string
  progress?: number
}
```

验收：

- 慢任务开始后，聊天 UI 不显示假卡死。
- 停止生成能取消当前 Job 或至少停止后续回写。
- Job 完成后能把结果绑定到原会话。

### Phase 5：MCP 外挂边界收窄

状态：✅ 已完成，2026-06-03

目标：MCP 明确变成外挂，不混进核心工具。

修改：

- `src/runtime/connection/toolConnectionAdapter.ts`
- `src/runtime/tools/mcpBridge.ts`
- `src/stores/mcpStore.ts`

规则：

- MCP 工具只有在用户显式启用 MCP server 且工具开关打开时才暴露。
- MCP 工具卡片统一显示为“外挂工具”来源。
- MCP 工具不能覆盖核心工具同名能力。
- MCP 工具执行失败时不影响核心工具运行。

验收：

- 关闭工具时无 MCP tools。
- 只选 Skill Creator 时，不暴露普通 MCP tools。
- MCP server 未连接时，模型伪造 MCP tool call 会被拒绝。
- MCP bridge 不进入 `RuntimeConnection` prompt 组装，只提供工具 definition 和执行器。

### Phase 6：素材转 Skill 原生管道

目标：先把现有文本/附件到 Skill 的链路做稳，再接外部资料编译器。

P1（已完成）：

- `build_skill_from_text`
- `local_extract_attachment`
- `document_to_markdown`
- `run_skill_tests`
- `save_skill`

当前行为：

- 选择 `素材转Skill` 后，即使普通本地工具总开关关闭，也会暴露创建类 Skill 必需工具。
- 用户粘贴文本时直接调用 `build_skill_from_text`。
- 用户上传可读附件时先调用 `local_extract_attachment`，需要 Markdown 化时调用 `document_to_markdown`。
- 产物保存时保留 `SKILL.md`、`references/source.md`、manifest 和 asset index。

P1 审计硬化（已完成）：

- `素材转Skill` 保存门禁独立于官方 Skill Creator：必须先生成草稿、至少运行 3 个测试用例、再等用户明确确认保存。
- 长素材不再让模型在 `save_skill` 中复制大段 references JSON，优先用 `draft_id` 回读应用内草稿。
- Runtime prompt 和内置 Skill 说明都列明 5 个工具：`build_skill_from_text`、`local_extract_attachment`、`document_to_markdown`、`run_skill_tests`、`save_skill`。
- Skill 包保存只在本地文件系统成功写入后返回包路径；正式运行不再生成假的 package metadata；写包流程使用临时目录 + rename 原子替换。
- focused 回归纳入底层本地内容工具测试，覆盖附件提取和 `document_to_markdown` 暴露链路。

P2（待做）：

- 按 `docs/sdd/skill-builder-p2-native-material-compiler-sdd.md` 执行。
- 新增 `compile_skill_materials` 高层工具，内部以 APP 原生 Job 调用资料编译器。
- 不把 40 个 Skill Seekers MCP 工具暴露给聊天。
- P2 支持 PDF、文档 URL、GitHub、本地代码目录；OpenAPI、Notion、Confluence、视频等来源放到 P3。

验收：

- 用户拖入资料后可以生成 `SKILL.md + references/source.md`。
- 保存后进入“我的 Skill”。
- references 不丢失。
- 不自动写入知识库。

---

## 9. 文件级执行清单

### 9.1 新增文件

```text
src/runtime/tools/types.ts
src/runtime/tools/registry.ts
src/runtime/tools/kernel.ts
src/runtime/tools/policy.ts
src/runtime/tools/nativeExecutors.ts
src/runtime/tools/mcpBridge.ts
src/runtime/tools/artifacts.ts
src/runtime/tools/jobRunner.ts
src/runtime/tools/skillCreatorRuntime.ts
src/runtime/tools/skillBuilderRuntime.ts
src/runtime/tools/__tests__/kernel.test.ts
src/runtime/tools/__tests__/jobRunner.test.ts
src/runtime/tools/__tests__/skillCreatorRuntime.test.ts
```

### 9.2 修改文件

```text
src/composables/useChat.ts
src/runtime/connection/toolConnectionAdapter.ts
src/runtime/connection/mcpToolAdapter.ts
src/runtime/connection/__tests__/architectureGuards.test.ts
src/utils/toolRegistry.ts
src/utils/localCapabilities.ts
src/utils/skillTestRunner.ts
src/utils/skillBuilderTools.ts
src/utils/skillCreatorWorkspace.ts
src/components/chat/MessageToolSummary.vue
src/stores/toolStore.ts
```

### 9.3 暂不修改

```text
ChatPanel.vue 主布局
MessageBubble.vue 主结构
agentStore.ts 的 Skill 主存储格式
vaultStore.ts 的知识库写入原则
canvas runtime 的节点模型
RuntimeConnection 作为唯一总协调的定位
```

---

## 10. 性能目标

| 场景 | 目标 |
|---|---|
| 工具调用收到后 | 50ms 内进入 running 状态 |
| instant 工具 | 3 秒内返回，超时给可读错误 |
| Skill validate | 200ms 内完成 |
| 评审页打开 | 不重复生成，点击后 1 秒内交给系统打开 |
| Job 状态反馈 | 至少每个阶段有一次状态更新 |
| MCP 未连接失败 | 立即失败，不等待长超时 |
| 工具执行错误 | 不让聊天卡在“正在回复中” |

---

## 11. 错误恢复

| 错误 | 恢复方式 |
|---|---|
| 工具参数非法 | Kernel 返回 `INVALID_TOOL_ARGS`，让模型重试或提示用户 |
| 工具未暴露 | 返回 `TOOL_NOT_EXPOSED`，不执行 |
| MCP 未连接 | 返回 `MCP_NOT_CONNECTED`，提示用户到外挂工具启用 |
| 产物路径失效 | Artifact Store 提示重新生成 |
| Job 被取消 | 写入 `cancelled`，不继续回写 |
| Skill 测试 API 超时 | 保留草稿，允许用户重试测试 |
| 评审页打开失败 | 显示 Finder 路径或降级为浏览器打开 |
| 会话切换 | Job 只回写原 conversationId，不串会话 |

---

## 12. 安全边界

1. 所有工具参数继续走 `validateToolArgs`，100KB 限制保留。
2. 写文件工具必须保持项目根目录限制。
3. 命令执行继续使用 allowlist，不支持 shell 管道和重定向。
4. Artifact path 必须来自应用工作区或用户显式选择文件。
5. MCP 工具结果继续截断到 100KB。
6. MCP 工具不得拥有核心工具同名覆盖权。
7. Knowledge 仍然只读注入，不允许工具自动写入知识库。
8. Skill 保存必须用户确认，不能由模型静默保存。
9. Tool Kernel 不得直接读取或修改 Skill、Knowledge、Model 选择状态。
10. Tool Kernel 不得绕过 `ToolConnection.availableToolNames` 执行模型伪造工具。

### 12.1 架构守卫

新增或扩展 `src/runtime/connection/__tests__/architectureGuards.test.ts`：

```text
1. src/runtime/tools/** 不能导入 chatRuntimeConnection / runtimeConnection / skillConnectionAdapter / knowledgeConnectionAdapter。
2. src/runtime/tools/** 不能导入 vaultStore / agentStore 做运行态选择。
3. src/runtime/tools/kernel.ts 必须暴露 allowlist 参数或等价执行上下文。
4. useChat.ts 必须继续通过 buildChatRuntimeConnection() 获得 tools。
5. Tool Runtime Kernel 只能接收 tool call + execution context，不能接收完整 RuntimeConnection 并自行改写。
```

---

## 13. 与现有 SDD 的关系

| 文档 | 关系 |
|---|---|
| `manual-workbench-final-form-checklist.md` | 继续作为产品执行边界，本 SDD 不改变纯手动原则 |
| `connection-system-sdd.md` | Tool Runtime Kernel 是 ToolConnection 的执行层 |
| `skill-capability-core-sdd.md` | 本 SDD 收敛其中工具运行部分，优先原生内置，不 MCP-first |
| `conversation-runtime-context-boundary-final-sdd.md` | 会话上下文边界继续沿用，Job 回写必须绑定 conversationId |
| `chatgpt-like-streaming-experience-sdd.md` | Streaming 体验继续独立优化，本 SDD 只处理工具执行 |

---

## 14. 验收口径

P1 完成后必须满足：

1. 用户不需要额外安装 MCP，也能完整使用 Skill Creator。
2. `useChat.ts` 不再直接维护一长串工具执行 if/else。
3. Skill Creator 的官方生命周期可由应用状态机约束。
4. 评审页不重复生成，且能稳定打开。
5. 慢工具不会让界面一直停在“正在回复中”。
6. MCP 工具关闭时完全不暴露；开启时也不能覆盖核心工具。
7. 现有工具测试全部通过。

验证命令：

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
pnpm run test:focused:run
```

桌面验证：

```bash
pnpm tauri:dev
```

手动验证脚本：

1. 选择 Skill Creator，说“继续之前的 Skill 修改任务”。
2. 确认会话上下文能接上。
3. 创建一个简单 Skill。
4. 运行测试。
5. 打开评审页。
6. 不满意后继续修改。
7. 保存到我的 Skill。
8. 切换到另一个会话，确认不会串入前一个会话的 Job 或上下文。

---

## 15. 最终判断

这是韭菜盒子工具能力的长期主线：

```text
核心工具原生内置
慢任务后台 Job
产物统一 Artifact
MCP 作为外挂扩展
Skill Creator 状态机化
useChat 只做聊天，不做工具内核
```

这个方案符合当前产品定位：

- 简单：用户仍然只选择能力并输入需求。
- 直接：核心工具安装即有，不绕外部服务。
- 高效：确定性步骤由应用执行，不反复让模型调度。
- 稳定：MCP、外部工具、长任务都被隔离在明确边界里。
