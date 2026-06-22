# OpenCode 对齐遗留问题 — 下一轮发版重点修复

> **日期**: 2026-06-22
> **当前发布版本**: v1.0.5（已含 OpenCode v1.17.9 协议对齐 + D0 事件矩阵修复）
> **状态**: 用户实测发现两个体验层 bug，本次发版不阻塞，列为下一轮重点
> **关联文档**: `docs/sdd/opencode-alignment-duiqiopencode-plan.md`、`docs/sdd/opencode-hardening-d0-official-carrier-parity.md`

---

## 背景

`duiqiopencode` 分支已完成并合并入 main：
- SDK / Plugin / 二进制升级到 v1.17.9
- 事件协议层对齐官方（applyOpenCodePartDelta、SKIP_PARTS、session 生命周期、vcs.branch.updated 等）
- UI 承载组件齐全（RevertDock、FollowupDock、ToolErrorCard、Context Group 等）

**但运行时行为细节仍与官方有偏差**。用户实测桌面 APP 后反馈两个体验问题，需要下一轮发版集中解决。

---

## Bug #1 — 变更审查体验与官方不一致

### 现象

桌面 APP 中，OpenCode 执行涉及 `edit` / `write` / `apply_patch` 工具的任务后，"变更审查"的呈现方式与官方 OpenCode（SolidJS 版）不一致。

### 用户感知

- 改了文件，但 timeline 里看不到"哪些文件改了 / 改了多少行"的醒目摘要
- 需要切到右侧 DiffReviewDock 才能看到具体 diff
- 没有官方那种"每轮回答后自动展开 diff 详情卡片"的体验

### 与官方差距

| 维度 | 官方 OpenCode | 韭菜盒子当前 |
|------|--------------|-------------|
| 每轮 idle 后 diff summary row | ✅ 自动在消息流内显示 | ❌ 缺失（只在右侧 Dock） |
| 文件级 +N/-N 行数着色 | ✅ | 🟡 弱化 |
| 单个文件可点击 review | ✅ 内联展开 | ❌ 需进 Dock |
| `edit/write/apply_patch` 工具卡默认展开 | ✅ 由 `editToolPartsExpanded` 设置控制 | 🟡 设置存在但默认行为不明显 |
| ToolErrorCard 错误信息密度 | ✅ 内联可复制可展开 | 🟡 已实现基础版，但视觉密度低 |

### 关联 D0 矩阵编号

- **D0-031**: idle 后 diff summary row 缺失
- **D0-025**: edit/write/apply_patch 默认展开策略未对齐
- **D0-016**: ToolErrorCard 视觉密度

### 排查方向（下一轮接手时按顺序）

1. 在 `src/composables/useChat.ts` 中确认 `session.status:idle` 事件触发时，是否生成了 `diff-summary` row 并 push 到 timeline
2. 检查 `src/opencodeClient/timelineRows.ts` 的 `buildOpenCodeTimelineRows` 是否包含 idle 后的 diff summary 行生成逻辑
3. 检查 `src/components/chat/OpenCodePartList.vue` 是否渲染 `diff-summary` 类型的 row
4. 参考官方源码：
   - `packages/app/src/pages/session/message-timeline.tsx`（idle 后 summary 处理）
   - `packages/ui/src/components/message-part.tsx:1399`（ToolErrorCard）

---

## Bug #2 — 任务已完成，UI 仍显示"正在回复"

### 现象

OpenCode 任务实际已经结束（最后一条 assistant 消息已经完整出现），但顶部状态栏 / 输入框仍显示 "OpenCode 正在回复" / "正在生成"，需要刷新或切换会话才会消失。

### 严重程度

🔴 **高** — 用户会以为任务还在跑，重复发问或长时间等待。

### 根因推测（按可能性排序）

#### 推测 A：v1.17.9 完成事件名变了，我们没识别全

`src/opencodeClient/runEvents.ts` 中 `isOpenCodeRunCompleteEvent` 当前只识别：
- `session.idle`
- `session.finished`
- `session.next.finished`
- `session.closed`（本轮新加）
- `session.next.closed`（本轮新加）
- `session.status` 且 status.type === 'idle'

但 v1.17.9 服务端可能发的是别的事件名（如 `session.next.idle` / `assistant.finished` / `run.completed` 等）。需要在生产环境抓真实事件流确认。

#### 推测 B：竞态 — finalize 后晚到的事件把 phase 改回去

`useChat.ts` 中有多个地方 setPhase：
- `message.part.updated` → `setPhase('replying', 'OpenCode 正在回复')`
- `session.next.text.delta` → `setPhase('replying', ...)`
- `session.next.tool.success/failed` → `setPhase('replying', ...)`

如果 `scheduleFinalizeOpenCodeRun('done')` 之后还有晚到的事件（如最后一个 tool result），phase 会被重新改回 'replying'，但再也不会有新的 idle 事件了。

需要检查：finalize 后是否设置了 `finalized = true` 标志，并在所有 setPhase 调用前检查该标志。

#### 推测 C：`subscribeOpenCodeEvents` 的 onClose 没触发

事件流断开时本应通过 `onClose` 回调走到 finalize 兜底，但可能：
- 服务端没主动关闭流，只是停止发事件
- `onClose` 触发但 status API 返回的不是 idle，被 fallback 到 `resetIdleTimer()` 而不是 finalize

### 排查方向（下一轮接手时按顺序）

1. **抓真实事件流**：在 `eventBridge.ts` 的 `logEventSample` 把 debug 限制放宽，跑一次实际任务，记录所有事件 type
2. **看 finalize 标志**：检查 `useChat.ts` 中 `finalized` 变量是否在所有可能改 phase 的 handler 前面做了 guard
3. **检查 idle timer**：`resetIdleTimer()` 的超时阈值是多少？是否合理？
4. **加临时日志**：在 `setPhase` 函数入口打印调用栈，跑一次任务，看 phase 在 "done" 之后是否被谁改回去
5. 参考官方源码：
   - `packages/app/src/context/global-sync/event-reducer.ts` 的完成判定逻辑
   - SDK v1.17.9 的 `Event` 类型定义（在 `@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`），确认所有 event type 的完整列表

### 关联 D0 矩阵编号

- **HD-001**: session.status:error 承载（已修但完成路径可能不完全）
- **HD-002**: event stream close/error carrier（已加 onClose，但 fallback 逻辑可能不完整）
- **D0-009**: 完成事件兼容（本轮已扩展，可能仍有漏）

---

## 下一轮发版的建议执行顺序

### Phase A（必修 P0）— Bug #2 任务完成状态不收敛
1. 加临时日志，抓 v1.17.9 真实事件流
2. 补全 `isOpenCodeRunCompleteEvent` 漏识别的事件名
3. 增强 finalize 后的 phase 锁定（finalized 标志守卫所有 setPhase）
4. 验证：发 5 个不同类型任务，全部能在结束后回到 idle 状态

### Phase B（重要 P1）— Bug #1 变更审查体验
1. 在 idle 事件中生成 `diff-summary` row
2. timelineRows.ts 加入 `diff-summary` 类型支持
3. OpenCodePartList.vue 渲染 `diff-summary` 行（带文件数、+/- 行数）
4. ToolErrorCard 视觉密度提升（参考官方）
5. edit/write/apply_patch 默认展开策略让用户在设置里能开关

### Phase C（可选 P2）— 持续打磨
- 滚动锁底再优化（D0-032）
- bash/edit 展开偏好持久化
- websearch / webfetch 工具卡 URL 摘要显示

---

## 不要做的事（避免下一轮接手踩坑）

❌ **不要重新设计 OpenCode tool loop** — 协议层已对齐，只补行为偏差
❌ **不要改 SDK 版本** — v1.17.9 是当前基线，先把当前版本的 bug 修完
❌ **不要碰 Web 直连路径** — Bug #1 #2 都在桌面 OpenCode 路径
❌ **不要降级二进制版本试图回避问题** — 这是逃避，根因在 finalize 状态机

---

## 验收标准（下一轮发版前必须通过）

- [ ] 桌面 APP 中触发 OpenCode 任务，5 种典型场景结束后均回到 idle：
  - [ ] 纯文本回答（无工具调用）
  - [ ] 含 read/grep/list 工具调用
  - [ ] 含 edit/write 文件改动
  - [ ] 含 bash 命令执行
  - [ ] 含 task（子任务）调用
- [ ] 每轮文件改动后，消息流内出现 diff-summary 行（文件数 + 变更行数）
- [ ] 点击 diff-summary 行可展开到 DiffReviewDock
- [ ] ToolErrorCard 在工具失败时显示完整可复制错误信息
- [ ] `vue-tsc -b` 通过
- [ ] `vite build` 通过
- [ ] 至少 1 个 subagent 独立审计无 P0/P1 回归

---

## 参考文件清单

| 文件 | 作用 |
|------|------|
| `src/composables/useChat.ts` | 事件处理 + finalize 逻辑（高危区） |
| `src/opencodeClient/runEvents.ts` | 完成事件识别 |
| `src/opencodeClient/eventBridge.ts` | onClose / onError 回调 |
| `src/opencodeClient/timelineRows.ts` | timeline row 生成（diff-summary 需在此加） |
| `src/components/chat/OpenCodePartList.vue` | 消息流渲染 |
| `src/components/chat/ToolCallCard.vue` | 工具卡（错误显示） |
| `src/components/chat/DiffReviewDock.vue` | 现有 diff 审查面板 |

---

## 给下一个 AI 协作者的话

这次 OpenCode v1.17.9 对齐工作的**协议层、UI 骨架、版本基线**都已经稳了。你的任务是**只补行为细节**，不要回头重做架构。

读完本文件后，建议按顺序阅读：
1. `docs/sdd/opencode-alignment-duiqiopencode-plan.md`（本次对齐的完整执行计划）
2. `docs/sdd/opencode-hardening-d0-official-carrier-parity.md`（D0 矩阵官方裁决）
3. `CLAUDE.md` §17 的"已完成"清单底部 OpenCode v1.17.9 对齐记录

不要破坏已经稳定的部分。补 Bug 优先于扩功能。
