# Conversation Runtime + ContextBoundary Final SDD

> 日期: 2026-06-03  
> 状态: P0 已实施并通过 focused 验证  
> 目标: 固化韭菜盒子 Studio 对话上下文最终主链路，并把“清除上下文”实现为不删除历史的 `ContextBoundary`。  
> 产品约束: UI 不变；不新增聊天气泡按钮；不新增“作品文档”；知识库继续使用现有 `CLAUDE.md + raw/ + wiki/ + _reports/ + _templates/`。

---

## 1. 最终结论

韭菜盒子 Studio 的对话架构定死为：

```text
ConversationRuntime
  -> ContextBuilder
  -> PromptAssembler
  -> Executor
  -> RunTrace
```

所有 Skill、Knowledge、Tool、MCP、画布、编辑器、创作面板都只能作为连接器进入这条主链路。不得再新增第二套 Agent Loop、第二套 Memory、第二套 Prompt 组装路径。

`清除上下文` 的唯一语义：

```text
设置 ContextBoundary
不删除会话历史
不删除知识库 raw/wiki
不自动写入知识库
后续模型请求默认跳过边界之前的聊天消息
继续使用用户当前绑定的 Skill / Vault / Tool / MCP / Model
```

---

## 2. 当前代码事实

### 2.1 已有能力

当前代码已经存在以下基础：

| 文件 | 现状 |
|------|------|
| `src/composables/useChat.ts` | 已有 `ConversationContextEngine`、`filterAfterContextClear()`、`buildApiMessages()`、`clearMessages()` |
| `src/components/chat/ChatPanel.vue` | 切换历史会话时通过 `sessionStore.loadSessionMessages()` 后调用 `loadMessages()` |
| `src/stores/sessionStore.ts` | 会话元数据和消息持久化到 SQLite/IndexedDB 抽象层 |
| `src/utils/idb.ts` | 已有 conversation context 相关表：run snapshots、memory items、dirty segments 等 |
| `src/stores/vaultStore.ts` | 知识库创建时已有 `CLAUDE.md`、`raw/`、`wiki/`、`_reports/`、`_templates/` |
| `src/components/vault/VaultWizard.vue` | 已支持上传资料到 `raw/` 并整理为 Wiki |
| `src/components/brain/BrainPanel.vue` | 已支持用户手动添加文本/文件资料到知识库 |

### 2.2 当前风险

`useChat.clearMessages()` 当前会把 `messages.value` 替换为单条 `[上下文已清除]` system 消息。这个行为适合“新对话前清空内存态”，但不适合作为正式的“清除上下文”语义。

风险：

```text
1. 如果清除后触发保存，旧消息可能从当前会话记录中消失。
2. ContextBoundary 只依赖 system marker，没有稳定会话元数据。
3. 打开历史会话后，边界、Skill、Vault 和上下文索引恢复顺序不够明确。
4. RunTrace 未把“本轮跳过了边界前历史”作为可诊断事实固定下来。
```

---

## 3. 产品行为定版

### 3.1 清除上下文

用户执行“清除上下文”后：

```text
聊天历史仍然可见
历史会话仍然可打开
边界前消息不再默认进入模型请求
边界后新消息继续进入模型请求
已绑定知识库继续参与召回
已选择 Skill / Tool / MCP / Model 不被清空
```

内部表现：

```text
在当前会话设置 contextBoundaryMessageId/contextClearedAt
在消息流中保留一个 system marker 用于可读性和兼容旧过滤逻辑
ContextBuilder/buildApiMessages 只使用边界后的 recent messages
ConversationContextEngine 不把边界前 message 当成本轮 recent conversation
RunTrace 记录 boundary 与 omitted message count
```

### 3.2 保存到知识库

本 SDD 不新增保存入口。

知识库沉淀继续走现有路径：

```text
BrainPanel 手动添加资料
VaultWizard 添加现有知识库内容
FileTree/Vault 现有知识库整理入口
```

AI 不得自动把聊天输出写入正式 Vault。用户认为正确的内容，需要通过现有知识库入口主动添加或整理。

### 3.3 不做的事

本次明确不做：

```text
不新增聊天气泡按钮
不新增“存为章节”按钮
不新增“作品文档”概念
不改知识库 UI
不把会话记忆自动写进正式知识库
不把清除上下文做成删除历史
不引入独立 Agent / Workflow 模块
```

---

## 4. 目标数据模型

### 4.1 Session 元数据扩展

在会话元数据中增加上下文边界字段：

```ts
interface Session {
  id: string
  title: string
  agentId: string
  vaultId: string | null
  contextPolicy: 'vault-only' | 'no-memory'
  contextBoundaryMessageId?: string
  contextClearedAt?: number
  createdAt: number
  updatedAt: number
  messageCount: number
}
```

持久化位置：

```text
conversations.contextBoundaryMessageId
conversations.contextClearedAt
```

若暂不增加 SQLite 列，则可先作为 conversation record JSON 字段随 `idb.setRecord('conversations', convRecord)` 进入现有兼容层；但读取时必须显式映射到 `Session`。

### 4.2 ContextBoundary system marker

消息流中保留兼容 marker：

```ts
{
  id: 'system_xxx',
  role: 'system',
  content: '[上下文已清除]',
  timestamp: now,
}
```

规则：

```text
marker 只用于 UI 可读和老过滤兼容
真正业务判断优先使用 contextBoundaryMessageId
marker 不进入最终 LLM messages
```

---

## 5. 执行方案

### Task 1: 固化 Session 边界元数据

**修改文件：**

- `src/stores/sessionStore.ts`

**改动：**

1. 给 `Session` 增加 `contextBoundaryMessageId?: string` 与 `contextClearedAt?: number`。
2. `saveSession()` 保存 conversation record 时保留旧记录中的 boundary 字段。
3. `loadAllSessions()` 从 conversation record 映射 boundary 字段。
4. 新增 store 方法：

```ts
async function setContextBoundary(sessionId: string, boundaryMessageId: string, clearedAt: number) {
  const record = await idb.getRecord('conversations', sessionId) as any
  if (!record) return
  await idb.setRecord('conversations', {
    ...record,
    contextBoundaryMessageId: boundaryMessageId,
    contextClearedAt: clearedAt,
    updatedAt: Date.now(),
  })
  const idx = sessions.value.findIndex(s => s.id === sessionId)
  if (idx >= 0) {
    sessions.value[idx] = {
      ...sessions.value[idx],
      contextBoundaryMessageId: boundaryMessageId,
      contextClearedAt: clearedAt,
      updatedAt: Date.now(),
    }
  }
}
```

**验收：**

```text
保存会话后重新打开，Session 元数据仍包含 contextBoundaryMessageId/contextClearedAt。
旧会话没有该字段时正常加载。
```

### Task 2: 拆分“新对话清空”和“清除上下文”

**修改文件：**

- `src/composables/useChat.ts`
- `src/components/chat/ChatPanel.vue`

**改动：**

1. 保留 `clearMessages()` 用于新对话/无 active session 的内存清空。
2. 新增 `clearContextBoundary()`，行为是追加 marker，不替换旧消息：

```ts
async function clearContextBoundary() {
  cancelCurrentRun()
  lastRuntimeContextSignature = null
  const marker: ChatMessage = {
    id: createMessageId('system'),
    role: 'system',
    content: '[上下文已清除]',
    timestamp: Date.now(),
  }
  messages.value.push(marker)
  setPhase('idle')
  toolHistory.value = []
  currentToolProgress.value = null
  return marker
}
```

3. 如果现有 UI 已有“清除上下文”入口，改为调用 `clearContextBoundary()` 并立即 `persistCurrentSession()`。
4. 如果当前没有独立入口，本 SDD 不新增 UI；只完成运行时能力和测试。

**验收：**

```text
调用清除上下文后，旧消息仍在 messages.value 中。
下一轮 buildApiMessages 不包含 marker 前的旧消息。
新对话 startNew 仍能清空当前临时消息态。
```

### Task 3: 让 Prompt 构建优先识别边界

**修改文件：**

- `src/composables/useChat.ts`

**改动：**

1. 抽出统一工具函数：

```ts
function isContextBoundaryMessage(message: ChatMessage): boolean {
  return message.role === 'system' && String(message.content || '').trim() === '[上下文已清除]'
}

function filterAfterContextBoundary(msgs: ChatMessage[]): ChatMessage[] {
  const idx = msgs.findLastIndex(isContextBoundaryMessage)
  if (idx < 0) return msgs
  return msgs.slice(idx + 1)
}
```

2. 用 `filterAfterContextBoundary()` 替换现有 `filterAfterContextClear()`。
3. `buildApiMessages()` 在没有 authoritative `conversationContext.recentMessages` 时必须走该过滤。
4. 如果 `conversationContext.recentMessages` 由 Engine 提供，Engine 输入也必须接收边界后的消息列表，避免 Engine 再把旧历史召回为 recent conversation。

**验收：**

```text
边界前 user/assistant 不进入 API messages。
边界后 user/assistant 正常进入 API messages。
system marker 不进入 API messages。
```

### Task 4: 历史会话恢复顺序校准

**修改文件：**

- `src/components/chat/ChatPanel.vue`
- `src/stores/sessionStore.ts`

**改动：**

1. 保持已加入的 `sessionLoadPromise` 思路：切换会话前必须先完成会话列表加载。
2. 切换会话时恢复顺序固定为：

```text
loadAllSessions()
loadSessionMessages(sessionId)
resolve session.agentId -> Skill
resolve session.vaultId -> active Vault
loadMessages(history, baseline)
恢复 contextBoundary metadata
允许 sendMessage
```

3. 发送前增加保护：如果 `sessionStore.activeSessionId` 已有值但历史消息尚未加载完成，不构建 LLM 请求。

**验收：**

```text
打开历史会话后马上发送，新请求能读取该会话历史和边界。
不会出现 UI 已显示历史，但模型请求只看到新消息的情况。
```

### Task 5: RunTrace 增加边界诊断

**修改文件：**

- `src/composables/useChat.ts`
- 如已有独立 trace 类型，则同步修改对应类型文件。

**改动：**

每轮 trace 至少记录：

```ts
{
  contextBoundaryMessageId,
  contextClearedAt,
  omittedBeforeBoundaryCount,
  recentMessageCount,
  vaultEvidenceCount,
  selectedSkillIds,
  enabledToolNames,
}
```

**验收：**

```text
清除上下文后发送一轮，trace 能看到 omittedBeforeBoundaryCount > 0。
绑定知识库后发送一轮，trace 能看到 vaultEvidenceCount。
```

### Task 6: 测试

**修改/新增测试：**

- `src/utils/__tests__/useChatSendMessage.test.ts`
- 如已有 session store 测试，补充到对应文件；否则在 focused test harness 中新增 sessionStore 边界测试。

**测试用例：**

1. `clearContextBoundary keeps history but excludes older messages from api payload`

```text
Given: messages = user A, assistant B
When: clearContextBoundary(), then user C sends
Expect: messages still contains A/B/marker/C
Expect: API payload does not contain A/B/marker
Expect: API payload contains C
```

2. `session boundary metadata survives save and load`

```text
Given: session with contextBoundaryMessageId
When: saveSession(), loadAllSessions()
Expect: loaded session keeps contextBoundaryMessageId/contextClearedAt
```

3. `vault remains active after context boundary`

```text
Given: activeVaultId exists
When: clearContextBoundary(), then sendMessage()
Expect: vault recall path is still called
Expect: boundary does not clear vault selection
```

4. `history session cannot send before load completes`

```text
Given: switchSession(newId)
When: sendMessage is triggered before loadSessionMessages resolves
Expect: request is delayed or rejected without building empty-history API payload
```

**验证命令：**

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/utils/__tests__/useChatSendMessage.test.js
```

---

## 6. 风险与规避

| 风险 | 规避 |
|------|------|
| 清除上下文误删历史 | 追加 marker + session metadata，不替换 messages |
| 旧会话无 boundary 字段导致加载失败 | 字段全部 optional，旧记录默认无边界 |
| 知识库被误当成自动记忆 | 文档和代码中继续禁止 AI 自动写 Vault |
| UI 被顺手改动 | 本次不改模板结构，不新增气泡按钮 |
| Engine 与 buildApiMessages 两边过滤不一致 | 统一使用 `filterAfterContextBoundary()` 或同名纯函数 |
| 打开历史后立刻发送仍丢上下文 | 发送前检查 session load ready 状态 |

---

## 7. 验收标准

P0 完成后必须满足：

```text
1. CLAUDE.md 明确写入最终架构和 ContextBoundary 铁律。
2. 清除上下文不会删除旧聊天历史。
3. 清除上下文后，模型请求不包含边界前聊天消息。
4. 清除上下文后，绑定知识库继续可召回 raw/wiki 内容。
5. 打开历史会话后，下一轮发送能稳定继承历史、Skill、Vault 和边界。
6. 不新增聊天气泡按钮，不新增作品文档概念。
7. TypeScript 与 focused tests 通过。
```

---

## 8. 执行顺序

推荐顺序：

```text
1. 先补 sessionStore boundary 元数据
2. 再拆 clearMessages / clearContextBoundary
3. 再统一 buildApiMessages 边界过滤
4. 再修历史会话恢复保护
5. 最后补 RunTrace 和测试
```

本方案是对现有 `ConversationContextEngine` 的语义校准，不是推翻重写。执行时必须保持 UI 不变，并优先保护用户历史数据不被清除。

---

## 9. P0 实施记录（2026-06-03）

已完成：

```text
1. useChat 新增 clearContextBoundary()：追加 marker，不替换旧消息。
2. useChat 统一使用 filterAfterContextBoundary()，边界前消息不进入 Engine/API payload。
3. sessionStore 增加 contextBoundaryMessageId/contextClearedAt，并通过 setContextBoundary() 持久化。
4. ChatPanel 增加内部 clearCurrentContextBoundary() 流程，不改 UI 模板。
5. ChatPanel 增加 sessionHydrating 保护，历史会话加载完成前不允许发送。
6. RunTrace 增加 contextBoundary 诊断字段，记录 marker 与 omittedBeforeBoundaryCount。
7. useChatSendMessage 测试覆盖：清除上下文保留历史、API 不带旧消息、session boundary 可保存恢复。
```

已验证：

```bash
pnpm exec vue-tsc -b
pnpm run test:focused
```
