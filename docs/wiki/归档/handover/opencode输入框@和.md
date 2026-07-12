/Users/by3/Documents/jiucaihezi-opencode

所以完整的分组优先级其实是两套独立系统：

**`@` 菜单（5 组）：**
| 优先级 | 分组 | 含义 |
|--------|------|------|
| 0 | `reference` | Git Reference |
| 1 | `agent` | Agent |
| 2 | `resource` | MCP Resource |
| 3 | `recent` | 当前打开的文件 |
| 4 | `file` | 搜索匹配的文件 |

**`/` 菜单（扁平，无分组）：**
| 来源 | badge |
|------|-------|
| 自定义命令 (skill) | `Skill` |
| 自定义命令 (mcp) | `MCP` |
| 自定义命令 (command) | `Custom` |
| 内置命令 | 无 badge |


好的，我把所有相关文件完整读出来发你。

---

### 文件清单（按复刻顺序）

| # | 文件 | 行数 | 内容 |
|---|------|------|------|
| 1 | transient-state.ts | 55 行 | `popover: "at" \| "slash" \| null` 状态 |
| 2 | slash-popover.tsx | 350 行 | **`PromptPopover` UI 组件** — @ 和 / 共用一个弹出层 |
| 3 | use-filtered-list.tsx | 130 行 | **`useFilteredList` hook** — 模糊搜索 + 分组 + 键盘导航 |
| 4 | editor-dom.ts | 140 行 | DOM 工具函数：`getCursorPosition`、`setCursorPosition`、`setRangeEdge`、`createTextFragment` |
| 5 | build-request-parts.ts | ~280 行 | prompt parts → SDK 请求格式转换 |
| 6 | prompt-input.tsx | ~1860 行 | **主输入组件**，关键函数分散在各处 |
| 7 | prompt.tsx | ~120 行 | `ContentPart` / `FileAttachmentPart` / `AgentPart` 类型定义 |

### 核心函数位置（都在 prompt-input.tsx）

| 函数 | 行号 | 用途 |
|------|------|------|
| `handleInput` | L1043 | `@` 和 `/` 触发检测（正则匹配光标前文本） |
| `referenceList` | L651 | Git Reference 数据源 |
| `agentList` | L660 | Agent 数据源 |
| `mcpResourceList` | L671 | MCP Resource 数据源 |
| `recent` (tabs) | L322 | 当前打开的文件 tab |
| `useFilteredList<AtOption>` | L739 | @ 菜单的过滤/分组/导航配置 |
| `handleAtSelect` | L727 | @ 选中后 → `addPart()` |
| `slashCommands` | L777 | / 命令数据源（builtin + custom/skill） |
| `useFilteredList<SlashCommand>` | L825 | / 菜单的过滤/导航配置 |
| `handleSlashSelect` | L808 | / 选中后的处理 |
| `createPill` | L832 | 生成不可编辑 `<span>` DOM 元素 |
| `addPart` | L1100 | 删除 @xxx 文本 + 插入 pill 到 contenteditable |
| `selectPopoverActive` | L893 | Tab/Enter 确认选择 |
| `handleKeyDown` | L1298 | 键盘协调（弹窗导航 + Escape + 模式切换） |
| `renderEditor` | L857 | 根据 prompt parts 重新渲染编辑区 |
| `closePopover` | L632 | 关闭弹窗 |

### 复刻要点

1. **`useFilteredList`** 是整个系统的核心引擎——它用 `fuzzysort` 做模糊搜索、`solid-list` 处理键盘导航、`createResource` 做异步数据加载。你的框架里需要等价实现。

2. **`PromptPopover`** 是一个纯展示组件，接收所有数据通过 props 注入。`@` 模式下分组渲染（`agent` 用 brain 图标、`resource` 用 puzzle 图标 + client 标签、`reference` 用 branch 图标、`file` 用 FileIcon + 目录/文件名），`/` 模式扁平列表 + badge 显示来源。

3. **`addPart` + `createPill`** 是 DOM 操作核心——直接操作 contenteditable 的 `Range` API 删除 `@xxx` 文本、插入不可编辑的 `<span>` pill，不依赖框架的虚拟 DOM。

4. **键盘协调**在 `handleKeyDown`（L1380–L1440）：弹窗打开时 intercept `Tab/Enter/ArrowUp/ArrowDown` 导航，`Escape` 关闭，`Shift+Enter` 换行，`Ctrl+G` 中断。

