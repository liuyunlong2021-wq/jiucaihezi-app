# OpenCode 输出/消息渲染架构 — 完整设计文档

> 目标：另一份 AI 读完后，能完整复刻 OpenCode 桌面端所有消息输出/渲染功能。
> 核心在 `packages/session-ui/src/components/message-part.tsx` + `packages/app/src/pages/session/timeline/`。

---

## 目录

1. [功能总览](#1-功能总览)
2. [架构总览](#2-架构总览)
3. [消息列表（虚拟化时间线）](#3-消息列表虚拟化时间线)
4. [消息分组与行类型](#4-消息分组与行类型)
5. [用户消息渲染](#5-用户消息渲染)
6. [助手消息 Part 渲染引擎](#6-助手消息-part-渲染引擎)
7. [流式文本（PacedMarkdown）](#7-流式文本pacedmarkdown)
8. [Markdown 与代码块](#8-markdown-与代码块)
9. [推理/思考块](#9-推理思考块)
10. [工具调用渲染](#10-工具调用渲染)
11. [文件差异 / 编辑预览](#11-文件差异--编辑预览)
12. [消息状态与进度](#12-消息状态与进度)
13. [复制与操作按钮](#13-复制与操作按钮)
14. [动画系统](#14-动画系统)
15. [全部文件清单](#15-全部文件清单)
16. [完整复刻步骤](#16-完整复刻步骤)

---

## 1. 功能总览

| # | 功能 | 说明 | 代码位置 |
|---|------|------|----------|
| 1 | 虚拟化消息列表 | `@tanstack/solid-virtual`，无限滚动，自动跟随 | `message-timeline.tsx` |
| 2 | 消息按"话轮"分组 | User → Assistant(s) 为一个话轮 | `projection.ts` |
| 3 | 用户消息气泡 | 右对齐，背景层，圆角 10px | `message-part.tsx` UserMessageDisplay |
| 4 | 助手消息 Part 引擎 | text / reasoning / tool 分派 | `message-part.tsx` PART_MAPPING |
| 5 | 流式文本增量渲染 | 24ms 每帧，512 字符立即，标点断句 | `message-part.tsx` PacedMarkdown |
| 6 | Markdown 渲染 | `morphdom` 合并，shiki 代码高亮 | `markdown.tsx` |
| 7 | 代码块 + shiki 高亮 | Web Worker 增量高亮，复制按钮 | `markdown.tsx` + `markdown-worker.ts` |
| 8 | 推理/思考块 | `TextShimmer` + `TextReveal` 动画，折叠 | `message-part.tsx` ReasoningPartDisplay |
| 9 | "思考中"行 | Loading 闪烁 + 推理标题淡入 | `message-timeline.tsx` TimelineThinkingRow |
| 10 | 工具调用渲染 | 注册表体系，折叠式，懒加载输出 | `message-part.tsx` ToolPartDisplay |
| 11 | 上下文工具分组 | 多个 read/search 合并为一个 group | `message-part.tsx` ContextToolGroup |
| 12 | 文件差异摘要 | +12 -4，文件列表，Accordion 展开 | `message-timeline.tsx` DiffSummaryRow |
| 13 | 编辑/写入/patch 差异 | 差异视图 + 文件组件 | `basic-tool.tsx` |
| 14 | 工具错误卡片 | ⚠ 红色卡片，折叠详情，复制 | `tool-error-card.tsx` |
| 15 | 中断分隔线 | "interrupted" 标签 | `message-timeline.tsx` TurnDivider |
| 16 | 压缩分隔线 | "compaction" 标签 | `message-timeline.tsx` TurnDivider |
| 17 | 复制按钮 | 文本/代码块/错误均可复制 | `message-part.tsx` writeClipboard |
| 18 | 回退按钮 | 用户消息可回退到之前状态 | `message-timeline.tsx` |
| 19 | 消息元数据行 | Agent · Model · 12s · (interrupted) | `message-part.tsx` |
| 20 | 动画 | TextShimmer 闪烁 / TextReveal 擦除 / ShellSubmessage 淡入 | 各子组件 |
| 21 | 重试组件 | SessionRetry 错误重试 UI | `session-retry.tsx` |
| 22 | 诊断显示 | 文件诊断信息行 | `message-part.tsx` DiagnosticsDisplay |

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         App 层 (packages/app)                             │
│                                                                          │
│  packages/app/src/pages/session/timeline/                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  message-timeline.tsx         主虚拟化列表 + 行渲染                   │ │
│  │  model.ts                    数据读取层（sync → messages）          │ │
│  │  projection.ts               反应式投影（messages → TimelineRow[]） │ │
│  │  rows.ts                     行构造逻辑（groupParts + 行类型）      │ │
│  │  timeline-row.ts             TimelineRow tagged union 定义          │ │
│  │  virtual-items.ts            虚拟索引过滤                            │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Session-UI 层 (packages/session-ui)                  │
│                                                                          │
│  packages/session-ui/src/components/                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  message-part.tsx       Part 渲染引擎 + ToolRegistry + 流式文本      │ │
│  │  basic-tool.tsx         通用工具折叠控件                              │ │
│  │  markdown.tsx           Markdown 渲染 + shiki 代码高亮               │ │
│  │  markdown-stream.ts    流式文本 → Block 分割                         │ │
│  │  markdown-worker.ts    Web Worker shiki 高亮                         │ │
│  │  tool-error-card.tsx   工具错误卡片                                  │ │
│  │  session-retry.tsx     重试 UI                                       │ │
│  │  text-shimmer.tsx      加载闪烁动画                                  │ │
│  │  text-reveal.tsx       遮罩擦除动画                                  │ │
│  │  tool-status-title.tsx 状态切换文字动画                              │ │
│  │  session-diff.ts       差异规范化                                    │ │
│  │  message-part.css      消息样式                                       │ │
│  │  markdown.css           Markdown + 代码块样式                        │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### 数据流

```
Session Data (sync)
  → selectUserMessages() / selectVisibleUserMessages()
  → createTimelineProjection()
     → assistantMessagesByParent (Map<parentID, AssistantMessage[]>)
     → constructMessageRows()
        → groupParts() → PartGroup[]
        → 处理中断/压缩/思考/差异
        → TimelineRow[]
  → createVirtualizer() 虚拟化
  → 仅渲染可见行
     → UserMessage → UserMessageDisplay
     → AssistantPart → Part (PART_MAPPING 分发)
     → Thinking → TimelineThinkingRow
     → DiffSummary → Accordion + diff views
```

---

## 3. 消息列表（虚拟化时间线）

**文件**: `packages/app/src/pages/session/timeline/message-timeline.tsx`

### 虚拟化

使用 `@tanstack/solid-virtual`，核心配置：

```typescript
const virtualizer = createVirtualizer({
  count: timelineRows().length,
  getScrollElement: () => scrollRef,
  estimateSize: () => 60,            // 回退高度
  overscan: 50,                      // 可视区域外预渲染
  rangeExtractor: filterVirtualIndexes(range),  // 过滤隐藏行
  scrollToFn: elementScroll,         // 使用元素滚动
  followOnAppend: true,              // 新增内容自动跟随
  paddingEnd: 64,
})
```

**缓存**：`timelineCache` 保留虚拟状态，在切换会话时不丢失滚动位置。

### 布局

```tsx
<div class="md:max-w-200 2xl:max-w-[1000px] md:mx-auto">
  {/* 粘性标题栏：会话标题 + 面包屑 + 操作菜单 */}
  {/* 虚拟化列表 */}
  <div data-slot="timeline-rows" ref={scrollRef}>
    <div style={{ height: virtualizer.getTotalSize() }}>
      <For each={virtualizer.getVirtualItems()}>
        {(vItem) => <TimelineRowComponent row={timelineRows()[vItem.index]} />}
      </For>
    </div>
  </div>
</div>
```

### 行组件调度

```typescript
<Switch>
  <Match when={row instanceof TimelineRow.TurnGap}>         {/* 话轮间距 */}
  <Match when={row instanceof TimelineRow.CommentStrip}>    {/* 评论条 */}
  <Match when={row instanceof TimelineRow.UserMessage}>     {/* 用户消息 */}
  <Match when={row instanceof TimelineRow.TurnDivider}>     {/* 分隔线 */}
  <Match when={row instanceof TimelineRow.AssistantPart}>   {/* 助手 part */}
  <Match when={row instanceof TimelineRow.Thinking}>        {/* 思考中 */}
  <Match when={row instanceof TimelineRow.DiffSummary}>     {/* 差异摘要 */}
  <Match when={row instanceof TimelineRow.Error}>           {/* 错误卡片 */}
</Switch>
```

---

## 4. 消息分组与行类型

### TimelineRow 联合体

**文件**: `timeline-row.ts`

```typescript
class TurnGap extends Data.TaggedClass("TurnGap")<{ userMessageID: string }> {}
class CommentStrip extends Data.TaggedClass("CommentStrip")<{ userMessageID: string; comments: Comment[] }> {}
class UserMessage extends Data.TaggedClass("UserMessage")<{ message: UserMessage; meta: Meta }> {}
class TurnDivider extends Data.TaggedClass("TurnDivider")<{ label: string }> {}  // "interrupted" | "compaction"
class AssistantPart extends Data.TaggedClass("AssistantPart")<{
  userMessageID: string
  group: PartGroup
  previousAssistantPart: boolean
}> {}
class Thinking extends Data.TaggedClass("Thinking")<{ userMessageID: string }> {}
class DiffSummary extends Data.TaggedClass("DiffSummary")<{ userMessageID: string; diffs: SummaryDiff[] }> {}
class Error extends Data.TaggedClass("Error")<{ userMessageID: string; error: { type: string; message: string } }> {}
class Retry extends Data.TaggedClass("Retry")<{ userMessageID: string }> {}
```

### PartGroup 类型

**文件**: `message-part.tsx`

```typescript
type PartGroup =
  | { key: string; type: "part";    ref: PartRef }          // 单个 part
  | { key: string; type: "context"; refs: PartRef[] }       // 合并的上下文工具

// groupParts() — 将连续上下文工具合并为一个 context group
function groupParts(parts: PartType[]): PartGroup[] {
  // read / glob / grep / list / webfetch → 合并为 "context"
  // 其他（text / reasoning / bash / edit / write / ...）→ 各自一个 part group
}
```

### 行构造流程

```
constructMessageRows():
  1. 获取 userMessage parts → 提取 CommentStrip
  2. 获取 assistantMessagesByParent[userMessageID]
  3. 对每个 assistant message:
     a. groupParts(parts) → PartGroup[]
     b. 如果有 MessageAbortedError → 插入 TurnDivider("interrupted")
     c. 如果有 compaction → 插入 TurnDivider("compaction")
  4. 如果正在流式且无可见 assistant parts → 插入 Thinking 行
  5. 如果话轮完成且有文件差异 → 插入 DiffSummary 行
  6. 如果有错误 → 插入 Error 行
```

---

## 5. 用户消息渲染

**文件**: `message-part.tsx` 中的 `UserMessageDisplay`

### 布局

```
┌─────────────────────────────────────────────────┐
│                        [图片附件]                  │ ← flex wrap, right-aligned
│                        ┌────────────────────┐    │
│                        │ 用户文本内容        │    │ ← max-w 82%, 64ch
│                        │ @file 蓝色高亮      │    │    bg-v2-background-bg-layer-02
│                        │ @agent 紫色高亮     │    │    rounded-10px
│                        └────────────────────┘    │
│                        Agent · Model · 时间戳     │ ← text-12-regular
│                        [复制] [回退]              │ ← hover 显示
└─────────────────────────────────────────────────┘
```

### 高亮系统

`HighlightedText` 组件根据 `source.text.start/end` 偏移量在用户文本中渲染高亮片段：

```html
<span data-highlight="file">@src/utils/helpers.ts</span>   <!-- 蓝色 -->
<span data-highlight="agent">@build</span>                  <!-- 紫色 -->
```

### 用户消息上的操作按钮

```typescript
// 复制按钮
<MessageActionButton icon="copy" label="Copy" onClick={() => writeClipboard(text)} />

// 回退按钮（如果 props.actions.revert 存在）
<MessageActionButton icon="revert" label="Revert" onClick={...} />
```

悬停/聚焦时通过 `opacity: 0 → 1` 过渡显示。

---

## 6. 助手消息 Part 渲染引擎

### PART_MAPPING 注册表

**文件**: `message-part.tsx`

```typescript
export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

// 注册
PART_MAPPING["text"]      = TextPartDisplay
PART_MAPPING["tool"]      = ToolPartDisplay
PART_MAPPING["reasoning"] = ReasoningPartDisplay
PART_MAPPING["compaction"] = CompactionPartDisplay
```

### Part 分发函数

```typescript
function Part(props: MessagePartProps) {
  const Component = PART_MAPPING[props.part.type]
  if (Component) return <Component {...props} />
  return null  // 未知 part 类型不渲染
}
```

### renderable() 过滤器

决定哪些 parts 可见：

```typescript
function renderable(part: PartType): boolean {
  switch (part.type) {
    case "text":      return part.text.length > 0
    case "reasoning": return showReasoningSummaries && part.text.length > 0
    case "tool":
      if (part.tool === "todowrite") return false
      if (part.tool === "question" && (part.state === "pending" || part.state === "running")) return false
      return true
    default:          return true  // 已注册的 part 映射组件
  }
}
```

---

## 7. 流式文本（PacedMarkdown）

**文件**: `message-part.tsx`

### 增量渲染引擎

```typescript
const TEXT_RENDER_PACE_MS = 24       // 每帧间隔 24ms
const TEXT_RENDER_IMMEDIATE = 512    // ≤512 字符直接渲染
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/  // 标点断句

function step(size: number): number {
  if (size <= 12)  return 2
  if (size <= 48)  return 4
  if (size <= 96)  return 8
  return Math.min(256, Math.ceil(size / 4))
}

function next(text: string, start: number): number {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? "")) return i + 1  // 在标点处断句
  }
  return end
}
```

### createPacedValue

```typescript
function createPacedValue(getValue: () => string, live?: () => boolean) {
  const [value, setValue] = createSignal(getValue())
  let shown = getValue()
  let timeout: ReturnType<typeof setTimeout> | undefined

  const run = () => {
    const text = getValue()
    if (!live?.()) { sync(text); return }
    if (!text.startsWith(shown) || text.length <= shown.length) { sync(text); return }
    if (text.length - shown.length <= TEXT_RENDER_IMMEDIATE) { sync(text); return }
    const end = next(text, shown.length)
    sync(text.slice(0, end))
    if (end < text.length) timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  }

  // 通过 createEffect 响应式驱动
  createEffect(() => {
    const text = getValue()
    if (!live?.()) { clear(); sync(text); return }
    if (!text.startsWith(shown) || text.length < shown.length) { clear(); sync(text); return }
    if (text.length - shown.length <= TEXT_RENDER_IMMEDIATE) { clear(); sync(text); return }
    if (text.length === shown.length || timeout) return
    timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  })
}
```

### PacedMarkdown 组件

```typescript
function PacedMarkdown(props: { text: string; cacheKey: string; streaming: boolean }) {
  const value = createPacedValue(() => props.text, () => props.streaming)
  return <Show when={value()}>
    <Markdown text={value()} cacheKey={props.cacheKey} streaming={props.streaming} />
  </Show>
}
```

**流式 vs 非流式**：
- 流式 → `PacedMarkdown`（增量渲染）
- 非流式 → 直接 `<Markdown text={text()} streaming={false} />`

### TextPartDisplay

```typescript
function TextPartDisplay(props: MessagePartProps) {
  return (
    <div class="text-part">
      <Show when={props.streaming} fallback={
        <Markdown text={props.part.text} cacheKey={props.cacheKey} streaming={false} />
      }>
        <PacedMarkdown text={props.part.text} cacheKey={props.cacheKey} streaming={true} />
      </Show>
    </div>
  )
}
```

---

## 8. Markdown 与代码块

**文件**: `markdown.tsx` + `markdown-stream.ts` + `markdown-worker.ts` + `markdown.css`

### 渲染管线

```
text → project(text, streaming)
         → 分割为 Block[]（普通 Markdown / 代码块）
         → code block → highlightStreamingCode (Web Worker)
                      → 返回 { stable tokens, unstable tokens }
         → markdown block → 并行解析 + sanitize
         → morphdom 合并到 DOM
```

### 代码块结构

```html
<div data-component="markdown-code" data-language="ts" data-code-kind="shell">
  <pre class="shiki OpenCode">
    <code class="language-ts">...</code>
  </pre>
  <div data-slot="markdown-copy-button">
    <Icon name="copy" />
  </div>
</div>
```

### shiki 高亮（Web Worker）

```typescript
// markdown-worker.ts
async function highlightStreamingCode(key: string, text: string, language: string, complete: boolean) {
  // 增量更新：区分 stable（已确认）和 unstable（可能变化）的 token
  const result = await worker.postMessage({ type: "highlight", key, text, language, complete })
  return { generation, stable, unstable }
}

// shouldResetCodeTokens() — 当语言/内容变化时智能重置
function shouldResetCodeTokens(prev: RenderedCodeState, next: { language: string; raw: string }): boolean {
  if (prev.language !== next.language) return true    // 语言变了
  if (!next.raw.startsWith(prev.raw)) return true    // 内容不一致
  return false
}
```

### 流式代码智能合并

`morphdom` 将新 HTML 合并到现有 DOM，`markdown-stream.ts` 将流式文本增量分割为代码块：

```typescript
// markdown-stream.ts
function project(text: string, streaming: boolean): Projection {
  // 将文本分割为普通 Markdown 和代码块
  // 代码块通过 key 匹配，增量更新 token
}

function canReusePendingBlock(prev: Block, next: Block): boolean {
  // 判断是否可以复用之前的代码块（增量追加）
  return prev.mode === "code" && next.mode === "code" && prev.language === next.language
}
```

### Markdown 样式（markdown.css）

| 元素 | 样式 |
|------|------|
| 字体 | sans-serif, 14px, 行高 160% |
| h1 | 17px / weight 600 |
| h2 | 15px / weight 600 |
| h3 | 13px / medium |
| h4+ | 13px / muted |
| 链接 | `var(--text-interactive-base)`，hover 下划线 |
| 列表 | disc/decimal，32px padding-left |
| 引用块 | 0.5px 左边框，muted 颜色 |
| 代码块 | 背景 `var(--color-background-stronger)`，6px 圆角，0.5px 边框 |
| Shell 代码 | 特殊背景 `var(--markdown-shell-code-background)` |
| 复制按钮 | opacity 0→1 hover，右上角定位 |

### 语言标签

通过 `data-language` 设置。V2 布局使用 `data-code-kind="shell"` 区分 shell 命令。

### 复制实现

```typescript
// 监听 [data-component="markdown-code"] 上的点击
// 找到最近的 [data-slot="markdown-copy-button"]
// 提取 <code> 文本内容
// writeClipboard(codeText)
// 按钮变为复选标记 2 秒
```

---

## 9. 推理/思考块

### ReasoningPartDisplay

**文件**: `message-part.tsx`

```typescript
function ReasoningPartDisplay(props: MessagePartProps) {
  return (
    <Collapsible defaultOpen={false}>
      <Collapsible.Trigger>
        <Icon name="brain" />
        <span>Reasoning</span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <PacedMarkdown text={props.part.text} streaming={props.streaming} />
      </Collapsible.Content>
    </Collapsible>
  )
}
```

- 默认折叠
- 点击展开推理过程
- 流式时使用 `PacedMarkdown` 增量渲染

### "思考中"行（TimelineThinkingRow）

**文件**: `message-timeline.tsx`

```tsx
<div data-slot="session-turn-thinking">
  <TextShimmer text="Thinking" />
  <TextReveal text={reasoningHeading} travel={25} duration={700} />
</div>
```

**何时显示**：
```
isActive && status === "busy" && no error
  && (showReasoningSummaries ? parts 为空 : true)
```

**`reasoningHeading()`** — 从推理文本中解析标题：
1. HTML `<h1>`-`<h6>` 标签
2. ATX Markdown 标题（`# Title`）
3. Setext 标题（`Title\n===`）
4. 加粗文本（`**text**`）

### TextShimmer 动画

**文件**: `packages/ui/src/components/text-shimmer.tsx`

- 两层文本：基础层 + 闪烁覆盖层
- CSS 渐变扫描动画
- 停止时 220ms 延迟淡出（`--text-shimmer-swap`）

### TextReveal 动画

**文件**: `packages/ui/src/components/text-reveal.tsx` + `text-reveal.css`

```
mask-image: linear-gradient(to top, white 33%, transparent 33%+edge)
→ mask-position: 0 100% (隐藏) → 0 0% (可见)
```

- 新文本从上到下擦入
- 旧文本从上到下擦出
- 可配置：`duration`、`edge`（柔边，默认 17%）、`travel`（位移）、`spring`
- `growOnly` 模式：追加时不允许宽度收缩

---

## 10. 工具调用渲染

### 注册表体系

**文件**: `message-part.tsx` 中的 `ToolRegistry`（全局注册）

```typescript
// 注册方式
ToolRegistry.register({ name: "bash",    render(props) { ... } })
ToolRegistry.register({ name: "read",    render(props) { ... } })
ToolRegistry.register({ name: "edit",    render(props) { ... } })
ToolRegistry.register({ name: "write",   render(props) { ... } })
ToolRegistry.register({ name: "glob",    render(props) { ... } })
ToolRegistry.register({ name: "grep",    render(props) { ... } })
ToolRegistry.register({ name: "list",    render(props) { ... } })
ToolRegistry.register({ name: "webfetch", render(props) { ... } })
ToolRegistry.register({ name: "websearch",render(props) { ... } })
ToolRegistry.register({ name: "task",    render(props) { ... } })
ToolRegistry.register({ name: "apply_patch", render(props) { ... } })
ToolRegistry.register({ name: "todowrite", render(props) { ... } })
ToolRegistry.register({ name: "question", render(props) { ... } })
ToolRegistry.register({ name: "skill",   render(props) { ... } })
// MCP 工具 / 未知工具 → GenericTool 回退
```

### ToolPartDisplay

```typescript
function ToolPartDisplay(props: MessagePartProps) {
  const renderer = ToolRegistry.find(props.part.tool)
  if (!renderer) return <GenericTool {...props} />    // 回退
  if (props.part.state === "error") return <ToolErrorCard {...props} />
  if (props.part.tool === "question" && props.part.state === "pending") return null  // 隐藏
  if (props.part.tool === "question" && props.part.state === "rejected") return <div>Dismissed</div>
  return renderer.render(props)
}
```

### BasicTool（通用折叠控件）

**文件**: `basic-tool.tsx`

所有工具渲染的基础结构：

```tsx
<BasicTool tool={tool} title={title} subtitle={subtitle} icon={icon}
  pending={state === "running"}
  locked={locked} defer={true}>
  {/* 工具输出内容 */}
</BasicTool>
```

**布局**：
```
[icon] [title (shimmer if pending)] [subtitle] [args...] [action]  [▼]
```

- **触发行**：图标 + 标题（`TextShimmer` 动画）+ 副标题 + 参数 + 操作按钮
- **内容**：懒加载（`defer` prop），折叠时隐藏
- **动画高度**：Motion `animate()` 弹簧过渡
- **锁定**：展开时如果 `locked` 阻止折叠

### 各工具渲染

| 工具 | 图标 | 触发副标题 | 内容 |
|------|------|------------|------|
| `read` | glasses | 文件名 | 已加载文件列表 |
| `list` | bullet-list | 目录路径 | Markdown 输出 |
| `glob` | magnifying-glass-menu | 目录 + pattern | Markdown 输出 |
| `grep` | magnifying-glass-menu | 目录 + pattern | Markdown 输出 |
| `webfetch` | window-cursor | URL（可点击） | 无（hideDetails） |
| `websearch` | window-cursor | 查询文本 | ExaOutput 链接列表 |
| `task` | task | 描述/会话名 | 子会话导航卡片 |
| `bash` | console | 命令文本 | `<pre><code>` 终端输出 + 复制 |
| `edit` | code-lines | 文件名 | 差异视图 |
| `write` | code-lines | 文件名 | 文件内容文本 |
| `apply_patch` | code-lines | 文件计数 | 每个文件的 Accordion + 差异 |
| `todowrite` | checklist | 完成/总数 | 复选框列表 |
| `question` | bubble-5 | 问题计数 | 问答列表 |
| `skill` | brain | — | 纯卡片 |
| MCP/未知 | mcp | 动态 label | 无 |

### 上下文工具分组（ContextToolGroup）

合并多个 read/search 调用：

```
[Gathering context  ·  3 read, 2 search, 1 list]  [▼]
   ├─ Read: file.ts
   ├─ Read: types.ts
   ├─ Glob: src/**/*.ts
   ├─ Grep: src/ (pattern=useEffect)
   └─ List: /
```

`ToolStatusTitle` — "正在收集上下文" → "已收集上下文" 文本切换动画，计算共有前缀，仅动画差异部分。

---

## 11. 文件差异 / 编辑预览

### 差异摘要行

**文件**: `message-timeline.tsx` TimelineDiffSummaryRow

```
[3 changed files  ·  +12 -4  ·  Show all]
  ├─ 📁 src/utils/   helpers.ts  ·  +5 -1    [▼]
  │     [diff view]
  ├─ index.ts                    ·  +7 -3    [▼]
  │     [diff view]
  └─ (+1 more)
```

- 默认显示最多 10 个文件
- `showAll` 切换显示全部
- 路径分割：`getDirectory()` / `getFilename()`
- 每项是一个 `Accordion`，包含差异视图

### 差异渲染

| 工具 | 模式 | 展示方式 |
|------|------|----------|
| `edit` | diff | `ToolFileAccordion` + `DiffChanges` + `fileComponent(mode="diff")` |
| `write` | text | `ToolFileAccordion` + `fileComponent(mode="text")` |
| `apply_patch` | diff | Accordion + 标签（created/deleted/moved）+ 差异视图 |

差异通过 `@opencode-ai/ui/diff-changes` 和 `session-diff.ts` 的 `normalize()` 处理。

### 差异类型

```typescript
type SummaryDiff = SnapshotFileDiff & { file: string }
type Diff = SnapshotFileDiff | VcsFileDiff
```

---

## 12. 消息状态与进度

### SessionStatus

```typescript
type SessionStatus = { type: "idle" | "busy" | "retry" }
```

| 状态 | 表现 |
|------|------|
| `idle` | 所有内容完全渲染 |
| `busy` | 有可见 assistant parts → 流式输出中；无可见 assistant parts → Thinking 行 |
| `retry` | 显示 `SessionRetry` 组件 |

### 活动消息检测

```typescript
const activeMessageID = () => {
  // 找到最后一个 time.completed 不是 number 的助手消息
  // 返回其 parentID
}
```

### 话轮工作状态

```typescript
const workingTurn = (userMessageID: string) =>
  sessionStatus().type !== "idle" && activeMessageID() === userMessageID
```

- 正在运行的话轮的 context group 标记为 `busy`
- 正在运行的话轮的助手 part → `aria-hidden={true}`

### 消息元数据行

显示在 text part 下方：
```
Agent · Model · 12s · (interrupted)
```

- `agent`：首字母大写
- `model`：从 `providerID` + `modelID` 解析
- `duration`：从 `turnDurationMs` 或 `message.time.completed` 计算
- `interrupted`：如果 `error.name === "MessageAbortedError"`

---

## 13. 复制与操作按钮

### 复制实现

```typescript
async function writeClipboard(text: string): Promise<boolean> {
  // 方案 1: document.execCommand("copy") — 用隐藏 textarea
  // 方案 2: navigator.clipboard.writeText() — 回退
}
```

### 复制按钮显示逻辑

- **用户消息**：始终显示复制按钮
- **助手消息文本 part**：仅在最后一个 text part 显示（或 `showAssistantCopyPartID` 指定）
- `showAssistantCopyPartID === null` → 不显示（正在运行的话轮）
- 点击后按钮变为复选标记 2 秒

### 用户消息操作

```
[复制按钮] [回退按钮]  ← hover 显示
```

- `actions.revert` 存在时显示回退按钮
- 悬停/聚焦时通过 `opacity` 过渡显示

---

## 14. 动画系统

### 动画总览

| 动画 | 用途 | 实现 |
|------|------|------|
| TextShimmer | 加载中闪烁（Thinking、工具运行） | CSS 渐变扫描，2 层文本 |
| TextReveal | 推理标题擦入擦出 | CSS mask-image position 过渡 |
| ShellSubmessage | 命令文本淡入 + 宽度展开 | Motion spring（250ms）+ opacity blur（320ms）|
| ToolStatusTitle | "正在收集"→"已收集" 文本过渡 | rAF + setTimeout 600ms |
| BasicTool 展开 | 工具内容展开/折叠 | Motion animate() spring |
| 复制按钮确认 | 图标切换复选标记 | setTimout 2s 恢复 |
| DiffSummary 数字 | +12 / -4 数字变化 | AnimatedCountList |
| PacedMarkdown | 流式文本逐帧渲染 | setTimeout 24ms 循环 |

---

## 15. 全部文件清单

### App 层（时间线编排）

| 文件 | 用途 |
|------|------|
| `packages/app/src/pages/session/timeline/message-timeline.tsx` | 主虚拟化消息列表，行渲染调度 |
| `packages/app/src/pages/session/timeline/timeline-row.ts` | TimelineRow tagged union 定义 |
| `packages/app/src/pages/session/timeline/projection.ts` | 反应式投影（消息 → 行） |
| `packages/app/src/pages/session/timeline/model.ts` | 数据读取层 |
| `packages/app/src/pages/session/timeline/rows.ts` | 行构造逻辑 |
| `packages/app/src/pages/session/timeline/virtual-items.ts` | 虚拟索引过滤 |

### Session-UI 层（Part 渲染）

| 文件 | 用途 |
|------|------|
| `packages/session-ui/src/components/message-part.tsx` | **核心 Part 渲染引擎**（~800 行） |
| `packages/session-ui/src/components/message-part.css` | 消息样式 |
| `packages/session-ui/src/components/message-part-text.ts` | Part 文本提取工具 |
| `packages/session-ui/src/components/basic-tool.tsx` | 通用工具折叠控件 |
| `packages/session-ui/src/components/basic-tool.css` | 工具样式 |
| `packages/session-ui/src/components/tool-error-card.tsx` | 工具错误卡片 |
| `packages/session-ui/src/components/tool-error-card.css` | 错误卡片样式 |
| `packages/session-ui/src/components/tool-status-title.tsx` | 状态切换文字动画 |
| `packages/session-ui/src/components/tool-count-summary.tsx` | 差异数字动画 |

### Markdown / 代码高亮

| 文件 | 用途 |
|------|------|
| `packages/session-ui/src/components/markdown.tsx` | Markdown 渲染 + 代码高亮 |
| `packages/session-ui/src/components/markdown.css` | Markdown + 代码块样式 |
| `packages/session-ui/src/components/markdown-stream.ts` | 流式文本 → Block 分割 |
| `packages/session-ui/src/components/markdown-worker.ts` | shiki Web Worker |
| `packages/session-ui/src/components/markdown-worker-protocol.ts` | Worker 协议类型 |
| `packages/session-ui/src/components/markdown-code-state.ts` | 代码块增量状态管理 |
| `packages/session-ui/src/components/markdown-cache.ts` | Markdown 缓存 |
| `packages/session-ui/src/components/markdown-inline-code-kind.ts` | 内联代码种类检测 |

### 差异 / 文件

| 文件 | 用途 |
|------|------|
| `packages/session-ui/src/components/session-diff.ts` | 差异规范化 |
| `packages/session-ui/src/components/message-file.ts` | 文件 Part 渲染 |
| `packages/session-ui/src/components/file-media.tsx` | 文件媒体渲染 |
| `packages/session-ui/src/components/apply-patch-file.ts` | apply_patch 文件处理 |

### 动画组件

| 文件 | 用途 |
|------|------|
| `packages/ui/src/components/text-shimmer.tsx` | 加载闪烁动画 |
| `packages/ui/src/components/text-reveal.tsx` | 遮罩擦除动画 |
| `packages/ui/src/components/text-reveal.css` | TextReveal CSS |

### 其他

| 文件 | 用途 |
|------|------|
| `packages/session-ui/src/components/session-retry.tsx` | 重试 UI |
| `packages/session-ui/src/components/line-comment-annotations.tsx` | 行评论标注 |

---

## 16. 完整复刻步骤

### 第一步：数据结构

定义消息和 Part 的类型系统：

```typescript
// Part 类型联合体
type PartType =
  | { type: "text";      text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool";      tool: string; state: ToolState; input: any; output?: any }
  | { type: "compaction"; reason: string; summary: string }

// 消息类型
type UserMessage = { id: string; role: "user"; text: string; parts?: PartType[]; ... }
type AssistantMessage = { id: string; role: "assistant"; parts: PartType[]; model, agent, ... }
```

### 第二步：Part 渲染引擎

```
文件清单：
  components/part-registry.ts   — PART_MAPPING 注册表
  components/text-part.tsx      — TextPartDisplay + PacedMarkdown
  components/reasoning-part.tsx — ReasoningPartDisplay（折叠）
  components/tool-part.tsx      — ToolPartDisplay（+ ToolRegistry 分发）
  components/compaction-part.tsx— CompactionPartDisplay
```

### 第三步：Markdown + 代码高亮

```
文件清单：
  components/markdown.tsx            — 渲染 + morphdom + 代码高亮
  components/markdown-stream.ts      — 流式 Block 分割
  components/markdown-worker.ts      — shiki Web Worker
  components/markdown.css            — 样式
```

### 第四步：工具调用

```
文件清单：
  components/basic-tool.tsx          — 通用折叠控件
  components/tool-error-card.tsx     — 错误卡片
  components/tool-registry.ts        — 各工具渲染器注册
  components/context-tool-group.tsx  — 上下文工具分组
  components/shell-submessage.tsx    — Shell 输出渲染
```

### 第五步：时间线编排

```
文件清单：
  components/timeline-row.ts         — TimelineRow 类型定义
  components/timeline-projection.ts  — messages → rows 投影
  components/timeline-model.ts       — 数据读取
  components/message-timeline.tsx    — 虚拟化列表 + 行渲染
```

### 第六步：差异系统

```
文件清单：
  components/session-diff.ts         — 差异规范化
  components/diff-summary.tsx        — 差异摘要行
  components/file-diff.tsx           — 文件差异组件
```

### 第七步：用户消息

```
文件清单：
  components/user-message.tsx        — UserMessageDisplay
  components/highlighted-text.tsx    — @file @agent 高亮
```

### 第八步：动画组件

```
文件清单：
  components/text-shimmer.tsx        — 加载闪烁
  components/text-reveal.tsx         — 擦除动画
  components/tool-status-title.tsx   — 状态切换
```

---

## 附录：本地源码路径对照

| 文件 | 本地路径 |
|------|----------|
| 主消息 Part 引擎 | `packages/session-ui/src/components/message-part.tsx` |
| 消息 Part 样式 | `packages/session-ui/src/components/message-part.css` |
| Part 文本提取 | `packages/session-ui/src/components/message-part-text.ts` |
| 通用工具折叠 | `packages/session-ui/src/components/basic-tool.tsx` |
| 工具样式 | `packages/session-ui/src/components/basic-tool.css` |
| 工具错误卡片 | `packages/session-ui/src/components/tool-error-card.tsx` |
| 状态切换动画 | `packages/session-ui/src/components/tool-status-title.tsx` |
| 数字动画 | `packages/session-ui/src/components/tool-count-summary.tsx` |
| Markdown 渲染 | `packages/session-ui/src/components/markdown.tsx` |
| Markdown 样式 | `packages/session-ui/src/components/markdown.css` |
| 流式分割 | `packages/session-ui/src/components/markdown-stream.ts` |
| shiki Worker | `packages/session-ui/src/components/markdown-worker.ts` |
| Worker 协议 | `packages/session-ui/src/components/markdown-worker-protocol.ts` |
| 代码状态 | `packages/session-ui/src/components/markdown-code-state.ts` |
| Markdown 缓存 | `packages/session-ui/src/components/markdown-cache.ts` |
| 内联代码种类 | `packages/session-ui/src/components/markdown-inline-code-kind.ts` |
| 差异规范化 | `packages/session-ui/src/components/session-diff.ts` |
| 文件 Part | `packages/session-ui/src/components/message-file.ts` |
| 文件媒体 | `packages/session-ui/src/components/file-media.tsx` |
| apply_patch | `packages/session-ui/src/components/apply-patch-file.ts` |
| 消息时间线 | `packages/app/src/pages/session/timeline/message-timeline.tsx` |
| 行类型定义 | `packages/app/src/pages/session/timeline/timeline-row.ts` |
| 行投影 | `packages/app/src/pages/session/timeline/projection.ts` |
| 数据读取 | `packages/app/src/pages/session/timeline/model.ts` |
| 行构造 | `packages/app/src/pages/session/timeline/rows.ts` |
| 虚拟索引 | `packages/app/src/pages/session/timeline/virtual-items.ts` |
| TextShimmer | `packages/ui/src/components/text-shimmer.tsx` |
| TextReveal | `packages/ui/src/components/text-reveal.tsx` + `.css` |
| 重试组件 | `packages/session-ui/src/components/session-retry.tsx` |
