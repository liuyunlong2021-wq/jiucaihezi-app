# OpenCode 对齐方案 — duiqiopencode 支线

> **日期**: 2026-06-22
> **分支**: `duiqiopencode` (基于 `desktop`)
> **目标**: 桌面端 APP 完整覆盖 OpenCode 官方所有能力，消除版本偏差、事件处理缺口、UI 承载缺口
> **参考**: `CLAUDE.md`、`AGENTS.md`、`anomalyco/opencode` 上游仓库
> **关联 SDD**: `opencode-core-skill-kernel-sdd.md`、`opencode-official-capability-carrier-sdd.md`、`opencode-hardening-d0-official-carrier-parity.md`、`opencode-official-ui-parity-matrix.md`

---

## 0. 执行摘要

韭菜盒子 Studio 桌面端深度集成 OpenCode（`@opencode-ai/sdk` v1.17.6 + binary v1.17.0），通过 16 个 TypeScript 封装模块 + Rust 进程管理 + `useChat.ts` 中央编排器，实现了完整的 project directory → session → permission → tool → timeline 数据流。

本文档基于 D0 官方能力对齐矩阵的完整分析，制定覆盖所有 OpenCode 能力缺口的执行方案，分 P0-P4 五个 Phase 执行。

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
| **事件归一化** | `event-reducer.ts` (global-sync) | `eventBridge.ts` + `useChat.ts` 内联 | **需对齐事件处理语义** |
| **Part 渲染规则** | `renderable()` + `ToolPartDisplay` | `timelineRows.ts` + `OpenCodePartList.vue` | **需对齐隐藏/展示规则** |
| **Dock 系统** | Composer 上方内联 | 独立 Vue 组件 | **需补 RevertDock / FollowupDock** |
| **Session 命令** | `use-session-commands.tsx` | `sessionCommands.ts` | **已大部分覆盖，需补 undo/redo/mcp** |
| **Skill 机制** | 官方 `skill` tool + 系统提示 | `skillScope.ts` + `agentStore.ts` | **需验证官方 skill tool 流程** |
| **事件类型覆盖** | 30+ 事件类型 | ~20 事件类型 | **需补 message.removed/updated 等** |
| **VCS 状态** | `vcs.branch.updated` 维护 | 无处理 | **需补 VCS 状态承载** |

---

## 3. 完整缺口清单（D0 矩阵）

本节是能力对齐的事实源，所有 Phase 的改动均以此为准。

### 3.1 硬缺口（P0，阻塞 OpenCode 正常使用）

| 编号 | 缺口描述 | 官方规则 | 现状 | 修复动作 |
|------|---------|---------|------|---------|
| **HD-001** | `session.status:error` 未完整承载 | status error 必须结束 working 并显示错误 | 无 error row，UI 可能卡住 | 映射为 error row，停止 streaming |
| **HD-002** | event stream close/error 无 UI carrier | 断连不能让 UI 卡死 | `subscribeOpenCodeEvents()` 异步错误吞掉 | 加 `onError/onClose` 回调，触发最终同步或错误行 |
| **HD-003** | 非 text/reasoning delta 丢失 | `message.part.delta` 按任意 `field` 追加 | `applyOpenCodePartDelta()` 只支持 text/reasoning | 改为支持任意 string field，保留 raw |

### 3.2 功能缺口（P1，影响 OpenCode 交互体验）

| 编号 | 缺口描述 | 官方规则 | 现状 | 修复动作 |
|------|---------|---------|------|---------|
| **D0-002** | `message.part.updated` 未实现 skip 规则 | 跳过 `patch`/`step-start`/`step-finish` 事件更新 | 直接 upsert 无 skip 检查 | 加 SKIP_PARTS 列表检查 |
| **D0-006** | `session.status:retry` 无 timeline row | 显示 Retry 行 | 仅状态栏部分承载 | 改为 retry timeline row |
| **D0-009** | 完成事件兼容不足 | `session.finished`/`session.next.finished`/`session.closed` | 只覆盖部分完成事件 | 补齐所有完成事件名 |
| **D0-030** | 中断/abort 无 timeline divider | 显示 interrupted divider | abort 有实现，timeline 弱 | 加 interrupted 分割线行 |
| **D0-032** | 滚动不跟随输出 | 底部时内容变化自动跟随；用户上滑暂停 | 用户反馈仍会跑出视野 | 对齐官方多帧锁底策略 |
| **MSG-001** | `message.updated` 事件无处理 | 维护消息元数据同步 | 只通过 API 重新获取 | 添加 `message.updated` handler |
| **MSG-002** | `message.removed` 事件无处理 | 从会话中移除消息 | 零处理 | 添加 `message.removed` handler |
| **MSG-003** | `message.part.removed` 事件无处理 | 从消息中移除 part | 零处理 | 添加 `message.part.removed` handler |
| **SES-001** | `session.created/updated/deleted` 无处理 | 维护会话列表同步 | 零处理 | 添加会话生命周期事件 handler |
| **CMD-001** | `session.undo` 缺失 | 撤销上轮操作 | 缺失 | 新增撤销按钮 + `revertOpenCodeSessionMessage` |
| **CMD-002** | `session.redo` 缺失 | 重做上轮操作 | 缺失 | 新增重做按钮 |
| **CMD-003** | `/model` 错误发给 server | 只应打开本地选择器 | 当前调用 `session.command()` | 改为只打开模型选择器 |
| **CMD-004** | `permissions.autoaccept` 开关缺失 | 控制权限自动批准 | 缺失 | 新增设置开关 |

### 3.3 UI 承载缺口（P2，影响使用体验）

| 编号 | 缺口描述 | 官方规则 | 现状 | 修复动作 |
|------|---------|---------|------|---------|
| **D0-012** | 空 assistant 前无 thinking row | 显示 thinking/推理中 | 状态栏承载，timeline 弱 | 加 thinking timeline row |
| **D0-013** | context tools 未 group 折叠 | 连续 `read/glob/grep/list` 分组为 N 项 | 已有 `isContextOpenCodeTool()` 但 UI 未完整 group | 实现 ContextToolGroup 折叠渲染 |
| **D0-016** | ToolErrorCard 弱 | 错误可复制/展开，websearch 显示 provider | 工具错误卡弱 | 补复制按钮、展开详情 |
| **D0-021** | question dismissed/error 无提示 | 弱系统提示 "问题已跳过" | 不完整 | 补 dismissed/error 系统行 |
| **D0-024** | `bash` 展开策略未对齐 | 默认展开由 `shellToolPartsExpanded` 设置控制 | 展开策略硬编码 | 接入用户设置控制 |
| **D0-025** | `edit/write/apply_patch` 展开策略未对齐 | 默认展开由 `editToolPartsExpanded` 设置控制 | 展开策略硬编码 | 接入用户设置控制 |
| **D0-026** | `task` 子任务 tool 卡泛化 | 显示子 session metadata，可跳转子 session | 仅泛化展示 | 补子任务 metadata 展示 |
| **D0-027** | `skill` tool 卡泛化 | 显示 Skill 加载状态，失败给修复建议 | 仅泛化展示 | 补 Skill 加载状态和失败建议 |
| **D0-028** | `websearch/webfetch` 工具卡无 URL 摘要 | websearch 显示 provider title 和 URL | 泛化展示 | 补 URL 摘要显示 |
| **D0-029** | compaction/interrupted 未作 divider | 系统分割线，不进正文 | 已系统事件化但显示弱 | 改为明确 divider 样式 |
| **D0-031** | idle 后无 diff summary | 每轮 idle 后显示 diff 文件摘要 | 已有 DiffReviewDock，但缺摘要行 | 补每轮 diff 摘要 row |
| **DOCK-001** | RevertDock 缺失 | 撤回后展示可恢复项，位于输入区上方 | 缺失 | 新建 RevertDock.vue |
| **DOCK-002** | FollowupDock 缺失 | 后续操作建议，可发送或编辑 | 缺失 | 新建 FollowupDock.vue |
| **CMD-005** | `mcp.toggle` / `/mcp` 缺失 | 打开 MCP dialog | 缺失 | 新增设置/插件页入口 |
| **CMD-006** | Agent 选择器文案不清晰 | "Agent: 自动/xxx" | "自动" 无明确选项 | 改为带选项的 Agent 菜单 |
| **CMD-007** | `model.variant.cycle` 缺失 | 切换模型 variant | 缺失 | 模型菜单补 Variant 切换 |
| **VCS-001** | `vcs.branch.updated` 无处理 | 维护 VCS 分支状态显示 | 零处理 | 添加分支状态 handler 和 UI |

### 3.4 架构优化（P3，不阻塞功能）

| 编号 | 优化项 | 说明 |
|------|-------|------|
| **ARC-001** | 提取 `prepareOpenCodeConversation()` | `ensureOpenCodeCommandSession()` 和 `sendMessage()` 中 25+ 行重复的服务器+客户端+会话创建逻辑合并 |
| **ARC-002** | Provider 配置变更检测 | 当 NewAPI key/model 变更时自动重建 `OpencodeClient` |
| **ARC-003** | 统一工具状态管理 | 消除 `streamingTools` Map 和 `openCodeParts` 数组双轨并行，统一到 parts |
| **ARC-004** | 日志基础设施 | 统一日志级别、格式化、持久化 |
| **ARC-005** | `OpenCodeRenderablePart` 类型扩展 | 支持任意 delta 字段，避免类型定义限制字段传递 |

---

## 4. 对齐 Phase 规划

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
- v1.17.0 → v1.17.9 可能存在 API breaking change
- `(client as any).v2.xxx` 的动态调用方式降低了类型安全性
- 解决方案：运行 `vue-tsc -b` 捕获类型错误，逐一修复

**退出标准**:
- [x] 二进制版本 v1.17.9
- [x] SDK 版本 1.17.9
- [x] Plugin 版本 1.17.9
- [x] `vue-tsc -b` 通过
- [x] `vite build` 通过

---

### Phase 1: 事件处理硬缺口修复 (P0 🔴)

**目标**: 修复 HD-001/HD-002/HD-003 三个硬缺口 + 完成事件兼容 + Part SKIP 规则 + 消息事件补全。

**官方裁决依据**:
- `packages/app/src/context/global-sync/event-reducer.ts` — 事件 upsert/delta/skip 规则
- `packages/app/src/pages/session/message-timeline.tsx:485-596` — 滚动锁底策略

#### 1.1 `message.part.delta` 字段泛化 (HD-003)

**现状**: `applyOpenCodePartDelta()` 只接受 `text | reasoning` 字段，其他字段静默丢弃。
**官方规则** (event-reducer.ts:279-296): 对任意 string field 追加 delta。
**目标**: 接受任意 string field，保留 raw；扩展 `OpenCodeRenderablePart` 允许额外字段。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/types.ts` | `OpenCodeRenderablePart` 添加 `[key: string]: unknown` 索引签名或扩展字段集 |
| `src/opencodeClient/timelineRows.ts` | `applyOpenCodePartDelta()` 改为 `(next as any)[field] = ...` 覆盖所有字段 |
| `src/opencodeClient/__tests__/timelineRows.test.ts` | 新增非 text/reasoning delta 测试 |

#### 1.2 `message.part.updated` SKIP 规则 (D0-002)

**官方规则** (event-reducer.ts:19,228): `SKIP_PARTS = new Set(["patch","step-start","step-finish"])` 跳过这些类型的 part.updated。
**现状**: `upsertOpenCodePart()` 无此跳过逻辑，导致 patch/step-start/step-finish 重复更新触发不必要渲染。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | `message.part.updated` handler 在 upsert 前检查 `part.type` 是否在 SKIP 列表 |
| `src/opencodeClient/__tests__/timelineRows.test.ts` | 表驱动跳过测试：patch/step-start/step-finish 不更新 |

#### 1.3 `session.status:error` 承载 (HD-001)

**现状**: `session.status:error` 不会停止 streaming，也没有 error row。
**目标**: 映射为 timeline 错误行，停止 streaming，显示错误详情（可复制）。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | `session.status` handler 中 `status.type === 'error'` 分支：finalize streaming + 推送 error part |
| `src/opencodeClient/timelineRows.ts` | error part 渲染为带错误原因的红色 row |
| `src/components/chat/OpenCodePartList.vue` | error row 样式 + 复制按钮 |

#### 1.4 Event stream close/error carrier (HD-002)

**现状**: `subscribeOpenCodeEvents()` 异步错误吞掉，断连后 UI 可能卡死。
**目标**: 支持 `onError/onClose` 回调，触发最终稳定同步或显示连接错误行。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/eventBridge.ts` | `SubscribeOpenCodeEventsInput` 接口已有 `onError/onClose`，确保实现层实际调用 |
| `src/composables/useChat.ts` | 传入 `onError` → 推送 connection-error row；`onClose` → finalize streaming |

#### 1.5 完成事件兼容补全 (D0-009)

**现状**: 只处理 `session.idle`/`session.finished`/`session.next.finished`，可能遗漏其他完成信号。
**目标**: 对齐 SDK 实际支持的所有完成事件名。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/runEvents.ts` | `isOpenCodeRunCompleteEvent()` 补全 `session.closed`/`session.next.closed` 等 |
| `src/opencodeClient/__tests__/runEvents.test.ts` | 逐一测试各完成事件变种 |

#### 1.6 `message.updated/removed` + `message.part.removed` 事件 (MSG-001/002/003)

**现状**: 三个事件均无处理，会话内删消息/改消息会导致 UI 状态不一致。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | 新增三个事件 handler：`message.updated` 更新 openCodeMessages；`message.removed` 删除；`message.part.removed` 删除 part |

#### 1.7 Session 生命周期事件 (SES-001)

**现状**: `session.created/updated/deleted` 无处理，会话列表可能过期。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | 新增三个事件 handler，触发对应会话列表刷新 |

#### 1.8 Scroll lock 策略对齐 (D0-032)

**官方策略** (message-timeline.tsx:485-596): 内容变化且用户在底部时才自动跟随；工具卡高度变化后多帧锁底。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ChatScrollNav.vue` | 改进锁底逻辑：多帧检测 + 工具卡高度变化后重新判断 |

#### 1.9 `session.status:retry` 承载 (D0-006)

**现状**: retry 仅在状态栏显示，timeline 无 row。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | `session.status:retry` → 推送 retry system row |
| `src/opencodeClient/timelineRows.ts` | retry row 渲染 |

**退出标准**:
- [x] `applyOpenCodePartDelta` 支持任意字段
- [x] `upsertOpenCodePart` 跳过 patch/step-start/step-finish
- [x] `session.status:error` 显示 error row，停止 streaming
- [x] Event stream 断连后 UI 不卡死，显示连接错误行
- [x] 所有完成事件变种均可触发 finalize
- [x] `message.updated/removed`、`message.part.removed` 正确更新 UI
- [x] Session 创建/更新/删除事件正确刷新会话列表
- [x] 滚动锁底行为正确（底部自动跟随，上滑暂停）
- [x] retry 状态有 timeline row
- [x] 所有测试通过

---

### Phase 2: Dock 系统补全 + Tool Part 渲染对齐 (P1 🟡)

**目标**: 补全缺失的 Dock 组件，工具 Part 渲染与官方 `ToolPartDisplay` 对齐，补全中断和 diff 承载。

**官方裁决依据**:
- `session-composer-region.tsx` — Dock 布局
- `message-part.tsx:559` — Context tool group
- `message-part.tsx:618` — bash/edit 展开策略
- `message-part.tsx:1359` — `ToolErrorCard`

#### 2.1 RevertDock (DOCK-001)

**现状**: 缺失。官方 `session-revert-dock.tsx` 在输入区上方展示可恢复项。

| 文件 | 操作 |
|------|------|
| `src/components/chat/RevertDock.vue` | **新建**：显示 revert 可恢复项列表，按钮"恢复" |
| `src/components/chat/ChatPanel.vue` | 集成到 composer 上方，由 `revert` session 状态控制显隐 |

#### 2.2 FollowupDock (DOCK-002)

**现状**: 缺失。官方 `session-followup-dock.tsx` 提供后续操作建议。

| 文件 | 操作 |
|------|------|
| `src/components/chat/FollowupDock.vue` | **新建**：显示后续建议列表，按钮"发送建议 / 编辑后发送" |
| `src/components/chat/ChatPanel.vue` | 集成到 composer 上方，由 `followup` session 事件控制显隐 |
| `src/composables/useChat.ts` | `session.followup` 事件触发 followup 数据更新 |

#### 2.3 Context Tool Group 可视化 (D0-013)

**现状**: `isContextOpenCodeTool()` 已有定义，但 UI 未完整 group 折叠。
**目标**: 连续 `read/glob/grep/list` 折叠为一组 "上下文读取 N 项"，默认折叠。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/timelineRows.ts` | `buildTimelineRows()` 对连续 context tool 做 group 合并 |
| `src/components/chat/OpenCodePartList.vue` | ContextToolGroup 折叠渲染，展开后显示每个工具卡 |

#### 2.4 ToolErrorCard 对齐 (D0-016)

**现状**: 工具错误展示弱，无复制、无详情展开。
**目标**: 对齐官方 `ToolErrorCard`，错误可复制/展开，websearch 显示 provider title。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | error 状态增加复制按钮、展开详情区域 |
| `src/components/chat/ToolCallCard.vue` | websearch/webfetch 工具卡显示 URL/provider title |

#### 2.5 bash/edit/write/apply_patch 展开策略 (D0-024/D0-025)

**现状**: 展开策略硬编码。
**目标**: `bash` 由 `shellToolPartsExpanded` 设置控制；`edit/write/apply_patch` 由 `editToolPartsExpanded` 设置控制。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | 根据 tool 类型读取对应展开偏好 |
| `src/stores/sessionStore.ts` | 持久化 `shellToolPartsExpanded`/`editToolPartsExpanded` 用户偏好 |

#### 2.6 task/skill tool 展示增强 (D0-026/D0-027)

**现状**: task 和 skill 工具卡仅泛化展示。
**目标**: task 显示子 session metadata，可跳转；skill 显示加载状态和失败修复建议。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | task tool：显示子任务 ID/标题，提供"打开子任务会话"按钮（入口后置） |
| `src/components/chat/ToolCallCard.vue` | skill tool：显示"已加载 Skill: xxx"，失败时给修复建议 |

#### 2.7 websearch/webfetch 工具卡 URL 摘要 (D0-028)

| 文件 | 修改 |
|------|------|
| `src/components/chat/ToolCallCard.vue` | websearch：摘要显示搜索 query + provider；webfetch：显示目标 URL |

#### 2.8 Compaction/interrupted divider (D0-029/D0-030)

**现状**: 已系统事件化但视觉弱。
**目标**: 明确 divider 样式，compaction 显示"上下文已压缩"，interrupted 显示"本轮已停止"。

| 文件 | 修改 |
|------|------|
| `src/components/chat/OpenCodePartList.vue` | system row 按 type 显示不同 divider 样式 |
| `src/opencodeClient/timelineRows.ts` | `buildTimelineRows()` 对 compaction/interrupted 生成 divider row |

#### 2.9 Thinking row 强化 (D0-012)

**现状**: 状态栏承载思考状态，timeline 中没有明确的 thinking row。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/timelineRows.ts` | 空 assistant 消息（无 parts 或仅 reasoning 为空）→ 生成 thinking row |
| `src/components/chat/OpenCodePartList.vue` | thinking row 独立渲染组件（动画 + "正在推理"文案） |

#### 2.10 DiffSummary row 增强 (D0-031)

**现状**: 有 DiffReviewDock，但缺每轮 idle 后的 diff 文件摘要行。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | `session.status:idle` 时若有 diff → 推送 diff-summary row |
| `src/components/chat/OpenCodePartList.vue` | diff-summary row 渲染（变更文件数 + 可点击展开 DiffReviewDock） |

#### 2.11 Question dismissed/error 提示 (D0-021)

**现状**: question 被跳过或出错时无 timeline 提示。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/timelineRows.ts` | question dismissed/error → 生成弱系统行 "问题已跳过" / "问题处理出错" |

**退出标准**:
- [x] RevertDock 可正常展示和交互
- [x] FollowupDock 可正常展示和交互
- [x] Context tools 连续读取正确 group 折叠为 N 项
- [x] ToolErrorCard 有复制按钮和展开详情
- [x] bash/edit 展开策略由用户设置控制
- [x] task tool 显示子任务 metadata
- [x] skill tool 显示加载状态
- [x] websearch/webfetch 工具卡有 URL/query 摘要
- [x] compaction/interrupted 显示为 divider
- [x] thinking row 出现在内容生成前
- [x] idle 后有 diff-summary 行
- [x] question dismissed/error 有系统提示行

---

### Phase 3: Session 命令 + 模型/Agent 选择器对齐 (P1 🟡)

**目标**: 补全缺失的 session 命令 UI、修复 `/model` 行为、Agent 选择器对齐。

**官方裁决依据**:
- `use-session-commands.tsx` — 官方命令注册
- `slash-popover.tsx` — slash 命令 UI（slash 不等于发给 server）

#### 3.1 Session 命令补全

| 命令 | 现状 | 动作 |
|------|:----:|------|
| `/new` (新建会话) | ✅ 已承载 | 保持 |
| `/compact` (压缩上下文) | ✅ 已承载 | 保持 |
| `/undo` (撤销上轮) | ❌ 缺失 | 新增按钮 + 快捷键，调用 `revertOpenCodeSessionMessage` |
| `/redo` (重做上轮) | ❌ 缺失 | 新增按钮 + 快捷键，调用 `unrevertOpenCodeSession` |
| `/fork` (分支) | 🟡 部分 | 确认 UI 入口 + 结果反馈 |
| `/share` (分享) | 🟡 部分 | 补取消分享、复制链接 |
| `/unshare` (取消分享) | ❌ 缺失 | 新增菜单项 |
| `/archive` (归档) | 🟡 部分 | 确认对话框 |
| `/delete` (删除) | 🟡 部分 | 确认对话框 |
| `/model` | ❌ 错误 | 当前错误发给 server → 改为只打开选择器 (CMD-003) |
| `/agent` | ❌ 文案不清 | 改为带选项 Agent 菜单 |
| `permissions.autoaccept` | ❌ 缺失 | 新增权限自动批准开关 (CMD-004) |
| `mcp.toggle` | ❌ 缺失 | 设置页 MCP 入口 (CMD-005) |

**文件**: `src/components/chat/ChatPanel.vue`、`src/opencodeClient/sessionCommands.ts`

#### 3.2 `/model` 行为修复 (CMD-003)

**现状**: 输入 `/model xxx` 调用 `session.command()`，server 不识别此命令。
**目标**: `/model` 只打开本地模型选择器。

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | `sendMessage()` 前检测 `/model` 前缀 → 拦截并打开选择器，不发给 server |
| `src/components/chat/ChatPanel.vue` | slash 面板中 `/model` 入口直接触发选择器 |

#### 3.3 Agent 选择器对齐 (CMD-006)

**现状**: "自动" 文案无明确选项，`/agent` 缺失。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ChatPanel.vue` | Agent 选择器改为带下拉选项："Agent: 自动 / Claude-3-Sonnet / ..." |
| `src/composables/useChat.ts` | `/agent` 输入拦截为打开 Agent 菜单，不发给 server |

#### 3.4 Permissions autoaccept 开关 (CMD-004)

| 文件 | 修改 |
|------|------|
| `src/components/settings/SettingsPanel.vue` | 新增"自动批准权限"开关 |
| `src/opencodeClient/interactive.ts` | `autoAccept` 开关控制权限自动回复逻辑 |

#### 3.5 MCP 入口 (CMD-005)

| 文件 | 修改 |
|------|------|
| `src/components/settings/SettingsPanel.vue` | 新增 MCP 外部工具配置区域 |

#### 3.6 Model Variant 切换 (CMD-007)

| 文件 | 修改 |
|------|------|
| `src/components/chat/ChatPanel.vue` | 模型菜单补"切换 Variant"子菜单 |

#### 3.7 Slash 命令面板完善

**现状**: slash 面板命令列表可能包含无效命令。
**目标**: 从官方 command registry 映射命令，标记来源（Skill/MCP/自定义）。

| 文件 | 修改 |
|------|------|
| `src/components/chat/ChatPanel.vue` | slash 面板过滤无效命令，只展示真实可用命令 |

**退出标准**:
- [x] undo/redo 按钮可见可用
- [x] 分享状态完整（分享/取消分享/复制链接）
- [x] `/model` 只打开选择器，不发给 server
- [x] Agent 选择器有明确选项
- [x] permissions.autoaccept 开关可用
- [x] MCP 设置入口存在
- [x] slash 面板无无效命令

---

### Phase 4: Skill + VCS + 架构收口 (P2 🟢)

**目标**: Skill 官方机制验证、VCS 事件承载、架构去重。

#### 4.1 Skill 官方 skill tool 验证

**禁止项**:
1. ❌ 不把 `SKILL.md` 手动拼进 system prompt
2. ❌ 不用旧 `triggers` / 中文名称 / `agentConfig` 自行决定执行

**现状**: `skillScope.ts` 通过 session permission 固定 Skill，应确认 system prompt 只列出 Skill 列表，由官方 `skill` tool 按需加载。

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/skillScope.ts` | 确认 `buildFixedSkillSystemInstruction()` 只生成 Skill 可用性列表，不注入 SKILL.md |
| `src/composables/useChat.ts` | 移除所有旧式 SKILL.md 手动注入逻辑 |

#### 4.2 VCS 状态事件承载 (VCS-001)

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | 新增 `vcs.branch.updated` handler，维护分支状态 |
| `src/components/chat/ChatPanel.vue` | 顶部显示当前 VCS 分支（可选，P3 后置） |

#### 4.3 架构去重：`prepareOpenCodeConversation()` (ARC-001)

| 文件 | 修改 |
|------|------|
| `src/composables/useChat.ts` | 提取 `prepareOpenCodeConversation()` 共享逻辑 |

#### 4.4 Provider 配置变更检测 (ARC-002)

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/client.ts` | 监听 API key/base 变更，自动重建 `OpencodeClient` |

#### 4.5 OpenCodeRenderablePart 类型扩展 (ARC-005)

| 文件 | 修改 |
|------|------|
| `src/opencodeClient/types.ts` | 添加 `[key: string]: unknown` 索引签名，支持任意 delta 字段 |

**退出标准**:
- [x] Skill 选择后不手动注入 SKILL.md 到 prompt
- [x] 官方 `skill` tool 正常加载 Skill
- [x] VCS 分支变更有处理
- [x] `prepareOpenCodeConversation()` 已提取
- [x] Provider 变更自动重建客户端

---

## 5. 文件改修清单

### 🔴 必改 (P0-P1)

| 文件 | Phase | 修改类型 |
|------|:-----:|:-------:|
| `package.json` | P0 | 版本号 |
| `.opencode/package.json` | P0 | 版本号 |
| `src/data/opencodeRuntimeInfo.ts` | P0 | 版本号 |
| `src/opencodeClient/types.ts` | P1/P4 | delta 字段扩展 |
| `src/opencodeClient/timelineRows.ts` | P1/P2 | delta 泛化 + skip 规则 + group + divider + thinking + diff-summary |
| `src/opencodeClient/eventBridge.ts` | P1 | onError/onClose 实现 |
| `src/opencodeClient/runEvents.ts` | P1 | 补完成事件变种 |
| `src/composables/useChat.ts` | P1-P4 | 事件处理全面补全 + 命令修复 + Skill 验证 |
| `src/components/chat/OpenCodePartList.vue` | P1/P2 | Part 渲染对齐 + system rows |
| `src/components/chat/ChatScrollNav.vue` | P1 | Scroll lock 多帧策略 |
| `src/components/chat/ToolCallCard.vue` | P2 | ToolErrorCard + 展开策略 + 工具特化 |
| `src/components/chat/ChatPanel.vue` | P2/P3 | Dock 集成 + 命令按钮 + Agent 选择器 |

### 🟡 改改 (P2-P3)

| 文件 | 修改类型 |
|------|---------|
| `src/components/chat/RevertDock.vue` | **新建** |
| `src/components/chat/FollowupDock.vue` | **新建** |
| `src/stores/sessionStore.ts` | 展开偏好持久化 |
| `src/opencodeClient/skillScope.ts` | 官方 skill tool 验证 |
| `src/opencodeClient/interactive.ts` | autoAccept 开关 |
| `src/opencodeClient/sessionCommands.ts` | 补 undo/redo（已有 revert/unrevert） |
| `src/components/settings/SettingsPanel.vue` | autoAccept 开关 + MCP 入口 |

### 🟢 优化 (P4)

| 文件 | 修改类型 |
|------|---------|
| `src/opencodeClient/client.ts` | Provider 变更检测 |
| `src/__tests__/timelineRows.test.ts` | 完整 D0 矩阵表驱动测试 |

---

## 6. 禁止与约束

### 6.1 分支边界（必须遵守）

- ✅ 只在 `duiqiopencode` 上修改桌面端 OpenCode 相关代码
- ❌ 不修改 `src-tauri/**` 中与 OpenCode 无关的代码
- ❌ 不修改 Web 直连路径 (`web` 分支代码)
- ❌ 不混入旧知识库产品面代码

### 6.2 不回退的已完成修复

| 项目 | 说明 |
|------|------|
| API "Load failed" | Rust HTTP bridge 已修复，不动 |
| Session Token | Rust 文件存储 0600，不动 |
| SKILL.md 远程加载 | 白名单+大小限制已加，不动 |
| 知识库自动沉淀 | 已禁用 ingestAssistantOutput，不移除 |
| 启动架构重构 | UI 优先挂载 + 异步后端，不动 |

### 6.3 保持的产品原则

1. Skill 保持官方形态（SKILL.md + references/scripts/assets）
2. 工具必须用户显式开启（OpenCode 官方工具除外）
3. OpenCode 项目目录真实贯穿 server/client/session/tool
4. 桌面专属能力隔离在 `src-tauri/` 和 `src/opencodeClient/`
5. 官方 timeline 行为不在客户端重实现 — 直接通过 SDK 调用

### 6.4 OpenCode 官方工具与韭菜盒子主动工具分离

| 类型 | 定义 | 控制方 |
|------|------|:------:|
| OpenCode 被动工具 | read/glob/grep/list/bash/edit/patch/task/skill/question/todowrite | OpenCode runtime 决定 |
| 韭菜盒子主动工具 | 格式转换/浏览器控制/媒体处理/项目读写 | 用户显式开启 |

旧 ToolPickerBar 对 OpenCode 被动工具的开关 **应删除**，只保留工具页对韭菜盒子主动工具的管理。

---

## 7. 验证矩阵

每个 Phase 完成后执行：

```bash
# 类型检查
pnpm exec vue-tsc -b

# 前端构建
pnpm exec vite build

# 单元测试
pnpm run test:focused:build && pnpm run test:focused:run

# OpenCode 专项测试
pnpm run test:conversation
```

### Phase 专项验证

| Phase | 额外验证 |
|:-----:|---------|
| P0 | `opencode --version` 输出 v1.17.9；SDK import 无错误 |
| P1 | 发消息 → 触发工具 → 观察 delta 字段、skip 规则、错误行、滚动行为 |
| P2 | 触发 permission → 验证 Dock；触发 context tools → 验证 group 折叠；检查 divider |
| P3 | 输入 `/model` → 仅打开选择器不发 server；undo/redo 按钮可用 |
| P4 | 选择 Skill → 确认用官方 skill tool；切换 API key → 确认自动重建 client |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:---:|:---:|---------|
| SDK 1.17.6→1.17.9 breaking change | 低 | 高 | `vue-tsc -b` 前置；git revert 回滚路径 |
| Tauri 侧 spawn 行为变更 | 低 | 中 | 保留 `resolve_opencode_binary()` 多级回退 |
| 旧 useChat 双引擎冲突 | 中 | 中 | 改动限定在 OpenCode 路径，不碰直连路径 |
| 事件处理顺序竞态 | 低 | 中 | 每次 upsert 都以 part ID 为 key，幂等操作 |
| 版本号不同步（二进制 vs SDK） | 中 | 高 | 更新脚本自动校验版本一致性 |

---

## 9. 时间线估计

| Phase | 内容 | 估时 | 依赖 |
|:-----:|------|:----:|:----:|
| P0 | 版本同步 | 0.5d | 无 |
| P1 | 事件处理硬缺口 + 滚动 | 2d | P0 |
| P2 | Dock 补全 + Tool Part 渲染 | 2d | P1 |
| P3 | Session 命令 + 选择器对齐 | 1.5d | P1 |
| P4 | Skill/VCS/架构收口 | 1d | P2, P3 |
| **总计** | | **7d** | |

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
| Slash 面板 | `packages/app/src/components/prompt-input/slash-popover.tsx` |
| Request parts 构建 | `packages/app/src/components/prompt-input/build-request-parts.ts` |
| 滚动锁底策略 | `packages/app/src/pages/session/message-timeline.tsx:485-596` |

## 附录 C: D0 矩阵覆盖状态速查

| 编号 | 描述 | Phase | 状态 |
|------|------|:-----:|:----:|
| D0-001 | `message.updated` upsert | P1 | ⬜ |
| D0-002 | `message.part.updated` SKIP 规则 | P1 | ⬜ |
| D0-003 | `message.part.delta` 任意字段 (HD-003) | P1 | ⬜ |
| D0-004 | `session.status:busy` | — | ✅ 已有 |
| D0-005 | `session.status:idle` | — | ✅ 已有 |
| D0-006 | `session.status:retry` timeline row | P1 | ⬜ |
| D0-007 | `session.status:error` (HD-001) | P1 | ⬜ |
| D0-008 | event stream close/error (HD-002) | P1 | ⬜ |
| D0-009 | 完成事件兼容 | P1 | ⬜ |
| D0-010 | text part | — | ✅ 已有 |
| D0-011 | reasoning part | — | ✅ 已有 |
| D0-012 | empty assistant thinking row | P2 | ⬜ |
| D0-013 | context tool group | P2 | ⬜ |
| D0-014 | tool pending/running | — | ✅ 基本已有 |
| D0-015 | tool completed 折叠 | — | ✅ 基本已有 |
| D0-016 | ToolErrorCard | P2 | ⬜ |
| D0-017 | todowrite 隐藏 | — | ✅ 已有 |
| D0-018 | TodoDock | — | ✅ 已有 |
| D0-019 | question pending/running 隐藏 | — | ✅ 基本已有 |
| D0-020 | QuestionDock | — | ✅ 已有 |
| D0-021 | question dismissed/error | P2 | ⬜ |
| D0-022 | PermissionDock | — | ✅ 已有 |
| D0-023 | permission.replied 清理 | — | ✅ 已有 |
| D0-024 | bash 展开策略 | P2 | ⬜ |
| D0-025 | edit/write/apply_patch 展开策略 | P2 | ⬜ |
| D0-026 | task 子任务 | P2 | ⬜ |
| D0-027 | skill tool 卡 | P2 | ⬜ |
| D0-028 | websearch/webfetch URL | P2 | ⬜ |
| D0-029 | compaction divider | P2 | ⬜ |
| D0-030 | interrupted divider | P2 | ⬜ |
| D0-031 | diff summary row | P2 | ⬜ |
| D0-032 | scroll lock | P1 | ⬜ |
| D0-033 | share/unshare 完整状态 | P3 | ⬜ |
| D0-034 | 主动/被动工具分离 | P3/P4 | ⬜ |
| MSG-001 | `message.updated` handler | P1 | ⬜ |
| MSG-002 | `message.removed` handler | P1 | ⬜ |
| MSG-003 | `message.part.removed` handler | P1 | ⬜ |
| SES-001 | session 生命周期事件 | P1 | ⬜ |
| CMD-001 | `/undo` (session.undo) | P3 | ⬜ |
| CMD-002 | `/redo` (session.redo) | P3 | ⬜ |
| CMD-003 | `/model` 只打开选择器 | P3 | ⬜ |
| CMD-004 | permissions.autoaccept | P3 | ⬜ |
| CMD-005 | mcp.toggle | P3 | ⬜ |
| CMD-006 | Agent 选择器文案 | P3 | ⬜ |
| CMD-007 | model.variant.cycle | P3 | ⬜ |
| DOCK-001 | RevertDock | P2 | ⬜ |
| DOCK-002 | FollowupDock | P2 | ⬜ |
| VCS-001 | `vcs.branch.updated` | P4 | ⬜ |
| ARC-001 | `prepareOpenCodeConversation()` 提取 | P4 | ⬜ |
| ARC-002 | Provider 变更重建 client | P4 | ⬜ |
| ARC-003 | 工具状态单轨 | P4 | ⬜ |
| ARC-004 | 日志基础设施 | P4 | ⬜ |
| ARC-005 | `OpenCodeRenderablePart` 类型扩展 | P1 | ⬜ |

## 附录 D: 关联 SDD 文档索引

| 文档 | 用途 |
|------|------|
| `opencode-core-skill-kernel-sdd.md` | Skill 内核设计 |
| `opencode-official-capability-carrier-sdd.md` | 官方能力承载方案 |
| `opencode-hardening-d0-official-carrier-parity.md` | D0 硬化缺口清单（事实源） |
| `opencode-hardening-a-c-tdd-plan.md` | A-C TDD 测试计划 |
| `opencode-official-ui-behavior-porting-sdd.md` | UI 行为移植方案 |
| `opencode-hardening-a-c-acceptance-audit.md` | A-C 验收审计 |
| `opencode-official-ui-parity-matrix.md` | UI 映射表（专业汉化建议） |
