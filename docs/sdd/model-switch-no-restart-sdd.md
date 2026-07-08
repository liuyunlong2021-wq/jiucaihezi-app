# SDD: 对话内切换模型不丢上下文

> 状态: 待实施 | 日期: 2026-07-08 | 对端: OpenCode V2 Session 架构

---

## 一、问题

用户在同一个对话里切换模型 → OpenCode 进程被杀掉重启 → 会话上下文全部丢失。

## 二、根因

我们把「当前选中模型」塞进了 OpenCode 进程的启动配置里：

```
providerProjection.ts → projectNewApiForOpenCode() → return { model: defaultModel, ... }
                                                              ↑
                                          每次切模型这个值就变
                                          → config_signature 变
                                          → Rust 杀进程重启
```

OpenCode 原版：模型是 **session 级属性**，通过 `POST /api/session/:id/model` 运行时切换。进程配置只管 provider（API Key、端点），不管 model。

## 三、改动范围（3 文件，约 15 行）

### 文件 1：`src/opencodeClient/providerProjection.ts`

**改什么**：`projectNewApiForOpenCode` 的 `model` 字段，从「当前选中模型」改为「第一个可用模型」（固定值）。

**为什么**：`model` 字段只用于 OpenCode 启动时做 provider 校验，不应承载用户选择。用户选什么模型，由 session 级的 `updateOpenCodeSessionModel` 管理。

```diff
  return {
    enabled_providers: enabledProviders,
-   model: defaultModel,
+   // ponytail: model 不绑定用户选择。真正切模型走 updateOpenCodeSessionModel (POST /api/session/:id/model)
+   model: `${firstGroup.providerId}/${normalizeModelId(firstGroup.models[0]?.id || 'unknown')}`,
    provider: providerConfig,
  }
```

**影响**：切模型时 `config_signature` 不再变化 → Rust 不杀进程 → session 保留。

### 文件 2：`src/composables/useChat.ts` — 撤回 PID 检测

**改什么**：删掉上轮加的 `lastOpenCodePid` 变量和两处 PID 检测。

**为什么**：PID 检测是「进程必重启」前提下的临时补丁。现在进程不重启了，这个检测多余且有副作用（进程重启时误清 session）。

```diff
- // ponytail: 跟踪 OpenCode 进程 PID，进程重启（切模型/config变了）时清 stale session
- let lastOpenCodePid = 0
```

删掉两处：
```diff
- // ponytail: 进程重启（切模型/config变了）→ 清 stale session，避免 updateOpenCodeSessionModel 失败
- if (handle.pid && handle.pid !== lastOpenCodePid) {
-   setActiveOpenCodeSessionId('')
- }
- lastOpenCodePid = handle.pid || 0
```

### 文件 3：`src/composables/useChat.ts` — 确保切模型生效

**现状**：`sendMessage` 中已有 `updateOpenCodeSessionModel` 调用（L1207-1212），在 `activeOpenCodeSessionId` 存在且 model 变化时执行。

**无需改动**。进程不再重启后，这段逻辑自然生效：每次发送前检测 model 是否变了 → 是 → 调 `POST /api/session/:id/model` → 上下文保留。

验证点：确保这段代码在 `ensureOpenCodeServer` 之后、`createOpenCodeSession` 逻辑之前执行。

## 四、不改什么

| 不碰 | 原因 |
|------|------|
| Rust `opencode.rs` | `config_signature` 比较逻辑本身正确——只是之前 model 变化导致 signature 变化，现在 model 不变了 |
| `agentStore.setModel()` | 只是更新 localStorage + 响应式状态，正确 |
| `updateOpenCodeSessionModel` | 已实现，切模型 API 可用 |
| `createOpenCodeSession` 时的 `model` 参数 | 新建 session 仍传当前 model，正确 |

## 五、效果

```
改前：
  用户切模型 → config_signature 变 → 杀进程 → 新进程 → 新 session → ❌ 上下文丢失

改后：
  用户切模型 → config_signature 不变 → 进程不重启
  → 发消息时 updateOpenCodeSessionModel(session, newModel)
  → 同一 session，同一进程，新模型 → ✅ 上下文保留
```

## 六、回滚方案

还原 `providerProjection.ts` 的 `model` 字段 + 恢复 PID 检测 = 回到当前状态。
