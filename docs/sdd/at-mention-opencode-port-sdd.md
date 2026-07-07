# @mention & /command Autocomplete — 照抄 OpenCode 官方实现

> **基线**: OpenCode 源码 `/Users/by3/Documents/jiucaihezi-opencode/`
> **铁律**: 100% 照抄，不自创。OpenCode 有的类型/行为/UI 全部抄，不做"我们的扩展"。

## 一、目标

把当前 ChatPanel 的 textarea + 简易 @popover 替换为 OpenCode 的 contenteditable + PromptPopover 体系：

- `@` → agent / file / resource* / reference* （* 待基础设施就绪）
- `/` → 切换 agent / 清空上下文 / 新建会话（对齐 OpenCode 3 个指令）
- Pill chip：`<span data-type contenteditable="false">`，不是独立 Vue 组件
- fuzzysort 模糊搜索 + ArrowUp/Down/Enter/Tab 键盘导航

## 二、OpenCode 源码对照

| OpenCode 文件 | 行 | 功能 | → 我们的对应 |
|---------------|-----|------|------------|
| `prompt-input.tsx` | L651-663 | referenceList() | ChatPanel @ 数据源 |
| `prompt-input.tsx` | L671-682 | mcpResourceList() | ChatPanel @ 数据源 |
| `prompt-input.tsx` | L690-770 | agentList + useFilteredList | ChatPanel @ 数据源 |
| `prompt-input.tsx` | L832-848 | createPill() | `useContentEditable.ts` 里的函数 |
| `prompt-input.tsx` | L1043-1088 | handleInput() | ChatPanel onInput |
| `prompt-input.tsx` | L1100-1149 | addPart() | `useContentEditable.ts` |
| `prompt-input.tsx` | L1298-1340 | handleKeyDown() | ChatPanel onKeydown |
| `slash-popover.tsx` | L1-300 | PromptPopover | `MentionPopover.vue` 重写 |
| `use-filtered-list.tsx` | L20-110 | 模糊搜索+导航 | `useFilteredList.ts` composable |

## 三、AtOption 类型（100% 照抄 OpenCode）

```ts
// src/types/mention.ts — 与 OpenCode prompt-input.tsx L13-21 一致
export type AtOption =
  | { type: 'agent'; name: string; display: string }
  | { type: 'resource'; name: string; uri: string; client: string; display: string; description?: string; mime?: string }
  | { type: 'reference'; name: string; path: string; display: string; description: string }
  | { type: 'file'; path: string; display: string; recent?: boolean }
```

**注意**：OpenCode 的 `agent` 就是我们的 Skill。不用另加 `skill` 类型——skills 映射到 `agent`。

## 四、4 种 @ 条目详解

### 4.1 agent（Skill）

- 来源：`agentStore.getMySkills()` → 过滤非 primary agent
- 图标：`brain`
- Pill：`<span data-type="agent" data-name="xxx" contenteditable="false">@skill-name</span>`
- 样式：`color: var(--syntax-type)`（紫色）

### 4.2 file

- 无查询词：显示最近打开的文件 tabs
- 有查询词：调 `files.searchFilesAndDirectories(query)` 实时搜索
- 图标：`FileIcon`（按扩展名）
- Pill：`<span data-type="file" data-path="/abs/path" contenteditable="false">@filename</span>`
- 样式：`color: var(--syntax-property)`（蓝色）

### 4.3 resource（MCP Resource）— 待基础设施

- 来源：`sync().data.mcp_resource` → 通过 `sdk.experimental.resource.list()` 从已连接的 MCP 服务器获取
- 图标：`puzzle` + `<Tag>` 显示 client 名
- 选中后：`source.type = "resource"`，发送时 SDK 实时 `readResource(uri)` 注入内容
- 分组优先级：第 2 组
- **依赖**：需要至少一个已连接的 MCP 服务器声明 `resources` 能力
- **实施**：类型已在 popover 中定义，数据源待 OpenCode SDK 就绪后对接 `loadMcpResourcesQuery`

### 4.4 reference（Git Reference）— 待基础设施

- 来源：`.opencode.json` 中 `references: {}` 配置 → SDK `v2.reference.list()` 获取
- 类型：`local`（本地路径）或 `git`（自动 clone 到缓存）
- 图标：`branch`
- 选中后：`mime = "application/x-directory"`，作为目录注入
- 分组优先级：第 0 组（最高）
- **依赖**：需要项目中有 `.opencode.json` 配置文件
- **实施**：类型已在 popover 中定义，数据源待 OpenCode SDK 就绪后对接 `loadReferencesQuery`

## 五、改造清单（8 项）

| # | 新建/改 | 文件 | 内容 |
|---|---------|------|------|
| 1 | 新建 | `src/composables/useFilteredList.ts` | 照抄 `use-filtered-list.tsx`：fuzzysort + groupBy + solid-list → Vue |
| 2 | 新建 | `src/composables/useContentEditable.ts` | 合并 createPill + addPart + getCursorPosition（不是组件，是函数） |
| 3 | 重写 | `src/components/chat/MentionPopover.vue` | 照抄 `slash-popover.tsx`：4 种条目 + 分组 + 图标 + 键盘导航 |
| 4 | 安装 | `fuzzysort` | npm install |
| 5 | 改 | `ChatPanel.vue` 输入框 | textarea → contenteditable div |
| 6 | 改 | `ChatPanel.vue` 逻辑 | handleInput + handleKeyDown + @ 数据源（agent/file/reference/resource） |
| 7 | 改 | `ChatPanel.vue` 斜杠 | `/` 3 个指令：切换 agent / 清空上下文 / 新建会话 |
| 8 | 改 | `useChat.ts` send | contenteditable → 提取 pills → SDK parts |

**不再有的**（审计砍掉）：
- ~~`AtPill.vue` 独立组件~~ → 合并到 `useContentEditable.ts` 里的 `createPill()` 函数
- ~~`{ type: 'skill' }`~~ → 用 `agent`，100% 对齐 OpenCode
- ~~独立 Phase 4~~ → send 解析合并到 #8，SDK 已处理 parts，只需提取

## 六、数据流（100% 照抄 OpenCode）

```
用户输入 "@" 或 "/"
  → onInput → handleInput()
    → textBeforeCursor.match(/@(\S*)$/) 或 /^\/(\S*)$/
    → atOnInput(query) → useFilteredList.onInput()
      → setStore("filter", query)
      → items(query) 异步获取:
        → referenceList() → sync().data.reference（第 0 组）
        → agentList() → agents.filter(mode !== "primary")（第 1 组）
        → mcpResourceList() → sync().data.mcp_resource（第 2 组）
        → recent() → 当前打开的 tabs（第 3 组）
        → 有查询词 → files.searchFilesAndDirectories(query)（第 4 组）
      → fuzzysort 过滤 → groupBy 分组排序
    → popover = "at" | "slash"
  → MentionPopover 渲染 atFlat.slice(0, 10)

选择后:
  → handleAtSelect(option) 或 handleSlashSelect(command)
  → createPill(part) → <span data-type contenteditable="false">
  → range.deleteContents() 删除原始 @xxx 文本
  → range.insertNode(pill) 插入 pill
  → closePopover()
```

## 七、关键细节（OpenCode 原样）

1. **光标前匹配**：`textBeforeCursor.match(/@(\S*)$/)` — 只在光标前，不全文
2. **最多 10 条**：`atFlat.slice(0, 10)`
3. **分组排序**：reference(0) > agent(1) > resource(2) > recent(3) > file(4)
4. **Pill 不可编辑**：`contenteditable="false"` + `data-type`
5. **Tab 选择**：不等 Enter
6. **shellMode 屏蔽**：编辑区不触发 @
7. **session 切换重置**：popover 自动清空

## 八、风险

| 风险 | 缓解 |
|------|------|
| contenteditable 跨平台 | Tauri WebView 支持，macOS/Windows 测试 |
| fuzzysort 中文 | 支持 Unicode，需验证分词 |
| 大项目文件搜索 | 首屏只显示 recent/reference，有查询词才 search |
| resource/reference 数据源未就绪 | 类型已在 popover 定义，数据源为空时不显示该组，不影响其他功能 |
