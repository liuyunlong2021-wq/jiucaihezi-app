# 韭菜盒子 Studio — 桌面版产品说明书

> 本文档是 AI 协作者的完整上手指南。目标：读完即可开始编码，无需额外探索。
> **最后更新**: 2026-06-04 (上线前核心三线联测准备：Skill + 知识库 + 创作面板)

---
### 零、AI 开发行为规范

目的：

减少 AI 编程过程中最常见的错误。

这些规则应与项目自身规范配合使用。

这些规则优先保证正确性和可维护性，而非单纯追求开发速度。

对于极小任务（如修改文案、修复明显拼写错误、一行代码调整），可酌情简化执行流程。

---

# 一、编码前先思考

在开始修改代码之前，先理解问题。

## 明确说明假设

不要默默假设需求。

如果方案建立在某些前提之上，应明确指出。

例如：

- 我假设当前系统使用 JWT 登录。
- 我假设此接口仅供后台管理系统调用。

如果假设不成立，方案可能需要调整。

---

## 列出可能存在的多种理解

当需求存在歧义时：

不要自行选择一种解释。

应主动列出可能情况。

例如：

方案A：新增会员等级体系。

方案B：修改现有会员等级规则。

请确认具体需求。

---

## 主动提出更简单的方案

如果发现存在明显更简单、更直接的实现方式：

应主动说明。

例如：

- 可直接复用现有模块。
- 无需新增服务。
- 无需新增数据库表。

优先选择最简单可行方案。

---

## 不理解时立即停止

如果发现：

- 需求不明确
- 代码逻辑无法理解
- 存在关键缺失信息

应立即提出问题。

不要猜测。

不要强行继续开发。

---

# 二、简单优先

始终优先选择：

- 最简单
- 最清晰
- 最容易维护

的实现方案。

---

## 在新增设计前先自问

是否真的需要：

- 新抽象层？
- 新配置项？
- 新设计模式？
- 新服务？
- 新数据库表？

如果答案是否定的，则不要新增。

---

## 避免提前设计

不要为了未来可能出现的需求提前设计复杂架构。

避免：

- 过度抽象
- 过度封装
- 过度配置
- 过度模块化

---

## 保持代码直接可读

优先：

- 直接实现
- 明确逻辑
- 易于维护

而不是追求炫技。

原则：

能用100行解决的问题，不写1000行。

---

# 三、外科手术式修改

只修改当前任务需要修改的部分。

---

## 不做无关改动

禁止：

- 顺手重构
- 顺手优化
- 顺手格式化
- 顺手升级依赖
- 顺手调整架构

除非明确要求。

---

## 修改前确认影响范围

开始修改前应明确：

- 将修改哪些文件
- 修改哪些模块
- 可能影响哪些功能

避免扩大范围。

---

## 修改后说明改动内容

完成后应说明：

- 修改了哪些文件
- 修改了哪些逻辑
- 为什么这样修改

---

## 发现其他问题时

可以指出问题。

但不要未经允许直接修复。

例如：

发现登录模块存在潜在风险。

应先说明：

“发现额外问题，未进行修改。”

而不是直接改动。

---

# 四、目标驱动执行

先定义成功标准。

再开始开发。

---

## 明确什么叫完成

开始前应明确：

任务完成后应该满足什么结果。

例如：

- 功能可正常使用
- 测试通过
- 页面正确显示
- 接口返回符合预期

---

## Bug 修复流程

推荐流程：

1. 复现问题
2. 确认问题存在
3. 修改代码
4. 验证问题消失
5. 验证未引入新问题

---

## 新功能开发流程

推荐流程：

1. 理解需求
2. 明确验收标准
3. 制定实现方案
4. 开发
5. 验证结果

---

## 不以代码完成作为任务完成

代码写完不代表任务完成。

只有经过验证并达到目标后：

任务才算完成。

---

# 五、沟通原则

## 保持透明

明确说明：

- 正在做什么
- 为什么这样做
- 存在哪些风险
- 哪些内容尚未确认

---

## 不夸大结果

不要说：

- 已彻底解决
- 已完全修复
- 保证不会再出现

除非已经验证。

---

## 承认不确定性

如果存在不确定性：

应明确说明。

例如：

- 尚未验证生产环境
- 尚未确认兼容性
- 需要进一步测试

---

# 核心原则总结

1. 先理解，再编码。
2. 先确认，再修改。
3. 先复用，再新增。
4. 先验证，再完成。
5. 能简单，不复杂。
6. 只改需要改的内容。
7. 不猜测，不隐瞒，不自作主张。


## 一、产品定位

韭菜盒子 Studio 是一个 **本地优先的纯手动 AI 工作台桌面应用**。当前阶段的北极星不是通用 Agent、不是自主决策 Agent、也不是开放式 Agent Loop，而是：

> 用户手动选择 **Skill/ Knowledge（知识库）/ Tool（工具）/ Model（模型）**，Connection 只负责把这些显式选择组装成一次可追踪的 LLM 运行。

### 1.1 核心对象

| 对象 | 定义 | 边界 |
|------|------|------|
| **Skill** | Skill就是官方 Anthropic Skill，目录形态为 `SKILL.md` + 可选 `references/`、`scripts/`、`assets/` | 不发明私有 Skill 格式，不把Skill改造成自定义 Agent schema |
| **Knowledge（知识库）** | 独立 Wiki/Vault，提供资料、方法论、案例、规则、项目上下文 | 不属于某个 Skill，不执行任务，不替用户决策；进入 LLM 时只能作为 user-side evidence/context |
| **Tool（工具）** | 全局执行能力，例如搜索、爬虫、文件解析、文档导出、OCR、数据处理、API 调用、本地命令、媒体生成 | 默认不暴露给 LLM；必须由用户显式开启/选择；高风险工具需要独立确认边界 |
| **LLM（大语言模型）** | 执行引擎，负责根据当前 Connection 读取 Skill、Knowledge、Tool 并生成结果 | 不拥有产品结构，不自动决定 Skill/Knowledge/Tool |
| **Connection** | 产品核心运行协议，负责在一次任务中连接 Skill、Knowledge、Tool 和 LLM | 不是 Agent，不是 Workflow，不是新的 Skill 格式 |
| **ConversationRuntime / Context Engine** | 对话上下文最终主链路：发送前冻结会话、模型、Skill、Knowledge、Tool/MCP 和当前消息快照，再交给 ContextBuilder 与 PromptAssembler 生成本轮 LLM 请求 | 不是 UI 概念，不是第二套知识库，不是 Agent；Mem0 若未来接入，也只能作为内部索引 driver |
| **Superpower / 帮我配置** | 未来可选的运行前配置助手，帮助新用户推荐 Skill、Knowledge、Tool、Model | 只产出建议，用户确认后才进入手动执行；不是执行模式，不注入运行时 prompt |

### 1.2 标准调用链

```text
用户选择 Skill 或保持无 Skill
↓
用户选择 Knowledge 或保持 Knowledge off
↓
用户显式开启/选择 Tool 或保持 Tools off
↓
用户选择 Model
↓
用户输入任务
↓
RuntimeConnection 组装本轮显式配置
↓
ConversationContextEngine 构建本轮上下文工作集
↓
加载官方 Skill（SKILL.md + progressive disclosure）
↓
召回 Knowledge evidence（作为 user 上下文，不进入 system role）
↓
暴露用户允许的 Tool definitions（默认无工具）
↓
LLM 按当前配置生成
↓
必要时调用已暴露 Tool
↓
LLM 生成最终结果
↓
保存 Connection trace
```

### 1.3 LLM 上下文组装顺序

```text
System role:
1. 产品底层规则
2. Tool 策略与输出契约
3. 当前官方 Skill.md（仅在当前输入适用时完整生效，不适用时降为选择状态说明）

User/context role:
4. Knowledge evidence
5. Conversation Context evidence（最近原始消息、超长输入 brief/chunk、对话记忆、historical chunks）
6. Web search evidence
7. Tool 执行结果
8. 当前用户输入（物理上始终放最后，决策优先级高于已选 Skill/Knowledge/Tool）
```

关键原则：

- Skill就是官方 Skill，不是“兼容官方 Skill”。
- Knowledge 独立存在，通过 Connection 接入 LLM，但永远只是 evidence/context。
- Tool 独立存在，默认关闭；开启后仍只执行动作，不判断产品流程。
- LLM 不自动选择一切，只执行用户显式组装出的本轮配置；当前用户输入是本轮最高业务决策信号。
- Superpower 只作为未来“帮我配置”入口，不作为运行态。
- Workflow 不做独立模块；固定工作流必须内嵌在 Skill.md 中。

### 1.3.1 对话上下文最终架构（2026-06-03 定版）

本项目的长期对话架构定死为 **会话中心的手动上下文运行时架构**。后续开发只能在该主链路上增量扩展，禁止另起一套并行 Agent / Memory / Prompt 拼装系统。

```text
UI 层
  ChatPanel / Skill仓库 / 知识库 / 工具仓库 / MCP包 / 画布 / 编辑器 / 创作面板
        ↓
ConversationRuntime
  当前会话、历史消息、用户显式选择、发送前冻结 RuntimeSnapshot
        ↓
ContextBuilder
  从连接器读取历史、Skill、Vault、附件、搜索结果、活动上下文和省略项
        ↓
PromptAssembler
  拼成真正发给大模型的 messages + tools + trace metadata
        ↓
Executor
  流式请求、工具循环、错误处理、结果保存
        ↓
RunTrace
  记录本轮大模型实际看到了什么、用了什么工具、哪些内容被省略
```

固定模块职责：

| 模块 | 职责 | 禁止 |
|------|------|------|
| `ConversationRuntime` | 打开会话、恢复会话、冻结本轮 `RuntimeSnapshot`、保证历史已加载后才能发送 | 不拼 prompt，不直接检索 Vault |
| `ContextBuilder` | 依据 token 预算和显式选择生成 `ContextPacket`，决定带哪些历史、Skill、Vault evidence、附件和活动上下文 | 不执行工具，不调用模型生成最终回答 |
| `PromptAssembler` | 把 `RuntimeSnapshot + ContextPacket` 转换为唯一 `LLMRequestPacket` | 不读取 store，不隐式改变 Skill/Vault/Tool |
| `Executor` | 负责 SSE/stream、工具循环、取消、重试和最终消息保存 | 不重新选择上下文，不绕过 PromptAssembler |
| `RunTrace` | 保存每轮请求快照、上下文计划、工具事件和省略项 | 不参与业务决策 |

核心数据对象：

```ts
RuntimeSnapshot = {
  sessionId,
  modelId,
  messages,
  selectedSkillIds,
  selectedVaultIds,
  enabledToolIds,
  enabledMcpPackIds,
  activeSurface,
  currentUserMessage,
}

ContextPacket = {
  threadBrief,
  recentMessages,
  selectedSkills,
  vaultEvidence,
  attachments,
  activeSurfaceContext,
  omittedItems,
}

LLMRequestPacket = {
  model,
  messages,
  tools,
  traceId,
}
```

#### ContextBoundary：清除上下文的唯一语义

`清除上下文` 不是删除聊天记录，也不是清空知识库；它只是在当前会话中设置一个 `ContextBoundary`：

```text
边界之前的消息：历史仍可查看、可搜索、可手动沉淀到知识库，但后续不再默认进入模型请求
边界之后的消息：继续作为本轮近期上下文
已绑定知识库：继续通过 VaultConnector 召回 raw/wiki 证据
已选择 Skill/Tool/MCP/Model：继续按用户显式配置进入运行时
```

清除上下文后，模型仍可看到：

```text
1. ContextBoundary 之后的新对话
2. 当前选择的官方 Skill
3. 当前绑定知识库的 CLAUDE.md / raw / wiki 召回内容
4. 用户显式开启的工具和 MCP 包
5. 当前模型配置和本轮用户输入
```

产品铁律：

- 不新增聊天气泡按钮；现有 UI 形态不因本架构改变。
- 不引入“作品文档”作为新的长期记忆概念；现有知识库已经具备 `CLAUDE.md + raw/ + wiki/ + _reports/ + _templates/`。
- 知识库继续只接受用户主动添加、上传、整理或确认后的内容；AI 不得自动把聊天输出写入正式 Vault。
- 清除上下文只影响模型请求工作集，不删除会话历史，不删除 `raw/`，不删除 `wiki/`。
- 打开历史会话后，发送前必须恢复该会话的消息、Skill、Vault 和 ContextBoundary；未恢复完成不得构建 LLM 请求。

### 1.4 当前核心能力

1. **多模型对话** — 客户端直连 NewAPI（api.jiucaihezi.studio），调用 Claude / GPT / Grok 等模型
2. **Skill系统（Skill）** — 官方 Anthropic Skill 形态的内置Skill + 用户自定义Skill
3. **Connection 运行协议** — 连接用户显式选择的 Skill、Knowledge、Tool 和 LLM，支持 Manual / Plain 两种执行来源
4. **知识库系统（Vault）** — 用户手动添加资料 → 整理为 Wiki → AI 检索召回。**杜绝 AI 自动写入，防止幻觉污染知识库。**
5. **创作面板** — 统一走 NewAPI 主 Token；支持图片/视频/音频任务队列、模型可用性拦截、失败任务画廊回写
6. **画布节点系统** — 41 节点 Vue Flow 创作画布；节点/UI 已迁入，媒体运行时仍需逐步同步创作面板能力
7. **本地工具运行层** — 桌面端直接提供格式转换、浏览器控制、源码项目读写和命令执行
8. **文档能力** — Office 文档生成/转换/代码执行（通过后端 API）
9. **对话上下文引擎** — 本地 Conversation Context Engine 已接入，支持 runtimeSegment、长文 chunk、派生记忆索引、dirty/rebuild、continuation trace；Mem0 尚未接入

### 1.5 当前架构状态快照

- 当前可回滚 checkpoint：`74da554 feat: stabilize core studio runtime`。提交前必须先跑 `pnpm run test:focused`。
- 上线前联测主线：Skill（Skill缔造 + 素材转Skill + 修改/保存）、知识库（上传/整理/wiki/召回）、创作面板（图片/视频/音频任务提交、轮询、画廊回写）。
- 2026-06-04 验证门禁：`pnpm run test:focused` 已通过；其中 focused 前端 `556/556`、conversation `36/36`、Rust `skill_material` `6/6`。
- 统一对话上下文引擎历史 SDD：`docs/sdd/unified-conversation-context-engine-final-sdd.md`
- 对话上下文最终架构与 ContextBoundary 执行 SDD：`docs/sdd/conversation-runtime-context-boundary-final-sdd.md`
- 本地 `ConversationContextEngine` 已接入 `useChat.ts`，当前不接 Mem0。
- Engine 负责 `build()` / `afterAssistantMessage()` / `invalidateMessages()` / `prepareContinuation()`；不要绕过 Engine 直接读写对话记忆索引。
- Skill 选择不再无条件压制当前用户输入：`skillApplicability.ts` 会在文档导出、错误解释、一般支持类问题中把已选 Skill 降为 reference-only。
- 对话记忆必须独立于正式 Knowledge Vault；Vault 继续只接受用户手动添加和整理。
- 已完成 `Skill缔造` 官方 1:1 收尾：右键菜单固定为「修改Skill名字 / 修改Skill / 修改Skill命中关键词」，`素材转Skill` 保持独立入口，不再混入仓库菜单。
- 已完成 `素材转Skill` P2/P2.1 原生素材编译闭环：`compile_skill_materials` 接入后台 Job、Artifact Store、Rust/Tauri `skill_material_compile`、draft_id 测试绑定、下一轮确认保存、资料包元数据保留、URL/本地路径安全边界。
- `test:focused` 已接入 `src/runtime/tools/__tests__/skillBuilderRuntime.test.ts` 与 `cargo test skill_material --manifest-path src-tauri/Cargo.toml`；不要再只跑前端 bundle 就认为素材编译链路安全。
- 已完成 ContextBoundary P0：`clearContextBoundary()` 只追加边界 marker、不删除历史；`buildApiMessages()` / Engine 输入跳过边界前消息；`sessionStore` 持久化 `contextBoundaryMessageId/contextClearedAt`；RunTrace 记录边界和省略数量；历史会话加载期间禁止发送。

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri v2 (Rust)                       │
│  Plugins: fs, dialog, shell, process, notification       │
│  入口: src-tauri/src/lib.rs                              │
│  Keychain: secure_store.rs (macOS Keychain / 凭据管理器)   │
└─────────────┬───────────────────────────┬───────────────┘
              │ IPC (invoke/events)       │ WebView
┌─────────────┴───────────────────────────┴───────────────┐
│              Vue 3 + Pinia + TypeScript                  │
│  构建: Vite 8  |  包管理: pnpm  |  类型检查: vue-tsc     │
│                                                          │
│  鉴权: 手动 Key 优先；无 Key 时才走账号登录 Session          │
│  API: 同域 api.jiucaihezi.studio 下分流 NewAPI / Worker     │
│  RH:  NewAPI → rh-adapter(:8789) → RunningHub 原生 API    │
│  Creation Models: /api/creation/models → availability    │
│  手动 Key: /v1/* 直连 NewAPI 源站；账号 Session: /v1/* 走 Worker│
└─────────────────────────────────────────────────────────┘

### RunningHub rh-adapter 架构（2026-06-04 官方同步方案）

```
客户端 → api.jiucaihezi.studio (NewAPI)
          → Channel 55/56/57 → http://rh-adapter:8789
            → rh-adapter/ Python FastAPI (Docker)
               → 标准模型按官方 capabilities.json 组装 payload
               → AI App 先 apiCallDemo 获取真实 nodeInfoList
               → 上传媒体 → RH 官方 upload API
               → 轮询结果 → RH /openapi/v2/query
               → 翻译为 OpenAI 格式返回

rh-adapter: Python FastAPI 服务, Docker 部署 (rh-adapter/)
监听: 172.17.0.1:8789（Docker 内网，不暴露公网，无独立鉴权）
环境变量: .env (RUNNINGHUB_API_KEY)
架构: 异步 submit + poll — POST 提交立刻返回 task_id（走 NewAPI 计费），
      GET /tasks/{id} 轮询走 Nginx 直连（不计费，无状态，每次实时查 RH）
Channel: NewAPI 自定义渠道，代理 http://rh-adapter:8789，超时 30s
Nginx: location /rh/tasks/ { proxy_pass http://172.17.0.1:8789/tasks/; }
模型数: 19（图片4 + 视频6 + 数字人3 + 音频6）
官方源: /Users/by3/Documents/写剧本/runninghub_Skills-main (OpenClaw_RH_Skills, commit fb7de2b)

当前 RH 模型：
- 图片：rh-pro-image, rh-image-v2, rh-gpt2-image, rh-gpt2-text
- 视频：rh-video-v31-fast, rh-seedance2-text-video, rh-seedance2-image-video, rh-seedance2-multimodal-video, rh-grok-text-video, rh-grok-image-video
- 数字人：rh-aiapp-fast-digital-human, rh-aiapp-digital-human, rh-aiapp-director
- 音频：rh-speech-hd, rh-speech-turbo, rh-music, rh-voice-clone, rh-aiapp-voice-clone, rh-aiapp-voice-design

RH AI App 来源：
- `rh-gpt2-image`：官方 AI App，adapter 可 `apiCallDemo` 发现节点。
- `rh-aiapp-fast-digital-human`：极速数字人，webappId `2028055408421642241`，前端按官方文档显式提交 nodeInfoList。
- `rh-aiapp-voice-clone`：声音克隆 AI App，webappId `2046193597401276417`，前端按官方文档显式提交 nodeInfoList。
- `rh-aiapp-voice-design`：设计语音，webappId `2035739697670000642`，前端按官方文档显式提交 nodeInfoList。
- `rh-aiapp-digital-human`：数字人，webappId `2036019863617015809`，前端按官方文档显式提交 nodeInfoList。
- `rh-aiapp-director`：我是导演，webappId `2029950473750454274`，前端按官方文档显式提交 nodeInfoList。

旧 8788 网关 (runninghub-openai-gateway): 已废弃
旧 Node.js adapter: 本仓库 scripts/rh-adapter/ 已删除；线上不得再部署 Node/systemd 旧方案
禁止：rh-kling-v30-pro、rh-veo-31-fast、rh-veo-31-pro、旧 rh-seedance2 不得作为当前 RH 模型入口
收费分组：NewAPI RH 渠道 group 必须保持为 1，禁止为了测试改成 default；Step 4/冒烟必须使用可访问 group=1 的 token
```

### 供应商文档交接体系（2026-06-04）

目标：用户只需要给 AI 协作者供应商官方文档、控制台导出的 curl、参数表或示例 JSON；AI 协作者负责把链路和前端支持配置完整。

用户交接格式：

```text
我要加 [供应商/模型名]，官方文档在：/path/to/doc.md
输出类型：图片/视频/音频/文本（不知道可省略）
用途：创作面板 / 画布 / 对话工具 / 后端 API（不知道可省略）
要求：严格按官方文档接，不要自己猜参数。
```

AI 协作者必须执行：

1. 识别接口类型：标准 REST、OpenAI-compatible、异步 submit+poll、Webhook、AI App/工作流、自建节点。
2. 提取官方参数：endpoint、model id、必填字段、文件字段、枚举、输出类型、任务 ID、轮询接口、错误格式。
3. 先写测试：后端模型注册、前端模型目录、提交 payload、轮询 URL、移除/禁用旧模型保护。
4. 后端接入：优先使用官方 SDK/官方文档字段；RH 标准模型走 `capabilities.json`，RH AI App 走官方 `nodeInfoList` 或 `apiCallDemo`。
5. NewAPI/计费接入：模型名必须进入 NewAPI 渠道模型列表；RH 渠道 `group=1` 不得改；每个模型可单独设置价格。
6. 前端接入：更新 `mediaModelCapabilities.ts`、`/api/creation/models` 可用性映射、`media-generation.ts` 提交参数。
7. 验证：本地单测/类型检查先过；线上只做低成本冒烟，真实失败要保留失败卡片和轮询日志。

禁止：

- 不得为了“接上”而自造供应商没有的参数。
- 不得把旧错误模型名复活为新入口；需要兼容时必须新建明确模型 ID 或显式迁移。
- 不得绕开 NewAPI 计费链路直接让前端打供应商 Key。
- 不得修改 NewAPI RH 渠道收费分组 `group=1`。

### 创作模型可用性服务（2026-05-31）

```
客户端 CreationPanel
  → GET https://api.jiucaihezi.studio/api/creation/models
  → Nginx → creation-models(:8790)
  → 只读查询 NewAPI PostgreSQL channels 表
```

用途：

- 前端进入创作面板时刷新模型可用性。
- `media-generation.ts` 在真正提交图片/视频/音频任务前再次拦截不可用模型。
- 公网错误只返回通用提示，真实原因看 `journalctl -u creation-models`。
- 它不保存上游供应商 Key，不提交生成任务，不替代 NewAPI。

### 鉴权架构（V7.x 重要变更）

当前是两条并行路线，严禁合并：

```text
路线 A：手动 API Key（最高优先级）
用户粘贴 sk-xxx → 保存设置 → Keychain / 内存缓存
  → resolveApiConfig() 返回真实 apiKey
  → /v1/* 请求只带 Authorization: Bearer sk-xxx
  → Tauri Rust HTTP bridge 对无 X-JC-Session 的 /v1/* 直解析到 NewAPI 源站
  → 完全保持旧版“复制粘贴 Key 即可用”的直连路线

路线 B：账号登录 Session（仅在没有手动 Key 时启用）
用户点「一键登录」→ SettingsPanel 登录弹窗
  → gatewayLogin('/auth/login') 调 Cloudflare Worker 登录 NewAPI 账号
  → Session 写入安全存储和内存缓存
  → resolveApiConfig() 仅在没有手动 Key 时返回 __JC_GATEWAY_SESSION__
  → /v1/* 请求带 X-JC-Session
  → Tauri Rust HTTP bridge 保持请求到 Cloudflare Worker
  → Worker 内部使用该用户会话调用模型
```

关键规则：

- 手动 Key 存在时必须永远优先，不能绕到账号登录/Worker 路线。
- 账号登录只是“小白用户不用自己创建 Key”的低门槛入口，不替代高级 API Key。
- `src-tauri/src/lib.rs` 的分流规则是架构守卫：`/auth/*` 留在 Worker；`/v1/* + X-JC-Session` 留在 Worker；`/v1/* + 无 X-JC-Session` 直连 NewAPI 源站。
- 代码中仍保留 `gateway*` 命名作为历史兼容，但产品上不要重新引入 `gateway.jiucaihezi.studio` 子域。
- 注册入口不在应用内重做；未注册用户点击「注册」直接打开 `https://api.jiucaihezi.studio/sign-up`。

### 主站 Landing / 下载页（2026-06-02 线上修复）

NewAPI 源站仍保留 Go embed 版下载页，服务器标准位置见 `我的服务器运维手册.md`：

- Landing HTML 源码：`/opt/new-api/router/landing/index.html`
- 下载/图片/Logo 资源：`/opt/new-api/landing/`
- 标准服务器改法：改源码后重建 NewAPI 容器

但 2026-06-02 实际处理时，从当前环境 SSH 到 `47.82.86.196:22` 网络层超时，无法直接改服务器文件。因此线上采取 Cloudflare Worker 最小接管方案：

```text
api.jiucaihezi.studio/                 → Worker 返回 https://jiucaihezi.studio/landing/index.html
api.jiucaihezi.studio/landing/*         → Worker 302 到 https://jiucaihezi.studio/landing/*
api.jiucaihezi.studio/favicon.svg       → Worker 302 到 /landing/favicon.svg
api.jiucaihezi.studio/favicon.ico       → Worker 302 到 /landing/favicon.svg
api.jiucaihezi.studio/apple-touch-icon* → Worker 302 到 /landing/apple-touch-icon.svg
api.jiucaihezi.studio/auth/*            → Worker 登录网关，保持不变
api.jiucaihezi.studio/health            → Worker 健康检查，保持不变
其他 /v1/*、/api/*                      → 不由 Worker 接管，仍走 NewAPI/Nginx 原链路
```

对应代码/资源：

- `gateway/src/index.js`：Landing 首页、资源、favicon/apple-touch-icon 转发逻辑
- `gateway/wrangler.toml`：精确路由，避免误接管 `/v1/*` 和其他 API
- `public/landing/index.html`：从线上 NewAPI 首页固化出来的静态首页
- `public/landing/logo.svg`、`favicon.svg`、`apple-touch-icon.svg`：统一使用项目根 `logo.svg`

已完成的线上修复：

- 首页左上角 Logo 改为正确 `logo.svg`，并加 `object-fit: contain` 防止 36x36 容器拉伸残缺。
- 首页两处 `Intel 芯片版` / x64 DMG 按钮已删除，仅保留 Apple 芯片版；Intel 版以后上架再恢复。
- 网页标签页、收藏/保存标签页图标已补 `favicon`、`shortcut icon`、`bookmark icon`、`mask-icon`、`apple-touch-icon`。
- Cloudflare Pages 项目名：`jiucaihezi`。部署命令：`npx wrangler pages deploy dist --project-name jiucaihezi --commit-dirty=true`。
- Gateway Worker 部署命令：在 `gateway/` 下执行 `npm run deploy`。
- 最近验证：`gateway` 测试 13/13 通过；线上 Logo/favicons 与项目根 `logo.svg` hash 一致；`GET /health` 200。

---

## 审查范围（AI 协作者必读）

> 每次改代码前，先看这里确认改动的文件属于哪个优先级。

### 🔴 必检查（改动这些文件必须仔细审查）

| 目录/文件 | 原因 | 审查要点 |
|-----------|------|----------|
| `src/api/media-generation.ts` | 外部 API 调用（图/视频/音频生成） | 超时、重试、错误处理、异步轮询完整性 |
| `src/services/newApiClient.ts` | NewAPI 客户端 + Keychain 安全存储 | 鉴权传递、超时、流式/非流式双通道 |
| `src/utils/api.ts` | API 配置解析与鉴权路线选择 | 手动 Key 必须优先；仅无 Key 时才允许账号 Session；不要让粘贴 Key 走 Worker 路线 |
| `src-tauri/src/lib.rs` | Rust 命令入口 + HTTP bridge 分流 | `/auth/*`、`/v1/*` 的 Worker/NewAPI 源站分流；权限检查、panic 处理、read/write_session_token 文件权限 |
| `src/services/apiKeyCallback.ts` | 旧桌面端 key 回调兼容层 | 不得影响当前账号登录 Session；如继续保留，只能服务手动 Key 预填兼容场景 |
| `src/services/newApiOneClickLogin.ts` | 旧 Web 自动取 Key 兼容层 | 当前主线不再依赖“自动生成并填 Key”；避免把账号登录重新绕回 Key 预填 |
| `src/services/newApiAuth.ts` | 登录状态与未登录引导 | 不直接消费 URL key；检查登录状态/退出/未登录提示 |
| `src/services/creationModelAvailability.ts` | 创作模型可用性客户端 | `/api/creation/models` 解析、错误提示、运行时拦截一致性 |
| `src/canvas/services/canvasGeneration.ts` | 画布生成服务层（T8 迁入，仍有旧代理路径） | 后续必须向 `media-generation.ts` 收敛；检查超时、鉴权、轮询、错误处理 |
| `src/composables/useChat.ts` | 核心对话入口 | SSE 流解析、工具循环、ConversationContextEngine 接入、当前用户输入必须保留为最后一条 user message |
| `src/runtime/conversationContext/**` | 统一对话上下文引擎 | Engine 唯一入口、派生索引、runtimeSegment、chunking、compaction、dirty/rebuild、continuation、trace |
| `src/runtime/connection/**` | Connection 运行层 | Skill/Knowledge/Tool 组装、Skill 适用性判断、只能消费 Engine 输出，不能直接访问 Mem0 / memory index |
| `src/composables/officeTools.ts` | 本地文档/Office 工具 | create_document 必须生成真实文件并结束工具轮次，不能只文字声称完成 |
| `src/utils/localDocx.ts` | 本地 docx 写出器（旧版，保留兼容 createDocxFromText） | ZIP/XML 正确性、XML 转义、文件内容完整性 |
| `src/utils/localDocxV2.ts` | **新增** — Tiptap JSON → OOXML DOCX 渲染器 | 节点类型覆盖、6 命名空间根声明、图片 drawing 正确性、ZIP 完整性 |
| `src/utils/editorExport.ts` | **新增** — 编辑区统一导出服务（单一入口） | exportDocx/exportDocument 诊断+metadata+事件完整性；禁止 EditorPanel 绕过直调底层 |
| `src/utils/pptxExport.ts` | PPTX 导出骨架（Phase 3 试点，当前仅占位） | 待实现真实 OOXML 或接入 pptxgenjs 后再上线菜单 |
| `src/utils/confirmAction.ts` | 用户确认封装 | Tauri dialog plugin 优先，浏览器 confirm 兜底；禁止直接在 UI 中使用原生 confirm |
| `src/stores/agentStore.ts` | Skill管理（15 个文件依赖） | 数据迁移兼容、localStorage 序列化 |
| `src/stores/vaultStore.ts` | 知识库状态 | 与 useFileStore 的双向依赖 |
| `src/stores/sessionStore.ts` | 对话历史持久化 | SQLite 读写、消息一致性 |
| `src/utils/idb.ts` | SQLite 存储层（~/.jiucaihezi/data/jiucaihezi.db） | 表结构变更、迁移逻辑、SQL 注入、内存缓存一致性 |
| `src/utils/httpClient.ts` | fetch 劫持 + Rust HTTP 桥接 | SSE 流完整性、错误传播 |
| `src/utils/localContentTools.ts` | 本地格式转换/音视频工具 | 文件路径安全、外部进程调用 |
| `src/utils/browserTools.ts` | Chrome 浏览器控制 | 外部进程安全、URL 校验 |
| `src/components/chat/ChatScrollNav.vue` | 对话滚动跟随 | 内容增长前必须先判断是否接近底部，不能在 scrollHeight 增长后再判断 |
| `src/components/chat/display/**` | ChatGPT-like 对话显示体验 | 渐进流式显示、auto-scroll policy、markdown/工具展示模型、trace；修改后必须跑 display 相关测试 |
| `src/utils/webSearch.ts` | Jina 搜索 API（V7.1） | 超时、错误透传、8s AbortController |
| `src/utils/highlight.ts` | 代码高亮（V7.1） | DOMPurify 放行 hljs class |
| `src/utils/mermaidRenderer.ts` | Mermaid 图表（V7.1） | 动态 import、Sandbox 安全 |
| `src/data/modelContextWindows.ts` | 模型窗口映射（V7.1） | 默认值准确性、模型族推断 |
| `src/utils/localCapabilities.ts` | 本地能力注册表（V7.1） | 能力检测准确性、首次引导逻辑 |
| `src/utils/runtimeCapabilities.ts` | 模型运行时能力检测（V7.x） | DeepSeek V4 reasoning/thinking 识别、请求参数构建 |
| `src/utils/todoTools.ts` | LLM 可见 todo 工具（V7.x） | 工具定义完整性、会话状态隔离、参数校验 |
| `src/components/settings/LocalCapabilitySetup.vue` | 能力中心 UI（V7.1） | modal/inline 双模式、跳过逻辑 |
| `src/utils/devProjectTools.ts` | 源码项目读写/命令执行 | 路径遍历、命令白名单 |
| `src/utils/brain.ts` | 知识提炼 LLM 调用 | 输入脱敏（sanitizeBrainInput）、提取质量 |
| `src/utils/vaultFs.ts` | 知识库文件系统 | 文件名 NFKC 正规化、路径遍历防护 |
| `src/components/canvas/runtime/canvasInputs.ts` | 画布 prompt 拼接 + 媒体输入收集 | 边界标记完整性、注入面、upload 节点类型支持 |
| `src/canvas/providers/canvasModels.ts` | 画布模型注册表 | 444+ 行，IMAGE_MODELS / VIDEO_MODELS / AUDIO_MODELS / LLM_MODELS |
| `src/data/mediaModelCapabilities.ts` | 媒体模型能力注册表（创作面板主用，画布待收敛） | provider/fields/webappId 一致性、runtime availability override |
| `src/components/canvas/runtime/canvasLlmRuntime.ts` | 画布 LLM 执行 | SKILL.md 加载安全（白名单+大小限制） |
| `src-tauri/capabilities/default.json` | Tauri 权限声明 | 最小权限原则、.session 文件 deny |

### 🟡 改动需注意

| 目录/文件 | 注意事项 |
|-----------|----------|
| `src/stores/mediaTaskStore.ts` | 异步任务队列（媒体生成），注意竞态和页面刷新后恢复轮询 |
| `src/composables/useBrain.ts` | 知识提炼 LLM 调用，依赖 vaultStore + useFileStore |
| `src/composables/useVaultCompiler.ts` | 知识库编译，依赖 vaultStore |
| `src/composables/useSkillEvolution.ts` | Skill进化逻辑，修改历史记录 |

### 🟢 可忽略（改动无需深度审查）

| 目录 | 说明 |
|------|------|
| `src/components/**/*.vue` | UI 组件，只影响展示不涉及数据/安全 |
| `src/layouts/` | 布局组件 |
| `src/styles/` | CSS 样式/设计令牌 |
| `src/**/__tests__/` | 测试文件 |
| `docs/` | 文档 |
| `public/skills/` | 预设Skill SKILL.md 静态文件 |
| `src/data/` | 静态配置数据（模型定义、模板） |

### ⚠️ 已知问题（不要重复排查/修复）

| 问题 | 状态 | 说明 |
|------|------|------|
| API 请求 "Load failed" | ✅ 已修复 | 已用 Rust `http_request` / `http_request_stream` Command 完全绕过 WKWebView fetch |
| 手动 Key 与账号登录串线 | ✅ 已修复 | `resolveApiConfig()` 中手动 Key 永远优先；只有没有 Key 时才使用账号 Session。Rust bridge 根据 `X-JC-Session` 分流：有 Session 走 Worker，无 Session 的 `/v1/*` 直连 NewAPI 源站。 |
| `window.open()` 无效 | ✅ 已处理 | 统一用 `openExternal()` (tauri-plugin-shell) |
| Session Token 泄露风险 | ✅ 已修复 | Token 从 localStorage 迁移到 Rust `~/.jiucaihezi/.session` 文件（0600 权限），JS 内存缓存 |
| Tauri FS 权限过宽 | ✅ 已修复 | 移除 `fs:allow-read`/`fs:allow-write`/`fs:allow-copy-file`，token 文件明确 deny |
| SKILL.md 远程加载无校验 | ✅ 已修复 | 加白名单 + 50KB 大小限制 + Content-Type 校验 + agentStore 优先 |
| Canvas ToMD 路径无校验 | ✅ 已修复 | JS 侧加 validateSourcePath（空路径/ null 字节/.. 遍历/相对路径拦截） |
| login/register 参数无校验 | ✅ 已修复 | 客户端 validateLoginPayload / validateRegisterPayload 前置 |
| 工具调用参数无 Schema | ✅ 已修复 | validateToolArgs 加 100KB 限制 + 类型检查 + 错误脱敏 |
| 画布 prompt 注入面大 | ✅ 已修复 | mergePromptInputs 加边界标记 `[用户画布输入开始/结束]` |
| Unicode 同形异义攻击 | ✅ 已修复 | sanitizeName() 加 NFKC 正规化 |
| 知识提炼泄露敏感信息 | ✅ 已修复 | brain.ts 加 sanitizeBrainInput（脱敏 Token/JWT/API Key/密码） |
| 知识库自动沉淀污染 | ✅ 已禁用 | ingestAssistantOutput 从 useChat.ts 彻底移除，知识库只接受用户手动添加 |
| 统一对话上下文引擎 | 🟡 本地引擎已接入，Mem0 未接入 | `ConversationContextEngine.build()` 是对话上下文工作集入口；已支持 runtimeSegment、message chunks、本地 fallback memory、heavy historical chunk recall、dirty/rebuild、continuation。不要把对话记忆混入 Vault；不要新增用户可见“记忆 Provider”选择。 |
| 历史会话恢复后上下文丢失 | 🟡 待排查 | 打开历史会话后，界面消息已恢复，但下一轮 prompt 仍需核对是否被 `lastRuntimeContextSignature` / `runtimeClearMessageId` / context budget 裁掉；先查恢复链路，不要先改 memory index。 |
| Skill 过度主导当前输入 | ✅ 已修复 | `skillApplicability.ts` 将当前 Skill 与本轮用户输入做适用性判断；不相关的报错解释、文档导出等任务降为 reference-only，当前用户输入优先。 |
| Word 生成后仍显示运行中 | ✅ 已修复 | `create_document` / `office_create` 成功后直接以 `tool_complete` 收尾，并附带下载文件。 |
| `dialog.confirm not allowed` | ✅ 已修复 | UI 危险操作改用 `confirmAction()`，Tauri 环境走 `@tauri-apps/plugin-dialog`。 |
| 对话输出不自动滚到最新内容 | ✅ 已修复 | `ChatScrollNav.vue` 在内容增长前捕获 near-bottom 状态，通过 `autoScrollPolicy.ts` 判断是否跟随，避免 scrollHeight 增长后误判为用户离底部。 |
| 流式输出末尾突然整段刷出 | ✅ 已缓解 | `[DONE]` 不再强制 full flush visible delta，而是调用 progressive reveal 的 `finish()` 继续按节奏揭示剩余文本。上游如果本身批量返回，仍会有 TTFB/批量块限制。 |
| Editor DragHandle keyed plugin 报错 | ✅ 已修复 | `EditorPanel.vue` 移除重复的 DragHandle extension 注册，仅保留 Vue DragHandle 组件，避免 `RangeError: Adding different instances of a keyed plugin (dragHandle$)`。 |
| `useCreationEngine.ts` 已废弃 | ✅ 已处理 | 0 调用方，已标记完全废弃可安全删除 |
| 内置Skill `SKILL_PRESETS` 已重建 | ✅ 已完成 | 19 个 L1 + 1 个 L2，全部通过 skill:// 协议加载 |
| TypeScript 严格性低 | 🟡 故意的 | `noUnusedLocals` / `noUnusedParameters` 已关闭，允许隐式 `any` |
| 日志系统 | ❌ 未做 | 目前散落 `console.log`，无统一日志级别/持久化 |
| 监控告警 | ❌ 未做 | 无 Sentry / 错误汇集 / 崩溃上报 |
| 循环依赖 utils→stores→composables | 🟡 已知 | 12 个 `utils/` 文件反向依赖上层，涉及 `migration.ts`、`brain.ts`、`browserTools.ts` 等 |
| 3 个空目录 | 🟢 低优 | `src/components/agent/`、`common/`、`session/` 预留未用 |
| VaultWizard「添加现有知识库内容」 | ✅ 已实现 | 新增第 4 张卡片：选择知识库 + 上传文件 + 自动整理 |
| 设置页账户区颜色与主题不一致 | ✅ 已修复 | 新增 `--jc-account-card-bg` / `--jc-member-glow` / `--jc-member-glow-text` 三个语义令牌到 4 个主题，SettingsPanel.vue 中 11 处硬编码颜色全部替换为令牌 |
| 非 vision 模型贴图 502 | ✅ 已修复 | `buildApiMessages` 改为模型感知：非 vision 模型所有历史/新消息图片统一扁平化为纯文本。`supportsVision()` 检测 NewAPI 端点能力 |
| 图片桥接（text 模型间"读图"） | ✅ 已实现 | `src/utils/imageBridge.ts`：非 vision 模型 + 贴图 → 调 claude-haiku-4-5 描述图片 → 文字注入 user message。会话级缓存复用 |
| Cherry Studio 对话功能对比 | ✅ 已完成 | P0-P3 全部 16 项已实施：代码高亮/highlight.js、时间戳、会话内搜索、KaTeX、Mermaid、搜索引用卡片、TTS朗读、引用回复、编辑消息/重新生成、多模型并行、全局搜索Cmd+K、临时对话、多语言i18n、Jina API搜索、Token水位计 |
| V7.1 Token 水位计 | ✅ 已实现 | 模型感知的 token 水位显示（`≈2.4K / 200K ▓░░░ 1.2%`），替代旧的 N/20 条。`src/data/modelContextWindows.ts` 维护 30+ 模型上下文窗口映射。截断策略从按条改为按 token 预算。 |
| V7.1 搜索互斥设计 | ✅ 已实现 | 搜索按钮 ON→Jina API(Jina-search模型)自动搜索注入，隐藏 browser_search 工具；OFF→暴露浏览器工具供 AI 调用。`buildAvailableTools()` 中条件排除。`webSearch.ts` 含 8s 超时+错误透传。 |
| V7.1 Finder 文件拖拽 | ✅ 已实现 | `ChatPanel.vue` 监听 Tauri `onDragDropEvent`，OS 文件拖入 → FS 读内容 → FileUploader 附件。与 HTML5 拖拽并行。 |
| V7.1 护眼模式代码高亮 | ✅ 已修复 | `highlight-theme.css` 为 green 主题独立配色（浅绿底+高对比文字），不再复用暗色主题。 |
| 临时对话 | 🟢 已删除 | 用户反馈无实用价值，已从 ChatPanel 移除。 |
| mermaid 阻塞启动 | ✅ 已修复 | mermaid(11.x) 改为动态 `import('mermaid')`，仅在渲染 mermaid 代码块时加载，避免 1.5MB 库阻塞 Vue 挂载。 |
| V7.1 本地能力中心 | ✅ 已实现 | `src/utils/localCapabilities.ts` 能力注册表 + `LocalCapabilitySetup.vue` 首次引导弹窗 + 设置页内嵌。统一管理浏览器/文件/Shell/项目/ffmpeg 5 项本地能力，首次启动自动检测，非必需项可跳过。 |
| V7.2 T8 画布节点迁入 | 🟡 骨架完成 | 41 个节点从 T8-penguin-canvas 迁入，UI/节点/执行器骨架完整。注意：画布媒体运行时仍存在旧 `/api/proxy/*`、`/api/runninghub/*`、Seedance 直连等路径，尚未完全同步创作面板的 NewAPI + availability 方案。 |
| V7.x 账号登录/手动 Key 双路线 | ✅ 已完成 | 设置面板保留「一键登录 / 下载APP / 充值 / 使用日志」。一键登录使用 NewAPI 账号密码换取 Studio Session；没有手动 Key 时可直接对话。高级 API Key 输入保留为折叠能力，用户粘贴 Key 后完全走旧版直连路线，优先级高于账号 Session。 |
| V7.x 媒体鉴权统一 | 🟡 创作面板完成，画布运行时待收敛 | 创作面板统一走主 NewAPI Token，不再提供独立媒体 Key / BYOK 配置。画布模型注册表已移除旧 RH Seedance 入口，但画布媒体执行服务仍待统一改走 `media-generation.ts`。 |
| V7.x RH 官方同步 | ✅ 架构落地，真实付费冒烟待完成 | RH 实现已按官方 OpenClaw_RH_Skills 同步：标准模型由官方 `capabilities.json` 驱动；AI App 走 `apiCallDemo → nodeInfoList → upload → ai-app/run`，其中 5 个用户复制官方文档的 AI App 已按官方 nodeInfoList 显式提交。Python FastAPI adapter 为异步 submit+poll。当前注册 19 个 RH 模型，旧 Kling/Veo/旧 `rh-seedance2` 已移除。SDD: `docs/sdd/runninghub-official-sync-sdd.md`。 |
| V7.x rh-adapter 部署 | ✅ 基础上线完成 | Python FastAPI + Docker。无独立鉴权（Docker 内网隔离）。异步 submit+poll：POST 走 NewAPI 计费，GET `/rh/tasks/{id}` 走 Nginx 直连。线上旧版本已确认 adapter `models:14`、`/api/creation/models`、`/rh/tasks/` 轮询代理；本地代码已升为 `models:19`，下次部署会刷新 NewAPI RH 渠道模型列表。剩余 Step 4：用可访问 NewAPI `group=1` 的 token 跑真实付费冒烟。 |
| V7.x 创作模型可用性服务 | ✅ 已完成 | `/api/creation/models` 由 `creation-models(:8790)` 只读查询 NewAPI channels；创作面板挂载时刷新可用性，`media-generation.ts` 执行前再次拦截禁用模型。 |
| V7.x CORS 修复 | ✅ 已修复 | Nginx 全局 `Access-Control-Allow-Origin: https://jiucaihezi.studio`。Cloudflare Pages 网页版 CORS 已通。CSP `font-src` 已加 `data:`。 |
| V7.x safeFetch 迁移 | ✅ 已完成 | `media-generation.ts` 全网 0 个裸 `fetch()`。`apiCall`/`apiCallMultipart`/`uploadCreationAsset` 全部走 `safeFetch`+超时。 |
| V7.x submitCreationTask 死代码 | ✅ 已删除 | 旧的 `/api/creations/tasks` 通路（0 调用方），所有 RH 模型统一走标准 OpenAI 端点 + rh-adapter。 |
| V7.x 创作画廊失败反馈 | ✅ 已修复 | `mediaTaskStore` 记录失败任务 `completedAt`，CreationPanel 挂载时把已完成/失败的 creation 任务回写画廊，避免“转圈消失”和刷新后缺失失败原因。 |
| V7.x 画布模型注册表 | 🟡 部分收敛 | `canvasModels.ts` 已移除旧 `rh-seedance2`，改为官方 `rh-seedance2-text-video` / `rh-seedance2-image-video` / `rh-seedance2-multimodal-video`。后续仍应复用 `mediaModelCapabilities.ts` 和 `/api/creation/models`，避免创作面板与画布模型状态分叉。 |
| V7.x 画布 UploadNode | ✅ 已修复 | canvasInputs.ts 接受 upload 节点类型，支持多字段 URL 提取。 |
| V7.x 画布 AudioNode | ✅ 已修复 | cover/extend 模式补传 refAudioUrl/startTime/endTime/refText。 |
| V7.x 对话体验升级 | 🟡 持续收敛 | highlight.js 代码高亮、KaTeX、Mermaid、TTS、思考链折叠、引用卡片、图片灯箱、时间戳、progressive stream reveal、auto-scroll policy 已接入。下一阶段应把对话区沉淀为稳定组件架构，避免继续在 `useChat.ts` / UI 之间打散修改。 |
| V7.x GPT Image 2 可用声明 | 🟢 已过时 | 创作面板不再硬编码“仅 GPT Image 2 可用”。当前以 `/api/creation/models` 返回的 NewAPI 渠道状态为准。 |
| 2026-06-02 主站 Landing 修复 | ✅ 已完成 | SSH 到 NewAPI 源站 22 端口超时，线上暂由 Cloudflare Worker 精确接管 `api.jiucaihezi.studio/` 首页和 favicon/apple-touch-icon 路径；首页 Logo 统一为项目根 `logo.svg`，删除两处 Intel/x64 下载按钮，网页标签/收藏图标已补齐。详见“主站 Landing / 下载页”。 |
| V7.x GitHub Actions CI | ✅ 已完成 | `.github/workflows/build.yml` 三平台自动打包（macOS ARM/Intel + Windows）。 |
| V7.x Windows 本地编译 | ❌ macOS→Win | macOS 交叉编译 SQLite 需要 LLVM + cargo-xwin，451MB LLVM 下载慢且不稳定。推荐 GitHub Actions CI。 |
| V7.x DeepSeek V4 运行时 | ✅ 已完成 | `runtimeCapabilities.ts` 识别 deepseek-v4-pro/flash 为推理模型，发送 `thinking` + `reasoning_effort` 参数。fast 档自动禁用 thinking。 |
| V7.x 会话级 Todo 工具 | ✅ 已完成 | `todoTools.ts` 提供 todo_create/update/list/clear 4 个 LLM 可见工具，会话内持久化。复杂任务提示词引导模型先建清单再逐步执行。 |
| V7.x GPT Image 2 Skill | ✅ 已完成 | `public/skills/gpt-image-2-prompts/` 基于 wuyoscar/GPT-Image2-Skill（MIT），30+ 分类、162+ 精选提示词。SKILL.md + 31 个分类 references/gallery-*.md。 |
| V7.x NarratoAI 全量融合 | ✅ 已完成 | 对照 linyqh/NarratoAI（9.6k⭐），拆为 2 个Skill + 3 个工具：`narrato-docu`（影视解说工坊）、`narrato-short`（短剧解说工坊）、`srtParser.ts`（SRT 解析）、`local_video_narrate`（一键解说管道）、whisper.cpp 字幕转录（通过 `media_transcribe_file`）。SDD: `docs/sdd/narratoai-integration.md`。 |
| V7.x 内置Skill补全 | ✅ 已完成 | 从 20 个补到 **36 个内置Skill**，清理 3 个无目录的无效注册（canvas-design/claude-api/legal-workbench），新增 17 个 Banana系列+影视管线+视频提示词+音频Skill。 |
| V7.x 编辑区文档导出 | ✅ 已完成 | 编辑区升级为文档工作台。支持一键导出 **Word(.docx)**、**PDF**（window.print）、**HTML**、**Markdown**。DOCX 保真度覆盖标题/粗斜体/下划线/高亮/列表/表格/图片嵌入/任务列表/WikiLink。统一入口 `editorExport.ts`（exportDocx + exportDocument），EditorPanel 零直接引用底层。含诊断报告、版本快照、模板系统、LLM 工具集成（`export_editor_document`）。SDD: `docs/sdd/editor-document-export-optimization-sdd.md`，TDD: `docs/tdd/editor-document-export-optimization-tdd.md`。 |

### ✅ 上线标准（每次发版前检查）

- [x] **0 个 critical 安全漏洞**：Session token 已迁移到 Rust 0600 文件，FS 权限已收窄
- [ ] **所有 API 调用有超时/重试**：检查 `src/api/`、`src/services/`、`httpClient.ts` 的 fetch 是否设置 AbortController/超时
- [x] **数据操作有事务保护**：`idb.ts` 的 SQLite 写入、JSON 文件原子替换（先写临时文件再 rename）
- [x] **SSE 流式传输不掉字符**：`http_request_stream` Rust 侧逐块推送完整性
- [x] **外部链接不走 `window.open`**：全部走 `openExternal()` 在系统浏览器打开
- [x] **知识库不自动写入**：`ingestAssistantOutput` 已移除，仅用户手动添加
- [x] **会话 Token 不存 localStorage**：使用 macOS Keychain 存储（0600 等效）+ JS 内存缓存，`~/.jiucaihezi/.session` 文件仅作降级
- [ ] **日志系统**：仍未实现，建议在 V8 添加

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri v2 (Rust)                       │
│  Plugins: fs, dialog, shell, process, notification, http, sql│
│  入口: src-tauri/src/lib.rs                              │
└─────────────┬───────────────────────────┬───────────────┘
              │ IPC (invoke/events)       │ WebView
┌─────────────┴───────────────────────────┴───────────────┐
│              Vue 3 + Pinia + TypeScript                  │
│  构建: Vite 8  |  包管理: pnpm  |  类型检查: vue-tsc     │
└─────────────────────────────────────────────────────────┘
```

### 关键依赖版本

| 组件 | 版本 | 说明 |
|------|------|------|
| Tauri (Rust) | 2.11.2 | 桌面壳，管理窗口/权限/插件 |
| @tauri-apps/api | 2.11.0 | JS 侧 IPC 接口 |
| tauri-plugin-http | 2.5.9 | Rust 侧 HTTP 请求（绕 CORS） |
| Vue | 3.x | 前端框架（Composition API） |
| Pinia | 最新 | 状态管理 |
| Tiptap | v3 | 富文本编辑器 |
| marked + dompurify | — | Markdown 渲染 |
| highlight.js | latest | 代码语法高亮（15 语言） |
| katex | 0.17 | 数学公式渲染 |
| mermaid | 11.x | 图表渲染（动态 import） |
| tokenx | 1.x | Token 估算 |

---

## 三、目录结构

```
jiucaihezi-app/
├── src-tauri/                  # Tauri Rust 后端
│   ├── src/lib.rs              # 应用入口，注册 6 个插件
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # 窗口/CSP/构建配置
│   └── capabilities/default.json # 权限声明（fs/http/shell/dialog...）
│
├── src/                        # Vue 前端
│   ├── main.ts                 # 启动：theme → patchFetch → initDB → mount
│   ├── App.vue                 # 根组件，调用 runAutoMigrations()
│   ├── env.d.ts                # TS 声明（.vue, .css）
│   │
│   ├── layouts/
│   │   └── WorkspaceLayout.vue # ★ 主布局：5 列桌面 + 移动端适配
│   │
│   ├── components/
│   │   ├── rail/ActivityRail.vue      # Col 1: 左侧图标导航栏
│   │   ├── filetree/FileTreePanel.vue # Col 2: 文件树（Skill/知识库/历史）
│   │   ├── chat/                      # Col 4: 对话区
│   │   │   ├── ChatPanel.vue          #   主对话界面（含搜索开关+Token水位计+多模型对比）
│   │   │   ├── MessageBubble.vue      #   消息气泡（KaTeX/Mermaid/代码高亮/TTS/引用卡片）
│   │   │   ├── ToolCallCard.vue       #   普通工具调用卡片
│   │   │   ├── MediaTaskBubble.vue    #   媒体生成任务气泡
│   │   │   ├── FileUploader.vue       #   文件拖拽上传（Finder拖拽+Tauri事件）
│   │   │   ├── SkillPickerBar.vue     #   Skill选择器
│   │   │   ├── VaultPickerBar.vue     #   知识库选择器
│   │   │   ├── AgentStatusBar.vue     #   Agent 阶段状态条
│   │   │   └── ChatScrollNav.vue      #   滚动导航
│   │   ├── canvas/                      # ★ 画布节点系统 (V7.x, 41 节点, T8 迁入骨架)
│   │   │   ├── CanvasWorkspace.vue      #   画布主容器 (VueFlow)
│   │   │   ├── CanvasNodeLibrary.vue    #   节点库侧边栏（7 组分类）
│   │   │   ├── CanvasToolbar.vue        #   工具栏
│   │   │   ├── CanvasWorkflowPanel.vue  #   工作流模板面板
│   │   │   ├── CanvasExecutionLog.vue   #   执行日志
│   │   │   ├── CanvasModeControls.vue   #   模式控制
│   │   │   ├── nodes/                   #   41 个节点（含 AI 生成节点，运行时待收敛）
│   │   │   │   ├── CanvasImageGenNode.vue    # GPT Image + Nano Banana（366 行）
│   │   │   │   ├── CanvasVideoGenNode.vue    # Veo + Grok Video（237 行）
│   │   │   │   ├── CanvasSeedanceNode.vue    # Seedance 2.0（旧直连路径，待收敛）
│   │   │   │   ├── CanvasAudioGenNode.vue    # Suno（183 行）
│   │   │   │   ├── CanvasRunningHubNode.vue  # RH 单次工作流（365 行）
│   │   │   │   ├── CanvasRhToolsNode.vue     # RH 工具集（325 行）
│   │   │   │   ├── CanvasRhConfigNode.vue    # RH 配置（129 行）
│   │   │   │   └── ...（其余 33 个节点）
│   │   │   │   ├── CanvasUploadNode.vue
│   │   │   │   ├── CanvasOutputNode.vue
│   │   │   │   ├── CanvasLoopNode.vue
│   │   │   │   ├── CanvasFramePairNode.vue
│   │   │   │   ├── CanvasTextSplitNode.vue
│   │   │   │   ├── CanvasPickFromSetNode.vue
│   │   │   │   ├── CanvasResizeNode.vue
│   │   │   │   ├── CanvasCombineNode.vue
│   │   │   │   ├── CanvasGridCropNode.vue
│   │   │   │   ├── CanvasImageCompareNode.vue
│   │   │   │   ├── CanvasCinematicNode.vue
│   │   │   │   ├── CanvasVideoMotionNode.vue
│   │   │   │   ├── CanvasMultiAngleVisualNode.vue
│   │   │   │   ├── CanvasIdeaNode.vue
│   │   │   │   ├── CanvasBpNode.vue
│   │   │   │   ├── CanvasRelayNode.vue
│   │   │   │   └── ... (其余节点)
│   │   │   ├── runtime/                 #   执行引擎
│   │   │   │   ├── canvasExecutor.ts
│   │   │   │   ├── canvasLlmRuntime.ts
│   │   │   │   ├── canvasMediaRuntime.ts  # 当前调用 canvasGeneration.ts，待统一到 media-generation.ts
│   │   │   │   └── canvasToolRuntime.ts
│   │   │   ├── shared/
│   │   │   │   ├── MaterialPreviewSection.vue
│   │   │   │   ├── MentionPromptInput.vue
│   │   │   │   ├── RHToolEditorModal.vue   # RH 参数模板编辑器（219 行）
│   │   │   │   └── mediaMentions.ts
│   │   │   └── utils/
│   │   │       └── canvasNodeFactory.ts
│   │   ├── search/
│   │   │   └── GlobalSearch.vue       # 全局搜索 Cmd+K 面板
│   │   ├── agents/                    # Skill管理
│   │   │   ├── AgentWizard.vue        #   创建向导
│   │   │   ├── AgentEditDialog.vue    #   编辑弹窗
│   │   │   └── EvolutionDiff.vue      #   进化对比
│   │   ├── brain/BrainPanel.vue       # 知识库浏览（raw/wiki/lint）
│   │   ├── editor/
│   │   │   ├── EditorPanel.vue        # ★ Tiptap 富文本编辑器（V7.x 文档工作台升级）
│   │   │   ├── WikiLinkExtension.ts   # [[wiki-link]] 扩展
│   │   │   └── editorTableExtensions.ts # 自定义 Table 扩展
│   │   ├── creation/                  # 创作面板
│   │   │   ├── CreationPanel.vue      #   主面板
│   │   │   ├── GalleryCard.vue        #   媒体卡片
│   │   │   ├── GalleryLightbox.vue    #   灯箱预览
│   │   │   ├── GalleryLoadingCard.vue #   加载占位
│   │   │   └── GallerySizeControl.vue #   网格控制
│   │   ├── vault/VaultWizard.vue      # 知识库创建向导
│   │   ├── settings/
│   │   │   ├── SettingsPanel.vue       # 设置面板
│   │   │   └── LocalCapabilitySetup.vue # 本地能力中心（V7.1）
│   │
│   ├── composables/               # 核心业务逻辑
│   │   ├── useChat.ts             # ★★★ 最核心文件（1183 行）
│   │   ├── useBrain.ts            # 知识提炼 + 召回
│   │   ├── useCreation.ts         # 创作面板状态
│   │   ├── useCreationEngine.ts   # 创作任务执行
│   │   ├── useFileStore.ts        # 文件 CRUD（IndexedDB 封装）
│   │   ├── useEvolution.ts        # Skill进化（darwin-skill）
│   │   ├── useSkillFeedback.ts    # 知识库 → Skill反哺
│   │   ├── useVaultCompiler.ts    # 知识库编译
│   │   ├── useNotebook.ts         # 笔记本
│   │   ├── useFileUpload.ts       # 文件上传
│   │   └── useTheme.ts            # 主题
│   │
│   ├── stores/                    # Pinia 状态
│   │   ├── agentStore.ts          # Skill管理（30+ 预设 + 用户自定义）
│   │   ├── sessionStore.ts        # 对话历史（IndexedDB）
│   │   ├── vaultStore.ts          # 知识库管理
│   │   ├── mediaTaskStore.ts      # 媒体生成任务队列
│   │   ├── canvasStore.ts         # ★ 画布状态 (V7.2)
│   │   ├── canvasDragMaterialStore.ts # 画布拖拽素材状态
│   │   ├── canvasRunBusStore.ts       # 画布运行总线
│   │   ├── canvasLogsStore.ts         # 画布日志
│   │   ├── canvasGroupBusStore.ts     # 画布分组总线
│   │   └── canvasRhToolsStore.ts      # RH 工具集 Pinia store
│   │
│   ├── services/                  # 核心服务
│   │   ├── newApiClient.ts         # NewAPI 客户端 + Keychain 存储
│   │   ├── apiKeyCallback.ts       # 旧 key 回调兼容层；当前主线是账号 Session + 手动 Key
│   │   └── newApiAuth.ts           # 登录状态与未登录引导
│   │
│   ├── canvas/                     # ★ 画布迁入服务层（待与创作面板运行时合并）
│   │   ├── providers/
│   │   │   └── canvasModels.ts     # 模型注册表 (444 行)
│   │   ├── services/
│   │   │   └── canvasGeneration.ts # 生成服务 (775 行, 26 函数，仍含旧代理路径)
│   │   └── composables/            # 8 个画布 composables
│   │
│   ├── utils/                     # 工具函数
│   │   ├── idb.ts                 # ★ SQLite 统一存储 (~/.jiucaihezi/data/jiucaihezi.db)
│   │   ├── api.ts                 # API 配置解析（手动 Key 优先；无 Key 才使用账号 Session）
│   │   ├── httpClient.ts          # Tauri HTTP 插件桥 + openExternal
│   │   ├── imageBridge.ts         # ★ 图片桥接：非 vision 模型贴图 → vision 模型描述 → 文字注入
│   │   ├── providerConfig.ts      # Provider 配置 + supportsVision() 端点能力检测
│   │   ├── highlight.ts           # ★ 代码语法高亮（highlight.js，15语言，按需注册）
│   │   ├── timeFormat.ts          # 消息时间格式化（相对/绝对时间）
│   │   ├── mathRenderer.ts        # KaTeX 数学公式渲染
│   │   ├── mermaidRenderer.ts     # Mermaid 图表渲染（动态import）
│   │   ├── tts.ts                 # Web Speech API 朗读
│   │   ├── webSearch.ts           # ★ Jina API 联网搜索（jina-search模型）
│   │   ├── localMlxRuntime.ts     # 本地 MLX 模型运行时
│   │   ├── localContentTools.ts   # 本地资料/音视频工具
│   │   ├── browserTools.ts        # 可见 Chrome 浏览器控制
│   │   ├── devProjectTools.ts     # 源码项目读写和命令执行工具
│   │   ├── eventBus.ts            # 全局事件总线
│   │   ├── runtimeCapabilities.ts  # ★ 模型运行时能力检测 (DeepSeek V4 reasoning/thinking)
│   │   ├── todoTools.ts            # ★ LLM 可见的会话级 todo 工具
│   │   ├── brain.ts               # 对话 → 知识提炼 LLM 调用
│   │   ├── vaultFs.ts             # Tauri 文件系统同步
│   │   ├── vaultCompilerCore.ts   # 知识库纯函数（索引/lint/排名）
│   │   ├── migration.ts           # 数据迁移
│   │   ├── editorExport.ts        # ★ 编辑区统一导出服务（单一入口，DOCX/PDF/HTML/MD）
│   │   ├── localDocx.ts           # 旧版 DOCX 写出器（纯文本 → OOXML，保留兼容）
│   │   ├── localDocxV2.ts         # ★ Tiptap JSON → OOXML DOCX 渲染器（V7.x 新增）
│   │   ├── pptxExport.ts          # PPTX 导出骨架（Phase 3 试点）
│   │   └── ...                    # 其他辅助
│   │
│   ├── api/
│   │   └── media-generation.ts    # 多模型媒体生成 API
│   │
│   ├── data/
│   │   ├── creationModels.ts      # 创作面板 UI 分类/模型展示
│   │   ├── mediaModelCapabilities.ts # 创作面板媒体模型能力 + 运行时可用性覆盖
│   │   ├── vaultTemplates.ts      # 3 个知识库模板
│   │   ├── superpowerSkills.ts    # 额外预设Skill
│   │   └── modelContextWindows.ts # ★ 模型上下文窗口映射（30+模型）
│   │
│   ├── types/
│   │   └── skill.ts               # SkillConfig 等核心类型
│   │
│   └── styles/
│       ├── design-tokens.css      # 设计令牌（暖色调米纸 + 橄榄绿主色）
│       └── base.css               # 全局基础样式 + 字体加载
│
├── public/
│   └── skills/                    # 预设Skill SKILL.md 文件（静态资源）
│
├── package.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── .github/
│   └── workflows/
│       └── build.yml            # GitHub Actions 三平台自动打包
```

---

## 四、核心模块详解

### 4.1 useChat.ts — 对话引擎（最重要的文件）

**位置**: `src/composables/useChat.ts`（~1360 行）

#### 统一执行架构

```
用户输入 → sendMessage()
              └── runToolLoop() → SSE 流式对话 → 一手本地工具/云端工具闭环
```

#### Agent 阶段状态机

```
idle → sending → thinking → tool → replying → done
                    ↑         │         │        │
                    └─────────┘         │        │
                    (工具循环)           │        │
                                       error ←──┘
```

#### 云端 API 模式（runToolLoop）

1. `sendMessage()` 检测贴图 → 非 vision 模型触发图片桥接（`imageBridge.ts`）→ 文字描述注入
2. `buildApiMessages(systemPrompt, modelId)` — 组装消息，按模型能力决定图片格式
3. POST `{apiBase}/v1/chat/completions` with `stream: true`
4. `readSSEStream()` — 解析 SSE delta，累积文本和 tool_calls
5. 若有 tool_calls → `executeToolCall()` 执行 → 结果推回消息 → 循环（最多 10 轮）
6. 无 tool_calls → 完成。**不再调用 ingestAssistantOutput（已禁用）。**

#### 对话显示体验层（ChatGPT-like）

当前显示链路已拆出 `src/components/chat/display/**`，不要再把展示策略随意塞回 `useChat.ts`：

- `streamSmoother.ts` / `progressiveStreamReveal.ts`：控制可见文本的渐进揭示，降低上游 chunk 批量到达时的“整段蹦出”体感。
- `streamCommitScheduler.ts`：控制真实消息提交节奏，减少频繁写入导致的抖动。
- `autoScrollPolicy.ts` + `ChatScrollNav.vue`：滚动跟随策略。必须先记录内容增长前是否接近底部，再决定是否自动滚动；用户主动上滑时不能强行拉回。
- `messageDisplayModel.ts` / `toolDisplayModel.ts` / `markdownDisplayPolicy.ts`：消息、工具、Markdown 展示策略。
- `conversationExperienceTrace.ts`：记录显示体验诊断，不要打印临时 SSE/Rust 大量日志污染控制台。

未来系统化方向：

- 对话模块需要继续收敛成稳定架构：canonical message（真实内容）、visible message（渐进显示内容）、run state（运行状态）三者分离。
- 流式状态应绑定明确的 `runId/messageId`，避免跨消息误判“还在运行”。
- 工具卡片、普通文本、媒体任务、continuation 应共享同一套 message display model，不要各自维护显示规则。

#### 内置工具清单

| 工具名 | 功能 | 后端 |
|--------|------|------|
| `office_create` / `create_document` | 创建 Office 文档 | `api.jiucaihezi.studio/office/create` |
| `office_convert` / `convert_document` | 文档格式转换 | `/office/convert` |
| `office_execute` / `run_code` | 代码执行 | `/office/execute` |
| `document_to_markdown` | 本地资料转 Markdown | Tauri 本地转换链路 |
| `browser_search` / `browser_open` | 可见 Chrome 搜索/打开网页 | Tauri 本地浏览器控制 |
| `dev_*` | 源码项目读写/搜索/命令执行 | Tauri 本地执行层 |
| `graphify_build` | 构建知识图谱 | `/graphify/build` |
| `graphify_query` | 查询知识图谱 | `/graphify/query` |

#### 上下文管理（V7.x Conversation Context Engine）

- `ConversationContextEngine.build()`: 每轮先构建上下文工作集，再交给 RuntimeConnection 和 `buildApiMessages()`。
- `buildApiMessages(systemPrompt, modelId)`: 使用 Engine 返回的 authoritative recent messages 时，必须通过 `ensureCurrentUserMessageAtEnd()` 保证当前用户输入是最后一条 user message。
- **过滤管线（6 步）**：清除上下文 → 去错误对 → 去尾 asst → 去邻 user → 去空 → 以 user 开头
- **模型感知图片**：非 vision 模型 → 所有消息图片扁平化为 `[图片N]` 或桥接描述；vision 模型 → 正常 `image_url`
- `clearMessages()`: 注入清除标记，后续对话自动跳过之前的消息
- Runtime 配置变化：Skill / Knowledge / 关键工具变化由 Engine 创建新的 `runtimeSegment`；普通工具开关不应误清空“上面的内容”。
- 超长当前输入：Engine 走 oversized input evidence，生成三层 brief + mandatory/selected chunks，避免把完整长文在 recent raw context 中重复注入。
- Heavy 模式：memory hit 会根据 `sourceMessageIds` 回查原始 chunk；trace 记录 mandatory/selected/historical chunk 数量。
- 编辑、删除、重试、重新生成：必须调用 `ConversationContextEngine.invalidateMessages()`，失效相关 chunk、memory item、memory job，并标记 dirty segment。
- Assistant 输出后：必须调用 `ConversationContextEngine.afterAssistantMessage()`，保存 user/assistant chunks、run snapshot，并 enqueue 本地 memory job。
- Continuation：必须调用 `ConversationContextEngine.prepareContinuation()`，复用 contextPlanId，携带 output structure、completed sections、tail excerpt。
- 禁止把 Conversation Memory 写入正式 Knowledge Vault；禁止在 `useChat.ts` 直接接 Mem0 或绕过 Engine 访问 memory provider。
- 输入框实时 token 计数（`approximateTokenSize`）+ **Token 水位计** `≈2.4K / 200K ▓░░░ 1.2%`（替代旧 N/20 条）
- 模型菜单能力标签：👁（vision）/ 📝（text-only）

#### Unified Conversation Context Engine（本地版已接入，Mem0 待接）

权威文档：`docs/sdd/unified-conversation-context-engine-final-sdd.md`。

硬性原则：

- 所有对话上下文构建必须经过 `ConversationContextEngine.build()`。
- 所有 assistant 输出后的记忆更新必须经过 `ConversationContextEngine.afterAssistantMessage()`。
- 原始 `messages` / `conversation_message_chunks` / `runtime_segments` / `conversation_run_snapshots` 是唯一事实源。
- 对话记忆索引、Mem0 memory、摘要、向量和 FTS 都是派生索引，必须可重建、可降级、可对账。
- Mem0 只能作为 Engine 内部 driver，不是产品概念，不暴露到 UI，不与 Vault 并列。
- UI 保持不变：用户仍然只在第二列会话和聊天区输入、输出、查看历史。

极端长文目标：

- 支撑连续多轮 `1万字输入 + 1万字输出` 的长文会话，不靠无限塞 prompt。
- 超长输入走 `Oversized User Input Pipeline`：结构化 chunking、多层 brief、强制原始 chunk 回查。
- 长输出走 `Long Output Continuation Pipeline`：复用 `contextPlanId`、携带 output structure、tail excerpt、partIds。
- Heavy 模式必须有 Turn / Segment / Session Anchor 三层记忆分层与衰减。
- 不承诺“永远不丢记忆”，承诺可追溯召回、可降级继续、可重建索引。

#### 知识注入流程

```
sendMessage
  → recallKnowledge(userText, {vaultId, skillId})
    → rankVaultKnowledge() 关键词排名
    → 取 top 4 wiki 页 + 钉选知识 + CLAUDE.md
    → 拼接到 systemPrompt 末尾
  → (可选) jinaWebSearch(userText)
    → Jina API 快速搜索（用户开关控制）
    → 拼接搜索结果到 systemPrompt（标题+URL+摘要，禁止复述）
    → 搜索引用卡片显示来源
```

---

### 4.2 存储系统 — idb.ts (SQLite)

**单后端设计**：SQLite 数据库，内存缓存加速。

| 组件 | 说明 |
|------|------|
| 数据库文件 | `~/.jiucaihezi/data/jiucaihezi.db` |
| 内存缓存 | 启动时全量加载到 Map，读写即时同步 |
| 迁移 | 首次启动从旧 JSON 文件自动迁移，标记 `_migrations` 表 |

**4 个表**：
- `kv_store` — 键值对（设置、Skill配置等）
- `conversations` — 对话列表（索引: scopeKey, updatedAt）
- `messages` — 消息记录（索引: conversationId, updatedAt）
- `documents` — 文件/知识条目（索引: docKey, updatedAt）

**统一 API**：
```ts
getItem(key) / setItem(key, value) / removeItem(key)     // kv_store
getRecord(store, id) / setRecord(store, data)             // 结构化数据
getAll(store) / getAllByIndex(store, index, key)          // 查询
removeRecord(store, id)                                   // 删除
runStorageBatch(() => { ... })                            // 批量（SQLite 自动事务）
```

**浏览器降级**：`pnpm dev` 调试时自动使用 localStorage + 内存模拟，无需 SQLite。

---

### 4.3 Skill系统 — 官方 Skill

**核心定义**：Skill就是官方 Anthropic Skill，不是“兼容官方 Skill”，也不是韭菜盒子自定义 Agent 格式。标准目录形态：

```text
skill-name/
├── SKILL.md        # 必需：YAML frontmatter + Markdown instructions
├── references/     # 可选：按需加载的参考资料
├── scripts/        # 可选：可复用脚本
└── assets/         # 可选：素材、模板、示例文件
```

`SKILL.md` 是Skill的唯一核心。它负责定义角色身份、专业规则、工作方法、输出风格、示例，以及需要时如何使用 `references/`、`scripts/`、`assets/`。

**重要边界**：

- 不发明私有 Skill schema。
- 不把官方 Skill 改造成自定义 Agent。
- Knowledge 不写死进 Skill，通过 Connection 在运行时接入。
- Tool 是全局执行能力，默认关闭，用户显式开启后才暴露给 LLM。
- Superpower / 帮我配置只作为未来运行前配置助手，不参与本轮执行。

**内置Skill（官方 Skill 形态）**：

| 分类 | Skill | 来源 |
|------|------|------|
| 专业领域 | 律师工作台 | cat-xierluo/legal-skills 改编 |
| 内容创作 | 漫剧剧本生成器 | 用户 openclaw Agent 改编 |
| 创意设计 | algorithmic-art, brand-guidelines, canvas-design, frontend-design, slack-gif-creator, theme-factory, web-artifacts-builder | anthropics/skills |
| 开发技术 | claude-api, mcp-builder, skill-creator, webapp-testing | anthropics/skills |
| 企业沟通 | doc-coauthoring, internal-comms | anthropics/skills |
| 文档技能 | docx, pdf, pptx, xlsx | anthropics/skills（复用 docx/pdf/pptx/xlsx-office） |
| 配置助手 | 帮我配置 | 未来入口：只推荐 Skill / Knowledge / Tool / Model，用户确认后才执行 |

**Skill锁定**：内置Skill（`source !== 'user'`）SKILL.md 内容锁定，用户双击选择使用、不可编辑；用户自建Skill双击打开编辑对话框。右键菜单根据 `isBuiltinSkill()` 区分选项。

**Skill优化**：多源优化建议（`useSkillEvolution.ts`），对话历史（始终可用）+ 知识库 + 编辑器 + 用户口述 + 拖入文件，LLM 分析后生成 diff，用户 keep/revert。内置Skill禁止直接修改。产品文案应优先表达为“生成修改建议”，避免暗示 AI 自动改写规则。

**当前 SkillConfig 存储格式**（代码兼容层，不等于产品标准）：

```ts
interface SkillConfig {
  id, name, description, triggers
  skillContent: string      // SKILL.md 内容或 skill:// 路径
  references, examples, version
  source: 'preset' | 'user' | 'github' | 'evolved' | 'superpower'
  tier?: 'L1' | 'L2'        // 旧兼容字段，新设计不应围绕 L2 Agent 扩展
  contextCount?: number      // 上下文保留条数（默认 20）
  agentConfig?: {            // 旧兼容字段，新设计优先由 Connection 承担组合关系
    skills: { skillId, role, phase }[]
    hardGate: boolean
    autoTrigger: boolean
  }
}
```

**Connection 与Skill关系**：

- Skill 保持官方原样；Connection 不修改 Skill 格式。
- Knowledge 通过 Connection 接入当前任务，可为主知识库或辅助知识库。
- Tool 通过 Connection 暴露给 LLM，但必须来自用户显式开启/选择。
- Superpower / 帮我配置输出建议，不作为 RuntimeConnection 的执行来源。
- Plain 模式允许用户不选 Skill，直接使用 LLM / Knowledge / Tool。

---

### 4.4 知识库系统 — vaultStore.ts + useBrain.ts

**核心原则**：知识库**只接受用户手动添加**，AI 不得自动写入。防止 LLM 幻觉污染知识库。

**当前已落地的五层运行架构**：

```
Vault/
├── CLAUDE.md                 # Vault 配置：主题、编译规则、领域语义
├── raw/
│   ├── 原始文件/             # 用户上传原文件，metadata.kind = original-file
│   └── 转换后的MD/           # ToMD 后的唯一编译输入，metadata.kind = converted-markdown
├── wiki/                     # 有正文、有来源、有 sourceChunks 的结构化 Wiki
│   ├── 人物/ 关系/ 事件线/   # 小说 schema
│   ├── 案由/ 案件/ 文书模板/ # 律师 schema
│   └── ...                   # 用户自定义或通用 schema
└── _reports/
    ├── 导入报告/
    ├── 整理记录/
    ├── 冲突报告/
    └── 健康检查/
```

内部处理拆成五层：

```text
raw source layer
  用户手动上传资料 → 原文件保留 → ToMD 转 Markdown → raw/转换后的MD

corpus index layer
  buildVaultChunks() → chunkId / chunkHash / sourcePath / anchor / headingPath / metadata

wiki knowledge layer
  buildVaultWikiPlan() / compileRawToWiki() → 生成或合并 wiki 页面
  Wiki 动作必须带 rawId + chunkHash + sources + sourceChunkIds

retrieval planning layer
  buildVaultEvidencePlan() → 识别本轮意图 → 选 Wiki → 顺着 sourceChunks 回查 raw chunk

runtime evidence layer
  recallKnowledgeWithTrace() → Knowledge Evidence Pack → user-side evidence/context → LLM
```

**用户手动添加知识的 3 条路径**：

| 入口 | 流程 | 说明 |
|------|------|------|
| FileTree 知识库 Tab | 打开 vault → 上传/拖拽 → `convertDocumentToMarkdown()` → `buildVaultIngestionPlan()` → raw → `compileRawToWiki()` | 方法一 |
| VaultWizard「添加现有知识库内容」 | 选择知识库 → 上传文件 → 同一条 ToMD + ingestion + organize 主链路 | 方法二 |
| VaultWizard「有资料创建」 | 新建知识库 → 写入骨架 → 上传资料 → raw chunk → 真实 wiki 页面 → 首次创建报告 | 新建 vault |

**知识召回**（只读不写）：

```
用户提问
→ useChat.sendMessage()
→ recallKnowledgeWithTrace()
→ buildRuntimeContextPackResult() / buildVaultRetrievalPlan()
→ buildVaultEvidencePlan()
→ 选中 Wiki 页面 + 相关 raw chunk + CLAUDE.md + pinned knowledge
→ buildRecallKnowledgeHits()
→ 注入 systemPrompt 的 Knowledge Evidence 段，同时回写 UI knowledgeHits
→ LLM 回复
```

> ⚠️ **已禁用**：`writebackAssistantOutput()` / `ingestAssistantOutput()` 不再自动调用。`distillHistoryToWiki` 仅由用户右键「提炼」手动触发。

**与主框架的连接点**：

| 主框架层 | 知识库连接 | 文件 |
|---------|------------|------|
| UI 输入 | 用户显式选择 Knowledge，不自动启用 | `src/components/chat/VaultPickerBar.vue` |
| 创建/添加资料 | 统一 ToMD + ingestion + organize | `src/components/vault/VaultWizard.vue`, `src/components/filetree/FileTreePanel.vue` |
| Vault 状态 | 维护 activeVault、Vault 元数据和统计 | `src/stores/vaultStore.ts` |
| 文件存储 | raw/wiki/_reports 都写入 documents store | `src/composables/useFileStore.ts`, `src/utils/idb.ts` |
| 编译整理 | 只整理 converted Markdown raw；LLM 动作必须可追溯 chunk | `src/composables/useVaultCompiler.ts`, `src/utils/vaultOrganizeActions.ts` |
| chunk/index | 生成 source chunk 与领域 metadata | `src/utils/vaultChunking.ts` |
| 领域 schema | 小说、律师、通用目录语义 | `src/utils/vaultDomainSchema.ts`, `src/utils/vaultWikiPlanner.ts` |
| 召回计划 | 意图识别、Wiki 选择、sourceChunks 回查 raw | `src/utils/vaultEvidencePlanner.ts`, `src/utils/vaultRuntime.ts`, `src/utils/vaultRetrieval.ts` |
| 对话运行时 | `useChat.ts` 只读召回并注入 user-side evidence，不写 Vault | `src/composables/useChat.ts`, `src/composables/useBrain.ts` |
| Connection | Knowledge 作为用户显式选择的 evidence connection | `src/runtime/connection/knowledgeConnection.ts`, `src/runtime/connection/knowledgeConnectionAdapter.ts` |
| Trace/UI | Evidence Planner 选中的 wiki/raw chunk 进入 `knowledgeHits`，用户可见来源 | `src/utils/vaultRecallTrace.ts`, `src/components/chat/MessageReferences.vue` |
| 健康检查 | 检查 raw chunk、Wiki sourceChunks、覆盖率、孤立页、冲突 | `src/utils/vaultHealth.ts` |

**P0/P1 当前状态（2026-06-04）**：

- P0：编译目标只允许 `metadata.kind === 'converted-markdown'` 的 raw，原文件和 meta 不会被误整理。
- P0：LLM 生成的 Wiki create/update 动作缺少 `rawId / chunkHash / sources / sourceChunkIds` 时会被丢弃或回退本地可追溯动作。
- P0：raw 只有在 `sourceChunkHashes` 全部被 Wiki 动作覆盖后才标记 `indexed: true`。
- P0：结构化 Evidence Planner 选中的 Wiki 和 raw chunk 会同步进入 UI `knowledgeHits`。
- P1：整理 prompt 增加 chunk catalog，LLM 能看到可用 `rawId / chunkId / chunkHash / source`。
- P1：Evidence Planner 会顺着 Wiki `sourceChunks` 回查 raw 原文片段，预算紧时仍保留来源片段区。
- P1：健康检查新增 `rawChunkCoveragePercent` 和 `wikiSourceTraceCoveragePercent`，报告可量化验收质量。

#### 知识库最终形态硬性要求（2026-06-03 新增）

> 详细执行方案见：`docs/sdd/knowledge-vault-final-runtime-sdd.md`。后续知识库相关开发必须以该 SDD 为准。

知识库不是“文件夹 + 简单关键词搜索”，最终必须稳定达到以下效果：

1. **创建知识库时，资料必须真实变成 Wiki。**
   - 用户上传资料创建知识库后，原文件必须保留在 `raw/原始文件/`。
   - 可读 Markdown 必须写入 `raw/转换后的MD/`。
   - 系统必须基于资料内容生成有确切正文的 `wiki/` 页面，而不是空目录、占位页或泛泛摘要。
   - Wiki 页面必须可被人阅读、继续编辑，并能作为 LLM 检索证据。

2. **添加或修改资料时，必须增量整理。**
   - 新资料进入知识库后，必须先落 `raw/`，再拆解/合并进 `wiki/`。
   - 不允许只保存 raw 而不产生可检索 Wiki。
   - 不允许破坏性覆盖已有 Wiki；冲突、重复、待确认内容必须写入 `_reports/`。

3. **Wiki 必须有领域结构。**
   - 小说知识库必须能沉淀人物、关系、事件线、章节索引、场景、道具、世界观、写作状态等结构。
   - 律师知识库必须能沉淀案由、案件、事实、证据、诉状模板、处理策略、结果复盘等结构。
   - 其他领域也必须按资料语义生成结构，而不是机械按文件名或章节堆文件。

4. **召回必须顺着 Wiki 结构取证。**
   - 用户在对话中选择知识库后，本轮请求必须判断“当前用户真正需要哪些知识”。
   - 召回不能只靠关键词命中；必须结合 Wiki 结构、实体、关系、事件、模板、来源锚点和 raw 兜底。
   - 例如小说场景中，用户要求继续写男女主爱情线时，必须优先召回男女主性格、二人关系状态、关键共同事件、最近章节状态；必要时回查 raw 中的具体章节原文。
   - 例如律师场景中，用户询问相似案件时，必须能找出相同案由/事实结构的历史案件、处理结果、文书模板和策略依据。

5. **知识证据必须可追溯。**
   - Wiki 页面必须保留来源路径、章节/段落/案例锚点或 raw chunk 引用。
   - LLM 回答使用知识库事实时，应尽量带出来源线索，方便用户确认。
   - raw 是事实源，wiki 是结构化检索层；wiki 不能无来源地幻觉扩写成事实。

6. **知识库仍然只接受用户主动添加和整理。**
   - 对话输出不得自动写入正式 Wiki。
   - AI 可以生成整理建议、候选页、冲突报告，但正式进入 Wiki 必须来自用户上传、用户点击整理、用户确认或明确的手动操作。

---

### 4.5 本地工具运行层

桌面版不依赖外部本地 Agent 服务。工具调用统一从 `useChat.ts` 的 tool loop 进入，再分发到一手实现：

| 工具域 | 文件 | 说明 |
|--------|------|------|
| 格式转换/附件读取/音视频 | `localContentTools.ts` | 本地资料转 Markdown、媒体元信息和 ffmpeg/Whisper 类任务 |
| 可见浏览器 | `browserTools.ts` | 调用本地 Chrome 完成搜索、打开、读取、截图、点击和输入 |
| 源码项目 | `devProjectTools.ts` | 在用户选择的项目根目录内读写文件、搜索、查看 diff、执行允许列表命令 |
| 本地模型 | `localMlxRuntime.ts` | 管理 MLX 服务启动、健康检查和本地模型 API 地址 |

用户侧只看见“工具仓库”和“本地模型”，不暴露额外网关、端口或第三方运行时概念。

---

### 4.6 创作面板 & 画布节点系统 — V7.x 当前状态

**创作面板**：当前是媒体生成的主链路和基准实现。`CreationPanel.vue` + `useCreation.ts` + `mediaTaskStore.ts` + `media-generation.ts` 统一走 NewAPI 主 Token；进入面板时读取 `/api/creation/models`，提交任务前再由 `assertMediaModelExecutable()` 拦截不可用模型。失败任务会记录 `completedAt` 并回写画廊，避免“转圈消失”。

**RH 官方同步当前状态（2026-06-04）**：创作面板 RH 主链路已经切到官方同步方案。标准 RH 模型只来自官方 `capabilities.json`；AI App 只走官方 `apiCallDemo` 真实 `nodeInfoList`，或对用户提供的官方文档显式提交文档中的 `nodeInfoList`。当前本地注册 19 个 RH 模型。旧 `rh-kling-v30-pro`、`rh-veo-31-fast`、`rh-veo-31-pro`、旧 `rh-seedance2` 均不得作为当前入口。线上 NewAPI RH 渠道必须保持 `group=1` 收费分组；测试时换 group=1 token，不改渠道 group。

**后端主链路**：

```
CreationPanel
  → mediaTaskStore.submitTask()
  → media-generation.ts
  → https://api.jiucaihezi.studio/v1/images|videos|audio
  → NewAPI Channel
  → 普通上游 / rh-adapter(:8789) / Suno

模型可用性：
  CreationPanel/useCreation
  → /api/creation/models
  → creation-models(:8790)
  → NewAPI channels 表
```

**画布节点系统**：对标 T8-penguin-canvas，41 个节点组件已迁入，UI/节点库/执行器骨架完整。画布模型注册表已移除旧 `rh-seedance2`，并注册官方 Seedance 2.0 三入口；但画布媒体运行时仍使用 `src/canvas/services/canvasGeneration.ts`，里面保留 `/api/proxy/*`、`/api/runninghub/*`、Seedance 直连等 T8 旧路径。下一阶段应以创作面板为准，把画布媒体节点同步到 `media-generation.ts` + `mediaModelCapabilities.ts` + `/api/creation/models`。

#### 画布架构

```
CanvasWorkspace.vue (VueFlow 容器)
  ├── nodeTypes 注册 (41 个节点)
  ├── edgeTypes (promptOrder / imageRole / mediaRole)
  ├── canvasStore (状态管理、持久化、撤销/重做)
  ├── canvasExecutor.ts (拓扑排序执行引擎)
  │   ├── canvasLlmRuntime.ts (LLM 节点)
  │   ├── canvasMediaRuntime.ts (当前桥接 canvasGeneration.ts，待同步创作面板)
  │   └── canvasToolRuntime.ts (本地工具)
  └── canvasNodeFactory.ts (节点创建/默认数据/边解析)
```

#### 41 个节点清单

| 分类 | 节点类型 | 文件 | 说明 |
|------|---------|------|------|
| **核心生成 (6)** | `text` | CanvasTextNode.vue | 提示词输入 |
| | `llm` | CanvasLlmNode.vue | Claude/GPT/Gemini 文本生成 |
| | `imageGen` | CanvasImageGenNode.vue | GPT Image + Nano Banana，模型/比例/尺寸选择 |
| | `videoGen` | CanvasVideoGenNode.vue | Veo/Grok Video，比例/分辨率/时长 |
| | `audioGen` | CanvasAudioGenNode.vue | Suno/RH声音，标题/标签/MV |
| | `seedance` | CanvasSeedanceNode.vue | Seedance 2.0（旧直连路径，待同步创作面板） |
| **RH 系列 (4)** | `runninghub` | CanvasRunningHubNode.vue | webappId搜索 + nodeInfoList表单 + 提交/轮询 |
| | `runninghubWallet` | CanvasRunningHubWalletNode.vue | RH钱包应用 |
| | `rhTools` | CanvasRhToolsNode.vue | RH超市启动器 |
| | `rhConfig` | CanvasRhConfigNode.vue | RH配置注入（隐藏） |
| **素材 (3)** | `upload` | CanvasUploadNode.vue | 三合一上传（图/视/音），MIME自动识别，预览 |
| | `output` | CanvasOutputNode.vue | 上游收集、文本编辑、媒体预览、下载 |
| | `materialSet` | CanvasMaterialSetNode.vue | 素材集合（占位） |
| **流程控制 (4)** | `loop` | CanvasLoopNode.vue | 串联/并联循环器 |
| | `pickFromSet` | CanvasPickFromSetNode.vue | 按索引从合集取单个素材 |
| | `textSplit` | CanvasTextSplitNode.vue | 文本分段（按行/段落/分镜/正则/字数） |
| | `framePair` | CanvasFramePairNode.vue | 视频抽首尾帧，双Handle输出 |
| **图像处理 (7)** | `resize` | CanvasResizeNode.vue | 尺寸调整 |
| | `combine` | CanvasCombineNode.vue | 图像合并（水平/垂直/宫格） |
| | `removeBg` | CanvasRemoveBgNode.vue | 抠图（隐藏） |
| | `upscale` | CanvasUpscaleNode.vue | 放大（隐藏） |
| | `gridCrop` | CanvasGridCropNode.vue | 宫格剪裁 |
| | `imageCompare` | CanvasImageCompareNode.vue | 双图对比（滑杆/并排/叠加/差异） |
| | `drawingBoard` | CanvasDrawingBoardNode.vue | 手绘画板（隐藏） |
| **工具箱 (3)** | `cinematic` | CanvasCinematicNode.vue | 电影感组合器（风格/镜头/光影） |
| | `videoMotion` | CanvasVideoMotionNode.vue | 视频运镜组合器（场景/动作/路径） |
| | `multiAngleVisual` | CanvasMultiAngleVisualNode.vue | 可视化多角度（方位/俯仰/距离） |
| **辅助 (5)** | `idea` | CanvasIdeaNode.vue | 灵感记录 |
| | `bp` | CanvasBpNode.vue | 蓝图 |
| | `relay` | CanvasRelayNode.vue | 中继透传 |
| | `edit` | CanvasEditNode.vue | 图像编辑（隐藏） |
| | `videoOutput` | CanvasVideoOutputNode.vue | 视频输出预览（隐藏） |
| **结果 (3)** | `imageResult` | CanvasImageResultNode.vue | 图片结果展示 |
| | `videoResult` | CanvasVideoResultNode.vue | 视频结果展示 |
| | `audioResult` | CanvasAudioResultNode.vue | 音频结果展示 |
| **其他 (3)** | `file` | CanvasFileNode.vue | 文件引用 |
| | `tool` | CanvasToolNode.vue | 本地工具（ToMD、浏览器读取） |
| | `group` | CanvasGroupNode.vue | 分组容器 |

#### 节点执行流程

```
用户点击节点 ▶ 按钮 → jc-canvas-run-node 事件
  → canvasExecutor.runCanvasNode(nodeId)
    → 拓扑排序 → 检查上游依赖
    → 分发到对应 runtime:
        llm → canvasLlmRuntime
        imageGen/videoGen/audioGen/seedance → canvasMediaRuntime
        runninghub/runninghubWallet/rhTools → canvasMediaRuntime (当前仍经 canvasGeneration.ts 桥接)
        tool → canvasToolRuntime
        loop/pickFromSet/textSplit/framePair → 占位实现
    → 更新节点 status (idle→running→success/error)
    → emitEvent('refresh-file-list')
```

#### 执行器可执行类型

```ts
// canvasExecutor.ts EXECUTABLE_TYPES
'llm', 'imageGen', 'videoGen', 'audioGen', 'tool',
'runninghub', 'runninghubWallet', 'seedance', 'rhTools',
'loop', 'pickFromSet', 'textSplit', 'framePair',
'resize', 'combine', 'removeBg', 'upscale', 'gridCrop',
'frameExtractor', 'cinematic', 'videoMotion', 'multiAngleVisual',
'edit', 'browserNode'
```

#### 关键文件

| 文件 | 作用 |
|------|------|
| `src/types/canvas.ts` | 41 个节点类型定义 + 数据接口 |
| `src/stores/canvasStore.ts` | 画布状态（节点/边/视口/历史/执行日志） |
| `src/components/canvas/utils/canvasNodeFactory.ts` | 节点创建/默认数据/边解析 |
| `src/components/canvas/runtime/canvasExecutor.ts` | 执行引擎（拓扑排序/分发） |
| `src/components/canvas/runtime/canvasMediaRuntime.ts` | 媒体生成 runtime；当前调用 canvasGeneration.ts，下一步应对齐 media-generation.ts |
| `src/canvas/services/canvasGeneration.ts` | T8 迁入的旧服务层，仍有旧代理路径；改画布媒体能力时必须优先审计 |
| `src/components/canvas/CanvasWorkspace.vue` | 画布主组件（VueFlow 容器） |
| `src/components/canvas/CanvasNodeLibrary.vue` | 节点库侧边栏 |

---

### 4.7 媒体 API 调用路由

创作面板媒体 API 通过 `https://api.jiucaihezi.studio`（NewAPI）统一鉴权，客户端只使用主 NewAPI Token。画布媒体节点是下一阶段同步对象，不能继续新增旧代理路径。

| 功能 | 端点 |
|------|------|
| 对话 | `/v1/chat/completions` (stream=true) |
| 模型列表 | `/v1/models` |
| 创作模型可用性 | `/api/creation/models` |
| 图片生成（文生图） | `/v1/images/generations` |
| 图片编辑（图生图） | `/v1/images/edits` (multipart) |
| 视频生成 | `/v1/videos` → 轮询 `/v1/videos/:id` |
| RH 图片/视频/音频 | NewAPI Channel → `rh-adapter(:8789)`，客户端仍只请求 `/v1/*` |
| 素材上传 | `/api/creations/uploads`（画布旧链路仍可能使用，创作面板主链路不依赖） |
| RunningHub 工作流 | 旧 `/api/creations/tasks` 已废弃；不要新增调用 |
| Suno 音频 | `/suno/submit/music` → `/suno/fetch/:id` |
| 搜索 | 后端 Nginx 代理 Jina API |
| Office | `/office/create`, `/office/convert`, `/office/execute` |
| 知识图谱 | `/graphify/build`, `/graphify/query` |

---

### 4.9 搜索系统（V7.1）

**双通道互斥设计**：

| 通道 | 触发方式 | 说明 |
|------|---------|------|
| Jina API 搜索 | 用户点击「搜索」按钮变蓝 | 每条消息自动调 `jina-search` 模型，结果注入 system prompt。隐藏浏览器工具 |
| 浏览器操控 | 搜索按钮关闭时 | AI 通过 `browser_search` 工具调用控制 Chrome。API 搜索不可用 |

**关键文件**：
- `src/utils/webSearch.ts` — Jina API 调用、文本解析、markdown 生成
- `src/composables/useChat.ts` — `buildAvailableTools()` 中互斥排除浏览器工具
- `src/components/chat/ChatPanel.vue` — 搜索开关 UI + 状态提示

---

### 4.10 Token 水位计（V7.1）

**模型感知的上下文用量显示**：
- `src/data/modelContextWindows.ts` — 30+ 模型上下文窗口映射 + 模型族推断
- `ModelEntry.contextWindow` 字段由 `agentStore.fetchModels()` 自动填充
- 截断策略：按 token 预算（102K）从最新消息往回累积，替代旧的按条数截断
- UI：`≈2.4K / 200K ▓░░░░ 1.2%`，含进度条 + 三色预警（绿/橙/红）

---

## 五、UI 布局

### 桌面端 5 列布局

```
┌──────┬──────────┬──────────────┬──────────────────┐
│ Rail │ FileTree │  ChatPanel   │   右侧面板        │
│ 52px │ 280px    │   450px      │   flex: 1         │
│      │ 可隐藏   │  ★不可隐藏★  │   可隐藏          │
│      │          │              │                    │
│ 图标 │ Skill树   │ 对话消息      │ 创建Skill           │
│ 导航 │ 知识库树 │ 输入框        │ Skill仓库           │
│      │ 历史树   │ Skill选择      │ 知识库仓库         │
│      │          │ 知识库选择    │ 编辑区             │
│      │          │              │ 创作面板           │
│      │          │              │ 设置              │
└──────┴──────────┴──────────────┴──────────────────┘
        ↕ 拖拽     ↕ 拖拽                  ↕ 拖拽
```

### 移动端

```
┌──────┬──────────────────────────┐
│迷你  │     全屏单面板            │
│Rail  │  chat / creation / agents│
│44px  │  brain / editor / settings│
└──────┴──────────────────────────┘
```

---

## 六、设计令牌

主题系统在 `src/styles/design-tokens.css`。

**核心色系**：暖色调米纸 + 橄榄绿

```css
--jc-surface: #EEE1CE;    /* 米纸底色 */
--jc-primary: #D5C787;    /* 橄榄金主色 */
--olive: #6B8E23;          /* 橄榄绿强调 */
--olive-dark: #556B2F;     /* 橄榄深绿 */
```

**快捷别名**：`--bg`, `--paper`, `--surface`, `--ink`, `--ink2`, `--ink3`, `--line`, `--border`

**账户区语义令牌**（4 个主题各有适配值）：

| 令牌 | 用途 | light | dark | green | white |
|------|------|-------|------|-------|-------|
| `--jc-account-card-bg` | 账户卡片底色 | `rgba(255,255,255,0.58)` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.45)` | `rgba(255,255,255,0.70)` |
| `--jc-member-glow` | 会员金色高亮 | `#dccb70` | `#c9a834` | `#b8a040` | `#dccb70` |
| `--jc-member-glow-text` | 会员金色文字 | `#745711` | `#f0d878` | `#5c4030` | `#745711` |

**4 个主题**：白色(white)、浅色(light)、黑夜(dark)、护眼(green)

**字体**：Material Symbols Outlined（图标）、Inter（正文）、Noto Serif SC（中文衬线）

**图标用法**：`<span class="mso">icon_name</span>`

---

## 七、启动流程

```
main.ts
  1. 加载 CSS（design-tokens.css + base.css）
  2. 从 localStorage 恢复主题（无闪烁）
  3. 设置 API 默认值（jcApiBase, jcModel）
  4. Tauri 环境标记 [data-platform="desktop"]
  5. boot()
     └─ patchFetch()  // 全局 fetch monkey-patch
  6. initDB()         // 初始化存储后端
  7. createApp → mount('#app')
```

```
App.vue onMounted
  → runAutoMigrations()  // 数据格式迁移
```

---

## 八、构建与运行

```bash
# 安装依赖
pnpm install

# 开发模式（Tauri 桌面）
pnpm tauri dev

# 仅前端开发（浏览器）
pnpm dev

# 构建
pnpm run build          # 仅前端：测试 + 类型检查 + Vite 构建，产物在 dist/
pnpm run tauri:build    # 完整桌面应用：测试 + tauri build + macOS app 修复
pnpm run tauri:dmg:official # 生成正式 macOS DMG latest 包，依赖上一步已产出的 .app

# 类型检查
npx vue-tsc -b
```

### 上线发布产物

- Web 端上传目录：`dist/`。Cloudflare Pages 部署命令：`npx wrangler pages deploy dist --project-name jiucaihezi --commit-dirty=true`。手动上传到静态站点时，上传 `dist/` 里的内容，让 `index.html` 位于站点根目录。
- macOS 本地完整打包：先执行 `pnpm run tauri:build`，如需官网可下载的正式 DMG，再执行 `pnpm run tauri:dmg:official`。
- Apple Silicon 正式 DMG 默认路径：`src-tauri/target/release/bundle/dmg/韭菜盒子_0.1.0_aarch64_latest.dmg`。
- 普通 Tauri 产物仍会出现在 `src-tauri/target/release/bundle/` 下；`dist-desktop/` 只作为手动归档目录，不是 Web 端上传目录。

**注意**：`tsconfig.app.json` 需要 `"ignoreDeprecations": "6.0"` 以兼容 TypeScript 7.x 对 `baseUrl` 的弃用警告。

---

**Windows**:
```bash
# 本地交叉编译需 LLVM (brew install llvm) + cargo-xwin，复杂且不稳定
# 推荐使用 GitHub Actions:
git tag v0.1.0 && git push --tags
# 自动触发 .github/workflows/build.yml 三平台打包
```

## 九、已知问题与陷阱

### 9.1 ✅ 已修复：API 请求 "Load failed" + SSE 流式传输

**原始问题**：`@tauri-apps/plugin-http` 的 JS 端 `fetch()` 在 macOS WKWebView 中触发 "Load failed"。

**修复方案**：完全绕过 `@tauri-apps/plugin-http`，采用自定义 Rust Command：

| 通道 | Rust Command | 用途 |
|------|-------------|------|
| 非流式 | `http_request` | API Key 验证、模型列表、路由 LLM、媒体生成 |
| 流式（SSE） | `http_request_stream` | `/v1/chat/completions` (stream=true) |

**架构**：
```
patchFetch() 全局劫持 window.fetch
  ├─ 检测 body 含 stream:true → rustFetchStream()
  │     → invoke('http_request_stream', { request, onChunk: Channel })
  │     → Rust reqwest bytes_stream() → 逐块推送 → JS ReadableStream
  │     → useChat.ts SSE 解析器正常工作（真正的实时流式输出）
  │
  ├─ 其他外部 HTTP/HTTPS → rustFetch()
  │     → invoke('http_request', { request })
  │     → Rust reqwest → 一次性返回
  │
  └─ 内部请求 → 原生 fetch
```

**关键文件**：
- `src/utils/httpClient.ts` — JS 侧桥接（safeFetch, patchFetch, rustFetchStream）
- `src-tauri/src/lib.rs` — Rust 侧 `http_request` + `http_request_stream` commands
- `src-tauri/Cargo.toml` — reqwest 需要 `stream` feature，依赖 `futures` crate

### 9.2 外部链接

Tauri WebView 中 `window.open()` 无效。已改用 `openExternal()` 调用 Tauri Shell 插件（`@tauri-apps/plugin-shell` → `open(url)`）在系统浏览器打开。如果仍有链接打不开，检查是否遗漏了 `window.open` 调用。

### 9.3 本地工具运行层

本地工具由 Tauri/Rust 和前端一手模块提供，不需要安装额外本地 Agent 服务。新增工具时应优先接入现有 `localContentTools.ts`、`browserTools.ts`、`devProjectTools.ts` 或 Rust command，避免增加用户可见配置。

### 9.4 TypeScript 严格性

项目关闭了 `noUnusedLocals` 和 `noUnusedParameters`。部分文件有隐式 `any`。这是故意的——快速迭代优先于类型完美。

---

## 十、关键 localStorage 键

| 键 | 用途 | 默认值 |
|----|------|--------|
| `jcApiKey` | API 密钥 | 空 |
| `jcApiBase` | API 基址 | `https://api.jiucaihezi.studio` |
| `jcModel` | 当前模型 | `claude-sonnet-4-6` |
| `jcTheme` | 主题 | `light` |
| `jc_bigfont` | 大字模式 | `false` |
| `jc_skills_v2` | 用户Skill配置 | `[]` |
| `jc_my_skills` | 我的Skill ID 列表 | `[]` |
| `jc_skill_sort` | Skill排序方式 | `callCount` |
| `jcWebSearchEnabled` | 搜索开关 | `false` |

---

## 十一、协作三方关系

```
┌──────────┐    systemPrompt     ┌──────────┐
│  Skill     │ ──────────────────→ │          │
│ (谁来做)  │                     │   LLM    │
└──────────┘                     │  API 调用 │
                                 │          │
┌──────────┐    知识注入          │          │
│  知识库   │ ──────────────────→ │          │
│ (参考什么) │                     └────┬─────┘
└──────────┘                          │
                                      │ 工具调用
┌──────────┐                          │
│ 工具仓库  │ ←────────────────────────┘
│ (动手做)  │   文档 / 浏览器 / 项目 / 媒体
└──────────┘
```

**一句话总结**：Skill决定 AI 是谁，知识库提供参考资料，工具仓库提供本地手脚。

---

## 十二、给接手 AI 的快速行动指南

### 改 bug 的标准流程

1. 读本文档定位相关模块
2. `pnpm dev` 在浏览器调试前端逻辑（不需要 Tauri）
3. `pnpm tauri dev` 调试桌面端特有功能（HTTP 插件、文件系统、Shell）
4. 改完后 `npx vue-tsc -b` 确认类型检查通过
5. `pnpm build` 确认前端构建成功

### 加功能的注意事项

- 对话相关 → 改 `useChat.ts`，注意双模式分支
- 对话上下文长期记忆 → 先读 `docs/sdd/unified-conversation-context-engine-final-sdd.md`，只能按 `ConversationContextEngine` 唯一路径实施；Mem0 未接入前以本地 fallback index 验证稳定性
- Skill相关 → 改 `agentStore.ts`，注意 localStorage 迁移兼容
- 知识库相关 → 改 `vaultStore.ts` + `useBrain.ts`
- 媒体生成 → 改 `api/media-generation.ts` + `mediaTaskStore.ts`
- UI 组件 → 用 `var(--olive)` 等设计令牌，图标用 `<span class="mso">icon_name</span>`
- 外部链接 → 用 `openExternal(url)` 而非 `window.open`
- HTTP 请求 → 走 `safeFetch` / Rust `http_request` / `http_request_stream` 桥接，避免绕回 WebView 原生 fetch
- 新的 Tauri 插件 → 同时改 `Cargo.toml`（Rust 依赖）、`lib.rs`（注册）、`capabilities/default.json`（权限）

### 最紧急的任务

**先进行 App 真实使用验证，再接 Mem0 driver。** 本地 `ConversationContextEngine` 已经接入，下一步重点验证三条上线主线：

1. Skill：Skill缔造、素材转Skill、修改现有 Skill、保存资料包、评审页打开、工具调用速度和错误提示。
2. 知识库：创建/上传/整理/wiki 生成/召回/清除上下文后继续依靠绑定知识库工作。
3. 创作面板：图片/视频/音频模型可用性、提交任务、轮询、失败回写画廊、结果打开/保存。

同时继续观察 Skill 选择/取消、Knowledge 选择/取消、Tool 开关、Word 导出、超长输入、继续生成、编辑/删除/重试后的上下文污染。连续稳定后再按 SDD 接入 Mem0，且 Mem0 只能作为 Engine 内部 driver。
