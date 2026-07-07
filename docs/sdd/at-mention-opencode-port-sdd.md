# @mention & /command Autocomplete — 照抄 OpenCode 官方实现

> **基线**: OpenCode 源码 `/Users/by3/Documents/jiucaihezi-opencode/`
> **原则**: 不自创，照抄 OpenCode 架构/行为/UI，只做 Vue 3 + Tauri 适配

## 一、目标

把当前 ChatPanel 的 textarea + 简易 @popover 替换为 OpenCode 的 contenteditable + PromptPopover 体系，支持：

- `@` → 文件、Skill、Agent、MCP resource、git reference
- `/` → 内置指令（文/武切换、新建会话、清空历史等）
- Pill chip 可视化（不可编辑的 `<span data-type="file|agent">`）
- 模糊搜索（fuzzysort）+ 键盘导航（ArrowUp/Down/Enter/Tab）

## 二、OpenCode 源码对照表

| OpenCode 文件 | 行 | 功能 | → 我们的对应 |
|---------------|-----|------|------------|
| `prompt-input.tsx` | L690-770 | @ 数据源组装 + useFilteredList | `useChat.ts` + new `useAtMention.ts` |
| `prompt-input.tsx` | L832-848 | createPill() DOM | `AtPill.vue` 组件 |
| `prompt-input.tsx` | L1043-1088 | handleInput() 触发检测 | `ChatPanel.vue` onInput |
| `prompt-input.tsx` | L1100-1149 | addPart() DOM 插入 | composable `usePromptInput.ts` |
| `prompt-input.tsx` | L1298-1340 | handleKeyDown() 协调 | `ChatPanel.vue` onKeydown |
| `slash-popover.tsx` | L1-300 | PromptPopover UI | `MentionPopover.vue` (重写) |
| `use-filtered-list.tsx` | L20-110 | 模糊搜索 + 导航 hook | `useFilteredList.ts` (Vue composable) |
| `transient-state.ts` | L1-55 | popover 状态 | 现有 `showMentionPopup` + 扩为 `/` |
| `build-request-parts.ts` | 全场 | prompt parts → SDK | `useChat.ts` send 前解析 |

## 三、数据流（照抄 OpenCode）

```
用户输入 "@" 或 "/"
  → onInput → handleInput()
    → textBeforeCursor.match(/@(\S*)$/) 或 /^\/(\S*)$/
    → atOnInput(query) → useFilteredList.onInput()
      → setStore("filter", query)
      → items(query) 异步获取:
        → skills() + agents() + mcpResources() + recentFiles()
        → 有查询词 → files.searchFilesAndDirectories()
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

## 四、改造清单

### Phase 1: 基础设施（2-3 文件）

| # | 新建/改 | 文件 | 内容 |
|---|---------|------|------|
| 1 | 新建 | `src/composables/useFilteredList.ts` | 照抄 `use-filtered-list.tsx` → Vue 3 composable |
| 2 | 新建 | `src/composables/usePromptInput.ts` | contenteditable DOM 操作：parseFromDOM, getCursorPosition, createPill, addPart |
| 3 | 重写 | `src/components/chat/MentionPopover.vue` | 照抄 `slash-popover.tsx`：4 种条目类型 + 分组 + 键盘导航 |
| 4 | 安装 | package.json | `fuzzysort` (npm) |

### Phase 2: ChatPanel 改造（核心）

| # | 改 | 内容 |
|---|-----|------|
| 5 | `ChatPanel.vue` 输入框 | textarea → contenteditable div |
| 6 | `ChatPanel.vue` onInput | 替换为 OpenCode 的 handleInput 逻辑 |
| 7 | `ChatPanel.vue` onKeydown | 添加 popover 键盘协调 |
| 8 | `ChatPanel.vue` 数据源 | skills + agents + project files + recent |
| 9 | `ChatPanel.vue` pill 渲染 | data-type CSS 样式 |

### Phase 3: 斜杠指令

| # | 改 | 内容 |
|---|-----|------|
| 10 | `ChatPanel.vue` | `/` 触发内置指令列表（文/武切换、清空、新会话、导出等） |
| 11 | `src/data/` | 内置指令定义文件 |

### Phase 4: 发送适配

| # | 改 | 内容 |
|---|-----|------|
| 12 | `useChat.ts` send | 解析 contenteditable → 提取 pill 中的 file/agent → 转为 SDK parts |

## 五、AtOption 类型定义

```ts
// src/types/mention.ts
export type AtOption =
  | { type: 'agent'; name: string; display: string }
  | { type: 'resource'; name: string; uri: string; client: string; display: string; description?: string; mime?: string }
  | { type: 'reference'; name: string; path: string; display: string; description: string }
  | { type: 'file'; path: string; display: string; recent?: boolean }
  | { type: 'skill'; id: string; name: string; display: string }  // 我们的扩展
```

## 六、关键细节（照抄 OpenCode）

1. **光标前匹配**：`textBeforeCursor.match(/@(\S*)$/)` — 只在光标前查找，不是全文匹配
2. **最多 10 条**：`atFlat.slice(0, 10)` — 性能保护
3. **分组排序**：reference > agent > resource > recent > file
4. **Pill 不可编辑**：`contenteditable="false"` + `data-type="file|agent"`
5. **Tab 选择**：Tab 键选择当前高亮项，不等 Enter
6. **shellMode 屏蔽**：编辑区（shell 模式）不触发 @
7. **session 切换重置**：popover 状态在切换会话时自动清空

## 七、风险

| 风险 | 缓解 |
|------|------|
| contenteditable 跨平台兼容 | Tauri WebView 支持 contenteditable，macOS/Windows 均测试 |
| fuzzysort 中文搜索 | fuzzysort 已支持 Unicode，需验证中文分词效果 |
| 大项目文件搜索性能 | 首屏只显示 recent/reference，有查询词才 searchFiles |
| 与现有 textarea resize 冲突 | 移除 textarea resize 逻辑，contenteditable 自适应高度 |

## 八、实施顺序

1. Phase 1 (基础设施) → 独立可测试
2. Phase 2 (ChatPanel) → 核心改造
3. Phase 3 (斜杠) → 可并行
4. Phase 4 (发送) → 收尾
