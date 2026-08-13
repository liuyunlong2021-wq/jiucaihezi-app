# Thinking 模型工具调用 `reasoning_content` 中断（2026-08-11）

> 状态：代码修复与自动验证完成；截图对应 NewAPI 模型的真实回归待验收。

## 现象

- 记忆模式在完成多次查找、读取等工具调用后，以 HTTP 400 中断：`The reasoning_content in the thinking mode must be passed back to the API.`
- 无工具的普通回答不触发该错误；问题与任务复杂度无关，触发条件是 thinking 响应后进入工具结果回填。

## 根因

- 共享 direct runtime 为了不把隐藏推理显示到 UI，只累积可见 `content` 和 `tool_calls`，丢弃了流式 `reasoning_content`。
- 下一轮请求重建 assistant 工具调用消息时只携带 `tool_calls` 与 tool 消息，未原样回传该字段；thinking 上游因此拒绝续请求。

## 修复

- Git `d98b72bf` 在单次 `runDirectChatCompletion` 内引入临时 `DirectReasoningReplay`：SSE 和 JSON 回退响应都累积 `reasoning_content`，不传给 UI 回调。
- 普通工具循环及流中断后的续传循环，都将原值附加到紧随工具结果之前的 assistant 工具调用消息。
- `.raw` Markdown、`ConversationTurn` 和最终可见回答不保存该字段；本轮结束即丢弃。现有 Markdown 历史继续作为下一次用户请求的可见上下文。
- 审计后移除了与问题无关的 `content: null`，保持非 thinking 工具消息原有载荷形状。

## 验证边界

- direct runtime 定向测试 `39/39` 通过，覆盖推理不显示、普通工具续请求原样回放和流中断续传回放。
- `pnpm exec vue-tsc -b` 与 `git diff --check` 通过。
- 尚未用截图对应的真实 NewAPI 模型连续执行至少两轮工具调用；在该验收完成前，不登记为生产闭环。

## 关联

- [[开发/通用记忆对话独立App SDD]]
- [[hot]]
- [[来源索引]]
