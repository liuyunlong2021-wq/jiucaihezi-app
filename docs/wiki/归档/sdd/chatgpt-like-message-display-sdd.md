# ChatGPT-like Message Display SDD

> 日期: 2026-06-01
> 状态: 已按 TDD 执行至 Phase 7，待用户实机长文/工具流验证
> 范围: 只优化对话显示层，不改模型调用、上下文管理、工具执行、知识库召回
> 目标: 让韭菜盒子 Studio 的聊天阅读体验在显示层向 ChatGPT 靠拢，优先解决稳定性、阅读感、低噪音、流式顺滑、长文可读、工具结果清晰

---

## 1. 一句话定案

把当前聊天区升级为一套独立的 `Message Display System`。

它不改变 AI 的真实能力，只负责把原始消息、工具状态、知识引用、文件结果、流式输出包装成稳定、低噪音、可阅读、可操作的产品体验。

```text
原始消息内容
↓
显示模型分类
↓
文本诊断与容错
↓
流式平滑缓冲
↓
Markdown / 代码 / 表格 / 引用分层渲染
↓
低噪音消息布局
↓
Hover / 折叠 / 文件卡片 / Trace 按需显示
```

ChatGPT 显示层最值得学习的不是具体颜色、logo 或头像，而是这几个原则：

```text
内容优先
辅助信息延后
当前输入和当前回答最突出
长文像正文，不像卡片
工具与引用可查，但不抢主阅读流
流式输出稳定，不抖动、不乱码、不大段突涌
```

---

## 2. 为什么值得做

用户对模型质量的感知不只来自模型本身，也来自显示层：

```text
输出是否顺滑
长文是否好读
代码是否像专业工具
表格是否撑爆
文件生成状态是否可信
引用是否干扰阅读
操作按钮是否碍眼
有没有乱码和奇怪问号
```

当前韭菜盒子的核心能力已经强于普通聊天产品：Skill、Vault、Tool、文件生成、本地能力、Trace 都在同一个工作台里。但这些能力如果一直显性压在消息区里，会让用户感觉像在看调试台，而不是在和一个成熟产品对话。

所以显示层的方向是：

```text
普通用户先看到干净回答
需要确认时再展开来源、工具、上下文和调试信息
```

---

## 3. 对标 ChatGPT 的原则，不做像素级复制

### 3.1 禁止目标

```text
禁止复制 ChatGPT 的 logo、品牌、具体视觉资产
禁止为了像 ChatGPT 而破坏韭菜盒子的本地工作台定位
禁止把所有消息都改成同一种“漂亮气泡”
禁止牺牲工具、知识库、文件结果这些产品优势
```

### 3.2 正确目标

```text
学习 ChatGPT 的信息层级
学习 ChatGPT 的低噪音操作
学习 ChatGPT 的正文阅读感
学习 ChatGPT 的工具状态折叠
学习 ChatGPT 的代码块、表格、长文处理
学习 ChatGPT 的 hover 编辑、重试、复制等动作分层
```

官方资料中，ChatGPT 明确把编辑消息、重试回复、分支继续、工具入口、Canvas、Apps、composer 设计等作为体验能力持续迭代。这说明它的核心不是“气泡”，而是围绕对话建立一套完整工作面。

韭菜盒子应该对标这个方向，但做成适合本产品的版本：

```text
ChatGPT: 通用对话工作面
韭菜盒子: 纯手动 AI 工作台的对话阅读面
```

---

## 4. 当前差距诊断

### 4.1 已发现问题

| 类型 | 当前表现 | 对用户影响 | 优先级 |
|---|---|---|---|
| 流式乱码 | 偶发 `?` / `??` / `�` | 明显不专业 | P0 |
| 流式节奏 | 卡住后一大段涌出 | 不像实时生成 | P0 |
| 消息身份 | 头像、名称、时间长期占位 | 视觉噪音高 | P1 |
| 操作按钮 | 多个按钮常驻或局部常驻 | 阅读被打断 | P1 |
| 助手气泡 | 背景和边框偏重 | 长文像卡片，不像正文 | P1 |
| 引用卡片 | 搜索/知识引用容易抢正文 | 回答主体被打断 | P1 |
| 代码块 | 可用但质感一般 | 开发用户感知明显 | P1 |
| 表格 | 宽表容易撑爆或拥挤 | 长内容体验不稳 | P1 |
| 工具状态 | 工具卡、状态条、消息混杂 | 用户难判断进度 | P2 |
| 长输出 | continuation 可用但显示上割裂 | 长文读感弱 | P2 |
| 移动端 | 输入区和消息区节奏一般 | 对标差距明显 | P2 |

### 4.2 已完成的先导修复

已完成：

```text
Rust 流式 UTF-8 增量解码，避免 chunk 边界破坏中文/emoji
用户消息隐藏身份 meta
助手消息身份弱化为韭菜盒子或 Skill 名
消息操作按钮改为 hover/focus 显示
```

仍需继续：

```text
前端流式平滑缓冲
历史乱码显示诊断
助手正文流布局
Markdown / 代码 / 表格精修
引用默认折叠
工具状态统一折叠
长输出 continuation 的显示合并和结构提示
```

---

## 5. 产品显示原则

### 5.1 信息温度分层

显示层统一采用“信息温度”模型：

| 层级 | 内容 | 默认显示策略 |
|---|---|---|
| 热信息 | 用户输入、助手正文、文件下载结果 | 直接显示 |
| 温信息 | 复制、重试、编辑、继续写、导出 | hover/focus 显示 |
| 冷信息 | 时间、模型、Skill、Vault、知识引用、搜索引用 | 折叠或弱提示 |
| 冰信息 | 原始 JSON、token、trace、工具参数、上下文段 | 调试入口中显示 |

这是最接近 ChatGPT 高级感的核心规则：用户首先读内容，而不是读系统状态。

### 5.2 不同内容使用不同形态

消息区不是单一气泡系统，而是统一阅读系统：

```text
短用户输入 -> 右侧轻气泡
短助手回复 -> 左侧轻正文
长助手回复 -> 文章式 prose
代码输出 -> 专业代码块
表格输出 -> 可横向滚动数据表
工具运行 -> 后台任务状态
文件生成 -> 文件结果卡片
知识引用 -> 回答末尾脚注式来源
Trace 信息 -> 二级调试面板
```

### 5.3 显示层必须容错

显示层必须保证：

```text
不出现刺眼乱码
不让坏 Markdown 撑爆布局
不让超宽表格撑爆消息区
不让代码块破坏滚动
不让工具 JSON 原样污染聊天流
不静默改写用户原文
```

---

## 6. 目标体验规格

### 6.1 普通聊天

目标：

```text
用户消息像一个轻量输入回显
助手消息像一段自然正文
身份、时间、按钮不打断阅读
```

显示规则：

```text
用户消息:
  - 靠右
  - 最大宽度 72%
  - 无头像、无“你”、无常驻时间
  - hover/focus 显示复制、编辑、重发、删除

助手消息:
  - 靠左或正文流
  - 最大宽度 760-820px
  - 默认弱背景或无背景
  - 不使用重边框
  - hover/focus 显示复制、重试、引用、导出等动作

工具/系统消息:
  - 默认不进入主阅读流
  - 转为状态 pill 或折叠卡片
```

### 6.2 长文输出

目标：

```text
长文读起来像文章，而不是一大块聊天卡片
```

显示规则：

```text
compact length >= 900 或段落 >= 4 时切换 longform
longform 使用 prose layout
段落 line-height 1.72-1.8
段落间距 0.65em-0.9em
h2/h3 与前文间距显著大于普通段落
列表项间距稳定
引用、表格、代码块作为独立内容块
```

### 6.3 代码输出

目标：

```text
接近 ChatGPT 的代码块体验，并保留韭菜盒子主题
```

显示规则：

```text
代码块头部:
  - 左侧语言名
  - 右侧复制按钮
  - 背景与代码区分层

代码区:
  - 独立横向滚动
  - 不撑爆消息区
  - 等宽字体
  - 主题跟随当前 app theme
  - 代码复制只复制原始 code text
```

### 6.4 表格输出

目标：

```text
表格可读，不破坏布局
```

显示规则：

```text
table 外层包一层横向滚动容器
表头弱背景
单元格最大宽度，长文本换行
移动端优先横向滚动，不强行压缩到不可读
```

### 6.5 引用与知识来源

目标：

```text
可追溯，但不抢正文注意力
```

显示规则：

```text
默认只显示回答末尾一行弱提示:
  - 已参考 N 条知识库内容
  - 已参考 N 条搜索结果

点击展开:
  - 标题
  - 路径或 URL
  - 摘要
  - 命中原因

Trace 中:
  - 查看完整 recall reason
  - 查看上下文段
```

### 6.6 工具调用与文件生成

目标：

```text
用户能看懂工具进度，但主阅读流不被工具参数、JSON 和中间日志污染
```

状态：

```text
queued
running
succeeded
failed
cancelled
```

显示规则：

```text
running:
  - 单行 pill + loading
  - 文案使用自然语言，比如“正在生成 Word 文档”

succeeded with file:
  - 文件结果卡片
  - 文件名、格式、大小或来源
  - 下载/打开/导出按钮

succeeded text only:
  - 默认摘要折叠

failed:
  - 红色弱提示
  - 可展开错误详情
  - 可重试
```

---

## 7. 架构设计

### 7.1 新增显示层模块

新增目录：

```text
src/components/chat/display/
├── messageDisplayModel.ts
├── textDiagnostics.ts
├── streamSmoother.ts
├── markdownDisplayPolicy.ts
└── __tests__/
```

职责：

| 文件 | 职责 |
|---|---|
| `messageDisplayModel.ts` | 把 ChatMessage props 转成稳定 UI 显示模型 |
| `textDiagnostics.ts` | 检测乱码、替换字符、异常控制字符、可疑问号噪声 |
| `streamSmoother.ts` | 前端流式输出平滑缓冲，只影响 UI 节奏 |
| `markdownDisplayPolicy.ts` | 统一 Markdown、代码、表格、引用显示策略 |

### 7.2 组件拆分

当前 `MessageBubble.vue` 同时承担身份、Markdown、代码复制、图片灯箱、引用、导出、编辑、朗读、Trace。后续分阶段拆成：

```text
MessageBubble.vue
├── MessageMeta.vue
├── MessageContent.vue
├── MessageActions.vue
├── MessageReferences.vue
├── MessageToolSummary.vue
└── MessageTextWarning.vue
```

拆分原则：

```text
先抽纯显示组件，不改 useChat
保持 props 兼容，不重构消息数据结构
每拆一个组件必须有测试
先解决阅读体验，再做大拆分
```

### 7.3 MessageDisplayModel

新增类型：

```ts
export interface MessageDisplayModel {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  layout: 'user-bubble' | 'assistant-prose' | 'assistant-compact' | 'tool-collapsed' | 'hidden-system'
  showMeta: boolean
  metaLabel: string
  metaIcon: string
  showTimestampByDefault: boolean
  contentKind: 'plain' | 'markdown' | 'code-heavy' | 'longform' | 'tool-result'
  hasTextWarning: boolean
  textWarning?: string
  actionsMode: 'hover' | 'always' | 'hidden'
  referenceMode: 'none' | 'collapsed-summary' | 'expanded'
}
```

规则：

```text
user -> user-bubble, showMeta=false, actionsMode=hover
assistant short -> assistant-compact, showMeta=weak, actionsMode=hover
assistant long -> assistant-prose, contentKind=longform
assistant code-heavy -> assistant-prose, contentKind=code-heavy
tool -> tool-collapsed
system -> hidden-system
```

### 7.4 TextDiagnostics

检测目标：

```text
Unicode replacement char: �
连续问号: ??? / ？？？
控制字符: 非 \n \t 的 C0 控制符
异常高比例符号噪音
不完整 Markdown fence
异常长无空格文本
```

返回类型：

```ts
export interface TextDiagnosticResult {
  severity: 'none' | 'low' | 'medium' | 'high'
  codes: Array<'replacement-char' | 'question-mark-run' | 'control-char' | 'symbol-noise' | 'unclosed-fence' | 'long-unbroken-text'>
  userMessage?: string
}
```

处理策略：

```text
新消息: 依赖 UTF-8 流式修复避免产生
历史消息: 不自动改库，只在显示层提示
严重异常: 显示“文本可能包含编码异常”，提供复制原文
轻微异常: 不打断正文，只在 Trace 或 hover 中可见
```

禁止：

```text
禁止静默替换用户原文
禁止把 ??? 一律删除
禁止自动改写 messages 存储
```

### 7.5 StreamSmoother

目标：

```text
即使底层 chunk 到达不均匀，前端也以稳定节奏显示
```

策略：

```text
底层仍尽快接收完整 delta
真实 content 仍按原逻辑累计
UI 层维护 displayText
每 16-32ms flush 一小段
标点、换行、代码块边界允许立即 flush
finish 时立即 flush 剩余内容
abort 时 flush 当前已收到内容
```

硬约束：

```text
不能影响 fullReply 原始累计
不能影响 tool_calls delta 解析
不能让最终显示内容和原始内容不一致
不能为了动画牺牲响应速度
```

### 7.6 MarkdownDisplayPolicy

统一策略：

```text
所有链接桌面端用 openExternal 打开
所有代码块由统一 renderer 生成
所有 table 外包横向滚动容器
所有 img 限制 max-width / max-height
所有 blockquote 低对比显示
所有 hr 不产生过强分割
```

---

## 8. 文件级实施方案

### 8.1 Phase 1: 稳定与去噪

目标：

```text
先解决最影响观感的问题，让消息区不再像调试台
```

创建：

```text
src/components/chat/display/textDiagnostics.ts
src/components/chat/display/messageDisplayModel.ts
src/components/chat/MessageTextWarning.vue
src/components/chat/display/__tests__/textDiagnostics.test.ts
src/components/chat/display/__tests__/messageDisplayModel.test.ts
```

修改：

```text
src/components/chat/MessageBubble.vue
src/components/__tests__/chatMessagePresentation.test.ts
```

验收：

```text
用户消息不显示常驻“你”和头像
助手 meta 弱化
操作按钮 hover/focus 出现
包含 � 的历史消息显示弱提示
复制仍复制原始 content
system/tool 不污染主阅读流
```

### 8.2 Phase 2: 正文阅读质量

修改：

```text
src/components/chat/MessageBubble.vue
src/styles/highlight-theme.css
```

验收：

```text
助手长文自动进入 prose layout
长文不再像重卡片
段落、标题、列表间距接近文章阅读
中文长文 line-height 稳定
中英文混排不拥挤
```

### 8.3 Phase 3: 代码与表格专业化

修改：

```text
src/components/chat/MessageBubble.vue
src/components/chat/display/markdownDisplayPolicy.ts
```

验收：

```text
代码块头部包含语言名和复制按钮
代码长行横向滚动，不撑爆消息区
表格外层横向滚动
表头弱背景
移动端表格不压缩到不可读
```

### 8.4 Phase 4: 引用默认折叠

创建：

```text
src/components/chat/MessageReferences.vue
```

修改：

```text
src/components/chat/MessageBubble.vue
```

验收：

```text
知识库引用默认显示一行摘要
搜索引用默认显示一行摘要
展开后显示标题、路径/URL、摘要、命中原因
没有真实 hits 时不显示引用块
引用永远在回答末尾，不抢正文开头
```

### 8.5 Phase 5: 工具状态与文件结果

创建：

```text
src/components/chat/MessageToolSummary.vue
```

修改：

```text
src/components/chat/MessageBubble.vue
src/components/chat/AgentStatusBar.vue
```

验收：

```text
工具运行时主阅读流只显示单行状态
工具成功生成文件时显示文件卡片
工具失败时显示弱错误和可展开详情
工具原始参数/JSON 默认不显示
不会出现“Word 已生成但界面仍一直运行中”的状态错位
```

### 8.6 Phase 6: 流式体验

创建：

```text
src/components/chat/display/streamSmoother.ts
src/components/chat/display/__tests__/streamSmoother.test.ts
```

修改：

```text
src/composables/useChat.ts
src/components/chat/ChatPanel.vue
```

验收：

```text
连续小 delta 不会每个字符都触发 Vue 更新
大 chunk 会分批显示
finish 时 flush 全部剩余内容
abort 时 flush 当前已收到内容
tool_calls delta 解析不受影响
最终消息 content 与原始累计完全一致
```

### 8.7 Phase 7: 长输出 continuation 显示合并

修改：

```text
src/components/chat/ChatPanel.vue
src/components/chat/MessageBubble.vue
```

验收：

```text
finish_reason=length 时显示“继续写”弱按钮
用户点继续后追加到同一助手消息的 continuation group
显示上合并为同一回答，不割裂成多条噪音消息
保留 part 信息供调试查看
```

---

## 9. TDD 测试策略

### 9.1 单元测试

新增：

```text
src/components/chat/display/__tests__/textDiagnostics.test.ts
src/components/chat/display/__tests__/messageDisplayModel.test.ts
src/components/chat/display/__tests__/streamSmoother.test.ts
```

覆盖：

```text
用户/助手/工具/系统布局分类
长文识别
代码密集内容识别
引用显示模式
乱码检测
控制字符检测
流式 flush 节奏
finish/abort flush
```

### 9.2 源码守卫测试

扩展：

```text
src/components/__tests__/chatMessagePresentation.test.ts
```

守卫：

```text
用户消息不得重新出现常驻“你”/头像
操作按钮不得常驻显示
引用卡片默认折叠
工具 JSON 不得直接进入主阅读流
MessageBubble 不得继续无限膨胀
```

### 9.3 手测样例

必须构造 10 类消息：

```text
短问短答
长文 3000 字
代码块
宽表格
知识库引用回答
搜索引用回答
工具生成 Word 文件
工具失败
包含历史乱码的消息
finish_reason=length 的 continuation
```

手测标准：

```text
正文优先
无明显布局爆炸
操作按钮不干扰阅读
引用可查但不抢眼
流式输出稳定
工具状态可信
复制/编辑/重试功能不回退
```

---

## 10. 视觉规范

### 10.1 尺寸

```text
消息区最大正文宽度: 760-820px
用户气泡最大宽度: 72%
助手正文最大宽度: 820px
代码块最大宽度: 100%，内部横向滚动
表格最大宽度: 100%，外层横向滚动
```

### 10.2 字体与行高

```text
普通消息字号: 14px
助手正文 line-height: 1.72
长文 line-height: 1.76
代码字号: 12px-13px
meta / 引用摘要: 11px-12px
```

### 10.3 圆角与边框

```text
普通用户气泡 radius: 12px
代码块 radius: 8px
引用折叠块 radius: 8px
文件卡片 radius: 8px
避免多层 card 嵌套
助手长文不使用重边框
```

### 10.4 动效

```text
操作条出现: opacity + translateY，120-160ms
折叠展开: 120-180ms
流式文本: 16-32ms flush
不做复杂弹跳动画
尊重 prefers-reduced-motion
```

---

## 11. 可访问性要求

```text
所有 icon button 必须有 title 或 aria-label
hover 出现的操作也必须可通过 focus 访问
引用折叠按钮必须是 button，不用 div 模拟
代码复制按钮必须可键盘触发
错误提示不能只依赖颜色
文件卡片按钮必须有明确文本
```

---

## 12. 不做的事

初版不做：

```text
像素级复制 ChatGPT
重做整个 ChatPanel 布局
重做左侧栏、设置页、文件树
引入大型 UI 框架
把上下文引擎和显示层混在一起改
为了美观隐藏真实工具失败
自动改写历史消息内容
```

---

## 13. 风险与约束

### 13.1 最大风险

```text
MessageBubble.vue 已经过大，继续堆 CSS 和逻辑会恶化维护性
```

缓解：

```text
Phase 1 只接入 display model
Phase 2 开始逐步抽组件
每一步都有守卫测试
```

### 13.2 流式平滑风险

```text
如果 stream smoother 进入 useChat 核心累计逻辑，可能破坏工具调用和最终内容
```

缓解：

```text
stream smoother 只影响 UI displayText
真实 content 保存不经过 smoother
tool_calls delta 不进入 smoother
```

### 13.3 显示诊断误伤风险

```text
连续问号可能是用户真实输入，不一定是乱码
```

缓解：

```text
只提示，不删除
严重度分级
用户复制仍复制原文
不写回存储
```

---

## 14. 超越当前认知的建议

### 14.1 不要追求“像 ChatGPT 的气泡”，要追求“像 ChatGPT 的信息纪律”

ChatGPT 的成熟感来自信息纪律：

```text
当前回答最大
历史信息退后
工具退后
引用退后
操作退后
调试退后
```

这比颜色、头像、圆角重要得多。

### 14.2 韭菜盒子应该建立自己的“工作台阅读面”

ChatGPT 是通用对话。韭菜盒子是纯手动 AI 工作台。

所以最终形态不应该是 ChatGPT 克隆，而应该是：

```text
ChatGPT 的阅读体验
+ Cursor/Codex 的任务状态感
+ Notion/文档工具的长文排版
+ 本地工作台的文件结果可控性
```

这会比单纯模仿 ChatGPT 更适合你的产品。

### 14.3 显示层要成为信任层

用户会通过显示层判断系统是否可靠：

```text
如果生成 Word 后仍显示运行中，用户会觉得系统不可信
如果回答有乱码，用户会觉得模型不稳定
如果引用卡片乱，用户会觉得知识库不准
如果工具 JSON 外露，用户会觉得产品半成品
```

所以显示层不是小美化，是产品信任的一部分。

### 14.4 建议以后做“阅读模式”

当助手输出达到长文阈值时，可以提供一个轻量入口：

```text
在对话内阅读
打开阅读模式
放入编辑区
导出
```

这样长文、剧本、方案、法律文档、研究报告会比普通聊天产品更强。

---

## 15. 推荐执行顺序

建议按 7 个阶段执行，不要一次大改：

```text
Phase 1: 稳定与去噪
Phase 2: 正文阅读质量
Phase 3: 代码与表格专业化
Phase 4: 引用默认折叠
Phase 5: 工具状态与文件结果
Phase 6: 流式体验
Phase 7: 长输出 continuation 显示合并
```

第一批最值得立刻做：

```text
1. textDiagnostics.ts
2. messageDisplayModel.ts
3. MessageTextWarning.vue
4. MessageBubble 接入 display model
5. chatMessagePresentation 守卫测试
```

完成 Phase 1 后先手测 1-2 天，再进入 Phase 2。原因是 Phase 1 会改变消息区的基础显示模型，先稳定再继续打磨排版，风险最低。

---

## 16. 最终验收标准

必须达到：

```text
普通聊天默认界面不再像调试台
用户消息不显示头像和“你”
助手消息可读性接近正文
操作按钮默认不干扰阅读
代码块和表格不撑爆消息区
乱码被检测或避免
工具结果不污染主阅读流
引用可追溯但不抢正文
长输出 continuation 显示上不割裂
```

不要求初版达到：

```text
完全复制 ChatGPT
所有动画与 ChatGPT 一致
移动端做到最终形态
完整视觉回归自动化截图
```

---

## 17. 参考依据

本 SDD 主要基于：

```text
韭菜盒子当前 MessageBubble / ChatPanel 代码结构
ChatGPT 当前公开产品方向
OpenAI Help Center 中关于编辑消息、重试回复、分支继续、工具入口、composer 更新的说明
韭菜盒子“纯手动 AI 工作台”的产品原则
```
