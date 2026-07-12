# APPyouhua — 对齐官方 OpenCode 的三项修复 SDD

> **分支**: `APPyouhua`
> **原则**: 跟官方 OpenCode 一模一样。官方怎么做的我们就怎么做，不发明新机制。
> **官方参考**: [anomalyco/opencode](https://github.com/anomalyco/opencode) dev 分支

---

## 〇、官方对齐基准

| 模块 | 官方做法 | 官方代码位置 |
|------|---------|------------|
| 模型列表 | 来自已配置的 provider，无内置硬编码默认 | `packages/server/src/groups/model.ts` `/api/model` |
| 项目目录 | CLI 始终在某个目录运行；App 端必须有 directory | `packages/opencode/src/cli/cmd/run/` |
| 权限 | `always` = session-scoped 内存（重启失效）；App 端 binary autoAccept toggle | `packages/opencode/src/permission/index.ts`, `packages/app/src/context/permission.tsx` |
| 完成检测 | `session.idle` + `session.status{idle}`；Effect 结构化并发自动中断卡死 fiber | `packages/opencode/src/session/status.ts`, `packages/opencode/src/effect/runner.ts` |
| 中断 | `cancel()` → `cancelBackgroundJobs()` 递归取消子任务 | `packages/opencode/src/session/run-state.ts:80` |

---

## 一、问题与修复

### P0：消除「无项目目录」状态（新增 — P2 权限弹窗的根因）

**现象**：用户不选文件夹，文/武模式下疯狂弹权限确认。

**根因**：
```
用户不选项目目录
  → OpenCode server 落在 fallback 空目录 ~/.jiucaihezi/opencode-runtime/workspace/
  → LLM 调用 read/write/bash 操作任何真实文件
  → OpenCode 判断：不在 workspace 内 → external_directory
  → permission.asked → 弹窗
  → 用户在空 workspace 中，所有文件都是"外部" → 每条消息都弹
```

**官方怎么做**：OpenCode CLI 用户天然在项目目录中运行（`cd ~/project && opencode`）。App 端必须有 directory。**不存在「无项目目录」状态。**

**修复**：文/武模式下**必须有项目目录**。

```
文/武模式启动时：
  ├─ 已选项目目录 → 直接用
  ├─ 未选 → 默认用 ~/ （用户 home），行为跟官方在 home 目录运行一样
  └─ 首次使用 → 顶部栏显示提示「点击选择项目文件夹」
      用户不选也能用，但 OpenCode 落在 ~/ 而非空 fallback
```

**改动文件**：

| 文件 | 改动 |
|------|------|
| `src-tauri/src/lib.rs` | `opencode_ensure_server`: 无 directory 时 fallback 改为 `dirs::home_dir()` 而非空 workspace |
| `src/components/chat/ChatPanel.vue` | 项目选择器 UI：未选时显示提示文字 |

**效果**：用户即使不选项目，OpenCode 也运行在 `~/` 下。操作 home 目录内的文件不再全部算 external，权限弹窗大幅减少。跟官方 CLI 在 home 目录运行体验一致。

---

### P1：模型选择器污染

**现象**：模型列表出现 OpenCode 内置模型（非 NewAPI 云端模型），选错后对话失败。

**根因**：
```
App 启动 → ChatPanel.onMounted → fetchModels()
  → initApiKey() 未完成（Keychain 延迟）
  → gatewayModels() 返回 []
  → 进入 OpenCode 兜底：listOpenCodeModels() 返回 OpenCode 内置模型
  → adoptFetchedModels(officialModels, 'opencode')
  → 💀 OpenCode 模型写入 jc_models_cache 持久化污染
```

**官方怎么做**：模型列表来自 `/api/model`，数据源是用户配置的 provider。没有内置硬编码默认模型列表。OpenCode 自己的模型（Zen）只是其中一个可选 provider。

**修复**：

| # | 内容 | 文件 |
|:--:|------|------|
| 1 | OpenCode 模型**禁止进入选择器**。gateway 为空时不 fallback 到 OpenCode 模型 | `agentStore.ts:689-698` |
| 2 | `jc_models_cache` 仅写入 gateway 来源的模型 | `agentStore.ts:621` |
| 3 | 缓存恢复检查：至少有一个 provider=jiucaihezi 的模型才采用 | `agentStore.ts:111-131` |
| 4 | `fetchModels` 等待 `apiKeyReady` promise（initApiKey 完成时 resolve，无论有无 Key） | `main.ts` + `ChatPanel.vue` |

---

### P2：权限弹窗反复弹出

**现象**：同一文件夹反复弹窗要求确认，点「始终允许」无效。

**根因**：
1. **P0 放大**：用户没选项目目录 → 所有文件操作都算 external → 100% 弹窗
2. **官方语义未实现**：官方 `always` = session-scoped 内存（重启失效），我们完全没有
3. **resetToolState 清空**：每次 sendMessage 清空 pendingPermissions

**官方怎么做**：
- `always` 回复 → 加入 `approved` 规则集（内存）→ 同 session 后续自动 allow → "until OpenCode is restarted"
- App 端：binary autoAccept toggle → 开启后监听 `permission.asked` 自动回复 `once`
- `packages/app/src/context/permission.tsx`：持久化到 server global

**修复（跟官方一模一样）**：

| # | 内容 | 文件 |
|:--:|------|------|
| 1 | `always` 回复加入 session-scoped 内存 approved 规则集（不跨 session，对齐官方） | `useChat.ts` |
| 2 | `permission.asked` 时先查 approved 规则集 → 匹配则自动 allow（不弹窗） | `useChat.ts` |
| 3 | 新增 autoAccept 开关（binary toggle，默认关闭，对齐官方 App 端） | `useChat.ts` + `SettingsPanel.vue` |
| 4 | `resetToolState` 不清空 approved 规则集（session 切换或 abort 时才清） | `useChat.ts` |

**不做的**（之前 SDD 设计的 per-pattern 跨 session 缓存）：
- 官方没有跨 session 的 per-pattern 持久化，我们也不做
- 官方 `always` = session-scoped，我们保持一致

---

### P3：回复完成后 UI 仍显示「正在回复中」

**现象**：LLM 已回复完，UI 仍转圈，子任务运行 10+ 分钟。

**根因**：
1. 父 LLM 完成但子 agent（task 工具生成）卡住 → OpenCode 不发出 `session.idle`
2. 事件流关闭后 onClose 是空操作（只调 `resetIdleTimer` 但不做任何事）
3. status 轮询 fallback 是 `busy` → 永不 finalize

**官方怎么做**：
- 完成信号：`session.idle` + `session.status{type:"idle"}`
- 无 watchdog，但依赖 **Effect 结构化并发**：每个 session run 是 fiber，父 scope 关闭时所有子 fiber 自动中断
- `cancel()` 方法递归调 `cancelBackgroundJobs()` 清理子任务
- 状态轮询作为事件兜底（官方也做）

**我们的等价替代**（Tauri/JS 无 Effect 运行时）：

| # | 内容 | 文件 |
|:--:|------|------|
| 1 | 独立 `idleTimer`：120s 无事件 → 先 `abortOpenCodeSession()` 再 `finalizeOpenCodeRun('timeout')` | `useChat.ts` |
| 2 | onClose：3 次重试 status 查询（3s/5s/8s）→ 仍 busy → abort + timeout finalize | `useChat.ts` |
| 3 | status 轮询：5 分钟上限 + 2 分钟静默检测 → 触发 abort + timeout | `useChat.ts` |
| 4 | 子任务追踪：填充 `subtaskSessions`（当前是死代码），超时时 UI 可见子任务状态 | `useChat.ts` + `ChatPanel.vue` |
| 5 | 清理陈旧注释（useChat.ts:1712） | `useChat.ts` |

**为什么用 watchdog 而非等官方发 idle**：官方有 Effect 运行时自动中断卡死的 fiber，我们没有。watchdog 是对 Effect 结构化并发的等价替代，120s 每个事件都重置，只有真正静默才触发。

---

## 二、实施计划

### Phase 1：P0 + P3（最影响体验）

| 步骤 | 内容 | 文件 |
|:--:|------|------|
| 1.1 | 无项目目录时 fallback 到 `~/` 而非空 workspace | `lib.rs` |
| 1.2 | 独立 idleTimer（120s→abort→finalize） | `useChat.ts` |
| 1.3 | onClose 3 次重试 + abort | `useChat.ts` |
| 1.4 | 轮询上限 + 子任务追踪 + 清理注释 | `useChat.ts` + `ChatPanel.vue` |

### Phase 2：P1 模型污染

| 步骤 | 内容 | 文件 |
|:--:|------|------|
| 2.1 | 禁止 OpenCode 模型进选择器 | `agentStore.ts` |
| 2.2 | 缓存仅存 gateway + 来源检查 | `agentStore.ts` |
| 2.3 | apiKeyReady promise | `main.ts` + `ChatPanel.vue` |

### Phase 3：P2 权限

| 步骤 | 内容 | 文件 |
|:--:|------|------|
| 3.1 | session-scoped approved 规则集 | `useChat.ts` |
| 3.2 | autoAccept binary toggle（默认关闭） | `useChat.ts` + `SettingsPanel.vue` |
| 3.3 | resetToolState 不清空权限 | `useChat.ts` |

### Phase 4：测试 + 发布

| 步骤 | 内容 |
|:--:|------|
| 4.1 | `vue-tsc -b` + `vite build` |
| 4.2 | 新增 focused 测试 3 个 |
| 4.3 | `node scripts/set-version.mjs 1.0.12` 同步版本 |
| 4.4 | 打 tag `v1.0.12` |

---

## 三、改动清单总览

| 文件 | P0 | P1 | P2 | P3 | 风险 |
|------|:--:|:--:|:--:|:--:|:--:|
| `src-tauri/src/lib.rs` | ✅ | - | - | - | 🟡 |
| `src/stores/agentStore.ts` | - | ✅ | - | - | 🟡 |
| `src/main.ts` | - | ✅ | - | - | 🟢 |
| `src/composables/useChat.ts` | - | - | ✅ | ✅ | 🟡 |
| `src/components/chat/ChatPanel.vue` | ✅ | ✅ | - | ✅ | 🟢 |
| `src/components/settings/SettingsPanel.vue` | - | ✅ | ✅ | - | 🟢 |

---

## 四、不做的（砍掉的过度设计）

| 项目 | 原因 |
|------|------|
| per-pattern 跨 session 权限缓存 | 官方没有，不发明新机制 |
| 三层权限管理 UI | 简化为一个 binary toggle，对齐官方 |
| `buildPermissionCacheKey` / `permissionDecisionCache` | 砍掉，用官方 session-scoped approved 规则集 |
| `savePermissionDecisions` / `loadPermissionDecisions` | 砍掉，官方 always 不跨 session |
| `apiKeyReady` 固定 2s 等待 | 改用 promise（initApiKey 完成时立即 resolve） |
