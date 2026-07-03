# 工具仓库瘦身执行计划

> **原则**：工具仓库只保留 OpenCode 原生工具 + 用户通过 GitHub 安装的工具。其余自建工具全部删除，改为 GitHub 推荐安装。

---

## 现状

| 类别 | 数量 | 当前状态 |
|------|:--:|------|
| OpenCode 原生工具 | ~15 | ✅ 由 OpenCode 服务端提供，我们只展示结果 |
| 自定义工具（在 TOOL_CARDS 中） | 17+ | ❌ 要删除的 |
| GitHub 推荐安装 | 3 | ✅ 保留并扩充 |

**关键事实**：生产路径中，OpenCode 模式只使用 `options.openCodeTools`（OpenCode 原生工具），直连模式不发自定义工具。所以这些自定义工具定义虽然在代码中存在，**实际并不发送给 LLM**——只是占着工具仓库 UI 的位置。

---

## 执行步骤

### Step 1：把热门自建工具加入 githubTools.json

让用户通过 GitHub 安装这些以前内置的工具：

```jsonc
// src/data/githubTools.json — 扩充到 ~15 个
[
  // 现有 3 个
  { "id": "yt-dlp", "name": "yt-dlp", "repo": "yt-dlp/yt-dlp", ... },
  { "id": "pixelle-video", ... },
  { "id": "so-novel", ... },
  
  // 新增 — 文档/Office
  { "id": "pandoc", "name": "Pandoc", "repo": "jgm/pandoc", "category": "office",
    "description": "通用文档格式转换器", "installPrompt": "请安装 pandoc..." },
  { "id": "libreoffice", "name": "LibreOffice", "repo": "LibreOffice/core", "category": "office",
    "description": "Office 文档处理", "installPrompt": "请安装 LibreOffice..." },
  
  // 新增 — 媒体
  { "id": "ffmpeg", "name": "FFmpeg", "repo": "FFmpeg/FFmpeg", "category": "media",
    "description": "音视频处理工具", "installPrompt": "请确保 ffmpeg 已安装..." },
  { "id": "whisper", "name": "Whisper", "repo": "openai/whisper", "category": "media",
    "description": "语音转文字", "installPrompt": "请安装 whisper..." },
  
  // 新增 — 浏览器
  { "id": "playwright", "name": "Playwright", "repo": "microsoft/playwright", "category": "browser",
    "description": "浏览器自动化", "installPrompt": "请安装 playwright..." },
  
  // 新增 — 开发
  { "id": "ripgrep", "name": "ripgrep", "repo": "BurntSushi/ripgrep", "category": "dev",
    "description": "超快文本搜索", "installPrompt": "请安装 ripgrep..." },
]
```

### Step 2：清空 TOOL_CARDS 中的自定义工具

**文件**：`src/utils/toolRegistry.ts`

保留的 TOOL_CARDS 条目：
- ✅ MCP 扩展入口（"高级扩展"）
- ❌ 删除所有自建工具卡片（格式转换、文档读取、音视频、浏览器、开发、定时任务）

```typescript
// 修改前：17 个卡片
export const TOOL_CARDS: ToolCard[] = [
  { id: 'format-converter', ... },
  { id: 'document-reader', ... },
  // ... 15 more
]

// 修改后：仅保留容器入口
export const TOOL_CARDS: ToolCard[] = [
  { id: 'mcp-extensions', type: 'entry', label: '高级扩展', ... },
]
```

### Step 3：简化 ToolWarehousePanel

**文件**：`src/components/tools/ToolWarehousePanel.vue`

- 删除"我的工具"标签页中的卡片网格 → 只保留 MCP 扩展入口
- 删除子面板组件引用（FormatConverterPanel, MediaUrlCapturePanel, MediaWorkbenchPanel）
- "GitHub 推荐安装"标签页保持并优化

如果"我的工具"标签页空了，直接合并为一个页面：
```
┌─────────────────────────────────┐
│  工具仓库                         │
│  [GitHub 推荐安装]  [已安装]      │
│                                  │
│  搜索...                         │
│  ┌────────┐ ┌────────┐          │
│  │ ffmpeg  │ │ pandoc │  ...     │
│  │ 音视频   │ │ 文档    │          │
│  │ ⬇ 安装  │ │ ⬇ 安装 │          │
│  └────────┘ └────────┘          │
│                                  │
│  ── 高级扩展 ──                   │
│  MCP 服务器管理 →                 │
└─────────────────────────────────┘
```

### Step 4：保留但不删除的执行代码

以下文件的执行逻辑**保留**——因为 GitHub 安装的工具仍需要这些执行代码：

| 文件 | 保留原因 |
|------|---------|
| `src/utils/localContentTools.ts` | ffmpeg/whisper 等需要本地执行 |
| `src/utils/browserTools.ts` | Playwright 浏览器控制需要 |
| `src/utils/devProjectTools.ts` | ripgrep/git 等需要本地项目操作 |
| `src/utils/todoTools.ts` | Todo 能力可复用 |
| `src/utils/skillBuilderTools.ts` | Skill 构建可复用 |

这些执行函数不删除，只是不再在 `TOOL_CARDS` 中展示为内置卡片。它们改为由 GitHub 安装的工具包引用。

### Step 5：清理工具定义注册

**文件**：`src/runtime/connection/toolConnectionAdapter.ts`

- `buildAvailableChatTools()` — 移除自定义工具分类注册
- `buildDefaultChatTools()` — 简化或删除（目前测试中，未接入生产）

**文件**：`src/runtime/tools/` 
- 保留 `mcpBridge.ts`（MCP 扩展是 OpenCode 支持的）
- 其他运行时工具文件评估是否可归档

### Step 6：回归验证

```bash
# 确认构建通过
pnpm exec vue-tsc -b
pnpm exec vite build

# 确认工具仓库 UI 正常
# - GitHub 推荐安装标签页正常显示
# - 已安装工具可卸载
# - MCP 扩展入口可点击
# - OpenCode 原生工具在会话中正常工作（bash/read/write/edit 等）
```

---

## 不删除的内容

| 内容 | 原因 |
|------|------|
| OpenCode 原生工具 | 由 OpenCode 服务端提供，属于 OpenCode 生态 |
| MCP Bridge (`mcpBridge.ts`) | MCP 协议是 OpenCode 支持的标准扩展方式 |
| `skillBuilderTools.ts` / `skillTestRunner.ts` | Skill 是 OpenCode 核心概念 |
| `githubTools.json` | 扩充后作为用户安装工具的唯一来源 |
| 执行代码 (`localContentTools.ts` 等) | GitHub 安装的工具需要本地执行能力 |

---

## 预期效果

```
之前：工具仓库 17 个内置卡片 + 3 个 GitHub 推荐
之后：工具仓库 0 个内置卡片 + ~15 个 GitHub 推荐
      + MCP 扩展入口
      + OpenCode 原生工具（运行时由 OpenCode 自动暴露）
```

用户通过 GitHub 安装 ffmpeg/pandoc/playwright 等工具，我们只管理安装/卸载状态。跟 Skill 仓库一样的模式。
