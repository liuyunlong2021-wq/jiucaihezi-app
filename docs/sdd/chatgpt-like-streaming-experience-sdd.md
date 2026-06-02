# ChatGPT-like Streaming Experience SDD

> 日期: 2026-06-01
> 状态: 设计方案，待 TDD 执行
> 范围: 只优化对话流畅度、流式显示、滚动跟随、流式阶段渲染成本；不改模型调用协议、不改统一上下文引擎、不改 Skill/Vault/Tool 选择逻辑、不重做聊天 UI
> 目标: 基于韭菜盒子现有架构，补一层最小侵入的 `ChatGPT-like Streaming Layer`，解决“卡一下后一股脑输出”、长文流式渲染卡顿、滚动抖动、工具阶段像卡死等体验问题

---

## 1. 一句话定案

韭菜盒子 Studio 不应搬运 Open WebUI 或 `chatgpt-vue` 的整套聊天模块，而应该在现有链路上新增一层独立的 `ChatGPT-like Streaming Layer`。

它位于：

```text
SSE / provider stream
↓
Streaming Layer
  - 大 chunk 渐进 reveal
  - requestAnimationFrame UI commit
  - streaming 轻量渲染
  - 智能滚动合并
↓
messages / MessageBubble / ChatScrollNav
```

它的职责不是提升模型能力，而是把不稳定的上游 token 到达节奏包装成稳定、连续、低打扰的阅读体验。

---

## 2. 背景与对标结论

### 2.1 ChatGPT 的体验本质

ChatGPT 的流畅感不是单纯“支持 SSE”，而是前端主动控制节奏：

```text
首字反馈快
输出节奏稳定
大段返回不会突然整块砸到界面
Markdown / 代码 / 表格不会阻塞打字感
用户上滑时不强制拉回底部
工具、搜索、生成阶段有稳定中间态
```

### 2.2 Open WebUI 值得学习的点

Open WebUI 的关键优势：

```text
1. createOpenAITextStream 支持 splitLargeDeltas
   上游一次返回大 delta 时，前端拆成 1-3 字符的小片段渐进显示。

2. Messages.svelte 对 streaming content update 使用 requestAnimationFrame throttle
   内容变化不立即重建完整消息列表，每帧最多重建一次。

3. autoScroll 逻辑区分“用户在底部”和“用户主动上滑”
   用户阅读旧内容时，不强制滚回底部。
```

这三个机制值得吸收。

### 2.3 chatgpt-vue 不适合作为主要参考

`lianginx/chatgpt-vue` 的实现非常轻：

```text
reader.read()
↓
JSON.parse(data)
↓
messageList[last].content += delta.content
↓
watch(messageList) nextTick(scrollToBottom)
↓
md.render(content)
```

它看起来简单，但没有：

```text
大 chunk 拆分
rAF commit
streaming 轻量渲染
工具状态
知识引用
长文 continuation
复杂上下文引擎
```

它只适合提醒我们一个原则：流式阶段要尽量短链路，不应把每个 delta 都拖进重型显示链路。

### 2.4 我们当前基础

已具备：

```text
useChat.ts:
  - readSSEStream
  - readOllamaChatStream
  - tool call delta 解析
  - reasoning/content 分离
  - createStreamSmoother 接入

src/components/chat/display:
  - streamSmoother.ts
  - messageDisplayModel.ts
  - markdownDisplayPolicy.ts
  - continuationDisplayModel.ts
  - textDiagnostics.ts

MessageBubble.vue:
  - Markdown / code / table / KaTeX / Mermaid
  - tool summary
  - references
  - continuation grouping

ChatScrollNav.vue:
  - 用户上滑检测
  - autoScrollIfNeeded
```

当前缺口：

```text
createStreamSmoother 只是节流 fullText 更新，不主动拆大块
useChat 仍直接更新 Vue 响应式消息内容
MessageBubble streaming 时仍可能跑完整 Markdown / KaTeX / Mermaid 链路
滚动和内容提交不是同一个 rAF 节奏
工具阶段状态还没有完全变成稳定“运行中”反馈
```

---

## 3. 产品目标

### 3.1 目标体验

```text
用户点击发送后 150ms 内看到稳定状态反馈
模型一旦有内容，按稳定节奏持续显示
即使上游一次返回大段文本，也不能整段突然出现
长文输出中 UI 不明显卡顿
用户在底部时自动跟随，用户上滑后停止打扰
工具调用期间持续显示明确状态，不像卡死
最终输出内容必须和上游真实内容一致，不丢字、不改字
```

### 3.2 非目标

```text
不重做 ChatPanel 布局
不修改 Skill / Vault / Tool 的业务语义
不修改 ConversationContextEngine 的上下文选择策略
不改 provider API 协议
不为了动画牺牲工具调用解析正确性
不模拟“假输出”或编造模型没返回的内容
```

---

## 4. 架构方案

### 4.1 新增 Streaming Layer

新增模块：

```text
src/components/chat/display/progressiveStreamReveal.ts
```

职责：

```text
输入 canonical fullText
内部计算从 lastVisibleText 到 fullText 的待 reveal suffix
按稳定节奏输出 visibleText
大 chunk 自动拆成小片段
标点、换行、代码块边界可稍快 flush
finish / abort 时强制同步到 canonical fullText
```

它不解析 SSE，不处理工具调用，不理解 Markdown。

接口建议：

```ts
export interface ProgressiveStreamRevealOptions {
  emit: (visibleText: string) => void
  schedule?: (callback: FrameRequestCallback) => number
  cancelSchedule?: (id: number) => void
  now?: () => number
  minCharsPerFrame?: number
  maxCharsPerFrame?: number
  maxLagChars?: number
  hiddenTabFastForward?: boolean
}

export interface ProgressiveStreamReveal {
  pushCanonical(fullText: string): void
  flush(): void
  dispose(): void
}
```

默认策略：

```text
minCharsPerFrame = 1
maxCharsPerFrame = 8
maxLagChars = 600
hiddenTabFastForward = true
```

解释：

```text
短内容按 1-4 字符/帧显示
上游堆积过多时提高到 8 字符/帧追赶
落后超过 600 字符直接追到较近位置，避免长文输出延迟越来越大
页面隐藏时直接 fast-forward，避免浏览器后台定时器导致积压
```

### 4.2 改造 streamSmoother.ts

当前 `streamSmoother.ts` 只做时间节流。

改造为双层能力：

```text
createStreamSmoother:
  保持现有 API，兼容旧测试

createProgressiveStreamSmoother:
  新 API，内部组合 ProgressiveStreamReveal
```

这样避免一次性替换导致回归。

建议新 API：

```ts
export function createProgressiveStreamSmoother(options: StreamSmootherOptions & {
  progressive?: boolean
  minCharsPerFrame?: number
  maxCharsPerFrame?: number
  maxLagChars?: number
}): StreamSmoother
```

使用策略：

```text
普通 chat completions / ollama 文本输出: progressive = true
reasoningContent: progressive = false 或更慢节奏
tool_calls delta: 不走 progressive，保持原始解析
finish / error / abort: flush
```

### 4.3 useChat.ts 的最小改造

改造点：

```text
readSSEStream:
  content delta -> fullReply canonical
  fullReply -> progressive smoother -> onDelta(visibleText)

readOllamaChatStream:
  fullReply -> progressive smoother -> onDelta(visibleText)

tool_calls:
  继续直接 onToolCallDelta(buildToolCalls(...))
  禁止经过 progressive reveal
```

关键原则：

```text
canonical fullReply 永远保存真实完整内容
visibleText 只用于 UI 逐步展示
onFinish 必须返回 canonical fullReply
最终 assistant message 必须被 canonical fullReply 覆盖一次
```

这能保证：

```text
UI 看起来顺
保存的数据仍是真实模型输出
工具解析不受动画影响
```

### 4.4 rAF UI Commit

新增模块：

```text
src/components/chat/display/streamCommitScheduler.ts
```

职责：

```text
把高频 visibleText 更新合并为每帧最多一次 Vue state commit
finish / abort 时立即 commit
组件卸载或 run 结束时 dispose
```

接口建议：

```ts
export interface StreamCommitScheduler<T> {
  push(value: T): void
  flush(): void
  dispose(): void
}

export function createStreamCommitScheduler<T>(options: {
  commit: (value: T) => void
  schedule?: (callback: FrameRequestCallback) => number
  cancelSchedule?: (id: number) => void
}): StreamCommitScheduler<T>
```

useChat 接入方式：

```text
onDelta(visibleText)
↓
commitScheduler.push(visibleText)
↓
每帧最多一次 updateAssistantMessage(...)
```

为了降低侵入，第一阶段只在 `runChatCompletionsLoop` 和 `runLocalOllama` 的 assistant content 更新处接入，不改所有 provider 分支。

### 4.5 Streaming Lightweight Render

MessageBubble 新增 prop：

```ts
isStreamingMessage?: boolean
```

ChatPanel 传入规则：

```text
当前最后一条 assistant 且 isStreaming = true
或当前 assistant finishReason 尚未确定且内容正在更新
```

MessageBubble 渲染策略：

```text
isStreamingMessage = true:
  - 不渲染 Mermaid
  - 不渲染 KaTeX
  - 不做完整代码高亮
  - 使用 lightweight renderer:
      escape HTML
      保留换行
      基础链接不自动链接
      代码 fence 可用纯 pre 包裹但不高亮

isStreamingMessage = false:
  - 使用现有 renderMessageMarkdown
  - 完整 Markdown / code / table / KaTeX / Mermaid
```

新增模块：

```text
src/components/chat/display/streamingTextRenderer.ts
```

接口：

```ts
export function renderStreamingText(content: string): string
```

必须保证：

```text
HTML escape
不执行 v-html 中的用户原始 HTML
换行稳定
未闭合代码块不撑爆布局
```

### 4.6 Smart Auto-scroll 合并

ChatScrollNav 当前已有 `userScrolled`。

增强目标：

```text
所有 streaming 中的 scrollToBottom 合并到 rAF
只有用户接近底部时跟随
用户上滑后完全停止自动滚动
生成完成后不强制跳底，除非用户仍在底部
```

新增/改造：

```text
ChatScrollNav.vue:
  expose scheduleAutoScrollIfNeeded()
  内部用 requestAnimationFrame 合并 scrollTop = scrollHeight

ChatPanel.vue:
  watch(messages) 中不要每次 nextTick 直接 autoScroll
  改为 scrollNav.value?.scheduleAutoScrollIfNeeded()
```

底部判断：

```text
atBottom = scrollTop + clientHeight >= scrollHeight - 80
```

### 4.7 工具阶段稳定反馈

目标：

```text
工具执行、文档生成、浏览器搜索时，用户不能看到“空白等待”
```

当前已有：

```text
AgentStatusBar
MessageToolSummary
toolHistory
currentToolProgress
```

优化策略：

```text
当 assistant 有 toolCalls 但 content 为空:
  显示 MessageToolSummary running

当 tool result 返回:
  tool summary 变为 succeeded / failed

当最终 assistant 正文开始:
  工具 summary 保留为折叠/弱化证据
```

本 SDD 不引入新工具协议，只改显示和状态节奏。

---

## 5. 数据流

### 5.1 普通流式输出

```text
provider stream chunk
↓
readSSEStream 解码 / parse data lines
↓
contentDelta append to canonical fullReply
↓
progressiveStreamSmoother.push(fullReply)
↓
visibleText emit
↓
streamCommitScheduler.push(visibleText)
↓
requestAnimationFrame commit msg.content = visibleText
↓
MessageBubble streaming lightweight render
↓
ChatScrollNav scheduleAutoScrollIfNeeded
↓
finish
↓
flush visibleText
↓
msg.content = canonical fullReply
↓
MessageBubble full Markdown render
```

### 5.2 工具调用流

```text
provider tool_calls delta
↓
toolCallAccum
↓
onToolCallDelta(buildToolCalls(...))
↓
MessageToolSummary running
↓
executeToolCall
↓
tool result hidden message
↓
MessageToolSummary succeeded/failed
↓
下一轮 LLM 回复正文继续走普通流式输出
```

### 5.3 错误与中断

```text
network error / abort
↓
progressive flush
↓
commit visible partial content
↓
append error annotation
↓
finishReason = network_error / abort
```

硬性要求：

```text
任何错误都不能丢失已收到的 canonical fullReply
任何 abort 都必须 dispose rAF / reveal timer
```

---

## 6. 文件规划

### 6.1 新建文件

```text
src/components/chat/display/progressiveStreamReveal.ts
  负责 canonical -> visible 渐进 reveal。

src/components/chat/display/streamCommitScheduler.ts
  负责 visible update -> rAF Vue commit。

src/components/chat/display/streamingTextRenderer.ts
  负责 streaming 阶段轻量安全渲染。

src/components/chat/display/__tests__/progressiveStreamReveal.test.ts
src/components/chat/display/__tests__/streamCommitScheduler.test.ts
src/components/chat/display/__tests__/streamingTextRenderer.test.ts
```

### 6.2 修改文件

```text
src/components/chat/display/streamSmoother.ts
  保持 createStreamSmoother 兼容，新增 progressive API。

src/components/chat/display/__tests__/streamSmoother.test.ts
  补充 progressive 行为测试。

src/composables/useChat.ts
  在 SSE/Ollama 文本更新处接入 progressive smoother 和 rAF commit。
  不改变 tool_calls 解析。

src/components/chat/ChatPanel.vue
  给 MessageBubble 传 isStreamingMessage。
  watch(messages) 改用 scheduleAutoScrollIfNeeded。

src/components/chat/MessageBubble.vue
  streaming 中使用 renderStreamingText。
  done 后使用 renderMessageMarkdown。

src/components/chat/ChatScrollNav.vue
  增加 scheduleAutoScrollIfNeeded。

src/components/__tests__/chatMessagePresentation.test.ts
  增加架构守卫：streaming 轻量渲染、rAF scroll、progressive smoother 接入。

package.json
  把新增 display tests 接入 test:focused:build / run。
```

---

## 7. 阶段划分

### Phase 1: Progressive Reveal 纯函数层

目标：

```text
大 chunk 不再一次性显示
finish 时能追上 canonical
隐藏 tab 不积压
```

验收：

```text
pushCanonical("一大段内容...") 后第一次 emit 只显示前若干字符
连续 frame 后逐步追上
flush 后等于完整 canonical
dispose 后不再 emit
```

### Phase 2: rAF Commit Scheduler

目标：

```text
高频 visibleText 更新每帧最多 commit 一次
flush 立即 commit 最新值
dispose 清理 pending frame
```

验收：

```text
同一帧内 push 10 次，只 commit 最后一次
flush 后立即 commit
dispose 后 pending callback 不执行
```

### Phase 3: useChat 接入

目标：

```text
SSE/Ollama 正文走 progressive reveal
tool_calls delta 不受影响
onFinish 使用 canonical fullReply 覆盖最终消息
```

验收：

```text
useChatSendMessage 现有测试全部通过
新增测试证明大 delta 不一次性 commit 到 msg.content
新增测试证明最终 msg.content 等于完整上游输出
新增测试证明 tool call arguments 不被 progressive 拆坏
```

### Phase 4: Streaming Lightweight Render

目标：

```text
正在输出的 assistant 不跑完整 Markdown / Mermaid / KaTeX
完成后自动切回完整渲染
```

验收：

```text
isStreamingMessage=true 时使用 renderStreamingText
renderStreamingText escape HTML
未闭合代码 fence 不撑爆布局
isStreamingMessage=false 时仍使用 renderMessageMarkdown
```

### Phase 5: Smart Auto-scroll

目标：

```text
滚动跟随按 rAF 合并
用户上滑后不打扰
在底部时稳定跟随
```

验收：

```text
streaming 时多次消息更新只 schedule 一次滚动
userScrolled=true 时不自动滚动
streaming 结束不强制拉底
```

### Phase 6: 工具阶段体感补齐

目标：

```text
工具执行时有持续状态
工具结果到达后状态及时切换
最终正文流式输出不被工具状态阻断
```

验收：

```text
assistant toolCalls + empty content 显示 running summary
tool result 成功显示 succeeded summary
tool result error 显示 failed summary
最终 assistant 正文仍按 progressive reveal 输出
```

### Phase 7: 实机验证与参数调优

测试场景：

```text
1. 普通短问答
2. 3000 字长文输出
3. 1 万字长文输出
4. Word 文档生成工具调用
5. 知识库回答 + 引用
6. Skill 生效 + 非相关问题
7. 用户输出中途上滑阅读
8. 停止生成 / 网络失败
```

调优参数：

```text
minCharsPerFrame
maxCharsPerFrame
maxLagChars
bottom threshold
streaming lightweight render 的代码块策略
```

---

## 8. 技术细节

### 8.1 Progressive Reveal 算法

伪代码：

```ts
let canonical = ''
let visible = ''
let rafId: number | null = null

function pushCanonical(text: string) {
  canonical = text
  scheduleReveal()
}

function revealFrame() {
  const lag = canonical.length - visible.length
  if (lag <= 0) return

  const step = resolveStep(lag, canonical)
  visible = canonical.slice(0, visible.length + step)
  emit(visible)

  if (visible.length < canonical.length) scheduleReveal()
}

function flush() {
  visible = canonical
  emit(visible)
}
```

`resolveStep`：

```text
lag < 20: 1-3 chars
lag < 120: 4-6 chars
lag < maxLagChars: 6-8 chars
lag >= maxLagChars: jump closer, keep last ~240 chars unrevealed
```

标点策略：

```text
遇到换行、中文句号、问号、叹号、英文句号后，可适当扩大 step
代码块内不做复杂语法判断，避免引入重逻辑
```

### 8.2 rAF Commit 算法

伪代码：

```ts
let pending: T | undefined
let rafId: number | null = null

function push(value: T) {
  pending = value
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (pending !== undefined) commit(pending)
    pending = undefined
  })
}

function flush() {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  if (pending !== undefined) commit(pending)
  pending = undefined
}
```

### 8.3 Streaming Renderer 策略

`renderStreamingText(content)`：

```text
escape &, <, >, "
把 ``` fence 包成轻量 pre/code
普通换行变 <br>
不自动 linkify
不跑 KaTeX
不跑 Mermaid
不跑 highlight.js
```

目的：

```text
安全
快
不因未闭合 Markdown 导致 DOM 抖动
```

### 8.4 最终一致性

流式中允许：

```text
msg.content 暂时是 visibleText
```

完成后必须：

```text
msg.content = canonical fullReply
finishReason 设置完成
MessageBubble 切到完整 Markdown
会话保存完整 canonical
ConversationContextEngine.afterAssistantMessage 使用完整 canonical
```

---

## 9. 性能与风险

### 9.1 性能收益

预期收益：

```text
大 chunk 到达时不再突然整段出现
Vue 消息更新频率从每 delta 降到每 frame
长文 streaming 中不重复跑重型 Markdown
滚动更新与内容 commit 合并，减少布局抖动
```

### 9.2 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| reveal 落后真实输出太多 | 长文输出时用户看到延迟 | maxLagChars 追赶 |
| finish 时跳变 | 最后 canonical 覆盖 visible | flush 前确保 visible 追平 |
| 工具解析被影响 | 如果 tool delta 误走 reveal 会破坏 JSON args | tool_calls 独立路径 |
| Markdown 完成后布局变化 | streaming 轻渲染切 full render 会重排 | rAF scroll + 保持底部跟随 |
| 测试环境无 requestAnimationFrame | Node 测试失败 | scheduler/cancel 注入 |

### 9.3 安全

```text
streamingTextRenderer 必须 escape HTML
Markdown 完整渲染继续走现有 DOMPurify
Mermaid 继续二次 sanitize
KaTeX 继续 trust=false
搜索引用继续只允许 http/https
```

---

## 10. 测试策略

### 10.1 单元测试

新增：

```text
progressiveStreamReveal.test.ts
streamCommitScheduler.test.ts
streamingTextRenderer.test.ts
```

覆盖：

```text
大 chunk 分批 emit
flush 追平
dispose 清理
同帧多次 push 只 commit 一次
HTML escape
未闭合 code fence
隐藏 tab fast-forward
```

### 10.2 useChat 集成测试

扩展：

```text
src/utils/__tests__/useChatSendMessage.test.ts
```

新增断言：

```text
大 delta 不一次性进入第一帧 UI commit
最终 assistant content 等于完整输出
tool call delta 不经 progressive 拆分
网络错误保留 partial canonical
```

### 10.3 展示层架构测试

扩展：

```text
src/components/__tests__/chatMessagePresentation.test.ts
```

新增守卫：

```text
MessageBubble 接收 isStreamingMessage
streaming 时使用 renderStreamingText
ChatPanel 使用 scheduleAutoScrollIfNeeded
useChat 引入 createProgressiveStreamSmoother / streamCommitScheduler
```

### 10.4 手动验收

必须实机验证：

```text
桌面端 Tauri dev
Web dist
长文输出
工具生成 Word
知识库回答
用户上滑阅读
停止生成
```

---

## 11. 验收标准

P0：

```text
不丢字
不破坏 tool_calls JSON 拼接
不破坏 Word 文档生成
不出现明显 XSS 回退
```

P1：

```text
大 chunk 不整段突然出现
长文 streaming 不明显卡 UI
用户上滑后不被拉回底部
完成后 Markdown / code / table 正常
```

P2：

```text
工具阶段状态自然
reasoning 展示不抢正文
移动端输入/输出滚动稳定
```

---

## 12. 推荐执行顺序

最适合我们当前架构的执行顺序：

```text
1. progressiveStreamReveal 纯函数
2. streamCommitScheduler 纯函数
3. useChat 文本输出接入
4. MessageBubble streaming lightweight render
5. ChatScrollNav rAF auto-scroll
6. 工具状态体感补齐
7. 实机参数调优
```

原因：

```text
前两步纯函数，风险最低，测试最稳
第三步直接解决“一股脑出来”
第四步解决长文卡顿
第五步解决滚动打扰
第六步解决工具阶段像卡死
第七步根据真实体感调参数
```

---

## 13. 最终判断

最适配韭菜盒子当前架构的方案不是搬 Open WebUI，也不是搬 `chatgpt-vue`。

正确方案是：

```text
保留我们现有的 useChat / Tool / Vault / ConversationContextEngine
只在显示链路中新增 ChatGPT-like Streaming Layer
用 Progressive Reveal 驯化上游 chunk
用 rAF Commit 降低 Vue 响应式压力
用 Streaming Lightweight Render 避免长文渲染卡顿
用 Smart Auto-scroll 保持阅读控制权
```

这是一条收益最大、侵入最小、最符合现有产品定位的路径。
