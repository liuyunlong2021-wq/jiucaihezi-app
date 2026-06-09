# OpenCode Hardening D0 Official Carrier Parity

**Date:** 2026-06-08

**Goal:** 用 OpenCode 官方源码裁决韭菜盒子的聊天区承载规则。后续 D1/D2 只修与官方不一致的地方，不重新设计 OpenCode tool loop。

## 1. Rule

韭菜盒子必须完整承载 OpenCode 官方能力，但“承载”不等于“全部塞进普通消息流”。

官方显示在 timeline 的，韭菜盒子显示在 timeline。

官方放到 dock 的，韭菜盒子放到 dock。

官方用 permission/question 交互的，韭菜盒子必须提供同等交互。

官方隐藏的被动/内部工具，韭菜盒子也隐藏，但要保证其状态通过对应 dock 或最终结果被承载。

主动工具和 OpenCode 被动工具分离：

| 类型 | 定位 | 是否影响 OpenCode tool loop |
|---|---|---:|
| OpenCode 被动工具 | read / glob / grep / list / bash / edit / patch / task / skill / question / todowrite 等官方 runtime 能力 | 是，由 OpenCode 决定 |
| 韭菜盒子主动工具 | 格式转换、资料转文字、压缩转格式、视频字幕、网页媒体采集等未来“百宝箱”能力 | 否，独立入口 |

本轮只做 OpenCode 主线承载，不做“百宝箱”重构。

## 2. Official Source Map

| 官方文件 | 关键裁决 |
|---|---|
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:607](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:607) | `renderable()` 决定 part 是否进普通 timeline。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:608](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:608) | tool part 默认可见，但受隐藏规则和 question 状态影响。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:609](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:609) | `todowrite` 在普通 timeline 隐藏。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:610](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:610) | `question` pending/running 不进普通 timeline。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:618](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:618) | `bash`、`edit`、`write`、`apply_patch` 的默认展开由设置控制。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:559](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:559) | 连续 context tools 被 group 成 context 组。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:1359](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:1359) | tool part 统一进 ToolPartDisplay。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:1363](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:1363) | `todowrite` 在 ToolPartDisplay 中再次返回 null。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:1399](/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx:1399) | tool error 走 `ToolErrorCard`。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx:150](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx:150) | question dock 位于输入区上方。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx:158](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx:158) | permission dock 位于输入区上方。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx:194](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx:194) | todo dock 位于 prompt dock 内。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:228](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:228) | `message.part.updated` upsert part，并跳过 `patch`、`step-start`、`step-finish`。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:279](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:279) | `message.part.delta` 按事件给出的 `field` 追加到 part。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:306](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:306) | `permission.asked/replied` 维护 permission store。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:347](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/context/global-sync/event-reducer.ts:347) | `question.asked/replied/rejected` 维护 question store。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/message-timeline.tsx:485](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/message-timeline.tsx:485) | timeline 内容变化且仍在底部时，滚动到底部。 |
| [/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/message-timeline.tsx:596](/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/message-timeline.tsx:596) | 工具卡高度变化后多帧锁底，避免输出跑出视野。 |

## 3. Official Behavior To Jiucai Matrix

| 编号 | 官方能力/状态 | 官方裁决 | 韭菜盒子现状 | D1/D2 动作 |
|---|---|---|---|---|
| D0-001 | `message.updated` | upsert 到 session message store | 已有最终同步和 mapper，但仍偏 ChatMessage 模式 | D1 保持，补 event reducer 测试 |
| D0-002 | `message.part.updated` | upsert part；官方跳过 `patch`/`step-start`/`step-finish` 事件更新 | 已有 `upsertOpenCodePart`，但没有完全按官方 skip/排序语义测试 | D1 表驱动测试 |
| D0-003 | `message.part.delta` | 按 `field` 追加到对应 part 字段，不限 text/reasoning | 当前 `applyOpenCodePartDelta()` 只接受 `text | reasoning` | D1 必修，改为任意 string field |
| D0-004 | `session.status:busy` | 作为 active turn working 状态 | 基本承载 | D1 补回归测试 |
| D0-005 | `session.status:idle` | 结束 working，触发最终稳定 UI | 基本承载 | D1 补 `session.finished` 兼容 |
| D0-006 | `session.status:retry` | timeline 显示 Retry row | 状态栏部分承载 | D1/D2 对齐为 retry row 或明确状态行 |
| D0-007 | `session.status:error` | 必须结束 working 并显示错误 | A-C audit 已判缺口 | D1 必修 |
| D0-008 | event stream close/error | 官方 sync 层可刷新/重连；UI 不应卡死 | 当前 `subscribeOpenCodeEvents()` 异步错误会 throw 到后台 | D1 加 `onError/onClose` carrier |
| D0-009 | `session.finished` / `session.next.finished` | 完成信号兼容，多事件名以实际 SDK 为准 | 当前只覆盖部分完成事件 | D1 兼容并测试 |
| D0-010 | text part | 有内容才渲染，流式时 paced reveal | 已承载 | D2 可优化 paced reveal |
| D0-011 | reasoning part | 按设置显示；为空不显示 | 已承载 | D2 对齐 showReasoningSummaries |
| D0-012 | empty assistant before content | 显示 thinking row | 已有状态条，但 timeline 语义弱 | D2 对齐 thinking row |
| D0-013 | context tools `read/glob/grep/list` | 连续 group 成 `ContextToolGroup` | 目前 `isContextOpenCodeTool()` 有定义，但 UI 未完整 group | D2 必修 |
| D0-014 | ordinary tool pending/running | 立即显示工具卡和动态标题 | 已显示但较泛化 | D2 对齐 BasicTool 触发区 |
| D0-015 | ordinary tool completed | 卡片可折叠，结果在详情内 | 已显示 | D2 补官方默认展开 |
| D0-016 | tool error | `ToolErrorCard`，错误可复制/展开 | 现有卡片弱 | D2 对齐错误卡 |
| D0-017 | `todowrite` tool part | 普通 timeline 隐藏 | 当前隐藏 | 保持，不再作为失败项 |
| D0-018 | todo data | `todo.updated` 进入 TodoDock | 已有 TodoDock | D1/D2 补官方状态和清理语义 |
| D0-019 | `question` pending/running tool part | 普通 timeline 隐藏 | 当前部分隐藏 | 保持 |
| D0-020 | `question.asked` | QuestionDock 在输入区上方 | 已有 QuestionDock | D2 补队列/失败状态 |
| D0-021 | question dismissed/error | 完成后可在 timeline 弱提示 | 当前不完整 | D2 补 dismissed/error 行 |
| D0-022 | `permission.asked` | PermissionDock 在输入区上方 | 已有 PermissionDock | D2 对齐 once/always/reject 状态 |
| D0-023 | `permission.replied` | 从 pending permission store 移除 | 已有 | D1 测试 |
| D0-024 | `bash` | 工具卡；默认展开由 `shellToolPartsExpanded` 控制 | 展开策略未完全对齐 | D2 必修 |
| D0-025 | `edit/write/apply_patch` | 工具卡；默认展开由 `editToolPartsExpanded` 控制 | 展开策略未完全对齐 | D2 必修 |
| D0-026 | `task` | 子任务工具卡，可跳转子 session | 当前只泛化展示 | D2 先展示子 session metadata，跳转后续 |
| D0-027 | `skill` | 普通工具卡显示 Skill 加载 | 已显示但需确认输入/结果 | D2 表测 |
| D0-028 | `webfetch/websearch` | 普通工具卡，URL/搜索结果有专门摘要 | 当前泛化 | D2 可后置，但不能丢结果 |
| D0-029 | `compaction` | divider/system part，不进正文 | 已系统事件化 | D2 对齐 divider |
| D0-030 | interrupted/abort | MessageAbortedError 显示 interrupted divider/状态 | abort 已有，timeline 弱 | D1/D2 修 |
| D0-031 | diff summary | idle 后显示 diff summary | 已有 DiffReviewDock | D2 对齐 summary row |
| D0-032 | scroll follow | 在底部时内容变化自动跟随；用户上滑暂停 | 用户反馈仍会跑出视野 | D1 必修，照官方锁底策略 |
| D0-033 | share/session commands | 菜单行为 + 错误 toast/actionable URL | 当前 share notice 偏弱 | D2/D3 修，不阻塞 D1 |
| D0-034 | active/passive tools | 官方被动工具不由聊天工具开关控制 | 旧 ToolPickerBar 仍存在 | D2/D3 从聊天开关移除，工具页改只读展示 |

## 4. Revised Hard Blockers

撤销旧 HA-005 的表述。`todowrite` 不进普通消息流是官方规则，不是缺陷。

新的 Hardening D 硬缺口如下：

| ID | Gap | Official Rule | Required Fix |
|---|---|---|---|
| HD-001 | `session.status:error` 未完整承载 | status error 必须结束 working 并显示错误 | 映射为 error row/part，停止 streaming |
| HD-002 | event stream close/error 无 UI carrier | sync 断开不能让 UI 卡死 | `subscribeOpenCodeEvents()` 支持 `onError/onClose`，触发最终同步或错误行 |
| HD-003 | 非 text/reasoning delta 丢失 | `message.part.delta` 按 `field` 追加 | `applyOpenCodePartDelta()` 支持任意字段，保留 raw |
| HD-004 | 完成事件兼容不足 | `session.idle`、`session.finished`、`session.next.finished` 都应可结束 run | 统一 complete-event detector |
| HD-005 | 滚动不跟随当前输出 | 官方底部锚定和多帧锁底 | ChatPanel 按官方策略实现 bottom anchored auto-scroll |
| HD-006 | context tools 未官方分组 | `read/glob/grep/list` 连续分组 | 实现 ContextToolGroup 样式和测试 |
| HD-007 | shell/edit/patch 展开规则未对齐 | 由官方 settings 控制默认展开 | 加 setting 或固定官方默认 false，状态可记忆 |

## 5. Acceptance Definition

Hardening D 通过条件：

1. 不再把 `todowrite` hidden 判为失败。
2. Todo 必须由 TodoDock 承载，普通 timeline 不显示 `todowrite`。
3. pending/running question 必须由 QuestionDock 承载，普通 timeline 不显示 question tool part。
4. permission 必须由 PermissionDock 承载，且响应后从 pending 状态移除。
5. 所有 OpenCode part delta 必须保留，不允许只处理 text/reasoning。
6. 任意 stream close/error 都不能留下“回复中”卡死。
7. 用户停留底部时，生成内容、工具卡、reasoning、diff 高度变化都必须自动保持当前输出可见。
8. 用户主动上滑时，不能强制拉回底部。
9. OpenCode 被动工具不再受韭菜盒子聊天框工具开关控制。
10. 韭菜盒子主动工具后续迁入“百宝箱”，不进入 OpenCode tool loop。

## 6. D1 Execution Order

1. 先写测试：
   - `message.part.delta` 任意 field 追加。
   - `session.status:error` 结束 run 并生成错误 carrier。
   - `session.finished` / `session.next.finished` / `session.idle` 都能完成。
   - event stream `onError/onClose` 不会卡住。
   - `todowrite` hidden + TodoDock present 被判 PASS。
   - bottom anchored auto-scroll policy。
2. 实现 D1：
   - event bridge 增加 close/error 回调。
   - delta reducer 改为 official field append。
   - complete detector 合并完成事件。
   - scroll policy 按官方锚底策略修复。
3. 跑 gate：
   - `pnpm run typecheck`
   - `pnpm run test:focused`
   - `pnpm run test:tauri`

## 7. D2 Execution Order

1. context tool group。
2. shell/edit/patch 默认展开策略。
3. ToolErrorCard 对齐。
4. question dismissed/error 弱提示。
5. passive tool 只读展示和聊天工具开关移除。

## 8. D2 Result

**Date:** 2026-06-08

**Status:** Completed.

| 项 | 结果 |
|---|---|
| context tool group | 已按官方 `read/glob/grep/list` 连续分组，韭菜盒子 timeline 使用独立 `context-group` carrier。 |
| shell/edit/patch 默认展开 | 已加入 `openCodePartDefaultOpen()`，默认 false；`bash` 受 `shellToolPartsExpanded` 语义控制，`edit/write/apply_patch` 受 `editToolPartsExpanded` 语义控制。 |
| ToolErrorCard | 已在 `OpenCodePartList` 加入错误卡 carrier，显示工具名、错误内容，并提供复制错误详情。 |
| question dismissed/error | 已将 dismissed question 映射为弱系统事件，不再作为普通工具卡显示。 |
| passive tool switch | 聊天区不再挂载 ToolPickerBar；工具仓库移除本地能力开关，只做展示和独立入口。OpenCode 被动工具由官方 runtime、permission、question、todo/diff dock 承载。 |

**Gate:**

- `pnpm run test:focused:build`: PASS
- `pnpm run test:focused:run`: PASS, 522/522
- `pnpm exec vue-tsc -b`: PASS
- `pnpm run test:tauri`: PASS, 389 passed, 1 ignored

## 9. D3 Result

**Date:** 2026-06-08

**Status:** Completed.

| 项 | 结果 |
|---|---|
| slash command affordance | 已在 composer 增加 `/` 官方命令入口，显式执行 `runSlashCommand(\`/${command}\`)`，底层仍走 OpenCode `session.command()`。 |
| shell command affordance | 已在 composer 增加 `!`/Shell 入口，显式执行 `runShellCommand(command)`，底层仍走 OpenCode `session.shell()`。 |
| share carrier | 已新增 `SessionShareNotice`，share 成功后承载 URL，自动尝试复制，并提供复制/打开/关闭操作。 |
| official alignment | `/`、`!`、share 均只做韭菜盒子 UI 承载，不复刻 OpenCode core，不改 SDK，不改官方 runtime。 |

**Gate:**

- `pnpm run test:focused:build`: PASS
- `pnpm run test:focused:run`: PASS, 524/524
- `pnpm exec vue-tsc -b`: PASS
- `pnpm run test:tauri`: PASS, 389 passed, 1 ignored
