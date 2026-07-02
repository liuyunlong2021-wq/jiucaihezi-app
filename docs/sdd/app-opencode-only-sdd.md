# SDD: APP 专注 OpenCode，砍掉直连/本地模式

> **状态**: 提案（待研究决定）
> **日期**: 2026-07-02
> **作者**: by3
> **分支**: 0702-xiufu-2

---

## 一、决策

**APP（Tauri 桌面端）只保留 OpenCode Agent 模式，砍掉直连和本地模型。**

| 端 | 模式 | 引擎 | 说明 |
|---|------|------|------|
| 🖥 APP | Agent | OpenCode sidecar → NewAPI | 唯一模式 |
| 🌐 Web | 直连 | NewAPI | 不变 |

---

## 二、砍掉的内容

### 2.1 `useChat.ts` 中删除的函数（~1000 行）

```
sendDirectLocalModelMessage()     → 删除（本地模型）
sendDesktopDirectCloudMessage()   → 删除（桌面直连云）
sendWebCloudMessage()             → 删除（Web 直连，迁移到 useSimpleChat）
```

### 2.2 不再引用的文件

```
chatCloud.ts      → 删除（仅 Web 用，迁移到 useSimpleChat）
directMessageBuilder.ts → 删除（纯直连消息构建）
src/runtime/direct/               → 删除（直连运行时）
```

### 2.3 不再显示的组件

```
PermissionDock      → 删除（OpenCode 权限 Dock，仍需要？不，保留——OpenCode 需要）
QuestionDock        → 保留
TodoDock            → 保留
RevertDock          → 保留
DiffReviewDock      → 保留
```

等等——PermissionDock/QuestionDock/TodoDock/RevertDock 都是 OpenCode Agent 流程的组件，砍掉的是直连模式，这些反而要保留。重新整理：

**保留**（OpenCode Agent 需要）：
- PermissionDock
- QuestionDock
- TodoDock
- RevertDock
- DiffReviewDock
- SessionContextUsage
- AgentStatusBar（虽然上一步隐藏了，但只是 UI 隐藏，逻辑保留）

**删除**（直连模式专属）：
- 直连消息构建逻辑
- 本地模型调用逻辑
- chatCloud.ts

### 2.4 APP 模式切换 UI 简化

```
之前: [OpenCode Agent] [直连云] [本地模型]  三个 tab
之后: 无模式切换 UI（只有 OpenCode）
```

ChatPanel 顶部的模式选择器移除。

---

## 三、新增: `useSimpleChat.ts`

Web 端不再从 `useChat.ts` 绕道走，使用独立的轻量 composable。

### 3.1 职责

```ts
// src/composables/useSimpleChat.ts
// 职责：纯聊天，无 Agent 工具循环，无 OpenCode
// 使用方：Web 端、手机端

function useSimpleChat() {
  return {
    messages,        // Ref<Message[]>
    isStreaming,     // Ref<boolean>
    sendMessage,     // (content: string) => Promise<void>
    stopStream,      // () => void
    clearMessages,   // () => void
    // 无 agentPhase, currentToolProgress, pendingPermissions, sessionTodos...
  }
}
```

### 3.2 内部实现

```
useSimpleChat
├── 对话历史管理（messages, loadMessages, clearMessages）← 复用 sessionStore
├── 流式请求（sendMessage, stopStream）
│   └── newApiClient.chatCompletions() → SSE 解析
├── 附件处理（文件上传/粘贴）← 复用 FileUploader
└── 上下文管理（system prompt, skill 注入）← 复用 conversationContext
```

### 3.3 与 `useChat` 的区别

| | useChat | useSimpleChat |
|---|---------|---------------|
| 引擎 | OpenCode sidecar | NewAPI 直连 |
| 工具循环 | ✅ Agent 自主调用工具 | ❌ 无 |
| Permission | ✅ 权限弹窗 | ❌ 无 |
| Diff Review | ✅ 代码变更审查 | ❌ 无 |
| Shell 执行 | ✅ Tauri sidecar | ❌ 无 |
| 流式 | 事件驱动 (SSE via SDK) | SSE 直连 |
| 平台 | 仅 Tauri | Web + 手机 |
| 行数 | ~1400（瘦身后） | ~350 |

---

## 四、代码变更清单

### 4.1 新增文件

```
src/composables/useSimpleChat.ts    # Web 端轻量聊天 composable
```

### 4.2 修改文件

```
useChat.ts          # 删除直连/本地相关函数，~2478 → ~1400 行
ChatPanel.vue   # 移除模式切换 UI，Web 端改用 useSimpleChat
agentStore.ts            # agentMode 简化（移除 'direct' 选项？保留给 Web？）
```

### 4.3 删除文件

```
chatCloud.ts        # 直连云聊逻辑
directMessageBuilder.ts   # 直连消息构建
src/runtime/direct/                 # 直连运行时（如果存在独立目录）
```

---

## 五、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 用户习惯直连模式，突然没了 | 🔴 高 | 提供 Web 端作为替代（功能等价） |
| 直连模式用的模型 OpenCode 不支持 | 🟡 中 | 排查 NewAPI 模型列表，确认覆盖率 |
| useSimpleChat 和 useChat 行为不一致 | 🟡 中 | 共用 MessageBubble/FileUploader，仅引擎不同 |
| Web 端从 useChat 切 useSimpleChat 的回归 | 🟡 中 | 先写 useSimpleChat，Web 端并行跑一段再切 |

---

## 六、不做的事

- ❌ 不删除 opencodeClient/ 目录（APP 仍需要）
- ❌ 不修改 Tauri Rust 后端（OpenCode sidecar 逻辑不变）
- ❌ 不修改 NewAPI 后端
- ❌ 不修改创作面板/媒体引擎
- ❌ 不修改 Skill 仓库/工具仓库

---

## 七、实施步骤（如果决定做）

```
Phase 1: 提取 useSimpleChat
  ├── 从 chatCloud.ts + directMessageBuilder.ts 提取核心流式逻辑
  ├── 写 useSimpleChat.ts（~350 行）
  ├── Web 端 ChatPanel 改为使用 useSimpleChat
  └── 验证：Web 端构建 + 功能测试

Phase 2: 瘦身 useChat
  ├── 删除 sendDirectLocalModelMessage
  ├── 删除 sendDesktopDirectCloudMessage
  ├── 删除 sendWebCloudMessage
  ├── 清理不再引用的 import
  └── 验证：vue-tsc + vite build + tauri build

Phase 3: 清理
  ├── 删除 chatCloud.ts
  ├── 删除 directMessageBuilder.ts
  ├── 删除 APP 模式切换 UI
  ├── agentStore 清理 agentMode 枚举
  └── 验证：全量构建 + 冒烟测试
```

---

## 八、决策记录

- **2026-07-02**: 提案创建。等研究几天再决定是否执行。
```

