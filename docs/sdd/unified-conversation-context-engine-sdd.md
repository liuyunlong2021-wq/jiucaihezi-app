# Unified Conversation Context Engine Implementation SDD

> 日期: 2026-05-31
> 状态: 待执行
> 目标: 把对话上下文规模与长期记忆管理收敛为唯一的统一对话上下文引擎
> 产品约束: UI 不变，用户仍然只在原来的会话列表与聊天区输入、输出、查看历史

---

## 1. 一句话定案

韭菜盒子 Studio 的对话系统升级为一套唯一的 `Unified Conversation Context Engine`。

它不是“当前上下文系统 + Mem0 + 另一个本地记忆系统”，而是所有对话统一经过的一条运行链路：

```text
原始消息永久保存
↓
Engine 判断上下文负载
↓
Engine 检索 Vault、对话记忆索引、最近原始消息
↓
Engine 按 token 预算和权威性顺序重建 Prompt 工作集
↓
LLM 输出
↓
原始输出永久保存
↓
Engine 后台异步更新派生记忆索引
```

产品层、UI 层、`useChat.ts` 上层调用方只认 `ConversationContextEngine`。
Mem0 只允许作为 Engine 内部的语义记忆索引实现，不成为产品概念，也不成为事实源。

---

## 2. 第一性原则

### 2.1 唯一事实源

永远以本地原始数据为真相：

```text
messages
sessions
runtime_segments
conversation_run_snapshots
```

任何对话记忆、摘要、向量、Mem0 memory、FTS 索引，都是从原始消息和配置快照派生出来的索引。

只要原始消息、runtime segment、配置快照还在，索引损坏、过期、丢失或更换实现后，都必须可以重建。

### 2.2 只有一条对话上下文链路

禁止出现两套并行业务路径：

```text
禁止: 短对话走旧 buildApiMessages，长对话走 Mem0
禁止: UI 让用户选择 LocalProvider / Mem0Provider
禁止: useChat.ts 直接调用 Mem0
禁止: Mem0 作为与 Vault 并列的产品模块暴露给用户
```

允许 Engine 内部存在负载策略和降级策略：

```text
允许: Light / Standard / Heavy 三档负载策略
允许: Mem0 不可用时降级到最近消息 + Vault + 本地关键词索引
允许: 测试环境使用内存索引驱动
```

### 2.3 对话记忆是派生索引

`conversation_memory_index` 的定位：

```text
用于召回长期对话线索
用于减少 prompt 中塞入原始历史的体积
用于支撑无限接近“长对话不丢关键记忆”
```

它不是：

```text
不是正式 Knowledge Vault
不是用户手动维护的知识库
不是系统规则
不是不可替代的真相源
```

### 2.4 UI 零感知

初版不新增“本对话记忆”入口。

用户体验保持：

```text
第二列仍显示会话
聊天区仍显示输入和输出
历史仍存在原来的会话里
用户不需要理解 Engine / Mem0 / index
```

### 2.5 Engine 唯一性铁律

`ConversationContextEngine` 必须是对话上下文生命周期的唯一编排器。

硬性规则：

```text
所有对话上下文构建必须经过 ConversationContextEngine.build()
所有 assistant 输出后的记忆更新必须经过 ConversationContextEngine.afterAssistantMessage()
所有 runtimeSegment 创建、查询、切换必须经过 Engine 内部 storage/runtimeSegment 模块
所有 conversation_memory_index 检索、写入、删除必须由 Engine 内部 memoryIndex 模块发起
```

禁止：

```text
useChat.ts 直接 import mem0IndexDriver
useChat.ts 直接 import memoryIndex
chatRuntimeConnection.ts 判断记忆检索策略
任意 UI 组件直接查询 conversation_memory_items 参与 prompt
任意模块把 conversation_memory_index 当作不可重建真相源
```

代码约束：

```text
src/runtime/conversationContext/index.ts 只导出 ConversationContextEngine 与必要类型
src/runtime/conversationContext/mem0IndexDriver.ts 不从 connection / composables / components 直接导入
src/runtime/connection/chatRuntimeConnection.ts 只接收 Engine 输出的 evidence prompt 和 trace
src/runtime/connection/__tests__/architectureGuards.test.ts 增加 import 边界扫描
```

运行约束：

```text
buildChatRuntimeConnection() 在正式对话路径中必须接收 conversationContext
测试和非对话 runtime 可以显式传入 disabled context，但不能静默绕过
```

### 2.6 极端长文场景目标

本方案必须以真实极端负载为设计目标，而不是只优化普通聊天。

目标压力：

```text
连续 N 轮
每轮用户输入约 1 万字
每轮 assistant 输出约 1 万字
中途可能切 Skill / Vault / Tool
用户可能在第 25 轮追问第 3 轮里的风格、决策、细节
```

核心风险：

```text
前 10 轮表现可用，第 25 轮开始记忆退化
brief 逐轮压缩后丢失早期关键决策
memory index 被大量普通事实淹没
continuation 后半段重复、跑题或结构断裂
重建索引成本过高导致不可恢复
```

硬性目标：

```text
早期关键决策和风格锚点必须有强制保留机制
Heavy + Oversized 时必须强制回查一定比例原始 chunks
长输出 continuation 必须有结构摘要辅助，而不是只靠“继续写”
索引重建必须可中断、可增量、可按 dirty segment 恢复
```

### 2.7 长文多轮压力场景

目标场景：

```text
用户连续进行 N 轮长文对话
每轮输入约 1 万字
每轮输出约 1 万字
用户期望继续对话、不爆上下文、不丢关键决策
```

结论：

```text
原始消息可以永久保存
Prompt 不能无限塞入所有原文
Engine 必须把“保存全部原文”和“每轮输入模型的工作集”彻底分离
```

如果只做普通 prompt 拼接，一定会出问题：

```text
模型窗口会被早期长文挤爆
保存整段 session JSON 会越来越慢
索引写入会拖慢流式输出
长输出可能触发模型 max output 限制
早期关键决策可能被最近长文淹没
```

因此长文压力场景必须有 5 个硬能力：

```text
1. 原始长文消息 append-only / chunked 保存，避免每次重写巨大 session JSON
2. 当前超长 user input 先进入 oversized-turn pipeline，必要时分块提取任务 brief
3. assistant 长输出流式保存；如果 finish_reason = length，支持自动 continuation 拼接
4. 记忆索引异步更新，不阻塞当前回复
5. Heavy 策略按 sourceMessageIds 回查和重排，不依赖一次性塞入全部历史
```

单轮超长输入规则：

```text
如果当前 user input + system/skill/tool 必需上下文超过模型可用输入预算：
  Engine 将 user input 切为 message chunks
  先生成结构化 task brief / constraints / source map
  最终回答 prompt 使用 brief + sourceMessageIds
  原始 user input 仍完整保存在 messages/chunks 中
```

长输出规则：

```text
如果模型因为输出长度限制停止：
  Engine 记录 continuation state
  自动发起 continuation call
  合并 assistant message parts
  sourceMessageIds 和 run snapshot 仍指向同一轮用户请求
```

这不能保证“100% 永远不忘”，但可以把系统目标从“靠窗口硬撑”升级为：

```text
无限保存原文
有限重建工作集
可追溯召回
可降级继续
可重建索引
```

架构承诺必须写死：

```text
本引擎不承诺“永远不丢记忆”。
本引擎承诺：在合理成本范围内，把“关键信息可追溯召回”的概率尽量推高，
并提供清晰的降级、对账、重建和 source 回查路径。
```

长文场景分为两条确定性路径：

```text
Oversized User Input Path:
  当前这一轮用户输入本身过长，不能试图全部塞进 prompt。
  必须先 chunk，再生成结构化 brief、source pointers，并按当前任务选择性回查原文块。

Historical Long Context Path:
  历史已有多轮长文，不能只靠记忆索引。
  Heavy 模式必须混合使用 memory hits、阶段摘要、recent raw messages、按需原文 chunk 回查。
```

关键判断信号：

```text
currentUserInputTokens / availableInputBudget
```

如果当前输入占可用输入预算超过 55%，强制进入 `Oversized User Input Path`。
如果历史会话估算 token 超过模型窗口 45%，强制进入 `Historical Long Context Path`。

---

## 3. 当前代码落点

### 3.1 已有可复用结构

| 文件 | 当前职责 | 本方案中的角色 |
|------|----------|----------------|
| `src/composables/useChat.ts` | 对话发送、流式输出、工具循环 | 调用 Engine，不直接拼接对话记忆 |
| `src/runtime/connection/chatRuntimeConnection.ts` | Skill / Knowledge / Tool / LLM 连接单入口 | 接收 Engine 产出的 conversation context section |
| `src/utils/contextAssembly.ts` | 按 section 组装 prompt | 保留，增加对 Engine section 的稳定记录 |
| `src/runtime/connection/types.ts` | RuntimeConnection 类型 | 增加 conversation context trace 类型 |
| `src/stores/sessionStore.ts` | 会话与消息持久化 | 保存 segment、快照、删除时级联清理 |
| `src/utils/idb.ts` | SQLite / localStorage 存储层 | 增加 Engine 数据表和索引 |
| `src/data/modelContextWindows.ts` | 模型上下文窗口 | Engine 计算 token 预算时复用 |

### 3.2 不改 UI 的边界

初版不修改这些交互：

```text
不新增会话记忆按钮
不新增 Mem0 设置入口
不新增第二套历史列表
不改变用户发送消息的入口
不改变消息气泡显示方式
```

---

## 4. 目标架构

### 4.1 模块结构

新增：

```text
src/runtime/conversationContext/
  types.ts
  engine.ts
  loadStrategy.ts
  promptBudget.ts
  oversizedInput.ts
  continuation.ts
  runtimeSegment.ts
  provenance.ts
  storage.ts
  migration.ts
  backfill.ts
  memoryIndex.ts
  memoryCompaction.ts
  jobWorker.ts
  rebuildIndex.ts
  reconcileIndex.ts
  sqliteMaintenance.ts
  mem0IndexDriver.ts
  localFallbackIndexDriver.ts
  index.ts
```

连接层新增：

```text
src/runtime/connection/
  conversationContextConnection.ts
```

测试新增：

```text
src/runtime/conversationContext/__tests__/
  engine.test.ts
  loadStrategy.test.ts
  promptBudget.test.ts
  oversizedInput.test.ts
  continuation.test.ts
  runtimeSegment.test.ts
  provenance.test.ts
  storage.test.ts
  migration.test.ts
  backfill.test.ts
  memoryIndex.test.ts
  memoryCompaction.test.ts
  jobWorker.test.ts
  rebuildIndex.test.ts
  reconcileIndex.test.ts
  sqliteMaintenance.test.ts
  longFormStress.test.ts

src/runtime/connection/__tests__/
  conversationContextConnection.test.ts
```

### 4.2 模块职责

| 模块 | 职责 |
|------|------|
| `engine.ts` | 唯一编排入口，负责上下文生命周期 |
| `loadStrategy.ts` | 判断 Light / Standard / Heavy |
| `promptBudget.ts` | 分配 token 预算并裁剪 section |
| `oversizedInput.ts` | 当前轮超长输入分块、brief、source pointers、selective retrieval |
| `continuation.ts` | 长输出 continuation 状态机和合并规则 |
| `runtimeSegment.ts` | 判断是否创建新 segment |
| `provenance.ts` | 校验和生成 source metadata |
| `storage.ts` | 读写 runtime_segments、snapshots、jobs、index metadata |
| `migration.ts` | 为旧会话创建 baseline segment |
| `backfill.ts` | 按需回填旧会话 chunks 和 indexing jobs |
| `memoryIndex.ts` | Engine 内部索引端口，不暴露到产品层 |
| `memoryCompaction.ts` | Heavy 模式下阶段摘要、记忆分层、降采样和衰减 |
| `jobWorker.ts` | 异步执行索引任务，处理重试和幂等 |
| `rebuildIndex.ts` | 从原始 messages/chunks 重建派生索引 |
| `reconcileIndex.ts` | 修复本地 provenance 与外部 Mem0 索引漂移 |
| `sqliteMaintenance.ts` | SQLite 索引维护、轻量 vacuum、长会话存储健康检查 |
| `mem0IndexDriver.ts` | Mem0 语义记忆索引实现 |
| `localFallbackIndexDriver.ts` | 降级索引，只用于失败兜底、测试和重建辅助 |
| `conversationContextConnection.ts` | 把 Engine 输出渲染成独立 `[对话上下文]` evidence section |

---

## 5. 核心类型

### 5.1 Engine 输入

```ts
export interface BuildConversationContextInput {
  userId: string
  sessionId: string
  userInput: string
  currentMessages: ChatMessage[]
  selectedSkillId?: string
  primaryVaultId?: string | null
  secondaryVaultIds?: string[]
  enabledToolNames: string[]
  modelId: string
  providerId?: string
  contextBudget: number
  contextMode: ContextAssemblyMode
  now: number
}
```

### 5.2 Engine 输出

```ts
export interface ConversationContextResult {
  runtimeSegmentId: string
  loadLevel: 'light' | 'standard' | 'heavy'
  oversizedInput?: OversizedInputPlan
  continuation?: ContinuationState
  evidencePrompt: string
  recentMessages: ChatMessage[]
  memoryHits: ConversationMemoryHit[]
  tokenPlan: ConversationContextTokenPlan
  trace: ConversationContextTrace
  degradation?: ConversationContextDegradation
}
```

### 5.3 对话记忆命中

```ts
export interface ConversationMemoryHit {
  id: string
  text: string
  score: number
  kind: 'fact' | 'decision' | 'preference' | 'open_thread' | 'artifact' | 'summary'
  layer: 'turn' | 'segment' | 'session'
  recallReason: string
  sourceMessageIds: string[]
  sessionId: string
  runtimeSegmentId: string
  skillId?: string
  vaultId?: string
  createdAt: number
  lastUsedAt?: number
}
```

### 5.4 超长输入计划

```ts
export interface OversizedInputPlan {
  enabled: boolean
  messageId: string
  chunkIds: string[]
  brief: {
    task: string
    constraints: string[]
    entities: string[]
    sourcePointers: Array<{ chunkId: string; reason: string }>
  }
  briefLayers: {
    currentTurnDetailed: string
    recentTurnsCompressed: string
    anchorSummary: string
  }
  selectedChunkIds: string[]
  mandatoryChunkIds: string[]
  omittedChunkIds: string[]
  reason: 'current_input_over_budget' | 'current_input_dominates_budget'
}
```

### 5.5 长输出 continuation 状态

```ts
export interface ContinuationState {
  runId: string
  parentAssistantMessageId: string
  partIds: string[]
  status: 'idle' | 'continuing' | 'completed' | 'failed'
  attempts: number
  reusedContextPlanId: string
  outputStructureSummary: string
  completedSectionPointers: string[]
  lastFinishReason?: string
}
```

### 5.6 后台写入任务

```ts
export interface ConversationMemoryIndexJob {
  id: string
  sessionId: string
  runtimeSegmentId: string
  runId: string
  sourceMessageIds: string[]
  status: 'pending' | 'running' | 'done' | 'failed' | 'repair_required'
  attempts: number
  nextRunAt: number
  lastError?: string
  createdAt: number
  updatedAt: number
}
```

### 5.7 上下文 Trace

```ts
export interface ConversationContextTrace {
  sessionId: string
  runtimeSegmentId: string
  loadLevel: 'light' | 'standard' | 'heavy'
  selectedSources: Array<{
    section: 'knowledge' | 'recent-messages' | 'conversation-memory' | 'web-search'
    ids: string[]
    tokens: number
    reason: string
  }>
  rejectedSources: Array<{
    section: string
    ids: string[]
    reason: 'over_budget' | 'low_score' | 'wrong_segment' | 'missing_provenance' | 'index_degraded'
  }>
  budget: ConversationContextTokenPlan
  degradation?: ConversationContextDegradation
}
```

用途：

```text
解释本轮用了哪些来源
解释哪些 memory 没被召回
解释 segment 边界是否生效
解释 token 预算如何分配
```

---

## 6. 数据库设计

在 `src/utils/idb.ts` 初始化 SQLite 时新增表。

### 6.1 runtime_segments

```sql
CREATE TABLE IF NOT EXISTS runtime_segments (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  trigger TEXT NOT NULL,
  label TEXT,
  skillId TEXT,
  primaryVaultId TEXT,
  toolSignature TEXT,
  createdAt INTEGER NOT NULL,
  closedAt INTEGER,
  metadata TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_segments_session ON runtime_segments(sessionId, createdAt);
```

用途：

```text
记录会话阶段边界
隔离 Skill / Vault / Tool 切换后的上下文污染
为对话记忆索引提供 scope
```

### 6.2 conversation_run_snapshots

```sql
CREATE TABLE IF NOT EXISTS conversation_run_snapshots (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  runtimeSegmentId TEXT NOT NULL,
  userMessageId TEXT NOT NULL,
  assistantMessageId TEXT,
  skillId TEXT,
  primaryVaultId TEXT,
  enabledToolNames TEXT NOT NULL,
  modelId TEXT NOT NULL,
  providerId TEXT,
  contextMode TEXT NOT NULL,
  loadLevel TEXT NOT NULL,
  promptPlan TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_snapshots_session ON conversation_run_snapshots(sessionId, createdAt);
CREATE INDEX IF NOT EXISTS idx_run_snapshots_segment ON conversation_run_snapshots(runtimeSegmentId, createdAt);
```

用途：

```text
记录每轮实际使用的 Skill / Vault / Tool / Model / Prompt 来源
支持排查“为什么本轮不记得”
支持重建记忆索引
```

### 6.3 conversation_message_chunks

```sql
CREATE TABLE IF NOT EXISTS conversation_message_chunks (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  messageId TEXT NOT NULL,
  role TEXT NOT NULL,
  chunkIndex INTEGER NOT NULL,
  text TEXT NOT NULL,
  tokenCount INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  metadata TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_chunks_session ON conversation_message_chunks(sessionId, createdAt);
CREATE INDEX IF NOT EXISTS idx_message_chunks_message ON conversation_message_chunks(messageId, chunkIndex);
```

用途：

```text
支撑 1 万字输入 / 1 万字输出的多轮会话
避免每轮保存时反复重写巨大 message JSON
为 oversized-turn pipeline、索引重建、sourceMessageIds 回查提供稳定原文块
```

规则：

```text
短消息仍可保存在原 messages 结构中
超过阈值的长消息必须拆为 chunks
UI 显示时由 message metadata + chunks 还原完整文本
索引和摘要只读取 chunks，不要求把全部原文塞进 prompt
```

### 6.4 conversation_memory_items

```sql
CREATE TABLE IF NOT EXISTS conversation_memory_items (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  runtimeSegmentId TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sourceMessageIds TEXT NOT NULL,
  skillId TEXT,
  vaultId TEXT,
  score REAL,
  tokenCount INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  lastUsedAt INTEGER,
  indexDriver TEXT NOT NULL,
  externalId TEXT,
  idempotencyKey TEXT NOT NULL,
  syncStatus TEXT NOT NULL,
  metadata TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_items_session ON conversation_memory_items(sessionId, updatedAt);
CREATE INDEX IF NOT EXISTS idx_memory_items_segment ON conversation_memory_items(runtimeSegmentId, updatedAt);
CREATE INDEX IF NOT EXISTS idx_memory_items_external ON conversation_memory_items(indexDriver, externalId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_idempotency ON conversation_memory_items(idempotencyKey);
```

用途：

```text
本地保存可解释 memory metadata
即使 Mem0 存储事实，也在本地保留 provenance
支持索引重建、迁移、删除会话时级联清理
```

### 6.5 conversation_memory_jobs

```sql
CREATE TABLE IF NOT EXISTS conversation_memory_jobs (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  runtimeSegmentId TEXT NOT NULL,
  runId TEXT NOT NULL,
  sourceMessageIds TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  nextRunAt INTEGER NOT NULL,
  lastError TEXT,
  idempotencyKey TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_jobs_status ON conversation_memory_jobs(status, nextRunAt);
CREATE INDEX IF NOT EXISTS idx_memory_jobs_session ON conversation_memory_jobs(sessionId, createdAt);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_jobs_idempotency ON conversation_memory_jobs(idempotencyKey);
```

用途：

```text
assistant 输出结束后异步更新索引
失败重试
避免流式回复被记忆写入阻塞
```

### 6.6 conversation_continuations

```sql
CREATE TABLE IF NOT EXISTS conversation_continuations (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  runtimeSegmentId TEXT NOT NULL,
  parentAssistantMessageId TEXT NOT NULL,
  partIds TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  reusedContextPlanId TEXT NOT NULL,
  lastFinishReason TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  metadata TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_continuations_run ON conversation_continuations(runId, updatedAt);
CREATE INDEX IF NOT EXISTS idx_continuations_session ON conversation_continuations(sessionId, updatedAt);
```

用途：

```text
支撑长输出自动 continuation
保证多次 continuation 仍属于同一 runId 和同一用户请求
中间失败后可以继续恢复或提示用户重试
```

### 6.7 conversation_rebuild_jobs

```sql
CREATE TABLE IF NOT EXISTS conversation_rebuild_jobs (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  runtimeSegmentId TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  cursor TEXT,
  processedChunks INTEGER NOT NULL,
  totalChunks INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rebuild_jobs_status ON conversation_rebuild_jobs(status, priority, updatedAt);
CREATE INDEX IF NOT EXISTS idx_rebuild_jobs_session ON conversation_rebuild_jobs(sessionId, updatedAt);
```

用途：

```text
极长会话分段重建索引
按当前活跃 session / 最近使用 session / 用户主动请求确定优先级
记录进度，避免一次性重建阻塞应用
```

### 6.8 conversation_dirty_segments

```sql
CREATE TABLE IF NOT EXISTS conversation_dirty_segments (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  runtimeSegmentId TEXT NOT NULL,
  reason TEXT NOT NULL,
  dirtySince INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  metadata TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dirty_segments_status ON conversation_dirty_segments(status, priority, dirtySince);
CREATE INDEX IF NOT EXISTS idx_dirty_segments_session ON conversation_dirty_segments(sessionId, runtimeSegmentId);
```

用途：

```text
标记需要增量重建或重新压缩的 segment
支持只重建 dirty segment，而不是重建整个超长 session
```

---

## 7. Migration & Backfill Strategy

现有用户已经有历史会话，不能假设所有 session 从新 Engine 开始。

### 7.1 老会话 runtimeSegment

首次升级后不立即重写所有历史消息。

规则：

```text
每个旧 conversation 第一次被打开或第一次被新 Engine 使用时，创建一个 baseline segment
trigger = 'migration_baseline'
label = '历史会话导入'
skillId / primaryVaultId 使用 conversation 元数据中的 agentId / vaultId
createdAt 使用 conversation.createdAt 或第一条消息时间
```

### 7.2 历史消息回填策略

不做默认全量同步到 Mem0。

原因：

```text
成本不可控
启动耗时不可控
用户可能并不再使用旧会话
旧数据可能包含未脱敏敏感信息
```

采用三层回填：

```text
Lazy Backfill:
  用户打开旧会话时，只为该会话建立 baseline segment 和 chunk metadata

On-demand Backfill:
  用户在旧会话里继续提问时，优先回填最近 30 条消息和被检索命中的 source chunks

Manual / Maintenance Backfill:
  后续如提供诊断入口，可由用户手动触发“重建本会话上下文索引”
```

### 7.3 回填优先级

```text
当前正在使用的 session 最高
最近 7 天更新过的 session 次之
只读旧 session 默认不进入 Mem0
删除过 Vault 绑定的 session 不自动恢复旧 Vault 权威关系
```

### 7.4 回填输出

回填只创建派生数据：

```text
runtime_segments
conversation_message_chunks
conversation_memory_jobs
conversation_memory_items
```

不修改：

```text
原 messages 内容
原 conversations 标题
用户选择的 Skill / Vault 状态
UI 展示顺序
```

---

## 8. Engine 运行流程

### 8.1 发送前

```text
useChat.sendMessage()
  ↓
保存 user message
  ↓
ConversationContextEngine.build()
  ↓
ensureRuntimeSegment()
  ↓
resolveLoadStrategy()
  ↓
recall selected Vault
  ↓
search conversation_memory_index
  ↓
select recent raw messages
  ↓
allocate token budget
  ↓
return ConversationContextResult
  ↓
buildChatRuntimeConnection()
```

### 8.2 Prompt section 顺序

系统层：

```text
产品系统规则
当前 Skill / 默认 Skill
本地工具策略
长文输出契约
```

上下文层：

```text
正式 Knowledge Vault
最近原始消息摘要或片段
对话记忆索引证据
联网搜索证据
```

当前用户输入仍由 chat completion messages 的最后一条 user message 承载，不塞进 system prompt。

### 8.3 输出后

```text
assistant 完整输出结束
  ↓
保存 assistant message
  ↓
saveRunSnapshot()
  ↓
enqueueMemoryIndexJob()
  ↓
后台 worker 执行 indexTurn()
  ↓
写入 Mem0 / 本地降级索引
  ↓
本地 conversation_memory_items 保存 provenance
```

写入失败时：

```text
不影响用户本轮输出
job attempts + 1
写 lastError
按退避策略设置 nextRunAt
超过 5 次保留 failed 状态
```

### 8.4 Oversized User Input Pipeline

触发：

```text
currentUserInputTokens > availableInputBudget * 0.55
或 currentUserInputTokens + requiredSystemTokens + requiredSkillTokens > availableInputBudget
```

流程：

```text
1. 保存完整 user message
2. 将 user message 切成 conversation_message_chunks
3. 为每个 chunk 记录 tokenCount、chunkIndex、source range
4. 生成三层 brief:
   - currentTurnDetailed: 当前轮精细 brief，高细节
   - recentTurnsCompressed: 近期几轮压缩摘要，中细节
   - anchorSummary: 早期关键决策/风格锚点，强制保留
5. 基于当前问题、三层 brief、anchorSummary 选择性回查原文 chunks
6. 在 Heavy + Oversized 模式下强制保留一定比例 mandatory chunks
7. 最终 Prompt 使用 three-layer brief + mandatory chunks + selected chunks + source pointers
8. omitted chunks 不进入 Prompt，但可被后续 sourceMessageIds 回查
```

禁止：

```text
禁止把 1 万字当前输入无条件塞进 Prompt
禁止只保留 brief 丢掉原文
禁止让 brief 覆盖原始用户文本的事实权威
禁止 Heavy + Oversized 模式完全不带原始 chunk
```

输出给 LLM 的结构：

```text
[当前超长输入 Three-Layer Brief]
Current Turn Detailed:
Recent Turns Compressed:
Decision / Style Anchors:

[强制回查原文片段]
chunkId / reason / excerpt

[按需回查原文片段]
chunkId / reason / excerpt
```

强制 chunk 回查比例：

```text
Heavy + Oversized:
  至少 12% 的 oversized input budget 用于 mandatory chunks
  mandatory chunks 优先来自:
    - 用户显式要求
    - 决策句
    - 风格要求
    - 输出格式要求
    - 与当前问题高相关的 source pointers

Standard + Oversized:
  至少 6% 的 oversized input budget 用于 mandatory chunks
```

锚点规则：

```text
anchorSummary 必须包含:
  early decisions
  stable style rules
  user preferences
  long-running project constraints

anchorSummary 不能由当前轮 brief 覆盖。
如果 anchorSummary 与当前用户输入冲突，当前用户输入优先，但 trace 必须记录 conflict。
```

### 8.5 Historical Long Context Path

触发：

```text
estimatedSessionTokens > modelContextBudget * 0.45
或 messageCount > 80
或当前 session 已有多轮长文 chunks
```

流程：

```text
1. 检索当前 runtimeSegment 的 memory hits
2. 检索当前 session 的 segment summary
3. 选择最近原始消息窗口
4. 对高分 memory hits 回查 source chunks
5. 按 token budget 组合: segment summary + selected facts + source chunks + recent messages
6. 记录 selectedSources 和 rejectedSources
```

原则：

```text
Heavy 模式不能只靠 Mem0 / memory index
必须允许按需回查原始 chunks
必须让 summary、fact、decision、source chunk 分层进入 Prompt
```

强制锚点：

```text
Historical Long Context Path 必须检索并优先保留:
  session-level anchor summary
  当前 Skill 相关的 segment-level style anchors
  最近被用户引用过的 decisions
  当前 runtimeSegment 的 open_thread
```

预算不足时：

```text
可以减少普通 fact
可以减少 web search
可以减少旧 source chunks
不能删除当前任务相关 decision / preference / style anchor
```

### 8.6 Long Output Continuation Pipeline

触发：

```text
LLM finish_reason = 'length'
或响应流被模型输出上限截断
```

状态机：

```text
idle
  → continuing
  → completed
  → failed
```

规则：

```text
同一用户请求的所有 continuation 共用同一个 runId
sourceMessageIds 指向同一轮 user message 和同一批 source chunks
assistant 在 UI 中显示为一个完整消息
内部保存 partIds，用于恢复和排查
continuation 不重新执行完整 Engine.build()
continuation 必须复用上一轮 contextPlanId / prompt plan
只追加“继续上一段输出，不要重复已完成内容”的 continuation instruction
```

continuation prompt 必须包含：

```text
1. reusedContextPlanId
2. 当前 assistant 已完成输出的 outputStructureSummary
3. 最近一段输出 tail excerpt
4. completedSectionPointers
5. 下一段应从哪里继续
```

长输出 chunk 管理：

```text
assistant 长输出也写入 conversation_message_chunks
每个 continuation part 对应一个 partId
UI 展示时合并为一个 assistant message
索引写入时 sourceMessageIds 指向 parentAssistantMessageId 和 partIds
```

结构摘要：

```text
每次 continuation 后，Engine 更新 outputStructureSummary:
  已完成章节
  当前章节
  待完成章节
  已使用关键事实
  不应重复的段落
```

失败恢复：

```text
如果第 N 次 continuation 失败:
  保存已完成 parts
  conversation_continuations.status = 'failed'
  用户可重试继续生成
  重试仍复用同一 runId 和 context plan
```

最大次数：

```text
默认最多 3 次自动 continuation
超过后停止自动续写，避免无限输出循环
```

---

## 9. 负载策略

Engine 内部统一判断，不在 UI 暴露。

### 9.1 Light

触发：

```text
会话有效上下文 < 16 条消息
或估算 token < 模型窗口的 12%
且用户输入不是“回忆、总结、继续上次、我们之前”等记忆型请求
```

策略：

```text
取最近原始消息
召回少量高置信 memory，最多 500 tokens
Vault 仍按用户选择正常召回
不做重排
```

### 9.2 Standard

触发：

```text
会话 token 介于模型窗口 12% 到 45%
或消息数介于 16 到 80
或用户输入包含明显记忆依赖
```

策略：

```text
检索当前 segment memory
检索当前 session 跨 segment memory
取最近原始消息
按预算裁剪
memory 预算 1200 到 1800 tokens
```

### 9.3 Heavy

触发：

```text
会话 token 超过模型窗口 45%
或消息数超过 80
或用户要求总结长对话、继续复杂项目、追踪早期决策
```

策略：

```text
检索当前 segment
检索当前 session 跨 segment
对 memory hits 做 rerank
必要时生成局部摘要
保留 sourceMessageIds
memory 预算 2500 到 3500 tokens
```

### 9.4 负载判断信号

`loadStrategy.ts` 不只看消息条数。

输入信号：

```text
messageCount
estimatedSessionTokens
currentUserInputTokens
currentUserInputRatio
modelContextBudget
availableInputBudget
isMemoryIntentQuery
memoryIntentConfidence
isLongFormTask
hasSelectedVault
runtimeSegmentAge
memoryIndexFreshness
lastRunWasDegraded
```

记忆意图判断初版用确定性规则：

```text
包含“之前 / 上次 / 继续 / 回忆 / 总结我们 / 刚才决定 / 前面说过 / 按我们定的”
或用户要求追踪项目、决策、人物设定、长文大纲、连续创作
```

可选增强：

```text
当关键词规则不确定且当前会话已经进入 Standard / Heavy:
  使用轻量分类器判断 memory intent
  分类器只输出 memory_intent / no_memory_intent / uncertain
  不允许分类器直接决定 Prompt 内容
  不允许分类器创建 runtimeSegment
```

禁止初版让 LLM 自主判断是否切换负载级别或选择记忆内容。

### 9.5 Prompt 预算分配

预算原则：

```text
当前用户输入是硬输入，优先保留
产品系统规则 / Skill / 工具策略是行为约束，优先保留
正式 Vault 是用户显式选择的权威资料，优先级高于对话记忆
最近原始消息是事实源，优先级高于派生记忆
对话记忆用于补足远期上下文
联网搜索证据只在用户开启搜索或搜索策略触发时进入
```

默认预算：

| Section | Light | Standard | Heavy |
|---------|-------|----------|-------|
| system + skill + tools | 必保，过长时按 Skill progressive loading 裁剪资源 | 必保 | 必保 |
| current user input | 必保，超长时进入 oversized-turn pipeline | 必保 | 必保 |
| formal Vault | 1000-1800 tokens | 1800-3000 tokens | 3000-5000 tokens |
| recent raw messages | 2000-4000 tokens | 4000-8000 tokens | 6000-12000 tokens |
| conversation memory | 0-500 tokens | 1200-1800 tokens | 2500-3500 tokens |
| web search | 0-800 tokens | 800-1600 tokens | 1200-2400 tokens |
| output reserve | 至少 20% context 或模型最大输出安全值 | 至少 20% | 至少 25% |

预算不足时裁剪顺序：

```text
先裁剪 web search
再裁剪 conversation memory
再裁剪 recent raw messages 的较旧部分
再裁剪 Vault hit 数量
最后才裁剪 Skill 资源引用
```

不允许裁剪：

```text
产品系统规则
当前用户输入的任务意图
当前 Skill 主体规则
工具安全策略
```

### 9.6 模型窗口动态预算

`promptBudget.ts` 必须把 `modelContextBudget` 作为一等输入。

窗口级别：

```text
Small:  <= 32K tokens
Medium: <= 128K tokens
Large:  <= 512K tokens
Huge:   > 512K tokens
```

策略：

```text
Small:
  极保守，优先 brief / summary / memory hit，少量 source chunks

Medium:
  标准策略，Vault + recent raw messages + memory hits 均衡

Large:
  更激进地回查 source chunks，保留更多最近原始消息

Huge:
  允许更多 source chunks 和 segment summaries，但仍不无脑塞全部历史
```

硬约束：

```text
无论模型窗口多大，都必须保留 output reserve
无论模型窗口多大，单个 section 都不能无限增长
Huge window 只提高 source chunk 上限，不取消检索和排序
```

### 9.8 成本敏感模式

连续长文会显著增加成本和延迟。

触发：

```text
Heavy 模式连续 3 轮
或本轮预计需要 rerank + source chunk 回查 + continuation
或 memory index / rerank 平均耗时超过阈值
```

策略：

```text
减少 web search 预算
减少普通 fact 检索数量
提高 anchor memory / decision / preference 权重
降低 source chunk 回查数量，但保留 mandatory chunks
跳过轻量分类器，使用确定性规则
延后非关键 memoryCompaction job
```

用户体验：

```text
初版不弹成本提示
内部 trace 记录 costMode = true
```

### 9.9 Heavy 模式的记忆分层

当 session 进入 Heavy 且长文轮次持续增长，Engine 必须主动分层记忆。

记忆层：

```text
turn memory:
  来自单轮对话的 fact / decision / preference / artifact

segment summary:
  对一个 runtimeSegment 的阶段性摘要，kind = 'summary', layer = 'segment'

session summary:
  对跨 segment 的长期摘要，kind = 'summary', layer = 'session'

anchor memory:
  跨长文会话强制保留的 decision / style / preference / project constraint
```

触发压缩：

```text
同一 segment 的 memory_items > 120
或同一 segment 的 chunks token > 120K
或 session memory hits 在连续 3 轮中 rejectedSources 过多
或 Heavy 模式连续出现 5 轮
或 oversized input 连续出现 3 轮
或同一 session 的 total chunk tokens > 300K
```

处理：

```text
生成 segment summary
生成或更新 session summary
生成或更新 anchor memory
保留高价值 fact / decision / preference
普通内容降采样，只保留 source pointers
低分且长期未使用 memory 降权
重复 memory 合并
```

保留原则：

```text
decision 永远优先于普通 fact
用户偏好优先于普通风格描述
artifact 指针优先于长篇 artifact 原文
summary 不能覆盖 source chunks 的事实权威
anchor memory 优先进入 Prompt，除非与当前用户输入冲突
```

分层输出：

```text
turn memory:
  默认只保留最近活跃轮次和高分命中

segment summary:
  每个 runtimeSegment 最多保留 1 个 active summary
  segment summary 必须带 sourceMessageIds 范围

session summary:
  每个 session 最多保留 1 个 active summary
  session summary 只承接跨 segment 长期连续性，不写入正式 Vault

anchor memory:
  每个 session 默认最多 30 条 active anchors
  超过后按 score、lastUsedAt、用户显式引用次数合并
```

衰减规则：

```text
普通 fact:
  连续 10 次未被召回，score *= 0.85

style / preference:
  连续 20 次未被召回才降权

decision:
  不自动降权，只允许被更新决策 supersede

open_thread:
  被用户完成或关闭后转为 archived，不再默认召回

artifact:
  保留指针和摘要，原文依赖 source chunks
```

归档规则：

```text
archived memory 不删除原文
archived memory 默认不进入 Prompt
用户明确追问旧内容时可以被 search 命中
```

---

## 10. runtimeSegment 规则

### 10.1 必须创建新 segment

```text
新建会话
切换主 Skill
切换主要 Vault
清空/重置上下文
切换关键工具组合
用户手动开始新阶段
```

### 10.2 不创建新 segment

```text
单纯切换模型
临时增减非核心工具
切换辅助 Vault
普通话题漂移
联网搜索开关变化
```

### 10.3 工具签名

关键工具组合用稳定签名判断：

```ts
export function buildToolSignature(toolNames: string[]): string {
  return [...new Set(toolNames.map(name => String(name).trim()).filter(Boolean))]
    .sort()
    .join('|')
}
```

---

## 11. Mem0 接入边界

### 11.1 Mem0 是内部 index driver

文件：

```text
src/runtime/conversationContext/mem0IndexDriver.ts
```

它实现内部接口：

```ts
export interface ConversationMemoryIndexDriver {
  search(input: MemoryIndexSearchInput): Promise<MemoryIndexSearchResult>
  indexTurn(input: MemoryIndexTurnInput): Promise<MemoryIndexWriteResult>
  deleteSession(sessionId: string): Promise<void>
}
```

### 11.2 禁止默认 MCP 模式

不让 LLM 直接调用 Mem0 工具。

原因：

```text
保存什么记忆由 Engine 决定
检索什么记忆由 Engine 决定
scope 由 Engine 决定
LLM 不负责产品流程判断
```

### 11.3 Mem0 metadata

写入 Mem0 时必须携带：

```ts
{
  user_id: userId,
  session_id: sessionId,
  runtime_segment_id: runtimeSegmentId,
  skill_id: skillId || '',
  vault_id: vaultId || '',
  source_message_ids: sourceMessageIds,
  run_id: runId,
  source: 'jiucaihezi_conversation'
}
```

### 11.4 本地 provenance

无论 Mem0 返回什么 external id，本地都保存：

```text
conversation_memory_items.externalId
conversation_memory_items.indexDriver = 'mem0'
conversation_memory_items.sourceMessageIds
conversation_memory_items.runtimeSegmentId
```

### 11.5 Mem0 边界收紧

Mem0 只负责：

```text
语义相似度检索
对话事实抽取
按 metadata scope 返回候选 memory
```

Mem0 不负责：

```text
权威性判断
最终排序
去重策略
时序逻辑
runtimeSegment 判断
是否跨 session 检索
是否写入正式 Vault
```

这些全部由 `ConversationContextEngine` 完成。

---

## 12. 一致性与最终一致性模型

### 12.1 权威解释层

本地数据是权威解释层：

```text
conversation_memory_jobs 记录要处理哪一轮对话
conversation_memory_items 记录每条派生记忆的 provenance
Mem0 externalId 只是外部索引句柄
```

任何时候，如果 Mem0 里存在记录但本地没有 provenance，该记录不能进入 Prompt。

### 12.2 写入顺序

assistant 输出结束后的索引写入顺序：

```text
1. 写 conversation_memory_jobs，状态 pending
2. worker 获取 job，状态 running
3. 基于 sourceMessageIds 读取原始 messages/chunks
4. 脱敏并生成 indexTurn payload
5. 调 Mem0 / index driver
6. driver 返回候选 memory items
7. 先写本地 conversation_memory_items，syncStatus = 'local_committed'
8. 记录 externalId，syncStatus = 'synced'
9. job 状态 done
```

如果 Mem0 成功但本地写入失败：

```text
job 状态 repair_required
job.lastError 记录 external ids
reconciliation worker 尝试重新写本地 provenance
无法修复时删除外部 orphan records
```

如果本地写入成功但 Mem0 失败：

```text
conversation_memory_items.syncStatus = 'local_only'
job 按退避策略重试
检索时 local_only 可参与本地降级召回，但 trace 必须标记 indexDriver degraded
```

### 12.3 幂等性

`indexTurn()` 必须幂等。

幂等键：

```text
sha256(sessionId + runtimeSegmentId + runId + sourceMessageIds.join(','))
```

规则：

```text
同一 idempotencyKey 的 job 只能存在一条
同一 idempotencyKey 生成的 memory item 不能重复写入
重试不得产生重复记忆
Mem0 metadata 必须带 job_id 和 idempotency_key
```

### 12.4 对账与修复

新增内部函数：

```ts
reconcileConversationMemoryIndex(sessionId: string): Promise<void>
```

检查：

```text
local item 有 externalId，但 Mem0 搜不到
Mem0 有 metadata job_id，但本地 item 缺失
job 长期 running 超时
repair_required job 超过 5 次仍失败
```

修复策略：

```text
能从原始 messages 重建的，重新 index
无法补 provenance 的外部记录，从外部 index 删除
无法确认的记录不进入 Prompt
```

触发时机：

```text
应用启动后，轻量扫描最近 20 个 active / updated sessions
job 进入 repair_required 时立即加入对账队列
用户继续一个旧会话前，检查该 session 最近 50 条 memory item 的 syncStatus
每完成 50 个 memory jobs 后做一次轻量对账
```

频率控制：

```text
同一 session 10 分钟内最多自动对账 1 次
Heavy session 优先级高于只读旧 session
对账不得阻塞用户发送消息
```

---

## 13. 与现有 Connection 的关系

### 13.1 新增 connection section

`chatRuntimeConnection.ts` 增加：

```ts
conversationContextEvidencePrompt?: string
```

并在 `assembleRuntimeConnectionPrompt()` 中插入 section：

```text
knowledge
recent-messages
conversation-memory
web-search
```

### 13.2 RuntimeConnection trace

`RuntimeConnectionTrace` 增加：

```ts
conversationContext?: {
  runtimeSegmentId: string
  loadLevel: 'light' | 'standard' | 'heavy'
  memoryHitCount: number
  degraded: boolean
}
```

### 13.3 useChat 调用边界

`useChat.ts` 只做三件事：

```text
调用 Engine.build()
把 Engine 结果交给 buildChatRuntimeConnection()
输出结束后调用 Engine.afterAssistantMessage()
```

不在 `useChat.ts` 中直接：

```text
拼接对话记忆 prompt
调用 Mem0
判断 memory 检索策略
写 memory item
```

---

## 14. 降级与容错

### 14.1 检索降级

当 Mem0 或 memory index 超时：

```text
Engine 降级到最近原始消息 + Vault
记录 degradation.reason = 'memory_index_timeout'
本轮继续输出
不弹错误给普通用户
内部 trace 可查
```

默认超时：

```text
Light: 600ms
Standard: 1200ms
Heavy: 2500ms
```

降级时 Prompt 结构：

```text
如果 memory index 不可用，不插入空的 conversation-memory section
继续保留 Knowledge Vault section
继续保留 recent raw messages section
trace 中记录 degradation.reason 和 omittedSections
不要求模型向用户解释“记忆系统不可用”
```

### 14.2 写入降级

后台写入失败：

```text
不影响当前对话
写 conversation_memory_jobs
指数退避重试
失败 5 次后 status = failed
下次应用启动扫描 pending / failed 可继续处理
```

### 14.3 索引重建

提供内部函数：

```ts
rebuildConversationMemoryIndex(input: {
  sessionId: string
  runtimeSegmentId?: string
  dirtyOnly?: boolean
  priority: 'active' | 'recent' | 'manual' | 'maintenance'
}): Promise<void>
```

它从：

```text
messages
runtime_segments
conversation_run_snapshots
```

重建：

```text
conversation_memory_items
外部 Mem0 index
```

极长会话重建规则：

```text
按 runtimeSegment 分段重建
按 conversation_message_chunks 游标推进
每批最多处理 30 个 chunks 或 20K tokens
每批完成后写 conversation_rebuild_jobs.cursor
应用关闭或失败后可从 cursor 继续
默认 dirtyOnly = true，只重建 conversation_dirty_segments 标记的 segment
```

优先级：

```text
active: 当前正在对话的 session
manual: 用户或开发诊断主动触发
recent: 最近 7 天继续使用过的 session
maintenance: 后台低优先级维护
```

进度记录：

```text
processedChunks
totalChunks
currentRuntimeSegmentId
lastError
updatedAt
```

初版不做普通用户 UI 进度条，但内部 trace / logs 必须能看到重建进度。

可中断规则：

```text
每批处理后检查应用 idle / active 状态
用户正在发送消息时暂停 maintenance rebuild
active session rebuild 可以继续，但单批不得超过 20K tokens
失败后保留 cursor，下次从 cursor 继续
```

dirty segment 来源：

```text
index driver 写入失败
memoryCompaction 失败
旧会话 backfill 未完成
用户删除或重命名相关消息
reconcile 发现外部索引漂移
```

---

## 15. 数据治理与删除策略

### 15.1 原始消息保留

默认不自动删除原始消息。

原因：

```text
原始消息是唯一事实源
索引可重建依赖原始消息
用户历史会话显示依赖原始消息
```

### 15.2 派生索引治理

`conversation_memory_items` 可以治理和重建：

```text
低分 memory 可以降权
长期未使用 memory 可以不再进入 Prompt
过期 externalId 可以重新同步
重复 memory 可以按 idempotencyKey / normalized text 合并
```

初版不做自动删除，只做：

```text
lastUsedAt 更新
score 更新
syncStatus 更新
failed / repair_required job 追踪
```

Heavy 模式允许自动分层：

```text
turn memory 保留近期细节
segment summary 承接旧阶段上下文
session summary 承接跨阶段长期连续性
anchor memory 强制承接关键决策/风格/偏好/项目约束
低价值 turn memory 降权，但不删除原始 chunks
```

记忆衰减：

```text
连续 10 次未被选中的低分 fact 降权
被用户当前问题命中的 decision / preference 提权
被 source chunk 证实的 memory 提权
缺少 provenance 的 memory 直接禁用
```

归档策略：

```text
普通 fact 降权到阈值以下后 archived
archived memory 默认不进入 Prompt
用户明确追问旧内容时 archived memory 可以参与检索
decision 不自动 archived，只能被 superseded decision 替代
anchor memory 需要被更高置信 anchor 合并后才 archived
```

### 15.3 会话删除级联

用户删除 session 时必须级联删除：

```text
runtime_segments
conversation_run_snapshots
conversation_message_chunks
conversation_memory_items
conversation_memory_jobs
Mem0 中 metadata.session_id = 当前 sessionId 的外部记录
```

如果外部删除失败：

```text
本地先标记 delete_pending
后台 worker 重试外部删除
delete_pending 记录不能进入 Prompt
```

### 15.4 多用户隔离

虽然当前是本地单用户应用，Engine 仍必须有 `userId`。

默认：

```text
userId = local profile id
```

所有外部索引 metadata 必须带：

```text
user_id
session_id
runtime_segment_id
```

跨 session 召回默认关闭。跨 user 召回永远禁止。

### 15.5 SQLite 长期性能

长会话会持续产生 chunks、snapshots、memory items、jobs。

维护策略：

```text
对 sessionId / runtimeSegmentId / updatedAt / status 建索引
后台 job 批处理，不在主发送流程里做大查询
定期清理 done jobs 的冗余 payload，只保留审计字段
对 delete_pending / failed / repair_required 单独索引
应用空闲时执行轻量 storage health check
```

Vacuum 策略：

```text
不在用户发送消息时 vacuum
仅在大量删除会话后、应用空闲时执行轻量 vacuum
Tauri SQLite 失败时跳过，不影响对话
```

分表策略：

```text
MVP 不按 session 分表
当 conversation_message_chunks 超过 100 万行时再评估归档表
```

---

## 16. 可观测性

每轮保存 prompt plan：

```ts
{
  sections: [
    { name: 'product-system', tokens: 180 },
    { name: 'skill', tokens: 1200 },
    { name: 'knowledge', tokens: 1600 },
    { name: 'recent-messages', tokens: 2200 },
    { name: 'conversation-memory', tokens: 1200 },
    { name: 'web-search', tokens: 900 }
  ],
  loadLevel: 'standard',
  runtimeSegmentId: 'seg_xxx',
  degraded: false
}
```

每条 `ConversationMemoryHit` 必须记录：

```text
recallReason: 为什么召回
score: 原始相关度
layer: turn / segment / session
sourceMessageIds: 可回查来源
runtimeSegmentId: 所属阶段
```

每条 rejected source 必须记录：

```text
reason: over_budget / low_score / wrong_segment / missing_provenance / index_degraded
```

初版只内部记录，不做 UI。

后续可以在开发者诊断面板或高级设置中展示。

---

## 17. 实施任务

### Task 1: 建立 Engine 类型、负载策略、预算策略

文件：

```text
Create: src/runtime/conversationContext/types.ts
Create: src/runtime/conversationContext/loadStrategy.ts
Create: src/runtime/conversationContext/promptBudget.ts
Create: src/runtime/conversationContext/oversizedInput.ts
Create: src/runtime/conversationContext/__tests__/loadStrategy.test.ts
Create: src/runtime/conversationContext/__tests__/promptBudget.test.ts
Create: src/runtime/conversationContext/__tests__/oversizedInput.test.ts
```

验收：

```text
Light / Standard / Heavy 判断稳定
判断信号包含消息数、token、当前输入长度、记忆意图、index freshness
token budget 明确分配 Vault / recent raw messages / conversation memory / web search
当前 user input 和 system/skill/tool 安全规则不可被裁剪
超长当前输入触发 oversized-turn 标记
Oversized User Input Path 生成 brief、source pointers、selectedChunkIds、omittedChunkIds
Oversized User Input Path 生成 three-layer brief 和 mandatoryChunkIds
Heavy + Oversized 至少保留 12% oversized input budget 的 mandatory chunks
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/loadStrategy.test.ts src/runtime/conversationContext/__tests__/promptBudget.test.ts src/runtime/conversationContext/__tests__/oversizedInput.test.ts
```

### Task 2: 扩展 SQLite 存储和长文 chunks

文件：

```text
Modify: src/utils/idb.ts
Create: src/runtime/conversationContext/storage.ts
Create: src/runtime/conversationContext/__tests__/storage.test.ts
```

验收：

```text
runtime_segments 可创建和查询
conversation_run_snapshots 可写入
conversation_message_chunks 可按 messageId 还原长文
conversation_memory_items 支持 idempotencyKey 和 syncStatus
conversation_memory_jobs 支持 pending / running / done / failed / repair_required
conversation_continuations 可记录长输出 continuation 状态
conversation_rebuild_jobs 可记录分段重建进度
conversation_dirty_segments 可记录 dirtyOnly 增量重建范围
浏览器调试环境有 localStorage 降级
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/storage.test.ts
```

### Task 3: runtimeSegment 管理

文件：

```text
Create: src/runtime/conversationContext/runtimeSegment.ts
Create: src/runtime/conversationContext/__tests__/runtimeSegment.test.ts
```

验收：

```text
新会话创建 segment
切 Skill 创建 segment
切主 Vault 创建 segment
清上下文创建 segment
关键工具签名变化创建 segment
单纯切模型不创建 segment
联网搜索开关变化不创建 segment
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/runtimeSegment.test.ts
```

### Task 4: Migration & Backfill

文件：

```text
Create: src/runtime/conversationContext/migration.ts
Create: src/runtime/conversationContext/backfill.ts
Create: src/runtime/conversationContext/__tests__/migration.test.ts
Create: src/runtime/conversationContext/__tests__/backfill.test.ts
```

验收：

```text
旧会话首次打开时创建 migration_baseline segment
旧会话不默认全量写入 Mem0
继续旧会话时优先回填最近 30 条消息和命中 chunks
回填不修改原 messages / conversations / UI 展示
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/migration.test.ts src/runtime/conversationContext/__tests__/backfill.test.ts
```

### Task 5: memory index 端口、provenance、降级驱动

文件：

```text
Create: src/runtime/conversationContext/memoryIndex.ts
Create: src/runtime/conversationContext/localFallbackIndexDriver.ts
Create: src/runtime/conversationContext/provenance.ts
Create: src/runtime/conversationContext/memoryCompaction.ts
Create: src/runtime/conversationContext/__tests__/memoryIndex.test.ts
Create: src/runtime/conversationContext/__tests__/provenance.test.ts
Create: src/runtime/conversationContext/__tests__/memoryCompaction.test.ts
```

验收：

```text
索引命中必须带 sourceMessageIds
索引命中必须带 runtimeSegmentId
索引超时时返回 degradation，不抛断主流程
本地降级驱动只作为 Engine 内部能力，不暴露 UI
缺少本地 provenance 的外部索引记录不得进入 Prompt
Heavy 模式可生成 segment summary / session summary 并降权低价值 turn memory
memoryCompaction 可生成 anchor memory
memoryCompaction 可归档普通 fact 且不删除原始 chunks
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/memoryIndex.test.ts src/runtime/conversationContext/__tests__/provenance.test.ts src/runtime/conversationContext/__tests__/memoryCompaction.test.ts
```

### Task 6: job worker、幂等和重建能力

文件：

```text
Create: src/runtime/conversationContext/jobWorker.ts
Create: src/runtime/conversationContext/rebuildIndex.ts
Create: src/runtime/conversationContext/reconcileIndex.ts
Create: src/runtime/conversationContext/sqliteMaintenance.ts
Create: src/runtime/conversationContext/__tests__/jobWorker.test.ts
Create: src/runtime/conversationContext/__tests__/rebuildIndex.test.ts
Create: src/runtime/conversationContext/__tests__/reconcileIndex.test.ts
Create: src/runtime/conversationContext/__tests__/sqliteMaintenance.test.ts
Modify: src/main.ts
```

验收：

```text
应用启动后处理 pending jobs
indexTurn 按 idempotencyKey 幂等执行
重试不会产生重复 memory item
repair_required 可进入对账流程
超过 5 次标记 failed
rebuildConversationMemoryIndex() 可按 segment 和 chunks cursor 分段重建索引
rebuildConversationMemoryIndex() 默认 dirtyOnly，只重建 dirty segments
sqliteMaintenance 不在用户发送消息时执行 vacuum
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/jobWorker.test.ts src/runtime/conversationContext/__tests__/rebuildIndex.test.ts src/runtime/conversationContext/__tests__/reconcileIndex.test.ts src/runtime/conversationContext/__tests__/sqliteMaintenance.test.ts
```

### Task 7: ConversationContextEngine 主体

文件：

```text
Create: src/runtime/conversationContext/engine.ts
Create: src/runtime/conversationContext/index.ts
Create: src/runtime/conversationContext/__tests__/engine.test.ts
```

验收：

```text
Engine.build() 返回 runtimeSegmentId、loadLevel、evidencePrompt、recentMessages、tokenPlan、trace
Engine.afterAssistantMessage() 创建 memory job
Engine 可处理 oversized user input
Engine 可处理 memory index 降级
Engine 不直接修改 UI 状态
Engine 不依赖 Vue 组件
Engine 不让 Mem0 成为事实源
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/engine.test.ts
```

### Task 8: 接入 RuntimeConnection 并加入架构守门测试

文件：

```text
Create: src/runtime/connection/conversationContextConnection.ts
Modify: src/runtime/connection/types.ts
Modify: src/runtime/connection/chatRuntimeConnection.ts
Modify: src/runtime/connection/index.ts
Modify: src/runtime/connection/__tests__/architectureGuards.test.ts
Create: src/runtime/connection/__tests__/conversationContextConnection.test.ts
Modify: src/runtime/connection/__tests__/runtimeConnection.test.ts
```

验收：

```text
Prompt section 顺序稳定
conversation-memory 只进入 contextPrompt，不进入 systemPrompt
local-tools 保持 systemPrompt 行为规则
RuntimeConnection trace 记录 segment 和 loadLevel
architecture guard 阻止 useChat.ts 直接 import mem0IndexDriver / memoryIndex
```

测试命令：

```bash
pnpm exec vitest run src/runtime/connection/__tests__/architectureGuards.test.ts src/runtime/connection/__tests__/conversationContextConnection.test.ts src/runtime/connection/__tests__/runtimeConnection.test.ts
```

### Task 9: 接入 useChat 主流程和长输出 continuation

文件：

```text
Modify: src/composables/useChat.ts
Create: src/runtime/conversationContext/continuation.ts
Create: src/runtime/conversationContext/__tests__/continuation.test.ts
Modify: src/utils/__tests__/useChatSendMessage.test.ts
```

验收：

```text
sendMessage 发送前调用 Engine.build()
buildChatRuntimeConnection 接收 Engine evidence
assistant 输出完成后调用 Engine.afterAssistantMessage()
记忆索引写入失败不影响流式输出
切换 Skill / Vault / Tool 后 segment 生效
finish_reason = length 时支持 continuation 合并
continuation 复用同一 runId 和同一 context plan
continuation 中间失败可保存 parts 并恢复
continuation 带 outputStructureSummary、tail excerpt、completedSectionPointers
assistant 长输出按 chunks 保存，UI 合并为一条消息
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/continuation.test.ts src/utils/__tests__/useChatSendMessage.test.ts
```

### Task 10: Mem0 index driver

文件：

```text
Create: src/runtime/conversationContext/mem0IndexDriver.ts
Create: src/runtime/conversationContext/__tests__/mem0IndexDriver.test.ts
```

验收：

```text
Mem0 search 带 user_id、session_id、runtime_segment_id metadata
Mem0 add 带 source_message_ids、skill_id、vault_id、run_id、job_id、idempotency_key
Mem0 只返回候选，不做权威排序
Mem0 超时可降级
Mem0 返回外部 id 后写入本地 conversation_memory_items
不通过 MCP 暴露给 LLM
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/mem0IndexDriver.test.ts
```

### Task 11: 长文压力与集成回归

文件：

```text
Create: src/runtime/conversationContext/__tests__/longFormStress.test.ts
Modify: src/utils/__tests__/useChatSendMessage.test.ts
```

验收：

```text
模拟 N 轮 1 万字输入 + 1 万字输出不会把全部历史塞进 prompt
Engine 使用 chunks、Heavy 策略、memory hits、recent raw messages 重建工作集
Oversized User Input Path 不把整段 1 万字输入直接塞进 Prompt
Historical Long Context Path 可混合使用 segment summary、source chunks、recent raw messages
第 25 轮追问早期风格/决策时，anchor memory 和 source chunks 能进入工作集
Heavy 长文会话触发 memoryCompaction，memory index 不因普通 fact 膨胀而失控
Prompt token plan 不超过模型预算
索引降级时仍可用 recent raw messages + Vault 输出
```

测试命令：

```bash
pnpm exec vitest run src/runtime/conversationContext/__tests__/longFormStress.test.ts src/utils/__tests__/useChatSendMessage.test.ts
```

### Task 12: 全量回归

命令：

```bash
pnpm run test:focused
pnpm exec vue-tsc -b
git diff --check
```

验收：

```text
Connection 现有测试通过
useChat 现有测试通过
TypeScript 通过
无空白错误
UI 行为不变
```

---

## 18. 验收标准

### 18.1 产品验收

```text
用户看不到新的记忆系统 UI
普通短对话无明显延迟增加
长对话不会因为上下文过长直接失败
多轮 1 万字输入 / 1 万字输出不会把全部历史塞进 Prompt
当前轮 1 万字输入会进入 Oversized User Input Path
长输出被截断时自动 continuation 并在 UI 显示为一条完整消息
第 25 轮追问第 3 轮关键决策/风格时，Engine 能召回 anchor memory 或 source chunks
切换 Skill 后旧 Skill 的记忆不会污染新 Skill
切换 Vault 后旧 Vault 的上下文不会作为当前 Vault 权威资料
清空上下文后旧 segment 不再优先进入 Prompt
旧会话首次继续使用时能创建 migration_baseline segment
```

### 18.2 工程验收

```text
所有对话上下文构建只经过 ConversationContextEngine
useChat.ts 不直接调用 Mem0
chatRuntimeConnection.ts 不承担记忆检索策略
Mem0 不作为事实源
conversation_memory_items 每条都有 provenance
索引失败可降级
索引可重建
索引写入幂等，重试不产生重复记忆
本地 provenance 与 Mem0 external index 可对账修复
每轮 prompt plan 可追踪
architecture guard 阻止绕过 Engine 的直接索引调用
Heavy 模式会生成 segment summary / session summary，避免 memory index 变成噪声源
Heavy 模式会生成 anchor memory，避免早期关键决策被普通 fact 稀释
重建索引按 segment/chunk 分批执行，有进度和恢复点
```

### 18.3 安全验收

```text
对话记忆 section 明确标记为证据，不作为系统指令
记忆内容中的 prompt injection 只当作被引用资料
Mem0 metadata 不包含 session token、API key、密码
写入索引前复用 sanitizeBrainInput 类脱敏策略
删除会话时同步删除本地 memory items 和外部 index
```

---

## 19. 最终文件关系图

```text
useChat.ts
  ↓
ConversationContextEngine
  ├── runtimeSegment.ts
  ├── loadStrategy.ts
  ├── promptBudget.ts
  ├── oversizedInput.ts
  ├── continuation.ts
  ├── storage.ts
  ├── migration.ts
  ├── backfill.ts
  ├── memoryIndex.ts
  ├── memoryCompaction.ts
  ├── jobWorker.ts
  ├── rebuildIndex.ts
  ├── reconcileIndex.ts
  ├── sqliteMaintenance.ts
  │   ├── mem0IndexDriver.ts
  │   └── localFallbackIndexDriver.ts
  └── provenance.ts
  ↓
chatRuntimeConnection.ts
  ├── SkillConnection
  ├── KnowledgeConnection
  ├── ConversationContextConnection
  ├── ToolConnection
  └── LlmConnection
  ↓
LLM
```

---

## 20. 执行顺序

严格按下面顺序执行：

```text
1. 类型、负载策略、预算策略、Oversized Input
2. SQLite 表、storage、长文 chunks、continuation/rebuild job 表
3. runtimeSegment
4. Migration & Backfill
5. memory index 端口、provenance、降级驱动、memory compaction
6. job worker、幂等、分段重建、对账、SQLite 维护
7. Engine 主体
8. RuntimeConnection 接入和架构守门测试
9. useChat 主流程和 Long Output Continuation
10. Mem0 driver
11. 长文压力与集成回归
12. 全量回归
```

不允许先接 Mem0 再补 Engine。
不允许先改 UI。
不允许绕过 Engine 在 `useChat.ts` 里直接拼记忆 prompt。

---

## 21. 结论

这份 SDD 的核心不是“给当前对话加一个记忆功能”，而是把对话系统的上下文生命周期整体升级为唯一 Engine。

最终状态：

```text
UI 不变
对话原文是真相
runtimeSegment 隔离污染
conversation_memory_index 是可重建派生索引
Mem0 是内部语义索引实现
Oversized Input 走 brief + source pointers + selective retrieval
Heavy + Oversized 强制保留原始 chunks 和 anchor memory
Long Output 走 continuation 状态机
Heavy 模式做记忆分层和阶段摘要
第 20-30 轮之后靠 segment/session summary + anchor memory 抗退化
每轮 Prompt 由 Engine 动态重建
失败可降级
索引可重建
过程可观测
```
