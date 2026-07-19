# 对话 Markdown 正文紧凑化 SDD

> 日期：2026-07-19
> 状态：已实现
> 范围：助手 Markdown 正文的显示间距；不改模型输出、用户消息、工具卡片或 Markdown 语法支持。

## 目标

助手的长 Markdown 回复应当正文紧凑可读，标题、列表、表格和代码块仍有清晰层次。不得再把 Markdown 渲染产生的 HTML 源码换行显示为额外空行。

## 根因

renderMessageMarkdown() 用 Marked 把助手回复转为 HTML。MessageBubble.vue 的 .msg-body 同时设置了 white-space: pre-wrap。

浏览器会把 HTML 标签之间的换行保留为文本节点；pre-wrap 再将这些文本节点显示出来，造成每个段落、列表项、标题块之间出现额外空白。长回复还会命中 assistant-prose，其段落下边距为 0.78em，进一步放大问题。

原始模型回复中的空行和 --- 是有意义的 Markdown 结构，不是根因，不应通过改提示词或删除内容解决。

## 最小方案

1. 助手 Markdown 正文容器使用正常 HTML 空白折叠，不再使用 pre-wrap。
2. 流式文本继续由现有 renderStreamingText() 明确输出 <br>，因此真实换行不丢失。
3. 代码块继续由 pre 保留格式；表格、列表、引用和用户消息不改。
4. 仅收紧 assistant-prose 的段落和列表外边距；标题、代码块、表格维持现有较明显的视觉层级。

## 不做

- 不修改模型系统提示词，不要求模型少换行。
- 不新增“紧凑/宽松”设置或第二套 Markdown 渲染器。
- 不改变用户消息的 pre-wrap，用户手动输入的换行必须原样保留。
- 不压缩 ---、代码块、表格、引用等 Markdown 结构本身。

## 实施位置

| 文件 | 改动 |
|---|---|
| src/components/chat/MessageBubble.vue | 仅调整 .msg-body 与 assistant-prose 下的正文、列表间距。 |
| src/components/chat/display/__tests__/markdownDisplayPolicy.test.ts | 加入多段 Markdown 的渲染合同。 |
| src/components/chat/__tests__/messageMarkdownLayout.test.ts | 加入样式合同，确保 Markdown 正文不再使用 pre-wrap，并保留代码块 pre。 |

## 验收标准

1. 包含标题、段落、编号列表、表格和代码块的长回复不再每段多出一行空白。
2. 普通正文段距小于当前 0.78em，列表项间距小于当前 0.28em。
3. 标题、表格和代码块仍有独立层次；代码内部换行不变。
4. 用户消息继续使用自己的 pre-wrap 显示逻辑。
5. Markdown 安全净化、链接、复制代码和表格包装的已有测试继续通过。

## 验证

- 先让新增样式合同在旧代码上失败。
- 修改后运行 Markdown 显示测试和完整聚焦测试。
- 人工验收：打开同一条“统一设计系统”长回复，确认段落紧凑、列表可扫读、表格和代码块未塌陷。

## 实施记录（2026-07-19）

- Markdown 正文容器已从 pre-wrap 改为 normal，避免 Marked 产出的 HTML 标签间换行被显示为额外空行。
- assistant-prose 段落下边距从 0.78em 收紧为 0.42em；列表外边距从 0.55em/0.9em 收紧为 0.42em/0.62em；列表项从 0.28em 收紧为 0.16em。
- 用户消息未修改，仍使用独立的 pre-wrap；代码块仍由 pre 显示，标题、表格、引用和 Markdown 语义不变。
- 自动验证：新增正文样式合同和多段 Markdown 语义合同。
