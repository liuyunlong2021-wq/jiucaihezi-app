# 对话记忆后端选型对比 — SDD

> 日期: 2026-05-31
> 状态: 设计评估完成，待决策
> 主题: 当前方案 vs 对话小知识库 vs Mem0 后端

---

## 一、结论先行

对话记忆**不应该和现在的正式 Knowledge Vault 混为一谈**。这个判断是正确的。

正式知识库是用户手动选择、手动沉淀、可跨会话复用的 Wiki。
对话记忆是当前会话自动产生、自动召回、只服务对话连续性的 Memory Backend。

最终建议：

```text
第一阶段：自研 Conversation Memory Backend
  用本地 SQLite / FTS / 可选 embedding
  独立于正式 Knowledge Vault
  结构参考 Mem0 + LLM Wiki

第二阶段：把 Mem0 做成可选 Provider
  不作为默认后端
  可用于高级用户 / 云同步 / 团队版
```

不建议直接把 Mem0 作为默认唯一后端，原因是：

- 韭菜盒子 Studio 是本地优先桌面应用。
- 对话记忆需要和现有 session、Skill、Knowledge、Tool 配置强绑定。
- Mem0 很适合做通用 AI memory layer，但默认抽象偏“agent/user/session memory”，不天然理解我们的 Skill + Knowledge + Tool 运行边界。
- Cloud/MCP 模式会让“谁决定保存/搜索记忆”变得像 Agent 行为，容易偏离纯手动工作台。
- Self-hosted/SDK 模式可接，但运行时依赖、模型/embedding 配置、数据迁移和桌面打包复杂度较高。

最优解不是三选一，而是：

```text
内置自研后端 = 默认
Mem0 Adapter = 可选后端
统一 ConversationMemoryProvider 接口
```

---

## 二、Mem0 能不能接入

可以接入，但不能直接当成前端组件用，应该作为**对话记忆后端 Provider**接入。

资料依据：

- Mem0 官方仓库：`https://github.com/mem0ai/mem0`
- Mem0 文档索引：`https://docs.mem0.ai/llms.txt`

### 2.1 Mem0 当前能力

Mem0 是一个通用 AI Agent Memory Layer，核心能力包括：

- `add`: 从对话或文本中抽取可存储记忆。
- `search`: 按 user/session/agent 等 scope 搜索相关记忆。
- `get/update/delete`: 管理记忆。
- 多层记忆：User / Session / Agent。
- 支持 SDK、Cloud、Self-hosted Server、MCP。
- 新版算法强调 single-pass ADD-only extraction、hybrid search、entity linking。

### 2.2 可接入形态

| 接入方式 | 可行性 | 是否建议默认 | 说明 |
|----------|--------|--------------|------|
| Mem0 Cloud API | 高 | 否 | 最快，但违背本地优先，且用户对话会进入第三方服务 |
| Mem0 MCP | 中 | 否 | MCP 工具让模型决定 add/search，偏 Agent，不适合默认产品链路 |
| Mem0 Self-hosted Server | 中 | 否 | 功能完整，但桌面端要求 Docker/服务管理，太重 |
| Mem0 Node SDK OSS | 中 | 否 | 可做本地 sidecar，但 WebView 不能直接依赖 Node/SQLite |
| Mem0 Python SDK OSS | 中 | 否 | 可用 bundled Python sidecar，但打包、升级、模型配置复杂 |
| 自研 Provider + 兼容 Mem0 API | 高 | 是 | 最符合产品架构，未来可切到 Mem0 |

### 2.3 推荐接入方式

不要在 `useChat.ts` 里直接调用 Mem0。应该先抽象：

```ts
interface ConversationMemoryProvider {
  addTurn(input: AddConversationTurnInput): Promise<void>
  search(input: SearchConversationMemoryInput): Promise<ConversationMemoryHit[]>
  getTimeline(sessionId: string): Promise<ConversationMemoryPage>
  deleteSession(sessionId: string): Promise<void>
}
```

然后提供两个实现：

```text
LocalConversationMemoryProvider   # 默认，自研
Mem0ConversationMemoryProvider    # 可选，后续接 Mem0
```

`useChat.ts` 只依赖 `ConversationMemoryProvider`，不关心后端是不是 Mem0。

---

## 三、三种方案对比

### 方案 1：现在的方案

当前状态：

```text
messages 原始历史
→ buildApiMessages 取最近上下文
→ KnowledgeConnection 召回用户选择的 Vault
→ LLM
```

优点：

- 简单稳定。
- 没有额外服务。
- Skill / Knowledge / Tool 运行边界已经比较清晰。
- 切换 Skill/Knowledge/Tool 后已能隔离旧运行上下文。

问题：

- 对话本身没有独立记忆后端。
- 长对话只能靠最近消息窗口。
- 清上下文后，旧消息虽然还在历史里，但不会被语义召回。
- 用户问“我们很早之前决定了什么”，只能碰运气。
- 附件、工具结果、重要决定没有被结构化沉淀。

适用阶段：

- 当前过渡期。
- 对话轮次较少。
- 用户主要依赖正式 Knowledge Vault，而非长会话记忆。

### 方案 2：对话也是小知识库

设计：

```text
每个 session = Session Memory Vault

raw/messages
wiki/facts.md
wiki/decisions.md
wiki/preferences.md
wiki/open-threads.md
wiki/timeline.md
```

优点：

- 和 LLM Wiki 思路一致。
- 对话原文永远不丢。
- 会话可形成可读、可编辑、可追溯的小 Wiki。
- sourceMessageIds 清晰，方便回查。
- 可以和现有 Vault 编译、检索代码复用。
- 非常符合“本地优先”和产品的 Wiki 语言。

问题：

- 容易和正式 Knowledge Vault 混淆。
- 如果直接复用正式知识库 UI，会让用户误以为会话内容自动进知识库。
- 需要专门做 session scope、runtime segment、删除策略。
- Wiki 编译需要 LLM，成本和延迟要控制。

适用阶段：

- 想把会话记忆做成透明、可追溯、用户可理解的产品能力。
- 适合韭菜盒子 Studio 的长期形态。

关键调整：

不能叫“知识库”，应该叫：

```text
本对话记忆
Conversation Memory
Session Memory
```

底层可以借鉴 Vault，但产品层必须独立。

### 方案 3：Mem0 作为对话记忆后端

设计：

```text
sendMessage 前:
  mem0.search(query, filters={ userId, sessionId, skillId, vaultId })
  → Session Memory Evidence

sendMessage 后:
  mem0.add(messages, metadata={ sessionId, skillId, vaultId, runSegmentId })
```

优点：

- 现成 memory abstraction。
- add/search/update/delete API 完整。
- 支持 user/session/agent scope。
- 支持语义检索、BM25、entity linking 等增强能力。
- 有 Cloud/Self-hosted/SDK 多种部署形态。
- 后续可扩展跨设备、跨产品记忆。

问题：

- 默认 LLM/embedding 配置需要适配 NewAPI 或本地模型。
- Cloud/MCP 默认形态不符合本地优先。
- MCP 工具模式会让 LLM 自己决定保存/搜索，容易变成 Agent Loop。
- OSS SDK 在桌面端需要 sidecar，不适合直接塞进 Vue WebView。
- Mem0 抽取出来的是 memory facts，不是完整会话 Wiki；可解释性弱于 Session Wiki。
- 需要额外做 sourceMessageIds、runtime segment、Skill/Vault 隔离。

适用阶段：

- 第二阶段或团队版。
- 用户明确开启云记忆或高级记忆后端。
- 需要跨设备同步和更强语义检索。

---

## 四、上下文规模与管理对比

| 维度 | 方案 1：现在 | 方案 2：对话小记忆库 | 方案 3：Mem0 后端 |
|------|--------------|----------------------|-------------------|
| 长对话能力 | 中低 | 高 | 高 |
| 本地优先 | 高 | 高 | 取决于部署 |
| 与正式知识库隔离 | 中 | 高，需独立命名 | 高，需 metadata scope |
| 上下文预算控制 | 中 | 高 | 高 |
| 可追溯 sourceMessageIds | 中 | 高 | 需自建扩展 |
| 用户可理解性 | 中 | 高 | 中 |
| 实现成本 | 低 | 中 | 中高 |
| 运维复杂度 | 低 | 中 | 中高 |
| 语义检索能力 | 低 | 中，可增强 | 高 |
| Wiki 可编辑性 | 无 | 高 | 低 |
| 跨设备同步 | 低 | 中，需同步方案 | 高，Cloud 最强 |
| 纯手动工作台契合度 | 高 | 高 | 中，需约束 |
| Agent Loop 风险 | 低 | 低 | MCP/Cloud 集成时偏高 |

---

## 五、最推荐架构

### 5.1 不把对话记忆放进正式 Knowledge Vault

正式 Knowledge Vault：

```text
用户选择
用户整理
跨会话复用
可导出
```

Conversation Memory：

```text
自动绑定当前 session
自动写 raw
自动召回
默认只服务当前对话
删除会话时删除
```

两者都属于 KnowledgeConnection 的 evidence source，但来源不同：

```text
KnowledgeConnection
  ├── conversationMemory: always scoped to current session
  └── selectedVault: user-selected official vault
```

### 5.2 内置后端优先

默认实现：

```text
SQLite
  session_memory_chunks
  session_memory_facts
  session_memory_events
  session_runtime_segments

FTS5 / keyword search
可选 embedding
可选 Mem0 adapter
```

为什么不用一上来就 Mem0：

- 我们需要非常强的产品语义控制。
- 我们要精确处理 Skill/Vault/Tool 切换边界。
- 我们要保证本地优先和低依赖。
- 我们要防止自动记忆污染正式知识库。

### 5.3 Mem0 作为 Provider

未来配置项：

```text
对话记忆后端：
  ○ 本地记忆  推荐
  ○ Mem0 Cloud
  ○ Mem0 Self-hosted
```

Provider 配置：

```ts
type ConversationMemoryBackend = 'local' | 'mem0-cloud' | 'mem0-self-hosted'

interface MemoryBackendConfig {
  backend: ConversationMemoryBackend
  endpoint?: string
  apiKey?: string
  llmProvider?: string
  embeddingProvider?: string
}
```

---

## 六、Mem0 接入边界

如果接 Mem0，必须遵守这些产品边界：

### 6.1 不走 MCP 工具模式作为默认

Mem0 MCP 适合 Agent 客户端，但韭菜盒子 Studio 不能让 LLM 自主决定：

- 什么时候保存记忆。
- 什么时候删除记忆。
- 保存到哪个 scope。
- 是否跨 session 查询。

这些必须由产品运行时控制。

### 6.2 使用 SDK/API 后端模式

推荐：

```text
ConversationMemoryProvider
  → Mem0 SDK / REST API
  → add/search/delete
```

LLM 不直接调用 Mem0 tool。
Mem0 search 结果只作为 user-side evidence 注入。

### 6.3 Scope 必须严格

每条 memory 必须带：

```ts
{
  userId,
  sessionId,
  runtimeSegmentId,
  skillId,
  vaultId,
  messageIds,
  source: 'conversation',
}
```

默认搜索：

```ts
filters: {
  userId,
  sessionId,
}
```

只有用户明确开启“跨会话记忆”时，才允许跨 session。

---

## 七、推荐路线图

### Phase 1：抽象 ConversationMemoryProvider

新增：

```text
src/runtime/conversationMemory/types.ts
src/runtime/conversationMemory/localProvider.ts
src/runtime/conversationMemory/context.ts
src/runtime/conversationMemory/index.ts
```

先不接 Mem0，只定义接口和本地实现。

### Phase 2：本地记忆后端

实现：

- session message chunk 写入。
- runtime segment 写入。
- FTS/keyword 检索。
- Session Memory Evidence 注入。
- 删除会话时删除 memory。

### Phase 3：记忆抽取

实现：

- facts
- decisions
- preferences
- open threads
- artifacts

抽取结果必须可回查 sourceMessageIds。

### Phase 4：Mem0 Adapter POC

实现：

```text
src/runtime/conversationMemory/mem0Provider.ts
```

只做：

- `addTurn`
- `search`
- `deleteSession`

不接 MCP，不做自动删除/update。

### Phase 5：设置页开放后端选择

默认：

```text
本地记忆
```

高级选项：

```text
Mem0 Cloud
Mem0 Self-hosted
```

---

## 八、最终建议

三种方案里：

```text
现在的方案：只能作为过渡
对话小记忆库：最适合产品默认形态
Mem0 后端：适合作为可选 Provider
```

最终形态：

```text
Conversation Memory Backend
  ├── Local Provider  默认
  └── Mem0 Provider   可选

Knowledge Vault
  └── 正式用户知识库，独立存在
```

一句话：

**对话要有自己的后端；默认自研本地记忆后端，Mem0 做可插拔增强，而不是替代我们的核心架构。**
