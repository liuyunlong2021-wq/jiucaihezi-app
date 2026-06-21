# OpenCode 对齐方案 — duiqiopencode 支线

> **日期**: 2026-06-22  
> **分支**: `duiqiopencode` (基于 `desktop`)  
> **目标**: 桌面端 APP 完整对齐 OpenCode 官方代码，消除版本偏差和能力缺口  
> **参考**: `CLAUDE.md`、`AGENTS.md`、`anomalyco/opencode` 上游仓库  
> **关联 SDD**: `opencode-core-skill-kernel-sdd.md`、`opencode-official-capability-carrier-sdd.md`、`opencode-hardening-d0-official-carrier-parity.md`、`opencode-official-ui-parity-matrix.md`

---

## 0. 执行摘要

韭菜盒子 Studio 桌面端当前深度集成 OpenCode（`@opencode-ai/sdk` v1.17.6 + binary v1.17.0），通过 16 个 TypeScript 封装模块 + Rust 进程管理 + `useChat.ts` 中央编排器，实现了完整的 project directory → session → permission → tool → timeline 数据流。

但距离上游最新版 (v1.17.9) 有版本差距，且 UI 承载、part 渲染、Dock 系统、事件处理等方面与官方实现存在可度量的偏差。本文档制定完整的对齐方案，分 P0-P3 四个 Phase 执行。

---

## 1. 版本基线

### 1.1 版本差距

| 组件 | 韭菜盒子当前 | 上游最新 | 差距 | 影响面 |
|------|:----------:|:-------:|:----:|--------|
| OpenCode 二进制 | v1.17.0 | **v1.17.9** (2026-06-21) | 9 个版本 | session API、事件语义、tool schema、bug 修复 |
| `@opencode-ai/sdk` | v1.17.6 | **v1.17.9** | 3 个版本 | TypeScript 类型、v2 API 签名、新端点 |
| `@opencode-ai/plugin` | v1.17.0 | **v1.17.9** | 9 个版本 | 插件 API 兼容性 |

### 1.2 版本锁定策略

```
二进制:   通过 scripts/update-opencode-runtime.mjs 从 GitHub Releases 拉取
SDK:      通过 pnpm 锁定到 package.json
Plugin:   通过 .opencode/package.json 锁定
```

每次更新后运行集成验证，不盲目追最新。对齐目标版本：**v1.17.9**。

---

## 2. 架构对齐全景

### 2.1 上游 OpenCode 架构 (anomalyco/opencode)

```
┌──────────────────────────────────────────────────┐
│              packages/desktop                     │
│          Electron 桌面 APP (BETA)                  │
│  包装 packages/app，提供原生壳 + 自动更新           │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│              packages/app                         │
│         SolidJS Web UI 组件                        │
│  - session-composer (输入区 + Dock 系统)           │
│  - message-timeline (消息流 + Part 渲染)           │
│  - global-sync (event-reducer 事件归一化)          │
│  - slash-popover (命令面板)                        │
└────────────────────┬─────────────────────────────┘
                     │ @opencode-ai/sdk
┌────────────────────▼─────────────────────────────┐
│           packages/opencode (核心)                │
│  - server/       HTTP + WS 服务端点               │
│  - session/      session 生命周期 + LLM 调用       │
│  - tool/         官方工具实现 (read/grep/bash/...) │
│  - permission/   权限规则引擎                      │
│  - skill/        SKILL.md 发现与加载               │
│  - provider/     AI provider 适配                 │
│  - cli/cmd/tui/  TUI 终端界面                     │
└──────────────────────────────────────────────────┘
```

### 2.2 韭菜盒子 OpenCode 集成架构

```
┌──────────────────────────────────────────────────┐
│            Vue 3 ChatPanel + OpenCodePartList      │
│  - 消息流渲染 (OpenCodePartList.vue)               │
│  - Dock 系统 (QuestionDock/PermissionDock/...)     │
│  - 顶部选择器 (模型/Agent/Skill/知识库)            │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│        useChat.ts (~2300 行中央编排器)              │
│  - sendMessage() 路由 (OpenCode vs 直连)           │
│  - 事件处理 (20+ 事件类型)                         │
│  - 会话操作 (new/compact/fork/share/archive/...)   │
│  - 交互式 (permission.reply / question.reply)      │
└───┬───────────────┬──────────────┬────────────────┘
    │               │              │
    ▼               ▼              ▼
┌─────────┐ ┌────────────┐ ┌──────────────────┐
│daemon.ts│ │session.ts  │ │ eventBridge.ts   │
│ 服务器   │ │ 会话 CRUD  │ │ SSE 事件订阅      │
│ 生命周期 │ │ prompt操作 │ │ 16 种事件归一化   │
└────┬────┘ └──────┬─────┘ └────────┬─────────┘
     │             │               │
     ▼             ▼               ▼
┌─────────────────────────────────────────────────┐
│   client.ts → createOpencodeClient()             │
│   @opencode-ai/sdk v1.17.6                       │
└────────────────────┬────────────────────────────┘
                     │ HTTP/WS
┌────────────────────▼────────────────────────────┐
│        Tauri Rust (src-tauri/src/lib.rs)          │
│  opencode_ensure_server → spawn opencode serve   │
│  opencode_status / opencode_stop                  │
│  resolve_opencode_binary() 多级回退查找           │
└────────────────────┬────────────────────────────┘
                     │ 本机进程
┌────────────────────▼────────────────────────────┐
│     OpenCode 原生二进制 v1.17.0                   │
│     ~/.jiucaihezi/opencode-runtime/               │
└─────────────────────────────────────────────────┘
```

### 2.3 架构对比关键差异

| 维度 | 上游 OpenCode | 韭菜盒子 | 对齐动作 |
|------|:------------:|:-------:|:-------:|
| 桌面壳 | Electron | Tauri v2 | 无需对齐（已决定用 Tauri） |
| UI 框架 | SolidJS | Vue 3 | 无需对齐（已决定用 Vue） |
| 包管理 | Bun | pnpm | 无需对齐 |
| **事件归一化** | `event-reducer.ts` (global-sync) | `eventBridge.ts` + `useChat.ts` 内联 | **需对齐事件处理语义** |
| **Part 渲染规则** | `renderable()` + `ToolPartDisplay` | `timelineRows.ts` + `OpenCodePartList.vue` | **需对齐隐藏/展示规则** |
| **Dock 系统** | Composer 上方内联 | 独立 Vue 组件 | **需补 RevertDock / FollowupDock** |
| **Session 命令** | `use-session-commands.tsx` | `sessionCommands.ts` | **已大部分覆盖，需补遗漏** |
| **Skill 机制** | 官方 `skill` tool + 系统提示 | `skillScope.ts` + `agentStore.ts` | **需对齐为官方 skill tool 驱动** |
| **知识库(Vault)** | 无此概念，靠 `read`/`grep`/`glob` | `useBrain.ts` + `vaultStore.ts` | **需转为文件上下文注入** |
| **Provider 投影** | 官方 provider 配置 | `providerProjection.ts` 桥接 NewAPI | **已实现，需验证兼容** |

---

## 3. 对齐 Phase 规划

### Phase 0: 版本同步 (P0 🔴)

**目标**: 将 OpenCode 二进制、SDK、Plugin 统一升级到 v1.17.9。

| 步骤 | 操作 | 文件 | 验证方法 |
|:----:|------|------|---------|
| 0.1 | 更新 SDK 版本 | `package.json`: `@opencode-ai/sdk` → 1.17.9 | `pnpm install` 无错误 |
| 0.2 | 更新 Plugin 版本 | `.opencode/package.json`: `@opencode-ai/plugin` → 1.17.9 | 版本号匹配 |
| 0.3 | 拉取新二进制 | `node scripts/update-opencode-runtime.mjs` | 二进制文件存在且可执行 |
| 0.4 | 更新版本信息 | `src/data/opencodeRuntimeInfo.ts` | version/release/updatedAt 正确 |
| 0.5 | 类型检查 | `pnpm exec vue-tsc -b` | 0 类型错误 |
| 0.6 | 前端构建 | `pnpm exec vite build` | 构建成功 |
| 0.7 | SDK API 兼容扫描 | 检查 `src/opencodeClient/` 所有模块 | 无 breaking change |

**预期风险**:
- v1.17.0 → v1.17.9 可能存在 API breaking change（尽管是 patch 版本）
- `(client as any).v2.xxx` 的动态调用方式降低了类型安全性
- 解决方案：运行 `vue-tsc -b` 捕获类型错误，逐一修复

**退出标准**:
- [x] 二进制版本 v1.17.9
- [x] SDK 版本 1.17.9
- [x] Plugin 版本 1.17.9
- [x] `vue-tsc -b` 通过
- [x] `vite build` 通过

---

### Phase 1: 事件处理与 Part 渲染对齐 (P0 🔴)

**目标**: 事件 reducer 和 Part 渲染规则与官方 `event-reducer.ts` + `message-part.tsx` 对齐。

**官方裁决依据**:
- `packages/app/src/context/global-sync/event-reducer.ts` — 事件 upsert/delta 规则
- `packages/ui/src/components/message-part.tsx:607` — `renderable()` part 可见性
- `packages/ui/src/components/message-part.tsx:1359` — `ToolPartDisplay` 工具卡

#### 1.1 `message.part.delta` 字段泛化 (HD-003)

**现状**: `applyOpenCodePartDelta()` 只接受 `text | reasoning` 字段。
**目标**: 接受任意 string field，保留 raw。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/timelineRows.ts` | `applyOpenCodePartDelta()` 改为 `Record<string, unknown>` |
| `src/opencodeClient/__tests__/timelineRows.test.ts` | 新增非 text/reasoning delta 测试 |

#### 1.2 `message.part.updated` 跳过规则 (D0-002)

**官方规则**: `event-reducer.ts:228` 跳过 `patch`、`step-start`、`step-finish` 事件更新。
**现状**: `upsertOpenCodePart()` 未实现此跳过逻辑。
**目标**: 表驱动测试覆盖跳过规则。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/timelineRows.ts` | `upsertOpenCodePart()` 添加 skip type 列表 |
| `src/opencodeClient/__tests__/timelineRows.test.ts` | 表驱动跳过测试 |

#### 1.3 `session.status:error` 承载 (HD-001)

**现状**: `session.status:error` 未完整承载。
**目标**: 映射为 timeline 错误行，停止 streaming，显示错误详情。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | 事件 handler 添加 `status:error` → finalize + error row |
| `src/components/chat/OpenCodePartList.vue` | 错误行渲染 |

#### 1.4 Event stream close/error carrier (HD-002)

**现状**: `subscribeOpenCodeEvents()` 异步错误会 throw 到后台。
**目标**: 支持 `onError/onClose` 回调，触发最终同步或错误行。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/eventBridge.ts` | `subscribeOpenCodeEvents()` 添加 `onError/onClose` 参数 |
| `src/composables/useChat.ts` | 传入 `onError/onClose` 处理器 |

#### 1.5 Scroll lock 策略 (HD-004)

**官方策略**: `message-timeline.tsx:485-596` — 内容变化且用户在底部时才自动跟随；工具卡高度变化后多帧锁底。
**现状**: 用户反馈输出会跑出视野。
**目标**: 对齐官方锁底策略。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ChatScrollNav.vue` | 改进锁底逻辑，多帧检测 |

**退出标准**:
- [x] `applyOpenCodePartDelta` 支持任意字段
- [x] `upsertOpenCodePart` 跳过官方指定的事件类型
- [x] `session.status:error` 有完整 UI 承载
- [x] Event stream 断连不卡死 UI
- [x] 滚动锁底行为与官方一致
- [x] 所有测试通过

---

### Phase 2: Dock 系统补全 + Tool Part 渲染对齐 (P1 🟡)

**目标**: 补全缺失的 Dock 组件，工具 Part 渲染与官方 `ToolPartDisplay` 对齐。

**官方裁决依据**:
- `session-composer-region.tsx` — Dock 布局
- `message-part.tsx:559` — Context tool group
- `message-part.tsx:1399` — `ToolErrorCard`

#### 2.1 RevertDock (D0 缺口)

**现状**: 缺失。
**目标**: 撤回后展示可恢复项，位于输入区上方。

| 文件 | 操作 |
|------|------|
| `src/components/chat/RevertDock.vue` | **新建** |
| `src/components/chat/ChatPanel.vue` | 集成到 composer 上方 |

#### 2.2 FollowupDock

**现状**: 缺失。
**目标**: 展示后续操作建议，按钮"发送建议 / 编辑后发送"。

| 文件 | 操作 |
|------|------|
| `src/components/chat/FollowupDock.vue` | **新建** |
| `src/components/chat/ChatPanel.vue` | 集成到 composer 上方 |

#### 2.3 Context Tool Group 可视化 (D0-013)

**现状**: `isContextOpenCodeTool()` 已有定义，但 UI 未完整 group。
**目标**: 连续 `read/glob/grep/list` 折叠为一组 "上下文读取 N 项"。

| 文件 | 修改 |
|------|------|
| `src/components/chat/OpenCodePartList.vue` | ContextToolGroup 分组渲染 |
| `src/opencodeClient/timelineRows.ts` | `isContextOpenCodeTool()` 补全 tool 类型 |

#### 2.4 ToolErrorCard 对齐 (D0-016)

**现状**: 工具错误展示较弱。
**目标**: 对齐官方 `ToolErrorCard`，错误可复制/展开，websearch 显示 provider title。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | 增强错误展示：复制按钮、展开详情 |
| `src/components/chat/MessageBubble.vue` | tool error 走专用卡片 |

#### 2.5 bash/edit/write/apply_patch 展开策略 (D0-024/D0-025)

**现状**: 展开策略未完全对齐。
**目标**: `bash` 默认展开由 `shellToolPartsExpanded` 控制；`edit/write/apply_patch` 由 `editToolPartsExpanded` 控制。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | 根据 tool 类型实施不同默认展开策略 |
| `src/stores/sessionStore.ts` | 保存用户展开偏好 |

#### 2.6 task/skill tool 展示增强 (D0-026/D0-027)

**现状**: 子任务和 Skill 加载工具卡展示泛化。
**目标**: task 显示子任务元数据，skill 显示加载状态和失败修复建议。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | task/skill tool 专用展示分支 |

**退出标准**:
- [x] RevertDock 可正常展示和交互
- [x] FollowupDock 可正常展示和交互
- [x] Context tools 正确 group 折叠
- [x] ToolErrorCard 样式和功能对齐
- [x] bash/edit 展开策略可控
- [x] task/skill tool 展示增强

---

### Phase 3: Skill + Vault 官方机制对齐 (P1 🟡)

**目标**: Skill 使用官方 `skill` tool 驱动，Vault 转为文件上下文注入。

**官方裁决依据**:
- `packages/opencode/src/session/system.ts` — Skill 系统提示
- `packages/opencode/src/tool/skill.ts` — Skill 工具实现
- `packages/web/src/content/docs/skills.mdx` — Skill 官方文档

#### 3.1 Skill 使用官方 skill tool

**禁止项** (已写入 UI parity matrix):
1. ❌ 不把 `SKILL.md` 手动拼进 system prompt
2. ❌ 不用旧 `triggers` / 中文名称 / `agentConfig` 自行决定执行
3. ❌ 不把知识库包装成 Skill

**现状**: `skillScope.ts` 通过 session permission (`deny skill *` + `allow selected`) 固定 Skill，但 system prompt 中仍有旧式 Skill 注入。
**目标**: 纯靠官方 `skill` tool 机制，系统提示只列出可用 Skill (name + description)。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/skillScope.ts` | `buildFixedSkillSystemInstruction()` 改为只生成 Skill 可用性列表，不注入 SKILL.md |
| `src/composables/useChat.ts` | 移除旧式 SKILL.md 注入逻辑 |
| `src/stores/agentStore.ts` | 保持本地展示/搜索辅助，不再参与执行链 |

#### 3.2 Vault 转为文件上下文

**官方方式**: Vault 内容作为 `file` request parts 或外部只读目录 (`external_directory`) 注入，AI 通过 `read`/`grep`/`glob` 按需读取。

**现状**: `useBrain.ts` 做旧式 RAG prompt 注入 (`recallKnowledge()` → system prompt)。
**目标**: 用户选择 Vault 后，将 CLAUDE.md、wiki index、精选页面作为结构化文件传入。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | `sendMessage()` 将 Vault 转为 `file` request parts |
| `src/opencodeClient/session.ts` | `buildOpenCodePromptParts()` 接受 Vault context files |
| `src/composables/useBrain.ts` | 不再做 prompt 注入；保留知识提炼/召回能力但输出改为文件 |

**知识库资料量分档策略**:
| 资料量 | 策略 |
|:------:|------|
| < 50KB | 直接作为 `file` request parts 传入 |
| 50KB - 5MB | 导出到 `.jiucaihezi/context/<vault-id>/`，开放只读 `read`/`grep`/`glob` |
| > 5MB | 同上，但仅导出 index + 钉选页面，不导出全量 |

**退出标准**:
- [x] Skill 选择后不手动注入 SKILL.md 到 prompt
- [x] 官方 `skill` tool 正常工作
- [x] Vault 选择后不注入大段 prompt
- [x] Vault 作为文件上下文可用
- [x] 禁止项全部实施

---

### Phase 4: Session 命令与 UX 收口 (P2/P3 🟢)

**目标**: 补全缺失的 session 命令 UI、模型/Agent 选择器对齐、清理旧模式冗余。

#### 4.1 Session 命令补全

| 命令 | 现状 | 动作 |
|------|:----:|------|
| `/new` (新建会话) | ✅ 已承载 | 保持 |
| `/compact` (压缩上下文) | ✅ 已承载 | 保持 |
| `/undo` (撤销上轮) | ❌ 缺失 | 新增按钮 + 快捷键 |
| `/redo` (重做上轮) | ❌ 缺失 | 新增按钮 + 快捷键 |
| `/fork` (分支) | 🟡 部分 | 补 UI 入口 |
| `/share` (分享) | 🟡 部分 | 补取消分享、复制链接 |
| `/unshare` (取消分享) | ❌ 缺失 | 新增菜单项 |
| `/archive` (归档) | 🟡 部分 | 确认对话框 |
| `/delete` (删除) | 🟡 部分 | 确认对话框 |
| `/model` | ❌ 错误 | 当前错误发给 server，应只打开选择器 |
| `/agent` | ❌ 缺失 | Agent 选择器 |

**文件**: `src/components/chat/ChatPanel.vue`、`src/opencodeClient/sessionCommands.ts`

#### 4.2 模型/Agent 选择器对齐

| 控件 | 现状 | 目标 |
|------|:----:|------|
| 模型选择器 | ✅ 已有 | 确保 `/model` 只打开选择器不发 server |
| Agent 选择器 | 🟡 "自动"文案 | 改为 "Agent：自动/xxx"，补 `/agent` |
| Variant 切换 | ❌ 缺失 | 模型菜单 "切换 Variant" |

#### 4.3 架构优化

| 优化项 | 说明 | 优先级 |
|--------|------|:------:|
| 提取 `prepareOpenCodeConversation()` | `ensureOpenCodeCommandSession()` 和 `sendMessage()` 中重复的 25+ 行服务器+客户端+会话创建逻辑合并 | P2 |
| Provider 配置变更检测 | 当 NewAPI key/model 变更时自动重建 `OpencodeClient` | P2 |
| 日志基础设施 | 统一日志级别、格式化、持久化 | P3 |

**退出标准**:
- [x] undo/redo 按钮可见可用
- [x] 分享状态完整（分享/取消分享/复制链接）
- [x] `/model` 只打开选择器
- [x] Agent 选择器有明确选项
- [x] 重复代码已提取
- [x] Provider 变更自动重建客户端

---

## 4. 文件改修清单

### 🔴 必改 (P0-P1)

| 文件 | Phase | 修改类型 |
|------|:-----:|:-------:|
| `package.json` | P0 | 版本号 |
| `.opencode/package.json` | P0 | 版本号 |
| `src/data/opencodeRuntimeInfo.ts` | P0 | 版本号 |
| `src/opencodeClient/timelineRows.ts` | P1 | delta 泛化 + 跳过规则 |
| `src/opencodeClient/eventBridge.ts` | P1 | onError/onClose |
| `src/composables/useChat.ts` | P1-P3 | 事件处理 + Skill/Vault 改造 + 命令 |
| `src/components/chat/OpenCodePartList.vue` | P1 | Part 渲染对齐 |
| `src/components/chat/ToolCallCard.vue` | P2 | ToolErrorCard + 展开策略 |
| `src/components/chat/ChatScrollNav.vue` | P1 | Scroll lock |

### 🟡 改改 (P2)

| 文件 | 修改类型 |
|------|---------|
| `src/components/chat/RevertDock.vue` | **新建** |
| `src/components/chat/FollowupDock.vue` | **新建** |
| `src/components/chat/ChatPanel.vue` | Dock 集成 + 命令按钮 |
| `src/opencodeClient/skillScope.ts` | 官方 skill tool 对齐 |
| `src/opencodeClient/session.ts` | Vault context files |
| `src/composables/useBrain.ts` | 不再 prompt 注入 |
| `src/stores/agentStore.ts` | 不再参与执行链 |

### 🟢 优化 (P3)

| 文件 | 修改类型 |
|------|---------|
| `src/opencodeClient/client.ts` | Provider 变更检测 |
| `src/opencodeClient/sessionCommands.ts` | 补遗漏命令 |
| `src/stores/sessionStore.ts` | 展开偏好持久化 |

---

## 5. 禁止与约束

### 5.1 分支边界（必须遵守）

- ✅ 只在 `duiqiopencode` 上修改桌面端 OpenCode 相关代码
- ❌ 不修改 `src-tauri/**` 中与 OpenCode 无关的代码
- ❌ 不修改 Web 直连路径 (`web` 分支代码)
- ❌ 不混入旧知识库产品面代码

### 5.2 不回退的已完成修复

| 项目 | 说明 |
|------|------|
| API "Load failed" | Rust HTTP bridge 已修复，不动 |
| Session Token | Rust 文件存储 0600，不动 |
| SKILL.md 远程加载 | 白名单+大小限制已加，不动 |
| 知识库自动沉淀 | 已禁用 ingestAssistantOutput，不移除 |

### 5.3 保持的产品原则

1. Skill 保持官方形态（SKILL.md + references/scripts/assets）
2. 知识库只接受用户手动添加
3. 工具必须用户显式开启
4. OpenCode 项目目录真实贯穿 server/client/session/tool
5. 桌面专属能力隔离在 `src-tauri/` 和 `src/opencodeClient/`

---

## 6. 验证矩阵

每个 Phase 完成后执行：

```bash
# 类型检查
pnpm exec vue-tsc -b

# 前端构建
pnpm exec vite build

# 桌面构建（P1+ 阶段）
pnpm run build:desktop
pnpm run tauri:build

# 单元测试
pnpm run test:focused:build && pnpm run test:focused:run

# OpenCode 专项测试
pnpm run test:conversation
```

### Phase 专项验证

| Phase | 额外验证 |
|:-----:|---------|
| P0 | `opencode --version` 输出 v1.17.9；SDK import 无错误 |
| P1 | 发一条消息 → 观察 tool call part 渲染、错误行、滚动行为 |
| P2 | 触发 tool error → 验证 ToolErrorCard；触发 permission → 验证 Dock |
| P3 | 选择 Skill → 确认用官方 skill tool；选择 Vault → 确认文件上下文注入 |
| P4 | 测试 undo/redo → 确认 session 操作正确 |

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:---:|:---:|---------|
| SDK 1.17.6→1.17.9 breaking change | 低 | 高 | `vue-tsc -b` 前置；git revert 回滚路径 |
| Tauri 侧 spawn 行为变更 | 低 | 中 | 保留 `resolve_opencode_binary()` 多级回退 |
| 旧 useChat 双引擎冲突 | 中 | 中 | 改动限定在 OpenCode 路径，不碰直连路径 |
| Skill 迁移用户不适应 | 中 | 低 | 过渡期保留旧选择器 UI，底层切换 |
| 版本号不同步（二进制 vs SDK） | 中 | 高 | 更新脚本自动校验版本一致性 |

---

## 8. 时间线估计

| Phase | 内容 | 估时 | 依赖 |
|:-----:|------|:----:|:----:|
| P0 | 版本同步 | 0.5d | 无 |
| P1 | 事件处理 + Part 渲染 | 1.5d | P0 |
| P2 | Dock 补全 + Tool Part | 1.5d | P1 |
| P3 | Skill/Vault 官方机制 | 2d | P1 |
| P4 | Session 命令 + UX 收口 | 1d | P2, P3 |
| **总计** | | **6.5d** | |

> 注：以上为净编码时间估计，不含测试和调试。

---

## 附录 A: 版本更新命令速查

```bash
# 更新 SDK
pnpm add @opencode-ai/sdk@1.17.9

# 更新 Plugin
cd .opencode && pnpm add @opencode-ai/plugin@1.17.9

# 更新二进制
node scripts/update-opencode-runtime.mjs

# 验证版本
./src-tauri/binaries/opencode --version
grep version src/data/opencodeRuntimeInfo.ts
```

## 附录 B: 关键官方源码位置

| 用途 | 路径 (anomalyco/opencode) |
|------|--------------------------|
| Part 渲染规则 | `packages/ui/src/components/message-part.tsx` |
| 事件 reducer | `packages/app/src/context/global-sync/event-reducer.ts` |
| Composer + Dock | `packages/app/src/pages/session/composer/session-composer-region.tsx` |
| Session 命令 | `packages/app/src/pages/session/use-session-commands.tsx` |
| Skill 系统提示 | `packages/opencode/src/session/system.ts` |
| Skill 工具实现 | `packages/opencode/src/tool/skill.ts` |
| 权限规则引擎 | `packages/opencode/src/permission/` |
| 文件读取工具 | `packages/opencode/src/tool/read.ts` |

## 附录 C: 关联 SDD 文档索引

| 文档 | 用途 |
|------|------|
| `opencode-core-skill-kernel-sdd.md` | Skill 内核设计 |
| `opencode-official-capability-carrier-sdd.md` | 官方能力承载方案 |
| `opencode-hardening-d0-official-carrier-parity.md` | D0 硬化缺口清单 |
| `opencode-hardening-a-c-tdd-plan.md` | A-C TDD 测试计划 |
| `opencode-official-ui-behavior-porting-sdd.md` | UI 行为移植方案 |
| `opencode-hardening-a-c-acceptance-audit.md` | A-C 验收审计 |
| `opencode-official-ui-parity-matrix.md` | UI 映射表 |
