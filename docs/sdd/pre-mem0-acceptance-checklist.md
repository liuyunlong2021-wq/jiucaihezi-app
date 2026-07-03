# Pre-Mem0 Acceptance Checklist

> 日期: 2026-05-31
> 目标: 在接入 Mem0 前，确认 Unified Conversation Context Engine 本地闭环稳定、可控、无上下文污染。
> 范围: 不改 UI，不接 Mem0，不暴露 Provider 选择。

---

## 1. 验收结论标准

只有以下条件全部满足，才进入 Mem0 接入：

- 所有对话上下文构建都经过 `ConversationContextEngine.build()`。
- 所有 assistant 输出后的派生记忆更新都经过 `ConversationContextEngine.afterAssistantMessage()`。
- Skill / Knowledge / Tool 选择变化后，不把旧配置下的上下文继续注入新轮 prompt。
- 编辑、删除、重新生成、清空上下文后，旧 chunks / memory / jobs 不再回流。
- 长文输入走 chunk + brief + 原文块回查，不把完整超长输入重复塞进 recent history。
- Heavy 模式能根据 memory provenance 回查原始 chunks。
- 长输出 continuation 使用结构化续写 prompt，并保存 continuation state。
- 自动测试通过后，再做真实 APP 操作验收。

---

## 2. 自动验收

### 2.1 架构守卫

检查项：

- `useChat.ts` 不直接访问 Mem0 或 memory index driver。
- `chatRuntimeConnection.ts` 不直接访问 Mem0 或 memory index driver。
- Chat UI 仍然暴露手动 Skill / Knowledge / Tool 控件。
- Superpower 不进入默认执行链。

命令：

```bash
pnpm run test:focused
```

相关测试：

- `src/runtime/connection/__tests__/architectureGuards.test.ts`
- `src/utils/__tests__/useChatSendMessage.test.ts`

### 2.2 Conversation Context Engine 核心行为

检查项：

- 首轮创建 runtime segment。
- Skill / Vault / critical tools 变化创建新 segment，并关闭旧 segment。
- oversized input 不再作为 recent raw message 重复注入。
- memory index 失败时降级，不阻断对话。
- memory hits 被预算裁剪，rejected sources 进入 trace。
- Heavy 模式触发 compaction。
- Heavy 模式按 `sourceMessageIds` 回查历史 chunks。

命令：

```bash
npx esbuild \
  src/runtime/conversationContext/__tests__/engine.test.ts \
  src/runtime/conversationContext/__tests__/longFormStress.test.ts \
  --bundle --platform=node --format=esm --alias:@=./src \
  --outbase=src --outdir=/private/tmp/jc-pre-mem0-context

node --test \
  /private/tmp/jc-pre-mem0-context/runtime/conversationContext/__tests__/engine.test.js \
  /private/tmp/jc-pre-mem0-context/runtime/conversationContext/__tests__/longFormStress.test.js
```

### 2.3 派生记忆写入与恢复

检查项：

- worker 持续处理启动后的 pending jobs。
- worker 不把 message ids 当作正文索引。
- 缺失 chunks 时进入 repair，而不是污染 memory。
- 写入 memory 前脱敏 token / API key / password。
- idempotency key 对 source message ids 去重排序。
- rebuild 成功后 dirty segment 标记为 done。

命令：

```bash
npx esbuild \
  src/runtime/conversationContext/__tests__/jobWorker.test.ts \
  src/runtime/conversationContext/__tests__/provenance.test.ts \
  src/runtime/conversationContext/__tests__/rebuildIndex.test.ts \
  --bundle --platform=node --format=esm --alias:@=./src \
  --outbase=src --outdir=/private/tmp/jc-pre-mem0-worker

node --test \
  /private/tmp/jc-pre-mem0-worker/runtime/conversationContext/__tests__/jobWorker.test.js \
  /private/tmp/jc-pre-mem0-worker/runtime/conversationContext/__tests__/provenance.test.js \
  /private/tmp/jc-pre-mem0-worker/runtime/conversationContext/__tests__/rebuildIndex.test.js
```

### 2.4 编辑/删除/清空后的失效

检查项：

- 删除 message 后，对应 chunks 被删除。
- 引用该 message 的 memory items 标记为 `delete_pending`。
- 引用该 message 的 memory jobs 标记为 `repair_required`。
- dirty segment 被创建，后续可 rebuild。
- 清空上下文/新对话不会保留当前 session 的旧 context index。

相关测试：

- `src/runtime/conversationContext/__tests__/storage.test.ts`

### 2.5 长文输入与长输出

检查项：

- chunking 保留代码块、Markdown 结构和精确 offset。
- oversized input 生成三层 brief。
- mandatory chunks 至少存在。
- chunks 之间存在真实 overlap。
- continuation prompt 包含结构摘要、已完成段落、tail excerpt。
- continuation state 记录 `runId`、`runtimeSegmentId`、`contextPlanId`。

相关测试：

- `src/runtime/conversationContext/__tests__/oversizedInput.test.ts`
- `src/runtime/conversationContext/__tests__/continuation.test.ts`

### 2.6 类型与格式

命令：

```bash
npx vue-tsc -b
git diff --check
```

---

## 3. APP 手动验收

以下操作必须在真实 APP 里执行，因为它们验证的是用户体验和实际输出污染。

### 3.1 Skill 选择/取消/更换

步骤：

1. 新建对话，不选 Skill，问一个普通问题。
2. 选择 Skill A，连续问 2 轮和 Skill A 强相关的问题。
3. 取消 Skill，问一个普通问题。
4. 更换为 Skill B，再问同类问题。

通过标准：

- 取消 Skill 后，回答不继续套用 Skill A 的身份、格式、规则。
- 切换到 Skill B 后，回答不引用 Skill A 的规则。
- 第二列会话显示不变，不出现额外“记忆系统”入口。

### 3.2 Knowledge 选择/取消/更换

步骤：

1. 选择 Vault A，问 Vault A 中明确存在的问题。
2. 取消知识库，继续问同一问题。
3. 更换 Vault B，问 Vault B 相关问题。

通过标准：

- 取消知识库后，不继续声称“根据知识库”。
- 更换 Vault 后，不混用 Vault A 和 Vault B 的内容。
- 若无知识库命中，回答应基于普通模型能力，而不是编造知识库证据。

### 3.3 Tool 开启/关闭

步骤：

1. 关闭工具，要求读取本地文件或执行浏览器任务。
2. 开启工具，执行同类任务。
3. 工具执行中途关闭工具，再继续对话。

通过标准：

- 关闭工具时，模型不能假装已经执行工具。
- 开启工具时，工具调用可见并受本地工具策略约束。
- 中途关闭工具后，后续 tool loop 停止，不继续调用已关闭工具。

### 3.4 长文输入

步骤：

1. 输入约 1 万字文本，要求总结、改写或续写。
2. 连续追问其中早期细节。
3. 切换 Skill 或 Vault 后再问同一细节。

通过标准：

- 不报上下文爆炸错误。
- 输出能引用关键原文内容。
- 切换配置后，不把旧配置下的工作方式污染到新配置。

### 3.5 长文输出与继续写

步骤：

1. 要求生成长文，触发输出长度上限。
2. 点击“继续写”。
3. 连续继续 2-3 次。

通过标准：

- 续写不大段重复。
- 结构和风格保持一致。
- 不重新规划一个完全不同的大纲。

### 3.6 编辑、删除、重新生成

步骤：

1. 发送一条包含明确设定的消息。
2. 让模型输出一轮。
3. 编辑这条用户消息，改掉关键设定。
4. 删除旧 assistant 回复并重新生成。
5. 再追问旧设定。

通过标准：

- 模型不再引用被编辑/删除前的旧设定。
- 重新生成基于新设定。
- 删除后的内容不会在后续对话中“复活”。

### 3.7 清空上下文 / 新对话

步骤：

1. 在一个会话中建立明确偏好或设定。
2. 清空上下文或新建对话。
3. 继续问与旧设定相关的问题。

通过标准：

- 模型不能把旧设定当成当前上下文。
- 若用户没有重新提供信息，回答应明确缺少上下文。

---

## 4. 不通过时的处理规则

- 如果出现 Skill / Vault / Tool 污染，优先检查 runtime segment 和 `buildApiMessages()` 输入。
- 如果出现删除内容回流，优先检查 `invalidateMessages()` 和 memory item `syncStatus`。
- 如果出现长文细节丢失，优先检查 chunk recall、mandatory chunks、historical chunks trace。
- 如果 continuation 重复或跑题，优先检查 continuation state 是否生成、是否使用 tail excerpt。
- 如果 APP 行为正常但测试缺失，补测试后再进入 Mem0。

---

## 5. Mem0 接入前最终门槛

进入 Mem0 的前提：

- 自动验收全绿。
- APP 手动验收无 P0 污染问题。
- 已确认 Mem0 只作为 `ConversationMemoryIndexDriver` 内部实现。
- 已确认本地 provenance 仍为解释权威。
- 已确认 Mem0 不改变 UI、不改变产品概念、不成为事实源。
