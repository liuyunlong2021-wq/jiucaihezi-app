# OpenCode Official UI Behavior Porting SDD

## 1. Highest Principle

韭菜盒子必须完整承载 OpenCode 官方能力。凡是韭菜盒子现有 UI、状态结构、消息结构、滚动逻辑、工具展示或交互方式承载不了官方能力的地方，优先修改韭菜盒子，而不是削弱、裁剪或绕开 OpenCode。

OpenCode 是核心运行时。韭菜盒子是产品壳、工作台和创作环境。适配方向是官方能力 100% 内化到韭菜盒子，而不是用韭菜盒子的旧 UI 反向限制 OpenCode。

## 2. Decision

放弃 iframe 承载官方 Web UI 作为产品方案。官方 Web UI 只作为行为参考和实现样本。

继续使用韭菜盒子原生 Vue ChatPanel，但 ChatPanel 的消息语义、事件同步、工具卡片、滚动行为、状态机、权限确认、问题确认、todo、diff、reasoning、上下文统计等能力必须逐项对齐 OpenCode 官方 UI。

## 3. Source Map

| 官方区域 | 官方文件 | 作用 |
|---|---|---|
| Session 主页面 | `packages/app/src/pages/session.tsx` | session 页面编排、滚动、状态、输入区、时间线挂载 |
| 消息时间线 | `packages/app/src/pages/session/message-timeline.tsx` | 消息行渲染、工具 part、diff、错误、copy、分享 |
| 时间线数据模型 | `packages/app/src/pages/session/message-timeline.data.ts` | message/part 转 TimelineRow |
| 自动滚动 | `packages/ui/src/hooks/create-auto-scroll.tsx` | 底部跟随、用户滚动暂停、强制滚到底 |
| 消息 part UI | `packages/ui/src/components/message-part.tsx` | text/reasoning/tool/file/diff 等 part 渲染 |
| 消息 part 样式 | `packages/ui/src/components/message-part.css` | 官方 part 视觉和展开状态 |
| 工具摘要 | `packages/ui/src/components/tool-count-summary.tsx` | 工具数量摘要 |
| 工具状态标题 | `packages/ui/src/components/tool-status-title.tsx` | 工具 pending/completed/error 标题 |
| 工具错误 | `packages/ui/src/components/tool-error-card.tsx` | 工具失败展示 |
| diff 展示 | `packages/ui/src/components/session-diff.ts` / `diff-changes.tsx` | 文件变更摘要和 diff |
| 全局事件同步 | `packages/app/src/context/global-sync/event-reducer.ts` | OpenCode event 到 store 的 reducer |
| 同步启动 | `packages/app/src/context/global-sync/bootstrap.ts` | 初始拉取、订阅、重连、状态装载 |
| session cache | `packages/app/src/context/global-sync/session-cache.ts` | session 数据缓存 |
| session load | `packages/app/src/context/global-sync/session-load.ts` | session/messages/parts 加载 |
| permission | `packages/app/src/context/permission.tsx` | 权限确认和 auto accept |
| permission dock | `packages/app/src/pages/session/composer/session-permission-dock.tsx` | 权限确认 UI |
| question dock | `packages/app/src/pages/session/composer/session-question-dock.tsx` | Agent 提问 UI |
| todo dock | `packages/app/src/pages/session/composer/session-todo-dock.tsx` | OpenCode todo UI |
| revert dock | `packages/app/src/pages/session/composer/session-revert-dock.tsx` | revert 状态 UI |
| followup dock | `packages/app/src/pages/session/composer/session-followup-dock.tsx` | 后续建议 UI |
| prompt input | `packages/app/src/components/prompt-input.tsx` | 输入区主体 |
| request parts | `packages/app/src/components/prompt-input/build-request-parts.ts` | text/file/agent/image 转请求 parts |
| attachments | `packages/app/src/components/prompt-input/attachments.ts` | 附件状态 |
| slash commands | `packages/app/src/components/prompt-input/slash-popover.tsx` | slash 命令入口 |
| session commands | `packages/app/src/pages/session/use-session-commands.tsx` | abort/revert/fork/summarize/share 等命令 |
| context usage | `packages/app/src/components/session/session-context-*` | 上下文统计、token breakdown |
| settings | `packages/app/src/context/settings.tsx` | reasoning、tool 展开等设置 |

## 4. Porting Matrix

| 编号 | 官方能力 | 必须内化成韭菜盒子的功能 | 我们的落点 | 优先级 | 验收 |
|---|---|---|---|---|---|
| OC-001 | event reducer | 所有 OpenCode event 统一进 reducer，不在 ChatPanel 内散落 if/else | `src/opencodeClient/eventBridge.ts`, `src/stores/sessionStore.ts` | P0 | event log 中 message/status/part 更新都能进入同一状态源 |
| OC-002 | session status | busy/idle/retry/error 以 OpenCode 状态为准 | `src/composables/useChat.ts`, `AgentStatusBar.vue` | P0 | 不再出现回复结束后仍显示回复中 |
| OC-003 | message.part.updated | part 更新按 messageID/partID 原地更新 | `src/opencodeClient/messageMapper.ts` | P0 | 工具、正文、reasoning 不丢失、不串位 |
| OC-004 | message.part.delta | delta 实时进入对应 part | `eventBridge.ts`, `useChat.ts` | P0 | 发消息 1 秒内出现首批文字或工具状态 |
| OC-005 | auto scroll | 底部时自动跟随，用户上滑时暂停，点击回到底部恢复 | `ChatPanel.vue`, `ChatScrollNav.vue` | P0 | 输出时当前生成内容始终可见；用户手动上滑不被强拉回底 |
| OC-006 | timeline row model | user turn、assistant part、thinking、diff、error 分行组织 | 新增 `src/opencodeClient/timelineRows.ts` | P1 | MessageBubble 不再承担所有结构判断 |
| OC-007 | text part | 正文 part 独立渲染 | `MessageBubble.vue` | P1 | 多段 text part 按顺序显示 |
| OC-008 | reasoning part | reasoning 独立区域，可折叠/可隐藏 | `MessageBubble.vue`, `AgentStatusBar.vue` | P1 | reasoning 不混入正文 |
| OC-009 | thinking row | busy 且未产生正文时显示 thinking | `AgentStatusBar.vue` 或 timeline row | P1 | 不再只有空白等待 |
| OC-010 | tool pending | 工具开始时立刻显示工具卡 | `ToolCallCard.vue` | P1 | read/bash/edit/glob/grep 调用开始即出现 |
| OC-011 | tool completed | 工具结果进入折叠区 | `ToolCallCard.vue` | P1 | 用户能看到工具结果摘要和展开内容 |
| OC-012 | tool error | 工具失败显示错误卡 | `ToolCallCard.vue` | P1 | 错误明确、不会吞掉 |
| OC-013 | tool default open | shell/edit 按官方规则默认展开或折叠 | `ToolCallCard.vue` | P1 | 展开策略与官方一致 |
| OC-014 | context tool group | 多个上下文工具组合显示 | `ToolCallCard.vue` 或新增组件 | P2 | 连续工具调用不是一堆散乱文本 |
| OC-015 | file/attachment part | file/image/agent part 显示为标签或附件卡 | `MessageBubble.vue`, `FileUploader.vue` | P2 | 文件输入和回显不丢 |
| OC-016 | compaction | compaction 显示为系统事件，不塞正文 | `timelineRows.ts` | P2 | 用户知道发生上下文压缩 |
| OC-017 | agent switch | agent switch 只更新状态/系统行 | `AgentStatusBar.vue` | P2 | 不再输出“系统事件 Agent 切换”污染正文 |
| OC-018 | diff summary | 文件变更摘要独立显示 | 新增 `DiffSummaryCard.vue` | P2 | 修改文件数量和变更统计可见 |
| OC-019 | diff detail | diff 可展开查看 | 后续接编辑区/审查面板 | P3 | 可看单文件 diff |
| OC-020 | error row | session/message error 独立行 | `MessageBubble.vue` 或 `TimelineErrorRow.vue` | P1 | 错误出现后状态结束 |
| OC-021 | retry status | retry 状态可见 | `AgentStatusBar.vue` | P2 | 限流/失败重试有提示 |
| OC-022 | abort | abort 调 OpenCode 官方 abort，UI 立即进入 cancelling | `useChat.ts` | P0 | 点击停止后 server 停止，UI 不残留 |
| OC-023 | final sync | idle 后拉取最终 messages/parts 修正乐观状态 | `useChat.ts` | P0 | 最终历史与 OpenCode 一致 |
| OC-024 | session cache | session 数据按官方方式缓存/淘汰 | `sessionStore.ts` | P3 | 多会话切换不卡、不串 |
| OC-025 | session prefetch | 切换会话前预加载消息 | `sessionStore.ts` | P4 | 历史打开更快 |
| OC-026 | permission request | OpenCode permission 显示为确认 dock | 新增 `PermissionDock.vue` | P2 | 用户能 allow/deny |
| OC-027 | auto accept | 支持官方 auto accept 语义 | 设置页 + permission bridge | P3 | 权限策略可配置 |
| OC-028 | question request | Agent 反问用问题 dock 承载 | 新增 `QuestionDock.vue` | P2 | 多选/文本问题能回答 |
| OC-029 | todo dock | OpenCode todo 原生展示 | 新增 `TodoDock.vue` | P2 | todo 状态 pending/in_progress/completed 可见 |
| OC-030 | revert dock | revert/unrevert 状态承载 | 后续命令区 | P4 | 回滚操作可见 |
| OC-031 | followup dock | 后续建议承载 | 后续命令区 | P4 | 回复后建议可见 |
| OC-032 | prompt request parts | 输入转 OpenCode parts，而不是纯 text | `useChat.ts`, `FileUploader.vue` | P2 | 文件/图片/agent mention 能结构化发送 |
| OC-033 | slash command | slash command 接 OpenCode command | 输入区命令菜单 | P3 | `/compact`, `/summarize` 等可执行 |
| OC-034 | model list | 模型列表来自 OpenCode | 模型选择器 | P3 | provider/model 与官方一致 |
| OC-035 | agent list | agent 列表来自 OpenCode | agent/模式选择器 | P3 | coder/build/plan 等官方 agent 可选 |
| OC-036 | context usage | Token/上下文统计来自 OpenCode | Token 水位计 | P3 | 不再靠旧估算冒充官方上下文 |
| OC-037 | session commands | fork/summarize/share/delete/archive 映射官方命令 | 会话菜单 | P4 | 官方 session 能力逐项可用 |
| OC-038 | terminal/shell | shell 工具结果按官方 terminal 语义展示 | 工具卡/后续终端面板 | P4 | shell 输出可读，不塞正文 |
| OC-039 | review/diff panel | 文件修改 review 面板 | 编辑区/右侧审查面板 | P4 | Agent 修改文件可审查 |
| OC-040 | notification | session idle/error 通知 | 通知系统 | P4 | 长任务完成/失败有提示 |

## 5. Implementation Order

### P0: Stop The Current Bad Experience

1. 修复自动滚动，照官方 `create-auto-scroll` 行为实现。
2. 修复 session 状态卡死，状态只以 OpenCode `session.status` / `session.idle` / `session.error` 为准。
3. 修复 delta 写入，按 messageID/partID 更新响应式 part。
4. 完成后 idle 拉取最终 messages/parts 同步。
5. abort 必须走官方 abort 并立即反映到 UI。

### P1: Message Part Correctness

1. 建立 `OpenCodeTimelineRow` 数据模型。
2. messageMapper 不再压扁成 content 字符串。
3. text/reasoning/tool/error 分开渲染。
4. 工具 pending/completed/error 卡片上线。

### P2: Official Interactive Docks

1. permission dock。
2. question dock。
3. todo dock。
4. file/image/agent part 标签。
5. compaction/agent switch 系统事件。

### P3: Official Lists And Context

1. model.list 接入。
2. agent.list 接入。
3. context usage 接入。
4. session cache/prefetch。

### P4: Full Official Surface

1. session fork/summarize/share/archive/delete。
2. diff/review panel。
3. slash command。
4. terminal/shell rich display。
5. notifications。

## 6. Non-Negotiable Acceptance Rule

每一个 OpenCode 官方 event、part type、session status、command、permission、question、tool state，都必须有韭菜盒子承载方式。

承载方式必须以官方行为为裁决：官方显示在 timeline 的，韭菜盒子显示在 timeline；官方放在 dock 的，韭菜盒子放在 dock；官方明确隐藏的内部/被动工具，韭菜盒子也隐藏，但必须通过对应 dock、状态、错误或最终结果承载其影响。

允许韭菜盒子的视觉风格不同；不允许能力缺失、状态丢失、part 压扁、官方应可见的工具不可见、错误被吞、回复中卡死、滚动不跟随。
