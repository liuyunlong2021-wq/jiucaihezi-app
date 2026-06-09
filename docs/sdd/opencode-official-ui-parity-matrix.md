# OpenCode 官方 UI 到韭菜盒子 UI 映射表

> 日期：2026-06-08  
> 状态：产品对齐草案，待用户确认后执行  
> 目标：先完整列出 OpenCode 官方 UI 能力，再决定韭菜盒子如何用专业汉化的显式按钮、选择器、Dock 和面板承载。  

## 1. 核心原则

韭菜盒子不是照搬 OpenCode 官方界面，而是把 OpenCode 官方能力翻译成专业、清晰、可点击的中文工作台 UI。

执行规则：

1. 先以 OpenCode 官方 UI 为能力清单，不以韭菜盒子现有按钮为清单。
2. 官方有的能力，韭菜盒子必须有承载方式。
3. 官方命令不一定都做成 slash；普通用户入口优先做成按钮、菜单、选择器或 Dock。
4. 官方隐藏的内部工具，韭菜盒子也不塞进普通消息流，但必须通过 TodoDock、QuestionDock、PermissionDock、DiffDock、状态行或最终结果承载。
5. 旧聊天内核遗留 UI 如果不能映射 OpenCode 官方能力，应该删除或合并。
6. 命名必须保持专业：优先保留 OpenCode 官方术语，必要时做标准汉化；不创造口语化、儿童化或营销化名称。
7. 面向新手的解释不放进主控件命名里；统一沉淀到左下角“帮助 / 教程中心”，用教程说明专业术语、按钮用途和使用场景。

## 2. 官方源码依据

| 官方区域 | 源码位置 | 本文使用的裁决 |
|---|---|---|
| Assistant part 渲染与隐藏规则 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx` | `renderable()`、context tool group、`todowrite` hidden、pending/running question hidden、tool default open |
| 工具错误卡 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/ui/src/components/message-part.tsx` | tool error 使用 `ToolErrorCard`，websearch 可显示 provider title |
| 输入区 Dock 编排 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-composer-region.tsx` | QuestionDock、PermissionDock、TodoDock、RevertDock、FollowupDock 都在输入区上方 |
| PermissionDock | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-permission-dock.tsx` | 拒绝、允许一次、总是允许 |
| QuestionDock | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-question-dock.tsx` | 单选、多选、自定义答案、多问题队列 |
| TodoDock | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-todo-dock.tsx` | 进度、当前任务预览、折叠/展开 |
| RevertDock | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-revert-dock.tsx` | 可恢复的 revert 项 |
| FollowupDock | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/composer/session-followup-dock.tsx` | 后续建议，可立即发送或编辑 |
| 官方命令注册 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/pages/session/use-session-commands.tsx` | session、file、context、view、terminal、model、mcp、agent、permissions 命令分类 |
| slash 命令弹窗 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/components/prompt-input/slash-popover.tsx` | slash 是命令入口，不等于全部发给 server |
| 请求 parts | `/Users/by3/Documents/1OKAPP/my-opencode/packages/app/src/components/prompt-input/build-request-parts.ts` | text、file、agent、image 和 context file 作为结构化 request parts |
| Skill 官方文档 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/web/src/content/docs/skills.mdx` | Skill 通过官方目录发现，按 `name` / `description` 暴露给模型，由原生 `skill` 工具按需加载 |
| Skill 系统提示 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/opencode/src/session/system.ts` | 系统提示列出可用 Skill，并要求模型在任务匹配 description 时调用 `skill` tool |
| Skill 工具实现 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/opencode/src/tool/skill.ts` | `skill({ name })` 加载 `SKILL.md`，返回内容、base directory 和采样文件列表 |
| Skill 权限测试 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/core/test/skill/guidance.test.ts` | 固定 Skill 可用 `deny skill *` 后 `allow selected` 实现，最后匹配规则生效 |
| 文件读取工具 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/opencode/src/tool/read.ts` | `read` 读取文件或目录；大资料应作为文件系统资料交给 OpenCode 按需读取 |
| 工具与权限文档 | `/Users/by3/Documents/1OKAPP/my-opencode/packages/web/src/content/docs/tools.mdx`、`/Users/by3/Documents/1OKAPP/my-opencode/packages/web/src/content/docs/permissions.mdx` | 资料读取依赖 `read` / `grep` / `glob` 和 `external_directory` 只读授权 |

## 3. 官方 UI 能力清单与专业汉化映射建议

### 3.1 输入区和上下文输入

| OpenCode 官方 UI | 官方行为 | 韭菜盒子专业汉化映射建议 | 优先级 |
|---|---|---|---|
| PromptInput 文本输入 | 普通文本 prompt | 保留当前输入框，placeholder 改成“输入任务、问题或修改要求” | P0 |
| 文件附件 | `file` request part，可带文件内容和路径 | 继续使用附件按钮；上传后显示文件 chip：“文件附件” | P0 |
| 图片附件 | `file` part，mime 为图片 | 保留粘贴/上传图片，chip 写“图片附件” | P0 |
| `@agent` 提及 | `agent` request part | 不要求用户记 `@`；用顶部“Agent：自动/xxx”选择器承载，同时保留高级 `@` 自动补全 | P1 |
| 文件上下文/选区上下文 | file context part，可带行号和注释 | 显示为“添加文件上下文 / 添加选区上下文”；代码 IDE 式选区上下文后置 | P1 |
| Slash popover | 输入 `/` 后显示可用命令 | 保留一个“命令”按钮，但命令列表必须从官方 command registry 映射；不要硬编码无效命令 | P0 |
| Custom slash command | custom command / MCP / skill command | 显示在“高级命令”分组，并标记来源：Skill/MCP/自定义 | P2 |

### 3.2 输入区上方 Dock

| OpenCode 官方 UI | 官方行为 | 韭菜盒子专业汉化映射建议 | 优先级 |
|---|---|---|---|
| PermissionDock | 工具/权限请求，用户选择 reject/once/always | 已有 PermissionDock；标题使用“权限请求”，按钮为“拒绝 / 允许一次 / 始终允许” | P0 |
| QuestionDock | Agent 提问，支持单选、多选、自定义答案、多问题 | 已有 QuestionDock；加强队列进度：“问题 1/3”，答案按钮更像表单 | P0 |
| TodoDock | `todowrite` 状态，不进普通消息流 | 已有 TodoDock；文案改成“任务进度”，默认折叠显示当前任务 | P0 |
| RevertDock | 撤回后展示可恢复项 | 当前缺失；新增“Revert 可恢复项”Dock | P1 |
| FollowupDock | 回复后的建议动作，可发送或编辑 | 当前缺失；新增“后续操作建议”Dock，按钮为“发送建议 / 编辑后发送” | P2 |

### 3.3 Timeline / 消息流

| OpenCode 官方 UI | 官方行为 | 韭菜盒子专业汉化映射建议 | 优先级 |
|---|---|---|---|
| Text part | 有内容才显示 | 已承载；继续作为普通助手正文 | P0 |
| Reasoning part | 可按设置显示/隐藏 | 已承载；默认折叠，标题“推理过程” | P1 |
| Empty assistant while working | thinking row | 已有 thinking/status；继续显示“正在推理 / 正在调用工具” | P0 |
| Context tool group | 连续 `read/glob/grep/list` 分组 | 已承载；显示“上下文读取 N 项”，默认折叠 | P0 |
| Tool pending/running | 工具卡立即出现 | 已承载；统一工具卡标题和状态词：准备中/执行中/完成/失败 | P0 |
| Tool completed | 结果折叠展示 | 已承载；默认只显示摘要，“详情”展开原始结果 | P0 |
| Tool error | `ToolErrorCard` | 已承载；补复制错误详情，错误原因更清晰 | P0 |
| `todowrite` tool part | timeline 隐藏 | 保持隐藏，只在 TodoDock 承载 | P0 |
| pending/running `question` tool part | timeline 隐藏 | 保持隐藏，只在 QuestionDock 承载 | P0 |
| dismissed question | 弱系统提示 | 已有部分承载；文案“问题已跳过” | P1 |
| `bash` tool | 默认展开由 shell setting 控制 | 高级用户可设置“Shell 结果默认展开”；默认折叠 | P1 |
| `edit/write/apply_patch` tool | 默认展开由 edit setting 控制 | 默认折叠，改动摘要进 DiffDock/审查面板 | P1 |
| `task` tool | 子任务工具卡，可关联子 session | 显示“Subtask / 子任务”，有子会话时提供“打开子任务会话”按钮 | P2 |
| `skill` tool | Skill 加载工具卡 | 显示“已加载 Skill：xxx”，失败时给明确修复建议 | P1 |
| `websearch/webfetch` tool | 工具卡，websearch 可显示 provider | 用 OpenCode 工具卡承载搜索；旧 Jina 搜索注入删除 | P1 |
| file/attachment part | 文件标签/附件卡 | 消息中显示附件 chip，不混入正文 | P0 |
| patch/diff/snapshot part | 变更摘要/详情 | Timeline 显示摘要，详情进入 DiffReviewDock | P1 |
| compaction/interrupted divider | 分隔线/系统行 | “上下文已压缩”或“本轮已停止”，不当作正文 | P0 |
| DiffSummary row | 文件变更摘要 | 已有 DiffReviewDock；补每轮 diff 摘要和文件计数 | P1 |
| Share UI | timeline/title menu share popover | 保留分享 notice，补取消分享和复制/打开状态 | P1 |

### 3.4 Session 命令

| OpenCode 官方命令 | 官方入口 | 韭菜盒子专业汉化映射建议 | 当前注意点 | 优先级 |
|---|---|---|---|---|
| `session.new` / `/new` | 命令面板、slash | 顶部按钮“新建会话” | 当前“新建对话”要明确创建新的 OpenCode session | P0 |
| `session.undo` / `/undo` | 命令面板、slash | 按钮“撤销上轮” | 当前缺失 | P1 |
| `session.redo` / `/redo` | 命令面板、slash | 按钮“重做上轮” | 当前缺失 | P1 |
| `session.compact` / `/compact` | 命令面板、slash | 替代旧“清除上下文”，按钮叫“压缩上下文” | 不能再用旧本地 boundary 当产品概念 | P0 |
| `session.fork` / `/fork` | 命令面板、DialogFork | 菜单项“Fork 会话分支” | 已部分承载 | P1 |
| `session.share` / `/share` | 命令面板、分享 popover | 菜单项“分享会话/复制链接” | 已有 share，缺状态细节 | P1 |
| `session.unshare` / `/unshare` | 命令面板、分享 popover | 菜单项“取消分享” | 当前缺失 | P1 |
| `session.archive` | 会话菜单 | 菜单项“归档” | 已部分承载 | P2 |
| `session.delete` | 会话菜单 | 菜单项“删除”，必须确认 | 已部分承载 | P1 |
| `session.abort` | 停止按钮 | 保留停止按钮 | 已承载 | P0 |
| `message.previous/next` | 快捷键/命令面板 | 可用滚动导航承载，默认不作为主入口 | 低优先级 | P3 |

### 3.5 模型、Agent、MCP、权限

| OpenCode 官方 UI | 官方行为 | 韭菜盒子专业汉化映射建议 | 当前注意点 | 优先级 |
|---|---|---|---|---|
| `model.choose` / `/model` | 打开模型选择 Dialog，不是发给 server | 顶部“模型”选择器；slash `/model` 也只打开选择器 | 当前错误地把 `/model` 发给 `session.command()`，会无效 | P0 |
| `model.variant.cycle` | 切换模型 variant | 放到模型菜单“切换 Variant / 变体” | 当前缺失 | P2 |
| `agent.cycle` / `/agent` | 切换 Agent | 顶部“Agent：自动/xxx”选择器；slash `/agent` 打开 Agent 菜单 | 当前“自动”文案不清楚 | P0 |
| `agent.cycle.reverse` | 反向切换 Agent | 不单独暴露，用同一个 Agent 菜单承载 | 当前缺失 | P3 |
| `mcp.toggle` / `/mcp` | 打开 MCP dialog | 设置/插件页入口：“MCP 外部工具” | 当前缺失，不应假装是聊天命令 | P2 |
| `permissions.autoaccept` | 自动批准开关 | 明确开关：“自动批准权限：开/关” | 当前缺失 | P1 |

### 3.6 文件、视图、终端

| OpenCode 官方 UI | 官方行为 | 韭菜盒子专业汉化映射建议 | 优先级 |
|---|---|---|---|
| `file.open` / `/open` | 打开文件选择 Dialog | 按钮“打开项目文件” | P2 |
| `tab.close` | 关闭当前文件 tab | 只有当代码/文件面板打开时显示 | P3 |
| `context.addSelection` | 添加当前选区为上下文 | 按钮“添加选区上下文” | P2 |
| `terminal.toggle` / `/terminal` | 打开/关闭 terminal panel | 不常驻在聊天输入框；放高级工具区 | P2 |
| `terminal.new` | 新建 terminal | 高级工具区 | P2 |
| `review.toggle` | 打开 review panel | 使用“Review / Diff 审查”或 DiffReviewDock | P1 |
| `fileTree.toggle` | 显示/隐藏文件树 | 已有布局能力，可不作为聊天命令 | P3 |
| `input.focus` | 聚焦输入框 | 快捷键即可，不需要按钮 | P3 |

### 3.7 Skill 选择器：完全按 OpenCode 官方 Skill 机制适配

裁决：Skill 是 OpenCode 官方 `SKILL.md` 能力，不是韭菜盒子自定义 Agent，也不是旧关键词触发系统。韭菜盒子只做专业汉化的显式选择器，不发明新的 Skill 执行链。

| 韭菜盒子 UI | OpenCode 官方映射 | 执行规则 | 优先级 |
|---|---|---|---|
| `Skill：自动` | 不添加 Skill 权限限制 | OpenCode 在系统提示和 `skill` 工具描述中看到所有可用 Skill；模型按 `description` 自行判断是否调用 `skill({ name })` | P0 |
| `Skill：固定某个 Skill` | session permission: `deny skill *` 后 `allow skill selected-name` | OpenCode 只看到/只能加载被选中的 Skill；本轮开始时可加轻量 system nudge 要求先加载该 Skill | P0 |
| Skill 列表 | OpenCode `skill.list` / 官方扫描结果 | 数据源以 OpenCode 为准；`agentStore` 只做本地展示、迁移和兼容，不再是执行真相 | P0 |
| Skill 名称 | 官方 `name` | 必须符合官方规则：小写字母数字和单短横线，且与目录名一致；中文名只能作为韭菜盒子显示名 | P0 |
| Skill 描述 | 官方 `description` | 这是自动选择的核心依据；旧 `triggers` 只能做 UI 搜索辅助，不能参与官方执行 | P1 |
| Skill 卡片/详情 | 官方 `location` + `content` | 显示来源、说明和只读内容；内置 Skill 不允许在 UI 中直接改写原件 | P1 |
| `skill` 工具卡 | 官方 tool part | 消息流显示“已加载 Skill：xxx”，失败时提示名称、权限或扫描路径问题 | P1 |

禁止项：

1. 不把 `SKILL.md` 手动拼进普通 system prompt 来绕过官方 `skill` tool。
2. 不用 `/skill xxx` 作为执行入口，除非它来自官方 command registry 且语义明确。
3. 不用旧 `triggers` / 中文名称 / `agentConfig` 自行决定执行哪个 Skill。
4. 不把知识库包装成 Skill，除非用户明确创建的是“带资料引用的可复用工作流 Skill”。

### 3.8 知识库选择器：适配为 OpenCode 文件/资料上下文

裁决：OpenCode 官方没有“知识库/RAG”产品概念。韭菜盒子 Vault 应作为用户显式选择的资料来源，转换成 OpenCode 能理解的 `file` request parts 或可读取的只读资料目录。

| 韭菜盒子 UI | OpenCode 官方映射 | 执行规则 | 优先级 |
|---|---|---|---|
| `知识库：不使用` | 不添加 file/context part，不开放资料目录 | OpenCode 只根据用户输入和当前项目上下文工作 | P0 |
| `知识库：选择某个 Vault` | 生成当前任务 Vault 上下文文件集 | UI 继续保留选择器，但底层不再做旧 RAG prompt 注入 | P0 |
| 小资料量 Vault | `file` request parts | 将 `CLAUDE.md`、wiki index、精选 wiki 页面或用户勾选文件作为结构化文件传入本轮 | P0 |
| 大资料量 Vault | OpenCode 可读目录 + `read` / `grep` / `glob` | 将 Vault 导出/挂载到 OpenCode 工作目录下的 `.jiucaihezi/context/<vault-id>/`，让模型按需读取 | P0 |
| 外部 Vault 路径 | `external_directory` 只读授权 | 仅允许 `read` / `grep` / `glob`，明确 deny `edit` / `write` / `apply_patch` | P1 |
| Vault context chip | file/context part 展示 | 输入框上方显示“Vault 上下文：xxx”，消息里显示附件/上下文 chip，不混入正文 | P1 |
| 召回来源 | OpenCode tool/file parts | 来源展示来自实际传入文件或官方读取工具结果，不再展示旧 RAG 召回为唯一真相 | P1 |

禁止项：

1. 不把 Vault 继续作为隐藏 prompt 大段注入。
2. 不让 AI 自动写入 Vault；知识库仍只接受用户手动添加、整理、确认。
3. 不把 Vault 默认变成 Skill。Skill 是工作流和行为规则，Vault 是资料和证据。
4. 不开放 Vault 写权限给 OpenCode 文件工具，除非未来有单独的“知识库编辑”确认流程。

## 4. 建议的韭菜盒子目标 UI

### 4.1 顶部显式选择区

| 控件 | 作用 | 数据来源 |
|---|---|---|
| 模型 | 选择 OpenCode 当前 model | OpenCode `model.list` + 韭菜盒子 NewAPI projection |
| Agent | 选择 OpenCode Agent，默认“自动” | OpenCode `agent.list` |
| Skill | 固定或自动使用官方 Skill | OpenCode `skill.list` + `skill` tool + session permission |
| 知识库 | 选择资料资源 | 韭菜盒子 Vault → OpenCode file parts / 只读资料目录 |

### 4.2 输入区

| 控件 | 保留/新增 | 说明 |
|---|---|---|
| 附件 | 保留 | 文件/图片都转 OpenCode structured parts |
| 命令 | 保留但重做 | 打开命令面板，按官方 command registry 分组 |
| Shell | 从常驻按钮移走 | 放入“高级命令 / Terminal”，降低高风险入口的误操作概率 |
| 发送/停止 | 保留 | 停止走 OpenCode abort |

### 4.3 会话菜单

| 分组 | 菜单项 |
|---|---|
| 常用 | 新建会话、压缩上下文、撤销上轮、重做上轮 |
| 变更 | Review / Diff 审查、Fork 分支 |
| 分享 | 分享会话、取消分享 |
| 管理 | 归档、删除 |

### 4.4 Dock 区

Dock 全部放在输入框上方，顺序建议：

1. PermissionDock
2. QuestionDock
3. TodoDock
4. RevertDock
5. FollowupDock
6. DiffReviewDock / ShareNotice

### 4.5 帮助 / 教程中心

左下角帮助入口应扩大为“帮助 / 教程中心”。它不是替代专业命名，而是给专业 UI 提供学习层。

| 教程模块 | 内容 | 目的 |
|---|---|---|
| 专业术语表 | Agent、Skill、MCP、Terminal、Diff、Review、Context、Permission、Session、Variant、Vault 等 | 保留专业术语，同时给出中文解释和使用边界 |
| UI 按钮说明 | 每个按钮的位置、官方映射、点击后发生什么、是否会修改文件或调用外部工具 | 降低误操作，提高用户可预期性 |
| 常见任务教程 | 新建会话、选择模型、固定 Skill、添加 Vault 上下文、上传文件、允许权限、查看 Diff、Fork 会话、压缩上下文 | 把操作流做成可学习的步骤 |
| 使用场景索引 | “我想改代码”“我想读项目”“我想让它参考知识库”“我想联网查资料”“我想审查改动” | 从用户意图反查该用哪个专业功能 |
| 权限与安全 | PermissionDock 的 allow once / always / reject，Shell、edit/write、external_directory 的风险说明 | 让用户知道哪些操作有风险，以及为什么要确认 |
| OpenCode 对齐说明 | 哪些 UI 是 OpenCode 官方能力，哪些是韭菜盒子专业汉化承载 | 防止把官方能力和自定义产品概念混淆 |

教程原则：

1. 主界面按钮保持专业汉化，不为了解释而改成冗长口语名。
2. 每个教程条目必须回答四件事：这是什么、什么时候用、点击后会发生什么、风险或注意事项是什么。
3. 教程可以偏新手，但术语必须准确，不创造与 OpenCode 不一致的新概念。
4. 高风险能力如 Terminal、edit/write、external_directory、permission autoaccept 必须有明确风险说明。

## 5. 当前韭菜盒子 UI 可删除或合并项

| 当前 UI | 处理建议 | 原因 |
|---|---|---|
| 输入框硬编码 `/model` | 删除硬编码，改为打开模型选择器 | 官方 `/model` 是 UI command，不是 server slash |
| 输入框硬编码 `/agent` | 删除硬编码，改为打开 Agent 选择器 | 官方 `/agent` 是本地 agent cycle/selection |
| 输入框硬编码 `/share`、`/fork`、`/summarize` | 合并到会话菜单；slash 面板只做命令搜索入口 | 与右上会话菜单重复 |
| 常驻 Shell 按钮 | 从输入框常驻区移入“高级命令 / Terminal” | Shell 是高风险操作，不适合常驻主输入区 |
| “自动”按钮文案 | 改成“Agent：自动” | 当前语义不明，像自动执行开关 |
| “清除上下文”按钮 | 删除或改为“压缩上下文” | 旧本地 boundary 概念，不是 OpenCode 原生 UI |
| 旧联网搜索开关 | 删除旧 Jina 注入式搜索；改为 OpenCode websearch/webfetch 能力开关 | 搜索应走 OpenCode tool loop 和权限/工具卡 |
| 旧模型选择器只读 `agentStore` | 迁到 OpenCode model list + NewAPI projection | 避免模型 UI 和 OpenCode runtime 不一致 |
| 旧工具开关/ToolPickerBar | 不回到聊天输入区 | OpenCode 被动工具由官方 runtime/permission 管理 |
| 本地 context boundary system message | 不作为用户可见产品概念 | 可保留内部兼容，但 UI 不再暴露 |
| 旧 Skill 关键词触发执行链 | 删除执行语义，只保留 UI 搜索辅助 | 官方 Skill 由 `description` + `skill` tool 选择和加载 |
| 旧知识库 RAG prompt 注入 | 删除或降级为兼容兜底 | 知识库应转为 OpenCode file/context parts 或只读文件目录 |
| 将 Vault 伪装成 Skill | 禁止 | Skill 是工作流；Vault 是资料，不应混淆 |

## 6. 推荐实施顺序

### P0：先消除误导和无效按钮

1. `/model`、`/agent` 不再调用 `session.command()`，改为打开本地选择器。
2. “自动”改成“Agent：自动”。
3. “清除上下文”改为“压缩上下文”，走 OpenCode compact/summarize。
4. 会话菜单补齐：新建会话、压缩上下文、撤销上轮、重做上轮、分享、取消分享、删除。
5. 搜索按钮停止旧 Jina 注入，先隐藏或改成 OpenCode web tool 开关。
6. Skill 选择器改为 OpenCode 官方 `skill.list` 数据源；选中时用官方 permission 固定 Skill。
7. 知识库选择器停止旧 RAG prompt 注入，先把选中 Vault 转成 OpenCode file parts / 只读 Vault 上下文文件集。

### P1：补齐官方 Dock 和核心命令

1. RevertDock。
2. FollowupDock。
3. permissions autoaccept 开关。
4. DiffReviewDock 与每轮 diff summary 对齐。
5. model.list / agent.list 驱动选择器。
6. Skill 工具卡和 Vault context chip 做官方 part 化展示。
7. 左下角帮助入口升级为“帮助 / 教程中心”，先补术语表和核心按钮说明。

### P2：高级能力收口

1. MCP dialog。
2. Terminal panel / Shell command。
3. file open / add selection context。
4. task 子会话跳转。
5. websearch/webfetch 专用摘要卡。

## 7. 待确认问题

1. Shell 是否默认隐藏到“高级命令 / Terminal”，还是保留在输入框但加危险提示？
2. 模型选择器是否继续展示韭菜盒子自有“能力档位”（快/均衡/深度），还是完全并入 OpenCode model/variant？
3. 是否允许一键开启 permission autoaccept？这能减少确认步骤，但也有安全风险。
