# OpenCode 输入框（Prompt Input）完整设计文档

> 目标：另一份 AI 读完后，能完整复刻 OpenCode 桌面端输入框的所有功能。
> 核心组件在 `packages/app/src/components/prompt-input.tsx`（~2260 行），子模块在 `packages/app/src/components/prompt-input/` 目录下。

---

## 目录

1. [功能总览](#1-功能总览)
2. [核心架构](#2-核心架构)
3. [功能详解](#3-功能详解)
   - [3.1 Contenteditable 编辑器](#31-contenteditable-编辑器)
   - [3.2 @ 提及菜单](#32--提及菜单)
   - [3.3 / 斜杠命令菜单](#33--斜杠命令菜单)
   - [3.4 文件附件（拖放/粘贴/选择器）](#34-文件附件拖放粘贴选择器)
   - [3.5 图片附件预览](#35-图片附件预览)
   - [3.6 Agent 选择器](#36-agent-选择器)
   - [3.7 模型选择器 + 变体选择](#37-模型选择器--变体选择)
   - [3.8 上下文项（文件/评论芯片条）](#38-上下文项文件评论芯片条)
   - [3.9 输入历史 ↑↓ 导航](#39-输入历史-导航)
   - [3.10 Shell 模式](#310-shell-模式)
   - [3.11 粘贴处理](#311-粘贴处理)
   - [3.12 占位符系统](#312-占位符系统)
   - [3.13 提交按钮 & 停止按钮](#313-提交按钮--停止按钮)
   - [3.14 拖放覆盖层](#314-拖放覆盖层)
   - [3.15 光标滚动 & 滚动渐变](#315-光标滚动--滚动渐变)
   - [3.16 键盘快捷键](#316-键盘快捷键)
4. [数据流](#4-数据流)
5. [Props 接口](#5-props-接口)
6. [Prompt 数据结构](#6-prompt-数据结构)
7. [子模块文件清单](#7-子模块文件清单)
8. [布局变体](#8-布局变体)
9. [完整复刻步骤](#9-完整复刻步骤)

---

## 1. 功能总览

| # | 功能 | 触发方式 | 代码位置 |
|---|------|----------|----------|
| 1 | contenteditable 富文本编辑器 | 直接输入 | `prompt-input.tsx` + `editor-dom.ts` |
| 2 | @ 提及 Agent | 输入 `@` | `prompt-input.tsx` handleInput + `slash-popover.tsx` |
| 3 | @ 提及文件/目录 | 输入 `@` | 同上 |
| 4 | @ 提及 MCP 资源 | 输入 `@` | 同上 |
| 5 | @ 提及命名引用（Reference） | 输入 `@` | 同上 |
| 6 | / 内置命令 | 输入 `/` | `prompt-input.tsx` handleInput + `slash-popover.tsx` |
| 7 | / 自定义命令（skill/mcp） | 输入 `/` | 同上 |
| 8 | 拖放文件 | 从系统拖入文件 | `drag-overlay.tsx` + `attachments.ts` |
| 9 | 粘贴文件/图片 | ⌘V | `paste.ts` + `attachments.ts` |
| 10 | 文件选择器 | ⌘U / 点击附件按钮 | `files.ts` |
| 11 | 图片缩略图预览 | 附加图片后 | `image-attachments.tsx` |
| 12 | Agent 选择下拉 | 底部栏下拉 | `prompt-input.tsx` |
| 13 | 模型选择弹窗 | 点击模型名 | `dialog-select-model.tsx` |
| 14 | 模型变体选择 | 模型有变体时 | `prompt-input.tsx` MenuV2 |
| 15 | 上下文芯片条 | 选择了文件/评论后 | `context-items.tsx` |
| 16 | 输入历史 | ↑↓ 方向键 | `history.ts` |
| 17 | Shell 模式 | `!` 开头 / ⌘⇧X | `prompt-input.tsx` |
| 18 | 自动换行 & 最大高度滚动 | 多行文本 | `prompt-input.tsx` style |
| 19 | 粘贴文本规范化 | 粘贴时 | `paste.ts` |
| 20 | 大文本粘贴 → manual mode | 粘贴 > 8000字符 | `paste.ts` |
| 21 | 占位符循环 | 空输入框 | `placeholder.ts` |
| 22 | 提交按钮（↑ / ↩） | 点击 / Enter | `prompt-input.tsx` |
| 23 | 停止按钮（■ / Esc） | 运行时点击 / Esc | `prompt-input.tsx` |
| 24 | 拖放覆盖层 UI | 拖入文件/文本时 | `drag-overlay.tsx` |
| 25 | 光标可见性滚动 | 输入时 | `prompt-input.tsx` |
| 26 | 滚动渐变遮罩 | 文本超长时 | `prompt-input.tsx` |
| 27 | 内联药丸（Agent/File pill） | @ 选择后 | `editor-dom.ts` createPill |
| 28 | 双向 DOM ↔ Prompt 同步 | 每次输入 | `editor-dom.ts` reconcile |
| 29 | 两种 UI 布局 | v1 dock / v2 new | `prompt-input.tsx` Switch |
| 30 | 快捷键注册 | 全局 | `prompt-input.tsx` command.register |

---

## 2. 核心架构

```
┌──────────────────────────────────────────────────────────────────┐
│  prompt-input.tsx（~2260 行)                                       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [Context Items 芯片条] ← context-items.tsx                  │ │
│  │  [Image Attachments 缩略图] ← image-attachments.tsx          │ │
│  │  ┌────────────────────────────────────────────────────────┐  │ │
│  │  │  contenteditable <div> 编辑器                           │  │ │
│  │  │  ← editor-dom.ts（DOM 操作 + 药丸渲染）                   │  │ │
│  │  │  ← paste.ts（粘贴处理）                                   │  │ │
│  │  │  ← history.ts（↑↓历史导航）                              │  │ │
│  │  └────────────────────────────────────────────────────────┘  │ │
│  │  [@ / 弹窗] ← slash-popover.tsx                              │ │
│  │  [拖放覆盖层] ← drag-overlay.tsx                              │ │
│  │  [底部栏: Agent选择 / 模型选择 / 变体 / 提交按钮]             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  外部依赖:                                                         │
│  ← dialog-select-model.tsx     (模型选择弹窗)                      │
│  ← submit.ts                   (提交流程)                          │
│  ← attachments.ts + files.ts   (附件管理)                          │
│  ← placeholder.ts              (占位符)                            │
│  ← transient-state.ts          (临时状态)                          │
│  ← submission-state.ts         (提交快照)                          │
└──────────────────────────────────────────────────────────────────┘
```

### 数据模型

```
Prompt = ContentPart[]   ← 输入框的状态（用户输入的完整内容）

ContentPart =
  | TextPart         { type: "text",  content: string, start, end }
  | AgentPart        { type: "agent", content: "@agentName", name: string }
  | FileAttachmentPart { type: "file", content: "@path", path: string,
                         selection?: FileSelection, mime?, filename?, url? }
  | ImageAttachmentPart { type: "image", id, filename, mime, dataUrl }
```

输入框维护一份 `Prompt` 数组，每次用户输入时通过 DOM 解析同步。

---

## 3. 功能详解

### 3.1 Contenteditable 编辑器

**文件**: `prompt-input.tsx`（主编辑器 div）+ `editor-dom.ts`（DOM 操作）

**核心**：不是 `<textarea>`，而是 `contenteditable="true"` 的 `<div>`。

```tsx
<div
  contentEditable={!disabled}
  role="textbox"
  aria-multiline="true"
  autocapitalize={mode === "shell" ? "off" : "sentences"}
  autocorrect={mode === "shell" ? "off" : "on"}
  spellcheck={mode !== "shell"}
  class={mode === "shell" ? "font-mono" : "font-inter"}
  onInput={handleInput}
  onKeyDown={handleKeyDown}
  onPaste={handlePaste}
  // ...
/>
```

**最大高度**：
- v2 新设计：`max-h-[180px] overflow-y-auto`
- v1 旧设计：`max-h-[240px]`

**`editor-dom.ts` 导出函数**：

| 函数 | 用途 |
|------|------|
| `createTextFragment(content)` | 将文本按 `\n` 分割为 `<br>` + TextNode 的 DocumentFragment，限制 MAX_BREAKS=200 |
| `getCursorPosition(parent)` | 计算 contenteditable div 内的光标文本偏移量 |
| `setCursorPosition(parent, pos)` | 设置光标到指定文本偏移量，跳过药丸节点 |
| `setRangeEdge(parent, range, edge, offset)` | 设置 Range 边缘到指定位置 |
| `createPill(part)` | 创建 `@agent` 或 `@file` 的不可编辑 span（药丸） |
| `renderEditor(parts)` / `parseFromDOM()` | 双向 DOM ↔ Prompt 同步 |
| `reconcile(input)` | 检查差异，避免不必要的重渲染 |

**药丸渲染**：

```typescript
const createPill = (part: FileAttachmentPart | AgentPart) => {
  const pill = document.createElement("span")
  pill.textContent = part.content
  pill.setAttribute("data-type", part.type)  // "file" | "agent"
  pill.setAttribute("contenteditable", "false")
  pill.style.userSelect = "text"
  return pill
}
```

Agent 药丸样式：`[&_[data-type=agent]]:text-syntax-type`（蓝色）
File 药丸样式：`[&_[data-type=file]]:text-syntax-property`（紫色）

**双向同步**：

```typescript
// Prompt → DOM
const renderEditor = (parts: Prompt) => { clearEditor(); append text + pills }

// DOM → Prompt（每次 handleInput 时调用）
const parseFromDOM = (): Prompt => { traverse childNodes, build array }

// 仅在真的变化时重渲染
const reconcile = (input: Prompt) => {
  const dom = parseFromDOM()
  if (isNormalizedEditor() && isPromptEqual(input, dom)) return  // 跳过
  renderEditorWithCursor(input)
}
```

### 3.2 @ 提及菜单

**文件**: `prompt-input.tsx`（`handleInput` 中检测）+ `slash-popover.tsx`（UI）

**触发**：输入 `@` 字符后检测是否在 `@word` 模式：

```typescript
const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
if (atMatch) {
  atOnInput(atMatch[1])       // 更新过滤列表
  setStore("popover", "at")   // 显示弹窗
}
```

**4 种 @ 类型**：

```typescript
type AtOption =
  | { type: "agent";    name: string; display: string }
  | { type: "resource"; name: string; uri: string; client: string; display: string; description?: string; mime?: string }
  | { type: "reference"; name: string; path: string; display: string; description: string }
  | { type: "file";     path: string; display: string; recent?: boolean }
```

**列表来源**（`atFlat`）：
1. **References** — `.opencode/references` 目录下的命名引用
2. **Agents** — 可用的子 agent
3. **MCP Resources** — MCP 服务器暴露的资源
4. **最近文件** — 当前打开的 tab
5. **搜索结果** — 通过 `files.searchFilesAndDirectories(query)` 搜索

**弹窗 UI**（`PromptPopover` 组件）：
- 绝对定位在编辑器上方（`inset-x-0 -top-2 -translate-y-full`）
- v2 圆角 `rounded-[10px]`，v1 圆角 `rounded-[12px]`
- 最大高度 `max-h-80`，可滚动
- 键盘导航：ArrowUp/Down 移动选中项，Enter/Tab 确认
- 每种类型的图标不同：agent → brain 图标，file → FileIcon，reference → 文件夹图标

**选择处理**（`handleAtSelect`）：

```typescript
case "agent":
  addPart({ type: "agent", name, content: "@" + name, start: 0, end: 0 })
case "file":
  addPart({ type: "file", path, content: "@" + path, ... })
case "reference":
  prompt.context.addReference({ name, ... })
case "resource":
  prompt.context.addResource({ ... })
```

### 3.3 / 斜杠命令菜单

**文件**: `prompt-input.tsx` + `slash-popover.tsx`

**触发**：当输入在行首 `/` 时：

```typescript
const slashMatch = rawText.match(/^\/(\S*)$/)
if (slashMatch) {
  slashOnInput(slashMatch[1])   // 过滤
  setStore("popover", "slash")  // 显示
}
```

**命令类型**：

```typescript
interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  keybind?: string
  type: "builtin" | "custom"
  source?: "command" | "mcp" | "skill"   // 仅 custom 有
}
```

**列表来源**：
1. **内置命令** — `command.options` 中所有有 `slash` 标记的
2. **自定义命令** — 配置文件中的自定义命令（带 source 标签）

自定义命令显示来源标签：`skill`、`mcp`、`custom`

**执行方式**：
- 自定义命令：插入 `/{cmd.trigger} ` 文本到编辑器
- 内置命令：清空编辑器，通过 `command.trigger(cmd.id, "slash")` 触发

### 3.4 文件附件（拖放/粘贴/选择器）

**文件**: `attachments.ts`（核心逻辑）+ `files.ts`（MIME 嗅探 + 文件选择器）

**三种添加方式**：

#### 拖放（drag & drop）
系统级拖放事件处理：

```typescript
// dragenter 时检测类型
onDragEnter = (e) => {
  if (e.dataTransfer?.types.includes("Files")) setDraggingType("image")
  else if (e.dataTransfer?.types.includes("text/plain")) setDraggingType("@mention")
}

// drop 时处理
onDrop = (e) => {
  if (draggingType === "image") addAttachments(e.dataTransfer.files)
  if (draggingType === "@mention") {
    const text = e.dataTransfer.getData("text/plain")
    if (text.startsWith("file:")) addPart({ type: "file", path: text.slice(5), ... })
  }
}
```

#### 粘贴（clipboard）
```typescript
// handlePaste → attachments.handlePaste(event)
const handlePaste = (e: ClipboardEvent) => {
  const file = e.clipboardData?.files[0]
  if (file) addClipboardAttachment(file)  // 图片/文件
  else normalizePaste(e.clipboardData.getData("text/plain"))  // 文本
}
```

#### 文件选择器（⌘U）
```typescript
command.register("file.attach", {
  keybind: "mod+u",
  onSelect: () => pickAttachmentFiles({ picker, directory, fallback, onFile, onError })
})
```

**`pickAttachmentFiles` 函数**：
1. 优先用平台原生文件选择器
2. 回退到隐藏的 `<input type="file">`
3. 支持的 MIME 类型：`ACCEPTED_FILE_TYPES`

**MIME 类型嗅探**（`files.ts`）：

```typescript
function attachmentMime(file: File): string {
  // 1. 已知图片类型：gif/jpeg/png/webp
  // 2. application/pdf
  // 3. 扩展名回退
  // 4. 文本类型检测：text/*, +json, +xml
  // 5. 读取前 4096 字节检测二进制
}
```

### 3.5 图片附件预览

**文件**: `image-attachments.tsx`

在编辑器上方渲染为缩略图行：

```tsx
<div class="flex flex-wrap gap-2 px-3 pt-3">
  <For each={images()}>
    {(img) => (
      <div class="relative group">
        <img src={img.dataUrl} class="size-16 rounded-[6px] object-cover" />
        <div class="absolute bottom-0 inset-x-0 bg-black/50 rounded-b-md text-white text-[10px] px-1 truncate">
          {img.filename}
        </div>
        <button class="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100">
          <Icon name="close-small" />
        </button>
      </div>
    )}
  </For>
</div>
```

- 缩略图尺寸：`size-16`（64×64px）
- 文件名覆盖在图片底部（半透明黑底）
- 移除按钮右上角（hover 显示）
- 点击缩放：打开 `ImagePreview` 对话框

### 3.6 Agent 选择器

**文件**: `prompt-input.tsx` 底部栏

两种布局的 Agent 选择器：

**v2 新设计**（底部栏左侧）：
```tsx
<Icon name="sliders" />
<Select
  options={props.state.options}
  current={props.state.current}
  onSelect={props.state.onSelect}
  class="max-w-[175px] justify-start text-v2-text-text-faint"
  variant="ghost"
  triggerProps={{ "data-action": "prompt-agent" }}
/>
```

**v1 旧设计**（DockTray 内部）：
```tsx
<Select
  size="normal"
  options={props.controls.agents.options}
  current={props.controls.agents.current}
  onSelect={(value) => { props.controls.agents.select(value); restoreFocus() }}
  class="capitalize max-w-[160px] text-text-base"
  variant="ghost"
/>
```

快捷键：`⌘⇧A`（`agent.cycle`）

### 3.7 模型选择器 + 变体选择

**文件**: `dialog-select-model.tsx`

#### 模型选择弹窗

两种版本：
- **`ModelSelectorPopover`**（v1）— `@kobalte/core` Popover
- **`ModelSelectorPopoverV2`**（v2）— 新版样式

**UI 特征**：
- 定位在输入框上方（`placement="top-start"`）
- 宽度 `w-72`，高度 `h-80`
- 内置搜索框+过滤
- 按 Provider 分组（热门排前）
- 每个模型项：名称 + `free`/`latest` 标签
- 底部 "+" 添加 Provider + 齿轮管理
- Hover Tooltip 显示模型详情

**选择逻辑**：
```typescript
const select = (item: ModelItem) => {
  model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
}
```

#### 模型变体选择

```tsx
<MenuV2 gutter={6} modal={false} placement="top-start">
  <MenuV2.Trigger as={ButtonV2} data-action="prompt-model-variant" variant="ghost-muted">
    {currentVariant ?? t("common.default")}
  </MenuV2.Trigger>
  <MenuV2.Content>
    <MenuV2.RadioGroup value={current}>
      {variants().map(v => <MenuV2.RadioItem value={v}>{v}</MenuV2.RadioItem>)}
    </MenuV2.RadioGroup>
  </MenuV2.Content>
</MenuV2>
```

- 仅在模型有变体且非 shell 模式时显示
- 通过 CSS 控制显示：`hidden group-hover/prompt-input:block group-focus-within/prompt-input:block`

### 3.8 上下文项（文件/评论芯片条）

**文件**: `context-items.tsx`

渲染在编辑器上方：

```tsx
<div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
  <For each={contextItems()}>
    {(item) => (
      <button class="flex items-center gap-1 px-2 py-1 rounded-[6px] whitespace-nowrap max-w-[200px]"
              onClick={() => navigateToFile(item)}>
        <FileIcon node={item} class="size-4 shrink-0" />
        <span class="truncate max-w-[14ch]">{label}</span>
        <Show when={item.selection}>
          <span class="text-text-weak">:{item.selection.startLine}</span>
        </Show>
        <Icon name="close-small" class="size-4" />
      </button>
    )}
  </For>
</div>
```

每个芯片显示：
- `FileIcon` + 文件名（截断 14 字符）+ 行号（如 `:42`）
- 如果有评论则显示评论文字
- 右上角移除按钮
- Hover Tooltip 显示完整路径
- 点击导航到文件位置

**Shell 模式过滤**：shell 模式排除评论芯片，只留纯文件引用。

### 3.9 输入历史 ↑↓ 导航

**文件**: `history.ts`

**存储**：持久化到 localStorage：

```typescript
const [normal, setNormal] = persisted(
  Persist.global("prompt-history", ["prompt-history.v1"]),
  createStore<PromptHistoryState>({ entries: [] }),
)
const [shell, setShell] = persisted(
  Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
  createStore<PromptHistoryState>({ entries: [] }),
)
```

Normal 和 Shell 模式各自独立维护历史。

**导航逻辑**（`canNavigateHistoryAtCursor`）：

```typescript
function canNavigateHistoryAtCursor(direction: "up" | "down", text: string, cursor: number, inHistory: boolean) {
  const position = Math.max(0, Math.min(cursor, text.length))
  const atStart = position === 0
  const atEnd = position === text.length
  if (inHistory) return atStart || atEnd
  if (direction === "up") return position === 0 && text.length === 0
  return position === text.length
}
```

**导航流程**：
1. 第一按 ↑：保存当前输入 → 从索引 0 恢复历史条目
2. 继续 ↑：遍历更旧的条目
3. ↓：往回遍历
4. 索引 0 按 ↓：恢复之前保存的输入

**去重**：`prependHistoryEntry` 检查最后一条是否等于当前条目。

**上限**：最多 100 条。

### 3.10 Shell 模式

**文件**: `prompt-input.tsx`

**进入方式**：
1. 在行首输入 `!`
2. 快捷键 `⌘⇧X`

**退出方式**：
1. 空行按 Backspace
2. 快捷键 `⌘⇧E`

**模式变化**：
- 字体：`font-mono`
- `autocapitalize="off"`、`autocorrect="off"`、`spellcheck={false}`
- 底部栏显示 shell 提示符
- 上下文芯片条过滤掉评论
- 输入历史独立存储
- 提交时执行 shell 命令而非发送 prompt

```typescript
// Normal → Shell: 输入 "!" 在行首
if (event.key === "!" && store.mode === "normal") {
  if (cursorPosition === 0) setStore("mode", "shell")
}

// Shell → Normal: Backspace 清空
if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
  setStore("mode", "normal")
}
```

### 3.11 粘贴处理

**文件**: `paste.ts`

```typescript
const LARGE_PASTE_CHARS = 8000
const LARGE_PASTE_BREAKS = 120

// 判断是否为"大文本粘贴"
function largePaste(text: string): boolean {
  if (text.length >= LARGE_PASTE_CHARS) return true
  let breaks = 0
  for (const char of text) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks >= LARGE_PASTE_BREAKS) return true
  }
  return false
}

// 规范化换行符
function normalizePaste(text: string): string {
  return text.replace(/\r\n?/g, "\n")
}

// 决定粘贴模式
function pasteMode(text: string): "manual" | "native" {
  if (largePaste(text)) return "manual"    // 大文本 → manual（大文本提示）
  if (text.includes("\n")) return "manual" // 多行文本 → manual
  return "native"                          // 单行文本 → 直接粘贴
}
```

**大文本粘贴响应**：当检测到大文本时，弹出 "manual paste" 对话框提示用户手动粘贴，而非直接阻塞编辑器。

### 3.12 占位符系统

**文件**: `placeholder.ts`

```typescript
function promptPlaceholder(input) {
  if (input.mode === "shell") return t("prompt.placeholder.shell", { example: input.example })
  if (input.commentCount > 1) return t("prompt.placeholder.summarizeComments")
  if (input.commentCount === 1) return t("prompt.placeholder.summarizeComment")
  if (!input.suggest) return t("prompt.placeholder.simple")
  return t("prompt.placeholder.normal", { example: input.example })
}
```

**循环示例**：空会话时每 6.5 秒轮换显示 25 个示例提示：

```typescript
const interval = setInterval(() => {
  setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
}, 6500)
```

### 3.13 提交按钮 & 停止按钮

**文件**: `prompt-input.tsx` 底部栏

**状态**：
- **停止中**（stopping = 正在运行且内容为空）：显示 ■ 图标，Tooltip "Stop, Esc"
- **Shell 模式**：显示 `arrow-undo-down` 图标
- **正常模式**：显示 `arrow-up` 图标

**v2 新设计**：
```tsx
<IconButton
  icon={stopping() ? "stop" : "arrow-up"}
  data-action="prompt-submit"
  size="small"
  variant="primary"
  onClick={stopping() ? handleStop : handleSubmit}
  tooltip={stopping() ? `Stop · Esc` : (mode === "shell" ? undefined : "Send")}
/>
```

### 3.14 拖放覆盖层

**文件**: `drag-overlay.tsx`

两种拖放状态：

```typescript
type DragType = "image" | "@mention" | null
```

- `"image"` — 拖入图片文件 → 显示 "拖放图片" 标签 + 照片图标
- `"@mention"` — 拖入文本/文件 → 显示 "拖放文件到此处" 标签 + 链接图标

通过全局事件监听实现：

```typescript
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) setDraggingType("image")
  else if (e.dataTransfer?.types.includes("text/plain")) setDraggingType("@mention")
})

document.addEventListener("dragleave", (e) => {
  if (e.target === document.body) setDraggingType(null)
})

document.addEventListener("drop", (e) => {
  e.preventDefault()
  // 处理文件或文本
})
```

### 3.15 光标滚动 & 滚动渐变

**光标可见性滚动**：
```typescript
const scrollCursorIntoView = () => {
  // 获取 Selection 的 Range 矩形
  // 检查是否在容器可见区域外
  // 滚动容器使其进入视野（12px padding）
}

const queueScroll = (count = 2) => {
  requestAnimationFrame(() => {
    scrollCursorIntoView()
    if (count > 1) queueScroll(count - 1)  // 重试一次确保稳定
  })
}
```

**滚动渐变遮罩**（旧设计）：
```tsx
<div aria-hidden="true" class="pointer-events-none absolute inset-x-0 bottom-0"
  style={{
    height: "56px",
    background: "linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)"
  }}
/>
```

### 3.16 键盘快捷键

| 快捷键 | 功能 | 注册方式 |
|--------|------|----------|
| `⌘U` | 附件文件选择器 | `command.register` |
| `⌘⇧X` | 切换到 Shell 模式 | `command.register` |
| `⌘⇧E` | 切换到 Normal 模式 | `command.register` |
| `⌘⇧A` | 循环切换 Agent | 外部注册 |
| `⌘G` | 终止会话 | 外部注册 |
| `↑` | 历史导航 / 光标移到行首 | `handleKeyDown` |
| `↓` | 历史导航 / 光标移到行尾 | `handleKeyDown` |
| `Enter` | 提交 | `handleKeyDown` |
| `Shift+Enter` | 换行 | `handleKeyDown` |
| `Esc` | 关闭弹窗 > 退出Shell > 停止会话 > 模糊编辑器 | `handleKeyDown` |
| `Backspace` | 删除字符 / 空行退出Shell | `handleKeyDown` |
| `Tab` | @/slash 弹窗确认选择 | `handleKeyDown` |

---

## 4. 数据流

### 用户输入周期

```
用户按键
  → handleInput(event)
    → parseFromDOM()          ← 从 DOM 解析当前 Prompt
    → 检测 @ / / 模式         ← 决定是否显示弹窗
    → reconcile(prompt)       ← 双向同步
    → queueScroll()           ← 保持光标可见

用户选择 @agent
  → handleAtSelect(option)
    → addPart({ type: "agent", name, ... })    ← 插入药丸
    → renderEditor(prompt)                     ← 重新渲染 DOM

用户粘贴图片
  → handlePaste(event)
    → normalizePaste()        ← 文本规范化
    → pasteMode()             ← 判断大文本
    → addClipboardAttachment(file)  ← 添加附件
    → renderEditor(prompt)

用户提交
  → handleSubmit()
    → sendFollowupDraft()
      → buildRequestParts()   ← Prompt → API request
      → client.session.promptAsync()
      → prependHistoryEntry() ← 保存到历史
```

---

## 5. Props 接口

```typescript
interface PromptInputProps {
  class?: string
  variant?: "dock" | "new-session"     // 两种布局变体
  state?: PromptInputState              // usePrompt() 的返回值
  history?: PromptInputHistory           // 历史管理
  submission?: PromptInputSubmission     // 提交状态
  controls: PromptInputControls          // 所有外部依赖
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"] }
  onEditLoaded?: () => void
  shouldQueue?: () => boolean
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  toolbar?: JSX.Element
}

// 所有外部依赖通过这个接口注入
type PromptInputControls = {
  agents: {
    available: { name: string; hidden?: boolean; mode: string }[]
    options: string[]
    current: string
    loading: boolean
    visible: boolean
    select: (name: string | undefined) => void
  }
  model: {
    selection: ReturnType<typeof useLocal>["model"]
    paid: boolean
    loading: boolean
  }
  session: {
    id?: string
    tabs: { active, all, open, setActive }
    reviewPanel: { opened, open }
  }
  newLayoutDesigns: boolean
}
```

---

## 6. Prompt 数据结构

**文件**: `packages/app/src/context/prompt.tsx`

```typescript
// 输入框的完整状态
type Prompt = ContentPart[]

type ContentPart =
  | TextPart             // 普通文本
  | FileAttachmentPart   // @file 附件
  | AgentPart            // @agent 药丸
  | ImageAttachmentPart  // 图片附件（base64 dataUrl）

interface PartBase {
  content: string   // 显示的文本
  start: number     // 在编辑器中的起始偏移
  end: number       // 在编辑器中的结束偏移
}

interface TextPart extends PartBase {
  type: "text"
}

interface FileAttachmentPart extends PartBase {
  type: "file"
  path: string
  selection?: FileSelection   // 行范围
  mime?: string
  filename?: string
  url?: string
  source?: FilePartSource     // "context" | "clipboard" | "picker"
}

interface AgentPart extends PartBase {
  type: "agent"
  name: string
}

interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  sourcePath?: string
  mime: string
  dataUrl: string    // base64
}
```

---

## 7. 子模块文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `prompt-input.tsx` | ~2260 | 主组件，所有功能的编排 |
| `prompt-input/editor-dom.ts` | ~140 | contenteditable DOM 操作 + 药丸管理 |
| `prompt-input/slash-popover.tsx` | ~250 | @ 和 / 弹窗 UI |
| `prompt-input/history.ts` | ~200 | 输入历史存储 + ↑↓ 导航逻辑 |
| `prompt-input/attachments.ts` | ~150 | 文件/图片附件管理 |
| `prompt-input/files.ts` | ~120 | MIME 嗅探 + 文件选择器 API |
| `prompt-input/paste.ts` | ~40 | 粘贴文本规范化 + 大文本检测 |
| `prompt-input/submit.ts` | ~200 | 提交流程（含 / 命令处理） |
| `prompt-input/submission-state.ts` | ~60 | 提交快照（clear/retarget/restore） |
| `prompt-input/build-request-parts.ts` | ~100 | Prompt → API request 转换 |
| `prompt-input/context-items.tsx` | ~100 | 上下文文件/评论芯片条 |
| `prompt-input/image-attachments.tsx` | ~60 | 图片缩略图预览行 |
| `prompt-input/drag-overlay.tsx` | ~80 | 拖放覆盖层 UI |
| `prompt-input/placeholder.ts` | ~50 | 占位符文本生成 + 示例循环 |
| `prompt-input/transient-state.ts` | ~30 | 本地临时 UI 状态存储 |

### 外部依赖组件

| 文件 | 职责 |
|------|------|
| `dialog-select-model.tsx` | 模型选择弹窗（ModelSelectorPopover + ModelSelectorPopoverV2） |
| `context/prompt.tsx` | Prompt 类型定义 + usePrompt hook |
| `context/models.tsx` | 模型列表管理 |
| `context/model-variant.ts` | 模型变体相关工具函数 |

---

## 8. 布局变体

组件支持两种布局变体，通过 `props.controls.newLayoutDesigns` 切换：

### v1 旧设计（dock）
- 圆角：`rounded-[12px]`
- 背景色：`bg-surface-raised-stronger-non-alpha`
- 最大高度：`max-h-[240px]`
- 使用 `DockTray` + `DockShellForm` 布局
- 使用 Kobalte Popover
- 底部有滚动渐变遮罩

### v2 新设计
- 圆角：`rounded-xl`
- 背景色：`bg-v2-background-bg-base`
- 最大高度：`max-h-[180px]`
- 使用 v2 组件（ButtonV2、TooltipV2、MenuV2）
- 阴影：`shadow-[var(--v2-elevation-raised)]`
- Agent 选择器前有 `sliders` 图标

---

## 9. 完整复刻步骤

### 第一步：数据结构

```
文件清单：
  context/prompt.ts       — Prompt, ContentPart, TextPart, FileAttachmentPart,
                            AgentPart, ImageAttachmentPart 类型定义
```

### 第二步：编辑器核心

```
文件清单：
  components/prompt-input/editor-dom.ts  — createTextFragment, getCursorPosition,
                                            setCursorPosition, createPill,
                                            renderEditor, parseFromDOM, reconcile
```

### 第三步：@ 和 / 弹窗

```
文件清单：
  components/prompt-input/slash-popover.tsx  — AtOption, SlashCommand 类型,
                                                PromptPopover 组件
```

### 第四步：附件系统

```
文件清单：
  components/prompt-input/attachments.ts    — 附件增删管理
  components/prompt-input/files.ts          — MIME 嗅探 + 文件选择器
  components/prompt-input/paste.ts          — 粘贴处理
  components/prompt-input/image-attachments.tsx — 缩略图预览
  components/prompt-input/drag-overlay.tsx   — 拖放覆盖层
```

### 第五步：辅助功能

```
文件清单：
  components/prompt-input/history.ts        — 输入历史
  components/prompt-input/placeholder.ts    — 占位符
  components/prompt-input/context-items.tsx — 上下文芯片条
```

### 第六步：提交流程

```
文件清单：
  components/prompt-input/submit.ts           — 提交逻辑
  components/prompt-input/submission-state.ts — 提交快照
  components/prompt-input/build-request-parts.ts — Prompt → API 转换
```

### 第七步：主组件

```
文件清单：
  components/prompt-input.tsx              — 主组件（编排所有子模块）
```

### 第八步：外部依赖

```
文件清单：
  components/dialog-select-model.tsx       — 模型选择弹窗
  context/prompt.tsx                        — usePrompt hook
  context/models.tsx                        — 模型列表
  context/model-variant.ts                  — 变体工具
```

---

## 附录：本地源码路径对照

| 文件 | 本地路径 |
|------|----------|
| 主输入框组件 | `packages/app/src/components/prompt-input.tsx` |
| DOM 编辑器核心 | `packages/app/src/components/prompt-input/editor-dom.ts` |
| @ 和 / 弹窗 | `packages/app/src/components/prompt-input/slash-popover.tsx` |
| 输入历史 | `packages/app/src/components/prompt-input/history.ts` |
| 附件管理 | `packages/app/src/components/prompt-input/attachments.ts` |
| MIME + 文件选择器 | `packages/app/src/components/prompt-input/files.ts` |
| 粘贴处理 | `packages/app/src/components/prompt-input/paste.ts` |
| 提交逻辑 | `packages/app/src/components/prompt-input/submit.ts` |
| 提交快照 | `packages/app/src/components/prompt-input/submission-state.ts` |
| Request 构建 | `packages/app/src/components/prompt-input/build-request-parts.ts` |
| 上下文芯片条 | `packages/app/src/components/prompt-input/context-items.tsx` |
| 图片缩略图 | `packages/app/src/components/prompt-input/image-attachments.tsx` |
| 拖放覆盖层 | `packages/app/src/components/prompt-input/drag-overlay.tsx` |
| 占位符 | `packages/app/src/components/prompt-input/placeholder.ts` |
| 临时状态 | `packages/app/src/components/prompt-input/transient-state.ts` |
| 模型选择弹窗 | `packages/app/src/components/dialog-select-model.tsx` |
| Prompt 类型定义 | `packages/app/src/context/prompt.tsx` |
| 模型管理 | `packages/app/src/context/models.tsx` |
| 模型变体 | `packages/app/src/context/model-variant.ts` |
