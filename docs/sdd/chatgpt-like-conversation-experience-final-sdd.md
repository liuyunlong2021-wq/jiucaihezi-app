# ChatGPT-like Conversation Experience Final SDD

> 日期: 2026-06-01
> 状态: 最终 SDD，待 TDD 执行
> 适用范围: 韭菜盒子 Studio 对话区的显示、流式、滚动、工具状态、输入区反馈和体验诊断
> 不适用范围: 不重做模型调用协议、不改 Skill/Vault/Tool 手动选择原则、不替换统一对话上下文引擎、不搬运 Open WebUI 或 chatgpt-vue 整套聊天模块

---

## 0. 一句话定案

韭菜盒子 Studio 向 ChatGPT 对话体验靠拢，最适配的方案不是“换一个聊天前端”，而是在现有架构上新增一层独立的 `Conversation Experience Layer`：

```text
useChat / ConversationContextEngine / Skill / Vault / Tool / Provider
↓
Conversation Experience Layer
  - Progressive Streaming
  - Lightweight Streaming Renderer
  - Message Display System
  - Smart Auto-scroll
  - Tool Status Presentation
  - Composer Feedback
  - Conversation UX Trace
↓
ChatPanel / MessageBubble / ChatScrollNav / ToolSummary / Composer
```

这层只负责“用户看见和操作时的体验”，不接管模型能力，不改变上下文事实源，不让 AI 自动选择 Skill/Vault/Tool。

---

## 1. 背景判断

### 1.1 为什么不能直接搬 Open WebUI

Open WebUI 的聊天体验成熟，但它的产品假设和韭菜盒子不同：

```text
Open WebUI:
  面向通用 Web LLM 管理台
  强后端会话/模型/工具抽象
  多用户、多模型服务端部署

韭菜盒子 Studio:
  本地优先桌面应用
  纯手动 AI 工作台
  用户显式选择 Skill / Knowledge / Tool / Model
  工具、知识库、创作、画布、文件导出都在本地工作台内闭环
```

直接搬会引入大量不适配的状态管理、后端假设和 UI 形态，反而破坏当前核心架构。

### 1.2 chatgpt-vue 的启发与边界

`chatgpt-vue` 的价值只在一个点：流式链路短，代码少，体感直接。

但它缺少韭菜盒子已经拥有的复杂能力：

```text
Skill
Vault
Tool loop
文件生成
知识引用
上下文引擎
长文 continuation
本地能力
Trace
```

因此它不能作为主架构参考，只能作为“流式阶段不要过度渲染”的提醒。

### 1.3 ChatGPT 当前值得学习的方向

参考 OpenAI 官方帮助与发布说明：

```text
Projects in ChatGPT:
  https://help.openai.com/en/articles/10169521-projects-in-chatgpt

ChatGPT Release Notes:
  https://help.openai.com/en/articles/6825453-chatgpt-release-notes

ChatGPT file uploads:
  https://help.openai.com/en/articles/8982896-how-does-the-new-file-uploads-capability-work
```

ChatGPT 近年的体验迭代重点集中在：

```text
更顺滑的对话与长对话可靠性
文件上传、文件库、最近文件和可复用文件上下文
代码块、写作块、可预览/可导出的内容块
项目级上下文、项目记忆和项目文件
工具、搜索、App、浏览器能力融入对话
编辑、复制、分享、继续等低摩擦操作
```

对韭菜盒子的启发是：对话区不是普通气泡列表，而是一个“可阅读、可追溯、可继续工作的任务工作面”。

---

## 2. 架构原则

### 2.1 保持产品铁律

必须保持：

```text
用户选择 Skill（或不选）
用户选择 Knowledge（或关闭）
用户显式开启/选择 Tool（或关闭）
用户选择 Model
LLM 只按这套显式配置执行
```

体验层可以更聪明地展示，但不能悄悄改变执行配置。

### 2.2 不让体验层污染执行层

硬性边界：

```text
Conversation Experience Layer 不决定召回什么知识
Conversation Experience Layer 不决定是否调用工具
Conversation Experience Layer 不改写用户输入
Conversation Experience Layer 不改写 assistant canonical content
Conversation Experience Layer 不写入 Vault
Conversation Experience Layer 不绕过 ConversationContextEngine
```

它可以：

```text
平滑显示 token
降低渲染成本
折叠工具噪音
提示乱码风险
改善滚动跟随
提供更自然的状态反馈
记录体验层 trace
```

### 2.3 原始内容与可见内容分离

所有流式输出必须区分：

```text
canonicalContent:
  上游模型真实返回的完整内容
  用于保存、上下文、导出、复制、后续工具和 continuation

visibleContent:
  UI 当前逐步显示的内容
  只用于阅读体感
```

完成时必须用 `canonicalContent` 覆盖最终消息内容。

### 2.4 体验优先级

本 SDD 的优先级顺序：

```text
P0 不丢字、不坏工具、不 XSS、不乱码
P1 流式顺滑、长文不卡、滚动不打扰
P2 消息层级接近 ChatGPT，低噪音、正文优先
P3 工具和文件结果更像产品能力，不像调试日志
P4 Composer 和文件/引用工作流继续靠近 ChatGPT
```

---

## 3. 当前基础

### 3.1 已有可复用能力

当前已经具备：

```text
src/composables/useChat.ts
  - SSE / Ollama stream 解析
  - tool call delta 解析
  - reasoning/content 分离
  - tool loop

src/runtime/conversationContext/
  - 统一对话上下文引擎
  - 长文、continuation、job、rebuild 相关测试

src/components/chat/display/
  - messageDisplayModel.ts
  - streamSmoother.ts
  - markdownDisplayPolicy.ts
  - continuationDisplayModel.ts
  - textDiagnostics.ts
  - toolDisplayModel.ts

src/components/chat/
  - ChatPanel.vue
  - MessageBubble.vue
  - ChatScrollNav.vue
  - MessageReferences.vue
  - MessageToolSummary.vue
  - MessageTextWarning.vue
```

### 3.2 当前主要差距

体验差距集中在六类：

```text
1. 流式节奏不稳定：卡一下后一大段涌出
2. 高频响应式更新：每个 delta 都可能触发完整 UI 更新
3. streaming 阶段渲染太重：Markdown / KaTeX / Mermaid / highlight 不应每帧跑
4. 滚动跟随粗糙：用户阅读旧内容时容易被拉回
5. 工具阶段反馈不稳定：工具执行像“卡住”，成功后状态有时不收尾
6. 消息信息层级仍偏调试台：正文、引用、工具、trace 的主次还需更明确
```

---

## 4. 目标体验规格

### 4.1 首字与状态反馈

目标：

```text
用户发送后 150ms 内看到稳定状态
模型有第一个 content delta 后 1 个 animation frame 内开始可见输出
工具调用开始后 150ms 内显示自然语言状态
```

状态文案示例：

```text
正在思考
正在检索知识库
正在生成 Word 文档
正在执行工具
正在整理结果
```

### 4.2 流式输出

目标：

```text
上游小 delta: 直接稳定显示
上游大 delta: 前端拆分成渐进可见内容
长文输出: 不明显卡 UI，不整段突然砸到页面
完成后: 最终内容和 canonicalContent 完全一致
```

禁止：

```text
禁止编造模型没返回的内容
禁止为了动画修改 canonical content
禁止 tool_calls arguments 走文本 reveal
```

### 4.3 消息呈现

目标：

```text
用户消息轻量靠右，像输入回显
助手消息以正文阅读为主，长文像文章
身份、时间、模型、Skill、Vault、Trace 默认低噪音
引用、工具、文件结果可追溯但不抢正文
```

信息温度：

```text
热信息: 用户输入、助手正文、文件结果
温信息: 复制、编辑、重试、继续、导出
冷信息: 时间、模型、Skill、Vault、引用摘要
冰信息: trace、token、tool args、原始 JSON
```

### 4.4 滚动

目标：

```text
用户在底部时自动跟随
用户上滑后停止自动拉回
streaming 更新和 scroll 更新合并到 requestAnimationFrame
完成时不强制跳底，除非用户仍在底部
```

底部判断：

```text
scrollTop + clientHeight >= scrollHeight - 80px
```

### 4.5 工具与文件结果

目标：

```text
工具运行中像产品状态，不像空白等待
工具参数和原始 JSON 不进入主阅读流
文件生成成功后显示文件卡片
最终 assistant 正文和工具 summary 分层显示
```

状态：

```text
queued
running
succeeded
failed
cancelled
```

### 4.6 Composer

保持当前设置 UI 和手动配置原则，但输入区应更接近 ChatGPT 的体感：

```text
多行输入稳定扩展
附件 chip 清晰
Skill / Vault / Tool / Model 状态是轻提示，不压迫输入
发送、停止、重试反馈明确
输入时不阻塞主线程
```

本 SDD 不要求大改 Composer 布局。

---

## 5. 目标架构

### 5.1 Conversation Experience Layer 模块

新增/强化模块：

```text
src/components/chat/display/progressiveStreamReveal.ts
src/components/chat/display/streamCommitScheduler.ts
src/components/chat/display/streamingTextRenderer.ts
src/components/chat/display/conversationExperienceTrace.ts
```

强化现有模块：

```text
src/components/chat/display/streamSmoother.ts
src/components/chat/display/messageDisplayModel.ts
src/components/chat/display/markdownDisplayPolicy.ts
src/components/chat/display/toolDisplayModel.ts
src/components/chat/display/textDiagnostics.ts
```

### 5.2 数据流

普通文本流：

```text
provider stream chunk
↓
useChat parse SSE
↓
append to canonicalContent
↓
progressiveStreamReveal.pushCanonical(canonicalContent)
↓
visibleContent emit
↓
streamCommitScheduler.push(visibleContent)
↓
rAF commit assistant message visible content
↓
MessageBubble streaming lightweight render
↓
ChatScrollNav scheduleAutoScrollIfNeeded
↓
finish
↓
flush visibleContent
↓
message.content = canonicalContent
↓
MessageBubble full Markdown render
```

工具流：

```text
provider tool_calls delta
↓
useChat toolCallAccum
↓
MessageToolSummary running
↓
executeToolCall
↓
tool result hidden from main reading flow
↓
MessageToolSummary succeeded / failed
↓
assistant final content 继续走普通文本流
```

### 5.3 组件边界

```text
useChat.ts
  只负责 canonical content、provider stream、tool loop、final persistence
  可以接入 smoother/scheduler，但不做 DOM 决策

ChatPanel.vue
  负责把 isStreamingMessage、tool result、continuation、scroll 调度传给子组件

MessageBubble.vue
  负责根据 display model 选择 rendering path

ChatScrollNav.vue
  负责用户滚动意图与 rAF scroll 合并

display/*.ts
  只做纯函数或可注入 scheduler 的小状态机，便于测试
```

---

## 6. 核心设计

### 6.1 Progressive Stream Reveal

文件：

```text
src/components/chat/display/progressiveStreamReveal.ts
```

职责：

```text
把 canonicalContent 转为逐步增加的 visibleContent
大 chunk 自动拆成小片段
积压过大时追赶
finish / abort / error 时 flush
dispose 时清理 pending frame
```

接口：

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

默认参数：

```text
minCharsPerFrame = 1
maxCharsPerFrame = 8
maxLagChars = 600
hiddenTabFastForward = true
```

规则：

```text
lag < 20: 每帧 1-3 chars
lag < 120: 每帧 4-6 chars
lag < 600: 每帧 6-8 chars
lag >= 600: 追赶到只落后约 240 chars
```

### 6.2 Stream Commit Scheduler

文件：

```text
src/components/chat/display/streamCommitScheduler.ts
```

职责：

```text
合并高频 visibleContent 更新
每帧最多 commit 一次 Vue state
flush 时立即 commit 最新值
dispose 时取消 pending frame
```

接口：

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

### 6.3 Streaming Lightweight Renderer

文件：

```text
src/components/chat/display/streamingTextRenderer.ts
```

streaming 中：

```text
HTML escape
保留换行
轻量处理 ``` fence
不跑 Mermaid
不跑 KaTeX
不跑 highlight.js
不做复杂 linkify
```

完成后：

```text
切回 renderMessageMarkdown()
完整 Markdown / code / table / KaTeX / Mermaid
```

硬性安全要求：

```text
renderStreamingText 必须 escape &, <, >, ", '
不能把用户内容原样 v-html
未闭合代码块不能撑爆布局
```

### 6.4 Message Display System

已有 `messageDisplayModel.ts` 继续作为权威显示模型。

需要强化：

```text
isStreamingMessage
isLastAssistantMessage
hasToolStatus
hasFileResult
contentDensity
referenceMode
actionsMode
```

布局规则：

```text
user:
  layout = user-bubble
  meta 默认隐藏
  actions hover/focus 显示

assistant short:
  layout = assistant-compact
  meta 弱显示

assistant long:
  layout = assistant-prose
  contentKind = longform

assistant streaming:
  rendering = streamingTextRenderer

tool/system:
  不进入主阅读流
  转为 summary 或 trace
```

### 6.5 Tool Status Presentation

`MessageToolSummary.vue` 和 `toolDisplayModel.ts` 继续作为工具显示入口。

强化规则：

```text
assistant 有 toolCalls 且 content 为空:
  显示 running summary

tool result 返回:
  更新为 succeeded / failed

office 文件生成成功:
  显示文件结果卡片

最终 assistant 正文开始:
  工具 summary 弱化为可折叠证据
```

关键修复点：

```text
工具已经成功但 UI 仍显示 running，属于 P0 回归
必须通过 finishReason、toolResult、officeDownloadFiles、toolHistory 做一致性收尾
```

### 6.6 Smart Auto-scroll

`ChatScrollNav.vue` 增加：

```ts
scheduleAutoScrollIfNeeded(): void
```

行为：

```text
内部 requestAnimationFrame 合并 scroll
仅 atBottom 时滚动
userScrolled=true 时不滚动
组件卸载时 cancel pending frame
```

`ChatPanel.vue`：

```text
watch messages/content 更新时调用 scheduleAutoScrollIfNeeded()
不要在每个 delta 后 nextTick + scrollToBottom
```

### 6.7 Conversation UX Trace

新增轻量 trace，不进入普通用户 UI，可用于调试：

```ts
export interface ConversationExperienceTrace {
  messageId: string
  runId?: string
  firstStatusAt?: number
  firstDeltaAt?: number
  firstVisibleCharAt?: number
  totalDeltas: number
  largeDeltaCount: number
  maxDeltaChars: number
  visibleCommits: number
  markdownRenderMode: 'streaming-light' | 'full'
  autoScrollSuppressed: boolean
  toolStatusTransitions: Array<'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'>
}
```

用途：

```text
定位“为什么卡一下才出来”
定位“为什么工具一直运行中”
定位“为什么滚动被拉到底”
定位“为什么长文渲染卡”
```

---

## 7. 文件级实施方案

### 7.1 新建文件

```text
src/components/chat/display/progressiveStreamReveal.ts
src/components/chat/display/streamCommitScheduler.ts
src/components/chat/display/streamingTextRenderer.ts
src/components/chat/display/conversationExperienceTrace.ts

src/components/chat/display/__tests__/progressiveStreamReveal.test.ts
src/components/chat/display/__tests__/streamCommitScheduler.test.ts
src/components/chat/display/__tests__/streamingTextRenderer.test.ts
src/components/chat/display/__tests__/conversationExperienceTrace.test.ts
```

### 7.2 修改文件

```text
src/components/chat/display/streamSmoother.ts
  保持 createStreamSmoother 兼容，新增 progressive API。

src/components/chat/display/messageDisplayModel.ts
  增加 streaming/tool/file/longform 相关显示模型字段。

src/components/chat/display/toolDisplayModel.ts
  补齐 running/succeeded/failed/cancelled 的确定性收尾规则。

src/composables/useChat.ts
  在文本 delta 更新处接入 progressive reveal + rAF commit。
  tool_calls delta 禁止走 progressive reveal。
  finish/error/abort 必须 flush canonical content。

src/components/chat/MessageBubble.vue
  新增 isStreamingMessage prop。
  streaming 使用 renderStreamingText。
  done 使用 renderMessageMarkdown。

src/components/chat/ChatPanel.vue
  计算当前 streaming message。
  传递 isStreamingMessage。
  改用 scheduleAutoScrollIfNeeded。

src/components/chat/ChatScrollNav.vue
  增加 rAF scroll 合并。

src/components/__tests__/chatMessagePresentation.test.ts
  增加架构守卫。

src/utils/__tests__/useChatSendMessage.test.ts
  增加流式与工具回归测试。

package.json
  将新增测试接入 test:focused:build / test:focused:run。
```

---

## 8. 分阶段执行

### Phase 0: 架构守卫

目标：

```text
先用测试锁住“体验层不能破坏执行层”的边界。
```

测试：

```text
tool_calls delta 不进入 progressive reveal
finish 后 assistant content 等于 canonical content
streaming renderer 不执行 full Markdown
system/tool message 不进入主阅读流
```

验收：

```text
新增测试先失败
实现后通过
现有 useChatSendMessage 测试不回归
```

### Phase 1: Progressive Streaming

目标：

```text
解决“卡一下后一大段涌出”。
```

实现：

```text
progressiveStreamReveal.ts
streamCommitScheduler.ts
streamSmoother.ts progressive API
useChat.ts 文本 delta 接入
```

验收：

```text
大 delta 第一帧只显示部分内容
多帧逐步追上
flush 后完整一致
dispose 后不再 emit
tool calls JSON 不被拆坏
```

### Phase 2: Streaming Lightweight Render

目标：

```text
解决 streaming 中 Markdown/KaTeX/Mermaid/highlight 反复重渲染造成的卡顿。
```

实现：

```text
streamingTextRenderer.ts
MessageBubble.vue isStreamingMessage
ChatPanel.vue 传入 streaming 状态
```

验收：

```text
streaming 中 HTML 被 escape
未闭合 fence 不撑爆
完成后完整 Markdown 正常
Mermaid/KaTeX 只在完成后渲染
```

### Phase 3: Smart Auto-scroll

目标：

```text
解决滚动抖动和用户上滑被拉回。
```

实现：

```text
ChatScrollNav.vue scheduleAutoScrollIfNeeded
ChatPanel.vue watch 更新改用 rAF scroll
```

验收：

```text
底部时跟随
上滑后不跟随
同一帧多次消息更新只触发一次 scroll
完成时不强制跳底
```

### Phase 4: Tool Status 收尾

目标：

```text
解决“工具已成功但仍显示运行中”。
```

实现：

```text
toolDisplayModel.ts 状态规则
MessageToolSummary.vue 展示规则
ChatPanel.vue latestToolResult / officeDownloadFiles 映射检查
useChat.ts tool history 状态收尾检查
```

验收：

```text
Word 生成成功后 running 消失
文件卡片显示
失败时显示 failed + 可展开错误
最终 assistant 正文不被工具 summary 遮挡
```

### Phase 5: Message Hierarchy Polish

目标：

```text
继续靠近 ChatGPT 的低噪音阅读体验。
```

实现：

```text
messageDisplayModel.ts 细化 contentDensity
MessageBubble.vue 长文 prose 稳定
MessageReferences.vue 引用默认折叠
MessageTextWarning.vue 乱码弱提示
```

验收：

```text
长文像正文
引用在末尾弱提示
按钮 hover/focus 出现
乱码不刺眼、不静默改原文
```

### Phase 6: Composer Feedback

目标：

```text
输入区不大改，但反馈更接近 ChatGPT。
```

实现：

```text
发送/停止状态明确
附件 chip、Skill/Vault/Tool/Model 轻提示稳定
输入 textarea resize 不抖
```

验收：

```text
发送后状态立即变化
停止按钮可用
长输入不卡
附件/引用不挤压输入正文
```

### Phase 7: 实机验证与参数调优

必须验证：

```text
普通短问答
3000 字长文输出
10000 字长文输出
知识库回答 + 引用
Skill 生效 + 用户临时偏离 Skill 的问题
Word 文档生成工具
停止生成
网络失败
用户中途上滑阅读
移动端窄宽度
```

---

## 9. 测试策略

### 9.1 单元测试

新增：

```text
progressiveStreamReveal.test.ts
streamCommitScheduler.test.ts
streamingTextRenderer.test.ts
conversationExperienceTrace.test.ts
```

覆盖：

```text
大 chunk 分批 emit
flush 追平
dispose 清理
同帧多 push 只 commit 最后值
HTML escape
未闭合 code fence
隐藏 tab fast-forward
trace 字段计算
```

### 9.2 useChat 集成测试

扩展：

```text
src/utils/__tests__/useChatSendMessage.test.ts
```

覆盖：

```text
大 delta 不一次性进入第一帧 UI commit
最终 assistant content 等于完整上游输出
tool call arguments 不被 progressive 拆分
network error 保留 partial canonical
abort flush 当前已收到内容
```

### 9.3 展示层架构测试

扩展：

```text
src/components/__tests__/chatMessagePresentation.test.ts
```

覆盖：

```text
MessageBubble 接收 isStreamingMessage
streaming 使用 renderStreamingText
done 使用 renderMessageMarkdown
ChatPanel 使用 scheduleAutoScrollIfNeeded
工具结果不显示为主阅读消息
引用默认折叠
```

### 9.4 手动验收

命令：

```text
pnpm run test:focused
pnpm run test:conversation
pnpm run build
pnpm run tauri:dev
```

手动观察：

```text
是否还会一股脑输出
长文是否卡 UI
工具成功后是否还显示运行中
滚动是否尊重用户上滑
乱码提示是否合理
代码/表格/引用是否稳定
```

---

## 10. 性能预算

P0 预算：

```text
发送后状态反馈: <= 150ms
content delta 到 visible commit: <= 1 frame
streaming 阶段: 不运行 Mermaid / KaTeX / highlight
Vue content commit: 每 frame 最多一次
scroll commit: 每 frame 最多一次
```

P1 预算：

```text
3000 字输出期间主线程无明显长卡顿
10000 字输出期间不出现持续性输入冻结
大 delta reveal 落后不超过 maxLagChars 策略允许范围
```

---

## 11. 风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| reveal 落后太多 | 长文输出用户看到延迟 | maxLagChars 追赶，finish flush |
| 最终内容跳变 | 轻渲染切完整 Markdown 导致布局变化 | rAF scroll，完成时只在底部自动跟随 |
| 工具 JSON 被拆坏 | tool_calls 若误走 reveal 会破坏参数 | 工具 delta 独立路径 + 测试守卫 |
| XSS 回退 | streaming renderer 使用 v-html | 强制 escape，完整 Markdown 继续 DOMPurify |
| 状态卡死 | 工具成功但 running 未收尾 | toolDisplayModel 确定性状态机 |
| 体验层侵入执行层 | 体验优化改坏上下文或工具 | 架构测试 + 文件边界 |

---

## 12. 验收标准

### P0 必须满足

```text
不丢字
不破坏 tool_calls
不破坏 Word 文档生成
不引入 XSS
工具成功后不再显示运行中
```

### P1 必须满足

```text
大 delta 不整段突然出现
长文 streaming 不明显卡 UI
用户上滑后不被拉回
完成后 Markdown / code / table 正常
```

### P2 应满足

```text
长文阅读接近正文
引用默认折叠
工具状态自然
输入区状态稳定
```

---

## 13. 与既有 SDD 的关系

本文件是对话体验最终总方案。

以下文档作为子方案参考：

```text
docs/sdd/chatgpt-like-message-display-sdd.md
  消息显示系统专项方案。

docs/sdd/chatgpt-like-streaming-experience-sdd.md
  流式顺滑专项方案。
```

执行时以本文件为总入口；若子方案与本文件冲突，以本文件为准。

---

## 14. 最终建议

最适配韭菜盒子的 ChatGPT-like 路线是：

```text
不换主架构
不搬外部聊天产品
不削弱手动工作台原则
先把对话体验层做强
用小模块 + 强测试 + 实机长文验证逐步靠近 ChatGPT
```

执行顺序：

```text
Phase 0 架构守卫
Phase 1 Progressive Streaming
Phase 2 Streaming Lightweight Render
Phase 3 Smart Auto-scroll
Phase 4 Tool Status 收尾
Phase 5 Message Hierarchy Polish
Phase 6 Composer Feedback
Phase 7 实机验证
```
