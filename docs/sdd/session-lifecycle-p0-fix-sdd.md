# 会话生命周期管理 P0 修复 SDD

> **日期**: 2026-07-06（v5 — 全部实现）
> **状态**: ✅ 全部完成
> **参考**: OpenCode 会话管理深度分析（home.tsx / session.ts / server-session.ts / submit.ts）
> **触发**: Monterey Intel Mac 兼容性报告第九节 — SSE 断连 + 重启丢会话

---

## 零、核心认知 + 架构决策

**OpenCode 已经把会话恢复做完了，我们只是没调用它的 API。**

### 四个决策（2026-07-06 确定，全选 B）

| 决策 | A（保守） | B（照抄 OpenCode） | 选定 |
|:----:|-----------|---------------------|:----:|
| 1. 会话加载时机 | server 就绪即调 | server 就绪 **+ project 已选** | **B** |
| 2. 会话事实源 | IndexedDB + OpenCode 双源 | **OpenCode SQLite 唯一事实源** | **B** |
| 3. 消息加载来源 | 读 IndexedDB | **OpenCode API** `GET /session/:id/message` | **B** |
| 4. UI 数据源 | 两源合并显示 | **OpenCode 为主，IndexedDB 为写入缓存** | **B** |

### 双端架构

```
桌面端（Tauri）:                      Web 端:
  OpenCode SQLite ← 唯一事实源          IndexedDB ← 唯一事实源
  IndexedDB ← 写入缓存                   ↕
  ↕                                     HTTP → NewAPI（无 session 持久化）
  HTTP → OpenCode Server                （不调 OpenCode session API）
```

**Web 端守卫**：所有 OpenCode session API 调用用 `isTauriRuntime()` 包裹。Web 端保持现状（IndexedDB）。

---

## 一、已实现（Phase 1-3）

### 1.1 `src/opencodeClient/eventBridge.ts` — SSE 自动重连

照抄 OpenCode `server-sdk.tsx` L106-L220：
- `RECONNECT_DELAY_MS = 250`
- `HEARTBEAT_TIMEOUT_MS = 15_000`
- while 循环：断连 → 等 250ms → 重连
- 每 5s 检查距上次事件是否超过 15s

### 1.2 `src/opencodeClient/session.ts` — 新增 API 包装

```typescript
// GET /session?directory=xxx&roots=true&limit=64
listOpenCodeSessions(client, { directory, roots, limit })

// GET /session/:sessionID
getOpenCodeSession(client, sessionID, { directory })
```

### 1.3 `src/stores/sessionStore.ts` — mergeOpenCodeSessions

```typescript
sessionStore.mergeOpenCodeSessions(openCodeSessions, projectDir)
// → 按 openCodeSessionId upsert → 按 updatedAt 降序
```

### 1.4 `src/stores/agentStore.ts` — 启动时同步会话 ✅

照抄 OpenCode `home.tsx` L304-308：`ensureOpenCodeServer` 成功后调用 `listOpenCodeSessions` + `mergeOpenCodeSessions`。用 `isTauriRuntime()` 守卫 Web 端。

### 1.5 `src/components/chat/ChatPanel.vue` — 切换 project 刷新会话 ✅

照抄 OpenCode `home.tsx`：watch `projectDir` 变化 → `listOpenCodeSessions` + `mergeOpenCodeSessions`。

### 1.6 点击历史 → OpenCode 加载消息 ✅（已有代码）

ChatPanel.vue L711-727 已有逻辑：`session.openCodeSessionId` 存在时优先从 OpenCode API 加载消息，失败回退 IndexedDB。

---

## 二、待实施（低优先级）

### 2.1 历史列表 UI 分组

照抄 OpenCode `buildHomeSessionRecords`：today / yesterday / older（纯 UI，不影响功能）

---

## 三、修改文件清单（全部完成）

| 文件 | 内容 | 状态 |
|------|------|:--:|
| `src/opencodeClient/eventBridge.ts` | SSE 重连循环（250ms + 15s 心跳） | ✅ |
| `src/opencodeClient/session.ts` | listOpenCodeSessions + getOpenCodeSession | ✅ |
| `src/stores/sessionStore.ts` | mergeOpenCodeSessions | ✅ |
| `src/stores/agentStore.ts` | boot 时同步 OpenCode 会话 | ✅ |
| `src/components/chat/ChatPanel.vue` | 切换 project → 刷新会话列表 | ✅ |
| （ChatPanel.vue L711-727 已有） | 点击历史 → OpenCode API 加载消息 | ✅ |

---

## 四、验证清单

- [x] `vue-tsc -b` 通过
- [x] `cargo check` 通过
- [x] `vite build` 通过（1.13s）
- [ ] 桌面端: 启动 → OpenCode server 就绪 → 自动加载会话列表
- [ ] 桌面端: 点击历史会话 → 从 OpenCode API 加载消息 → 继续聊
- [ ] 桌面端: 切换 project → 会话列表切换
- [ ] Web 端: 启动 → 正常加载 IndexedDB 会话（不受影响）
- [ ] Web 端: 不调任何 OpenCode session API（`isTauriRuntime()` 守卫）
