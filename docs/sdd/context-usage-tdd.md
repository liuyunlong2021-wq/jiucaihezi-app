# TDD: 上下文用量 100% 搬运官方 OpenCode

> **分支**: `xitongyouhua`
> **创建日期**: 2026-06-30
> **原则**: 逐文件 1:1 搬运官方实现，不做创造性修改

---

## 现状与目标对比

### 已有组件（保留）

| 文件 | 状态 |
|------|:---:|
| `src/components/chat/SessionContextUsage.vue` | ✅ 已对齐官方 `session-context-usage.tsx`，不动 |
| `src/components/chat/AgentStatusBar.vue` | ✅ Token 水位计 + 点击打开面板，不动 |
| `src/opencodeClient/catalog.ts` — `OpenCodeContextUsage` 接口 | 🟡 需扩展字段 |
| `src/opencodeClient/catalog.ts` — `computeOpenCodeContextUsage()` | 🔴 语义不同，需重写 |
| `src/opencodeClient/catalog.ts` — `getOpenCodeSessionContextUsage()` | 🔴 数据来源不同，需适配 |

### 需要重写的组件

| 我们的文件 | 官方对应 | 差距 |
|-----------|---------|:---:|
| `src/components/chat/ContextUsagePanel.vue` | `session-context-tab.tsx` | 🔴 需 100% 重写 |

### 需要新建的文件

| 文件 | 官方对应 | 用途 |
|------|---------|------|
| `src/opencodeClient/contextMetrics.ts` | `session-context-metrics.ts` | 核心数据层：`getSessionContextMetrics()` |
| `src/opencodeClient/contextBreakdown.ts` | `session-context-breakdown.ts` | Input token 按角色拆解 |
| `src/opencodeClient/contextFormat.ts` | `session-context-format.ts` | `Intl.NumberFormat` + `luxon` 格式化器 |
| `src/opencodeClient/__tests__/contextMetrics.test.ts` | `session-context-metrics.test.ts` | 数据层测试 |
| `src/opencodeClient/__tests__/contextBreakdown.test.ts` | `session-context-breakdown.test.ts` | 拆解测试 |

---

## Phase 1: 核心数据层 — `contextMetrics.ts`

### 官方语义 vs 我们当前语义

```
官方 getSessionContextMetrics(messages, providers):
  遍历 messages 从后往前 → 找到第一个有 token 的 assistant message
  → 返回该 message 的 token 快照（不是累积！）
  → context.usage = limit ? Math.round((total / limit) * 100) : null

我们 computeOpenCodeContextUsage(sessionID, contextMessages, models):
  遍历所有 assistant messages → 累加所有 token
  → 返回累积总量（跨所有轮）
  → usage = limit ? total / limit : undefined
```

**关键差异**：官方是「最后一轮的快照」，我们是「所有轮的累积」。这导致 usage% 完全不同。

### TDD-1.1: `getSessionContextMetrics()`

**输入**:
```ts
messages: ChatMessage[]  // 从 useChat().messages.value 取
providers: ModelEntry[]  // 从 agentStore.availableModels 取
```

**输出**:
```ts
{
  totalCost: number
  context?: {
    message: ChatMessage          // 最后一条有 token 的 assistant
    providerID: string
    modelID: string
    providerLabel: string
    modelLabel: string
    limit?: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
    usage: number | null         // 0-100 整数，无 limit 时 null
  }
}
```

**测试用例** (搬运官方 `session-context-metrics.test.ts`):

```
test 1: 最后一条有 token 的 assistant 决定全部指标
  messages: [user("u1"), assistant("a1", tokens=0, cost=0.5), assistant("a2", tokens=500, cost=1.25)]
  providers: [{id:"openai", name:"OpenAI", models:{"gpt-4.1":{name:"GPT-4.1", limit:1000}}}]
  expect: context.message.id = "a2", context.total = 500, context.usage = 50
  expect: totalCost = 1.75

test 2: 模型元数据缺失时的 fallback
  messages: [assistant("a1", tokens=50, cost=0.1, providerID="p-1", modelID="m-1")]
  providers: [{id:"p-1", models:{}}]
  expect: providerLabel = "p-1", modelLabel = "m-1", limit = undefined, usage = null

test 3: message 数组原地修改后重新计算
  messages[0]: assistant("a1", tokens=50, cost=0.25)
  metrics1: context.id = "a1"
  push assistant("a2", tokens=120, cost=0.75)
  metrics2: context.id = "a2", totalCost = 1

test 4: 空输入返回 empty metrics
  getSessionContextMetrics(undefined, undefined)
  expect: totalCost = 0, context = undefined

test 5: 最后一个 assistant 没有 token → 找上一个
  messages: [assistant("a1", tokens=100, cost=0.5), assistant("a2", tokens=0, cost=0)]
  expect: context.message.id = "a1"
```

---

## Phase 2: Input Token 拆解 — `contextBreakdown.ts`

### 官方算法

```
estimateSessionContextBreakdown({ messages, parts, input, systemPrompt })

1. 遍历所有 messages + parts:
   - user message 的 parts: 统计 chars (text/file/agent)
   - assistant message 的 parts:
     - text/reasoning → 计入 assistant
     - tool → 计入 tool (input keys × 16 + raw/output/error)
2. systemPrompt length → 计入 system
3. chars → tokens: Math.ceil(chars / 4)
4. 五个桶: system / user / assistant / tool / other
5. 如果估算总量 ≤ input: other = input - 估算总量
6. 如果估算总量 > input: 按比例缩放
7. 输出: [{key, tokens, width(%), percent(%)}]
```

### TDD-2.1: `estimateSessionContextBreakdown()`

**我们的数据适配**:
- `messages` → 从 `useChat().messages.value` 取，需要 `openCodeParts` 或原始 parts
- `parts` → 我们的 `ChatMessage` 没有 `Part[]` 结构。需要从 `openCodeParts` 字段读取或适配

**测试用例** (搬运官方):

```
test 1: 估算 tokens 并将余量归入 other
  messages: [user("u1"), assistant("a1")]
  parts: u1=[text("hello world")], a1=[text("assistant response")]
  input: 20, systemPrompt: "system prompt"
  expect: system=4, user=3, assistant=5, other=8

test 2: 估算超 input 时按比例缩放
  messages: [user("u1"), assistant("a1")]
  parts: u1=[text("x"×400)], a1=[text("y"×400)]
  input: 10, systemPrompt: "z"×200
  expect: total ≤ 10, all width ≤ 100
```

---

## Phase 3: 格式化器 — `contextFormat.ts`

### TDD-3.1: `createSessionContextFormatter(locale)`

```
官方: Intl.NumberFormat + luxon DateTime
我们: 搬运相同逻辑，luxon → dayjs (项目已有)

返回:
  number(value) → "1,234" 或 "—"
  percent(value) → "50%" 或 "—"
  time(value) → locale 感知的时间字符串
```

---

## Phase 4: UI 面板 — 重写 `ContextUsagePanel.vue`

### TDD-4.1: Stats Grid (16 项，对齐官方)

```
官方 stats 数组:
  session / messages / provider / model / limit
  totalTokens / usage / inputTokens / outputTokens
  reasoningTokens / cacheTokens (read/write)
  userMessages / assistantMessages / totalCost
  sessionCreated / lastActivity

我们当前只有 3 项: messages / totalTokens / cost
```

### TDD-4.2: Breakdown 堆叠条

```
当前: 按 token TYPE 分段（output/reasoning/input/cache）← 错误
目标: 按 input token ROLE 分段（system/user/assistant/tool/other）
颜色: 对齐官方 BREAKDOWN_COLOR
```

### TDD-4.3: System Prompt 展示

```
当前: 无
目标: Markdown 渲染 system prompt（从 messages 最后一条 user 的 system 字段取）
```

### TDD-4.4: 原始消息列表

```
当前: 简单列表 (role/id/time)
目标: Accordion 展开 → JSON 内容（带 File 查看器等价物）
最低可接受: Accordion UI + 格式化 JSON 文本
```

### TDD-4.5: 滚动位置保存

```
官方: ScrollView + view().scroll("context") + requestAnimationFrame
我们: 添加相同的 scroll 保存/恢复逻辑
```

---

## Phase 5: 数据源切换

### TDD-5.1: `getOpenCodeSessionContextUsage` → 改用本地 messages

```
当前: 调 v2.session.context() API → computeOpenCodeContextUsage
目标: 直接用 useChat().messages + agentStore.availableModels → 调新的 getSessionContextMetrics

保留 v2.session.context() 作为 fallback（当本地 messages 不可用时）
```

### TDD-5.2: `computeOpenCodeContextUsage` → 新增 `getSessionContextMetrics`

```
不删除 computeOpenCodeContextUsage（被其他代码引用），
新增 getSessionContextMetrics 作为 ContextUsagePanel 的主数据源
```

---

## Phase 6: WorkspaceLayout 适配

### TDD-6.1: 传递正确的 props

```
当前 props:
  :usage="openCodeContextUsage"
  :messages="contextMessagesForPanel"

目标 props:
  :usage="contextMetrics"        // 来自 getSessionContextMetrics 结果
  :messages="allMessages"        // 完整的 ChatMessage[] (含 parts)
  :parts="allParts"              // 用于 breakdown 计算
  :systemPrompt="systemPrompt"   // 当前 system prompt
```

---

## ⚠️ 审计结论（2026-06-30 最终审计）

### 发现的 TDD 问题

| # | 问题 | 严重度 | 修正方案 |
|---|------|:---:|------|
| 1 | **Phase 5 数据源切换不可行**：我们的 `ChatMessage` 没有 `tokens` 字段（input/output/reasoning/cache），token 数据只存在于 `v2.session.context()` API 返回的消息中。不能直接从 `useChat().messages` 取 token 数据 | 🔴 阻塞 | **取消 Phase 5**。保持用 `v2.session.context()` 作为数据源，只改 computation 逻辑（从累积→最后一条） |
| 2 | **Phase 2 breakdown 需要 `Part[]`**：我们的 `ChatMessage` 没有 Part 结构。只有 `openCodeParts`（渲染用，不可靠）和 `v2.session.context()` 返回的原始消息 | 🔴 阻塞 | breakdown 函数改为接收 `v2.session.context()` 返回的原始 messages + parts，不是我们的 ChatMessage |
| 3 | **`computeOpenCodeContextUsage` 被多处引用**：`syncAfterCommand`、compaction wait 循环都依赖它。不能删除 | 🟡 需注意 | 新增 `getSessionContextMetrics`，保留 `computeOpenCodeContextUsage` |
| 4 | **Provider 结构不同**：官方用 `Provider[{models: Record<string, Model>}]`，我们用 `ModelEntry[]`（扁平） | 🟡 需适配 | 在 `getSessionContextMetrics` 内部从 `ModelEntry[]` 重建 lookup map |
| 5 | **Accordion File 组件**：官方用 SolidJS `<File>` 组件渲染原始消息 JSON。我们没有等价物 | 🟢 可降级 | 用 `<pre>` + `JSON.stringify` 替代即可 |

### 修正后的实施顺序

```
Phase 1: contextMetrics.ts    — 新建，用 v2.session.context() 数据源 + 官方 last-assistant 语义
Phase 2: contextFormat.ts     — 新建，搬运官方 formatter
Phase 3: contextBreakdown.ts  — 新建，从 v2 session.context 消息估算（不用 ChatMessage）
Phase 4: 重写 ContextUsagePanel.vue — 16 stats + breakdown bar + system prompt + raw messages
Phase 5: WorkspaceLayout 适配 — 传新 props
```

Phase 5（原来的数据源切换）已取消。

---

## 实施顺序

```
Phase 1 (数据层) → Phase 3 (格式化) → Phase 2 (拆解)
  ↓
Phase 4 (UI 重写)
  ↓
Phase 5 (WorkspaceLayout 适配)
```

每个 Phase 完成后跑：
```bash
pnpm exec vue-tsc -b
pnpm run test:focused:run
```

---

## 不变内容

| 文件 | 原因 |
|------|------|
| `SessionContextUsage.vue` | 已对齐官方，不动 |
| `AgentStatusBar.vue` | Token 水位计 + 点击入口，不动 |
| `ChatPanel.vue` 中的 `emitEvent('switch-panel', 'context')` | 事件链路不动 |
| `WorkspaceLayout.vue` 中的 `rightPanel === 'context'` 分支 | 条件渲染不动 |

---

## 风险点

1. **我们的 ChatMessage 没有 Part[] 结构** — breakdown 需要 `parts: Record<string, Part[]>`。需要从 `openCodeParts` 字段重建或使用简化估算。
2. **System prompt 来源** — 官方从 `visibleUserMessages` + `findLast` 找 `msg.system`。我们的 ChatMessage 是否有 `system` 字段需确认。
3. **provider/model 名称** — 官方从 `providers` 数组查 `provider.name` + `model.name`。我们的 `ModelEntry` 有 `label` 字段但可能缺少 provider name。
