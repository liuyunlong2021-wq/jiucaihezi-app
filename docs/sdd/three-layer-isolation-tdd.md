# 三层隔离 — TDD（抄写 OpenCode 官方设计）

> **状态**: 待实现
> **铁律**: 一字不差照抄 OpenCode 源码。不自行发挥，不另起炉灶。
> **事实源**: `/Users/by3/Documents/jiucaihezi-opencode` 三层结构文档

---

## 目标

当前我们的隔离靠「目录变了就 kill 进程重启」——粗暴、慢、不官方。
官方 OpenCode **一个进程管理多 project**，隔离靠 SQLite `project_id` + session `directory` 参数。

这个 TDD 的目标：**把我们的代码改成和官方一模一样的隔离方式**。

---

## 三层对照

### 第一层：Project — 完全隔离

| | 官方 | 我们（修正后） |
|------|------|------|
| 进程数 | 1 个（官方 server 支持多 project） | 切目录 kill+重启（二进制是单目录模式） |
| 隔离机制 | SQLite `project_id` 字段 | 进程级隔离：`--current-dir` 决定文件系统范围，切目录必须重启 |
| 为什么不同 | 官方是完整 server，我们是 CLI 二进制 | `opencode serve --current-dir` 绑死一个目录，session.directory 不 override |

**需要改的代码**:

#### Rust `opencode_ensure_server` — 目录变化不杀进程

```rust
// 之前（杀进程）:
if (!requested_dir.is_empty() && current.directory != requested_dir)
    || current.config_signature != requested_config_signature
{
    let _ = current.child.start_kill();
    *session = None;
}

// 改为:
if current.config_signature != requested_config_signature {
    let _ = current.child.start_kill();
    *session = None;
}
// 目录变化 → 不杀进程。session 隔离由前端 directory 参数保证。
```

✅ 已实现（commit `3dacb75`）

#### 前端 `useChat.ts` — directory 变化时清 session

```typescript
// 已有逻辑（不变）:
if (activeOpenCodeDirectory && effectiveDir !== activeOpenCodeDirectory) {
  setActiveOpenCodeSessionId('')
}
activeOpenCodeDirectory = effectiveDir
```

目录变化 → 清 `activeOpenCodeSessionId` → 下次发消息走 `if (!activeOpenCodeSessionId)` 分支 → 创建新 session 带新 `directory`。

---

### 第二层：Workspace / Worktree — 可切换

| | 官方 | 我们 |
|------|------|------|
| 数据结构 | git worktree `add -b opencode/<name>` | **需要实现** |
| session 绑定 | `workspace_id` + `directory` | session 创建时传 `directory`（已做） |
| 跨 workspace | `sessionWarp()` 迁移 session + 携带改动 | **暂不实现** |
| UI | 第二列会话记录按 workspace 过滤 | **需要实现** |

**需要改的代码**:

#### Rust `worktree.rs` — git worktree 管理（已有文件）

现有函数: `create_worktree`, `list_worktrees`, `remove_worktree`
这些是之前写的，需要验证是否能正常工作。

#### 前端 — 会话列表按 workspace 过滤

当前：`sessionStore` 的会话列表不区分 workspace。
需求：当用户选了 project 后，第二列只显示属于当前 project 的会话。

具体改动：
1. `sessionStore` 增加 `projectFilter` 字段
2. 会话列表查询时按 project 目录过滤
3. 新建会话时绑定当前 project 目录

#### 前端 — workspace 切换 UI

官方 OpenCode 有 workspace 切换功能。
对应到我们的产品：同一 project 下可以有多个会话，第二列显示该 project 所有会话。

当前状态：第二列（文件树面板）的 "历史记录" tab 已经列出了会话。
需要确认：切换 project 时，会话列表是否正确过滤。

---

### 第三层：Session — 完全隔离，通过 fork 互动

| | 官方 | 我们 |
|------|------|------|
| 消息历史 | 完全隔离，`session_id` 查消息 | ✅ `activeOpenCodeSessionId` 隔离 |
| 上下文 | 不共享 | ✅ 每条 prompt 绑定 session |
| Fork | `parentID` 标记父子 | ❌ 未实现 |
| 同一目录 | 多个 session 操作同一份文件 | ✅ directory 相同即可 |

**需要改的代码**:

#### Fork 支持（官方: `sessionFork` 端点）

```typescript
// 新增 session.ts:
export async function forkOpenCodeSession(
  client: OpencodeClient,
  parentSessionID: string,
  input: { directory?: string; title?: string }
): Promise<{ id: string }> {
  return unwrapData(await client.session.fork({
    sessionID: parentSessionID,
    ...locationParams(input),
    title: input.title,
  }))
}
```

#### 新建对话 = 新 session（✅ 已实现）

```typescript
// useChat.ts 已有:
const localSessionId = String(options.sessionId || '')
if (localSessionId && localSessionId !== lastLocalSessionId) {
  if (activeOpenCodeSessionId) setActiveOpenCodeSessionId('')
  lastLocalSessionId = localSessionId
}
```

---

## 实现步骤

### Step 1: Project 隔离 ✅
- [x] Rust: 移除目录变化杀进程逻辑
- [x] 前端: `lastLocalSessionId` 跟踪 → 新对话 = 新 session

### Step 2: Session 隔离 ✅
- [x] `createOpenCodeSession` 传 `directory`（已有）
- [x] `fireOpenCodePrompt` 传 `sessionID`（已有）

### Step 3: Workspace 过滤 ✅
- [x] 会话列表按 project 目录过滤
- [x] `setCurrentProjectDir` + `projectSessions` computed
- [x] 所有会话列表渲染改用 `projectSessions`

### Step 4: Fork ✅
- [x] SDK v1.17.9 已有 `client.session.fork()`
- [x] `forkOpenCodeSession` 函数（session.ts）
- [ ] Fork UI 入口（后续迭代）

---

## 测试清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | Project A 发「你好」 → 切 Project B → 发「你是谁」 | AI 不知道 Project A 的内容 |
| 2 | Project A 对话1 发「你好」 → 新建对话2 → 发「继续」 | AI 不知道对话1 的内容 |
| 3 | Project A 对话1 → 切 Project B → 切回 Project A 对话1 | 对话1 的历史还在（session 持久化） |
| 4 | 同 project 两个对话 → 各发不同内容 | 互不干扰 |

---

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src-tauri/src/lib.rs` | ✅ 移除目录杀进程 |
| `src/composables/useChat.ts` | ✅ `lastLocalSessionId` 跟踪 |
| `src/opencodeClient/session.ts` | 新增 `forkOpenCodeSession` |
| `src/stores/sessionStore.ts` | 增加 project 过滤 |
| `src-tauri/src/worktree.rs` | 验证 git worktree 功能 |
