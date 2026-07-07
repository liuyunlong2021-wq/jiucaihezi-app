# @mention & /command Autocomplete — 照抄 OpenCode 官方实现

> **基线**: OpenCode 源码 `/Users/by3/Documents/jiucaihezi-opencode/`
> **铁律**: 100% 照抄，不自创。OpenCode 有的类型/行为/UI 全部抄，不做"我们的扩展"。

## 一、目标

把当前 ChatPanel 的 textarea + 简易 @popover 替换为 OpenCode 的 contenteditable + PromptPopover 体系：

- `@` → agent / file / resource* / reference* （* 待基础设施就绪）
- `/` → builtin 指令 + custom 指令（skill 在这里！source: "skill"）
- Pill chip：`<span data-type contenteditable="false">`，不是独立 Vue 组件
- fuzzysort 模糊搜索 + ArrowUp/Down/Enter/Tab 键盘导航

> **关键纠正**：Skills 在 `/` 菜单，不在 `@` 菜单。OpenCode 的 `agentList` 是内置 agent（plan/build），不是用户的 skill。

## 二、OpenCode 源码对照

| OpenCode 文件 | 行 | 功能 | → 我们的对应 |
|---------------|-----|------|------------|
| `prompt-input.tsx` | L651-663 | referenceList() | ChatPanel @ 数据源 |
| `prompt-input.tsx` | L671-682 | mcpResourceList() | ChatPanel @ 数据源 |
| `prompt-input.tsx` | L777-805 | slashCommands（builtin + custom/skill） | ChatPanel 斜杠数据源 |
| `prompt-input.tsx` | L832-848 | createPill() | `useContentEditable.ts` 里的函数 |
| `prompt-input.tsx` | L1043-1088 | handleInput() | ChatPanel onInput |
| `prompt-input.tsx` | L1100-1149 | addPart() | `useContentEditable.ts` |
| `prompt-input.tsx` | L1298-1340 | handleKeyDown() | ChatPanel onKeydown |
| `slash-popover.tsx` | L1-300 | PromptPopover | `MentionPopover.vue` 重写 |
| `use-filtered-list.tsx` | L20-110 | 模糊搜索+导航 | `useFilteredList.ts` composable |

## 三、类型定义（100% 照抄 OpenCode）

```ts
// @ 菜单条目 — prompt-input.tsx L13-21
export type AtOption =
  | { type: 'agent'; name: string; display: string }
  | { type: 'resource'; name: string; uri: string; client: string; display: string; description?: string; mime?: string }
  | { type: 'reference'; name: string; path: string; display: string; description: string }
  | { type: 'file'; path: string; display: string; recent?: boolean }

// / 菜单条目 — slash-popover.tsx L24-30
export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  type: 'builtin' | 'custom'
  source?: 'command' | 'mcp' | 'skill'  // ← skill 在这里！
}
```

> **关键**：Skills 在 `/` 菜单（SlashCommand.source = "skill"），不在 `@` 菜单。
> OpenCode 的 `agentList` 是内置 agent（plan/build），不是用户的 skill。

## 四、两套独立弹出系统

### 4.1 `@` 菜单（5 组，分组排序）

| 优先级 | 分组 | 来源 | 图标 |
|--------|------|------|------|
| 0 | reference | `.opencode.json` references | folder |
| 1 | agent | 内置 agent（plan/build） | brain |
| 2 | resource | MCP server resources | puzzle |
| 3 | recent | 当前打开的文件 tabs | file icon |
| 4 | file | 搜索匹配的项目文件 | file icon |

- `agent` 不是 skill！OpenCode 的 agent 是内置的 plan/build 等，我们的实现返回空数组
- resource/reference 待基础设施，类型已定义
- 有查询词时才搜索文件，无查询词只显示 recent

### 4.2 `/` 菜单（扁平列表，无分组）

| 来源 | badge | 说明 |
|------|-------|------|
| custom + source: "skill" | `Skill` | 用户的 skill，从 agentStore 获取 |
| custom + source: "mcp" | `MCP` | MCP 工具命令 |
| custom + source: "command" | `Custom` | 其他自定义命令 |
| builtin | （无 badge） | 内置指令：清空上下文、新建会话 |

- **Skills 在这里！** 每个 skill 作为一条 `/skillname` 命令，badge 显示 `Skill`
- `/` 使用 `useFilteredList` 但无 `groupBy`，扁平列表
- `/` 的正则匹配：`rawText.match(/^\/(\S*)$/)`（行首）

## 五、改造清单（8 项）

| # | 新建/改 | 文件 | 内容 |
|---|---------|------|------|
| 1 | 新建 | `src/composables/useFilteredList.ts` | 照抄 `use-filtered-list.tsx`：fuzzysort + groupBy + solid-list → Vue |
| 2 | 新建 | `src/composables/useContentEditable.ts` | 合并 createPill + addPart + getCursorPosition（不是组件，是函数） |
| 3 | 重写 | `src/components/chat/MentionPopover.vue` | 照抄 `slash-popover.tsx`：4 种条目 + 分组 + 图标 + 键盘导航 |
| 4 | 安装 | `fuzzysort` | npm install |
| 5 | 改 | `ChatPanel.vue` 输入框 | textarea → contenteditable div |
| 6 | 改 | `ChatPanel.vue` 逻辑 | handleInput + handleKeyDown + @ 数据源（agent/file/reference/resource）+ / 数据源（builtin + custom/skill） |
| 7 | 改 | `ChatPanel.vue` 斜杠 | `/` 扁平列表：builtin 指令 + skill 命令（source: "skill" + badge） |
| 8 | 改 | `useChat.ts` send | contenteditable → 提取 pills → SDK parts |

**不再有的**（审计砍掉）：
- ~~`AtPill.vue` 独立组件~~ → 合并到 `useContentEditable.ts` 里的 `createPill()` 函数
- ~~`{ type: 'skill' }`~~ → Skills 在 `/` 菜单（SlashCommand.source = "skill"），不在 `@` 菜单
- ~~独立 Phase 4~~ → send 解析合并到 #8，SDK 已处理 parts，只需提取

## 六、数据流（100% 照抄 OpenCode）

```
用户输入 "@" 或 "/"
  → onInput → handleInput()
    → textBeforeCursor.match(/@(\S*)$/) 或 /^\/(\S*)$/
    → atOnInput(query) → useFilteredList.onInput()
      → setStore("filter", query)
      → items(query) 异步获取:
        → referenceList() → sync().data.reference（@ 第 0 组）
        → agentList() → agents.filter(mode !== "primary")（@ 第 1 组）
        → mcpResourceList() → sync().data.mcp_resource（@ 第 2 组）
        → recent() → 当前打开的 tabs（@ 第 3 组）
        → 有查询词 → files.searchFilesAndDirectories(query)（@ 第 4 组）
      → fuzzysort 过滤 → groupBy 分组排序
    → popover = "at" | "slash"
    → 若是 "/"：slashCommands = builtin + custom(skill/mcp/command)，扁平无分组
  → MentionPopover 渲染 atFlat.slice(0, 10) 或 slashFlat

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
