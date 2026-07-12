# 上下文规模与会话记忆管理 — SDD

> 版本: V1
> 日期: 2026-05-31
> 状态: 设计完成，待执行
> 目标: 让韭菜盒子 Studio 支持长期、连续、可追溯的对话记忆，同时不把产品做成通用 Agent Loop。

---

## 一、核心结论

用户提出的判断是对的：**每一个对话记录都应该被当成一个小知识库**。

但实现方式不能是“把整段历史无限塞回模型上下文”。正确形态是：

```text
当前对话 = 一个 Session Memory Vault

原始消息永久保存
↓
自动建立会话索引与会话 Wiki
↓
每次发送时按当前任务召回相关片段
↓
LLM 只读取本轮需要的证据
```

因此，“无限对话不失忆”不是指模型上下文无限，而是指：

- 原始对话永不因为上下文裁剪而丢失。
- 历史内容被编译为可检索、可引用、可追溯的会话记忆。
- 清上下文只清短期运行窗口，不删除会话记忆。
- 压缩只影响发送给模型的临时上下文，不影响原始记录。
- 更换 Skill / Knowledge / Tool 会隔离旧运行上下文，但不会删除旧会话记忆。

这能做到“产品层面的长期记忆”，但不能承诺“模型每次都自然记得每个字”。召回质量取决于索引、摘要、检索和预算策略，所以必须做成一套显式的上下文管理系统。

---

## 二、参考对比

### 2.1 传统 RAG

RAG 的核心是：用户提问时，从外部知识库检索相关文档片段，再把片段交给生成模型回答。它适合事实问答、文档问答和大资料库检索。

优点：

- 不需要把所有资料放进上下文。
- 原始资料可持续增长。
- 可用关键词、向量、混合检索扩展规模。

问题：

- 每次问答都像从零开始重新找资料。
- 检索到的是碎片，不是长期整理后的知识结构。
- 对“跨很多轮对话形成的偏好、决定、上下文关系”支持弱。
- 如果只做 chunk retrieval，用户会感觉模型“明明聊过但又忘了”。

### 2.2 LLM Wiki / Karpathy Pattern

LLM Wiki 的关键不是普通检索，而是**把资料提前编译成一个持久 Wiki**。它强调三层结构：

```text
raw sources  →  wiki  →  schema / rules
原始资料        编译知识     维护规则
```

核心操作是：

- Ingest: 把 raw 资料整理进 wiki。
- Query: 查询 wiki，而不是每次从 raw 重推理。
- Lint: 检查冲突、孤立页面、过期信息和缺口。

它比 RAG 更适合韭菜盒子 Studio，因为我们的产品本来就有 Wiki 结构知识库，而且用户希望长期积累。

### 2.3 nashsu/llm_wiki 的可借鉴点

`nashsu/llm_wiki` 把 LLM Wiki 做成桌面应用。值得吸收的点：

- raw / wiki / schema 三层。
- `index.md` 作为内容目录，`log.md` 作为操作时间线。
- 两步 ingest：先分析，再生成 wiki 页面。
- source traceability：生成页面必须能追溯 raw 来源。
- 可选向量检索，不把向量检索作为唯一核心。
- 查询时做预算分配，而不是全量塞上下文。
- 多会话持久化，每个会话有独立历史。

不建议直接照搬的点：

- 自动 deep research 和自动 ingest 外部结果暂缓。
- 图谱、Louvain、复杂 insight 系统暂缓。
- 不让 LLM 自动把会话产物写进用户正式知识库。
- 不引入本地 HTTP Agent API 作为核心形态。

---

## 三、韭菜盒子 Studio 的最终方案

### 3.1 五层上下文架构

```text
┌──────────────────────────────────────────┐
│ L1 Runtime Window                         │
│ 本轮真正发送给模型的有限上下文              │
└──────────────────────────────────────────┘
                 ↑ 召回
┌──────────────────────────────────────────┐
│ L2 Session Memory                         │
│ 当前对话的小知识库：摘要、决定、事实、待办   │
└──────────────────────────────────────────┘
                 ↑ 编译
┌──────────────────────────────────────────┐
│ L3 Session Raw                            │
│ 当前对话的完整原始消息、附件、工具结果       │
└──────────────────────────────────────────┘
                 +
┌──────────────────────────────────────────┐
│ L4 User-selected Knowledge Vault          │
│ 用户手动选择的正式知识库                   │
└──────────────────────────────────────────┘
                 +
┌──────────────────────────────────────────┐
│ L5 External Evidence                      │
│ 搜索结果、临时附件、工具返回结果             │
└──────────────────────────────────────────┘
```

关键设计：

- L3 是事实源，永不因压缩丢失。
- L2 是会话 Wiki，只服务当前对话。
- L4 是用户正式知识库，必须用户选择。
- L2 不能自动污染 L4。
- L1 永远有限，由预算器组装。

### 3.2 产品原则

```text
用户选择 Skill
用户选择 Knowledge Vault
用户选择 Tool
系统自动挂载当前会话记忆
LLM 按 Skill 规则读取本轮证据
```

当前会话记忆不是新 Agent，也不是开放式 Loop。它只是 KnowledgeConnection 里的一个内置 evidence source：

```text
KnowledgeConnection
  ├── Session Memory Evidence   # 当前对话自动挂载
  └── Selected Vault Evidence   # 用户选择的正式知识库
```

这样仍然符合 Skill + Knowledge + Tool + LLM：

- Skill 仍是官方 Skill。
- Knowledge 仍只提供证据。
- Tool 仍只执行动作。
- LLM 仍只按显式配置执行。

---

## 四、Session Memory Vault 设计

### 4.1 每个对话自动生成一个小知识库

每个 session 对应一个隐式目录：

```text
session-memory/<sessionId>/
  raw/
    messages.jsonl
    attachments/
    tool-results/
  wiki/
    index.md
    overview.md
    timeline.md
    facts.md
    decisions.md
    preferences.md
    open-threads.md
    artifacts.md
    log.md
  meta/
    runtime-segments.json
    source-map.json
    retrieval-stats.json
```

这些文件不一定第一版就落成真实磁盘目录。第一版可以存在 SQLite / IndexedDB 的 `documents` 或新表中，但逻辑上必须按这个协议设计。

### 4.2 raw 层

raw 层保存完整事实：

- 用户消息
- 助手回复
- 附件引用
- 工具调用与工具结果
- 每轮 Skill / Knowledge / Tool / Model 配置签名
- 时间戳
- sourceMessageIds

raw 是不可变事实源。压缩、摘要、检索都不得覆盖 raw。

### 4.3 wiki 层

wiki 层是会话的长期可召回记忆：

| 页面 | 内容 |
|------|------|
| `index.md` | 当前会话的记忆目录 |
| `overview.md` | 会话总体摘要 |
| `timeline.md` | 重要轮次时间线 |
| `facts.md` | 明确事实、约束、用户提供的信息 |
| `decisions.md` | 已确认的产品/代码/创作决策 |
| `preferences.md` | 用户在本对话表达的偏好 |
| `open-threads.md` | 未完成问题、待继续讨论点 |
| `artifacts.md` | 已生成文档、代码、文件、媒体任务 |
| `log.md` | 每次记忆更新记录 |

每条记忆必须带：

```yaml
sourceMessageIds:
  - msg_xxx
confidence: high | medium | low
runtimeSegmentId: seg_xxx
createdAt: 2026-05-31T...
```

### 4.4 runtime segment

为了避免“换 Skill 后旧风格污染新任务”，会话记忆必须按运行配置分段。

一次运行配置包括：

```ts
{
  skillId,
  skillContentHash,
  vaultId,
  toolsEnabled,
  modelId
}
```

当用户更换 Skill / Knowledge / Tool 时：

- L1 运行窗口插入上下文清除边界。
- L2 Session Memory 不删除旧记忆。
- 旧 segment 的记忆默认降权。
- 如果用户明确说“刚才”“前面那个方案”“之前的律师搭子怎么说”，才跨 segment 召回。

这样既不丢记忆，也不污染当前任务。

---

## 五、运行时上下文组装

### 5.1 请求组装顺序

```text
System:
  产品规则
  当前 Skill
  Tool 使用规则

User-side evidence:
  当前会话 Session Memory 命中
  用户选择的 Knowledge Vault 命中
  搜索结果
  附件内容

History:
  最近 N 条原始消息
  完整配对的 tool_call / tool_result

Current user input
```

Session Memory 和 Knowledge Vault 都必须作为 evidence，不得作为 system instruction。

### 5.2 默认预算

预算不能按“条数”粗暴处理，必须按模型窗口动态分配。

第一版建议：

| 区块 | 默认比例 | 说明 |
|------|----------|------|
| Product + Skill | 10% | 不可挤出 |
| Recent Messages | 25% | 最近 8-20 条，保留对话流畅度 |
| Session Memory | 20% | 当前会话小知识库召回 |
| Selected Vault | 30% | 用户选择的正式知识库 |
| Tool / Attachment | 10% | 工具结果、附件片段 |
| Safety Buffer | 5% | 防止上游 token 估算误差 |

动态规则：

- 无 Knowledge Vault 时，Selected Vault 预算让给 Session Memory。
- 无 Session Memory 命中时，预算让给 Recent Messages。
- 创作长文任务减少历史，增加 Skill + Session Memory。
- 代码/工具任务增加最近 tool result 预算。
- full-vault 模式只扩大 selected Vault，不吞掉 Session Memory。

### 5.3 上下文清除语义

必须把“清上下文”和“删除记忆”分开。

| 用户动作 | 影响 Runtime Window | 影响 Session Memory |
|----------|---------------------|---------------------|
| 清除上下文 | 清除 L1 | 不删除 L2/L3 |
| 更换 Skill | 清除 L1，开启新 segment | 旧 segment 降权 |
| 取消 Knowledge | 清除 L1，停用 L4 | L2 保留 |
| 关闭 Tool | 停止工具暴露和同轮执行 | 已完成工具结果作为历史事实保留 |
| 新建对话 | 新建空 Session Memory | 旧 session 保留在历史 |
| 删除对话 | 删除 L2/L3 | 不影响正式 Vault |

---

## 六、检索策略

### 6.1 第一版：不用向量也能跑

先做稳定、可解释的本地检索：

```text
query
→ 中文/英文 token 化
→ title/path/heading/body 关键词打分
→ runtimeSegment 加权
→ sourceMessage recency 加权
→ wiki 优先，raw fallback
→ 返回 top K evidence
```

优点：

- 本地优先。
- 不依赖 embedding 服务。
- 易测试、易解释。
- 和当前 `vaultRetrieval` 可复用。

### 6.2 第二版：混合检索

加入可选 embedding：

```text
BM25 / keyword
+ vector similarity
+ runtime segment weight
+ recency
+ source confidence
→ rerank
```

向量检索必须可关闭。关闭后产品仍能完整工作。

### 6.3 第三版：会话 Wiki Lint

长期对话需要健康检查：

- facts 是否互相冲突。
- decisions 是否被后续推翻。
- open-threads 是否已经解决。
- 低置信记忆是否需要回查 raw。
- 跨 segment 召回是否过多。

Lint 只给建议，不自动改正式知识库。

---

## 七、和正式 Knowledge Vault 的关系

### 7.1 两类知识不要混淆

```text
Session Memory Vault
  当前对话的小知识库
  自动生成、自动更新
  只服务当前会话

User Knowledge Vault
  用户选择的正式知识库
  用户手动添加/整理
  可跨会话复用
```

Session Memory 可以自动更新，因为它只是当前会话的“可检索历史”。
User Knowledge Vault 不能被自动污染，仍然必须用户确认。

### 7.2 从会话记忆沉淀到正式知识库

只允许这三种方式：

1. 用户点击“保存到知识库”。
2. 用户在会话结束时确认“沉淀本轮总结”。
3. 用户在知识库整理界面选择某段会话 raw 进行整理。

禁止：

- assistant 输出自动写入正式 wiki。
- 工具结果自动写入正式 wiki。
- low-confidence session memory 自动进入正式知识库。

---

## 八、能否做到“无限对话不失忆”

可以做到产品层面的“长期不失忆”，但要精确定义。

### 可以做到

- 对话原文永久保存。
- 任何旧消息都能通过 raw 找回。
- 重要事实、决定、偏好会进入会话 Wiki。
- 清上下文不等于删除记忆。
- 超长对话仍可通过 Session Memory 召回关键内容。
- 用户可以问“我们之前怎么决定的”，模型能引用会话记忆回答。

### 不能承诺

- 模型每轮天然知道全部历史逐字内容。
- 召回永远 100% 命中。
- 不做索引/编译也能无限记忆。
- 所有 assistant 输出都可靠到可以直接进入正式知识库。

### 最适合的用户表达

```text
本对话会自动形成一个会话记忆库。
清上下文只会清理本轮模型工作区，不会删除本对话记忆。
当你问到之前聊过的内容时，系统会从本对话记忆中召回相关证据。
```

---

## 九、数据库结构建议

### 9.1 新表

```sql
CREATE TABLE session_memory_pages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,
  content TEXT NOT NULL,
  source_message_ids TEXT NOT NULL,
  runtime_segment_id TEXT,
  confidence TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_session_memory_pages_session
ON session_memory_pages(session_id);

CREATE INDEX idx_session_memory_pages_type
ON session_memory_pages(session_id, page_type);

CREATE TABLE session_memory_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT,
  token_estimate INTEGER,
  runtime_segment_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_session_memory_chunks_session
ON session_memory_chunks(session_id);

CREATE TABLE session_runtime_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  skill_id TEXT,
  skill_hash TEXT,
  vault_id TEXT,
  tools_enabled INTEGER NOT NULL,
  model_id TEXT,
  started_message_id TEXT,
  ended_message_id TEXT,
  created_at INTEGER NOT NULL
);
```

### 9.2 第一版可简化

为了减少迁移成本，第一版也可以先复用 `documents`：

```ts
category: 'history'
metadata.kind:
  - 'session-memory-page'
  - 'session-memory-index'
  - 'session-memory-log'
```

但中长期建议新表，因为 session memory 会高频读写，和普通 documents 混在一起会越来越难维护。

---

## 十、代码落点建议

### 新增模块

| 文件 | 职责 |
|------|------|
| `src/runtime/sessionMemory/types.ts` | Session Memory 类型 |
| `src/runtime/sessionMemory/rawStore.ts` | 消息 chunk 与 runtime segment 写入 |
| `src/runtime/sessionMemory/compiler.ts` | 从 raw 更新 wiki 页面 |
| `src/runtime/sessionMemory/retrieval.ts` | 会话记忆检索 |
| `src/runtime/sessionMemory/context.ts` | 渲染 Session Memory evidence |
| `src/runtime/sessionMemory/lint.ts` | 健康检查 |
| `src/runtime/connection/sessionMemoryConnection.ts` | 接入 KnowledgeConnection |

### 修改模块

| 文件 | 改动 |
|------|------|
| `useChat.ts` | 发送前召回 Session Memory，完成后异步更新 Session Memory |
| `chatRuntimeConnection.ts` | 增加 session memory evidence 区块 |
| `contextAssembly.ts` | 从字符预算升级到 token 预算 |
| `sessionStore.ts` | 保存 runtime segment 信息 |
| `idb.ts` | 增加 session memory 表和迁移 |
| `ChatPanel.vue` | 增加“本对话记忆”状态提示 |

---

## 十一、执行路线图

### Phase 1：会话记忆协议与数据层

- 建立 Session Memory 类型。
- 为每条消息建立 chunk。
- 为每次 Skill / Knowledge / Tool / Model 变化建立 runtime segment。
- 清上下文只写边界，不删除 raw。
- 测试：删除/清空/换 Skill 后 raw 和 segment 行为正确。

### Phase 2：会话记忆检索

- 实现 keyword/BM25 风格检索。
- 查询当前 session 的 chunks 和 memory pages。
- 默认只召回当前 segment，高相关时跨 segment。
- 渲染为 `[Session Memory Evidence Start/End]`。
- 测试：长对话 100 轮后能召回第 10 轮事实。

### Phase 3：会话 Wiki 编译

- 每 4-6 轮或消息 token 超阈值后异步更新：
  - overview.md
  - facts.md
  - decisions.md
  - open-threads.md
  - log.md
- 每条写入必须带 sourceMessageIds。
- 测试：编译内容只来自 raw 消息，不凭空写入。

### Phase 4：上下文预算器

- 用模型窗口计算本轮预算。
- Product/Skill 不可挤出。
- Session Memory、Selected Vault、Recent Messages 动态分配。
- 超预算时优先裁剪 raw 历史，不裁剪 Skill。
- 测试：构造超长历史，请求体不超预算且保留当前输入。

### Phase 5：正式知识库沉淀

- 在 assistant 消息上增加“保存到知识库”。
- 在会话结束处提供“沉淀本轮总结”。
- 写入正式 Vault 前展示候选 diff。
- 测试：未确认时不写正式 Vault。

### Phase 6：可选向量检索

- 增加 embedding 配置。
- session_memory_chunks 可选 embedding。
- hybrid retrieval 合并 keyword + vector。
- 向量失败时自动降级 keyword。

---

## 十二、验收标准

- [ ] 清上下文后，问“刚才我们决定了什么”，能从 Session Memory 召回。
- [ ] 更换 Skill 后，旧 Skill 输出不会默认污染新任务。
- [ ] 用户明确问“前面那个 Skill 怎么说”时，可以跨 segment 召回。
- [ ] 100 轮对话后，请求体仍受预算控制。
- [ ] 原始消息没有因压缩而丢失。
- [ ] 会话 Wiki 每条记忆都有 sourceMessageIds。
- [ ] Session Memory 不自动写入正式 Knowledge Vault。
- [ ] 关闭 Knowledge Vault 后，Session Memory 仍可服务当前对话。
- [ ] 删除会话会删除对应 Session Memory。
- [ ] focused tests 和 `vue-tsc` 通过。

---

## 十三、最终产品形态

用户看到的是：

```text
Skill：剧本策划搭子
知识库：短剧项目库
工具：关闭
模型：Claude / GPT
本对话记忆：开启
```

用户不需要理解 token、压缩、RAG、向量库。

系统内部是：

```text
当前输入
→ SkillConnection
→ KnowledgeConnection
    → Session Memory Evidence
    → Selected Vault Evidence
→ ToolConnection
→ Context Budgeter
→ LLM
→ 输出
→ Session Memory 异步更新
```

这就是韭菜盒子 Studio 最适配的上下文规模管理：

**不追求无限上下文，而是建立无限可追溯记忆。**
