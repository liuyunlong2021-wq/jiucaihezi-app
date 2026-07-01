# 插件接入工具仓库 SDD

> **分支**: `chajian`
> **日期**: 2026-07-01
> **目标**: 把各种 AI 编码工具的插件生态（OpenCode、Codex、Claude Code 等）统一接入工具仓库的 GitHub 推荐，让用户发现、安装、管理插件。

---

## 1. 背景

### 1.1 现状

韭菜盒子当前有三类扩展能力：

| 层级 | 载体 | 安装方式 |
|------|------|---------|
| Skill 仓库 | `~/.agents/skills/` 目录 + SKILL.md | 内置播种 / GitHub 导入 |
| 工具仓库 | CLI 二进制（yt-dlp、ffmpeg…） | brew / pip / git clone |
| （缺失） | 插件 | 未接入 |

各种 AI 编码工具（OpenCode、Codex、Claude Code 等）都有自己的插件/扩展机制。

### 1.2 AGENTS.md 过时内容

当前 AGENTS.md §2 中：

> *Superpower / 帮我配置只保留为未来运行前配置助手：它可以推荐 Skill、Tool、Model、项目目录，但用户确认前不得进入执行链。*

这是 OpenCode 成为核心之前的旧概念。现在 OpenCode plugin 才是真实的扩展机制。需要更新。

---

## 2. 官方 OpenCode Plugin 系统摘要

> 完整源码树见用户提供的地图。本节只提取与韭菜盒子接入相关的关键事实。

### 2.1 插件类型

OpenCode 支持两种插件 API：

- **V2 Effect Plugin**（推荐）：`import { define } from "@opencode-ai/plugin/v2/effect"`
  - 基于 Effect-TS，`define({ id, effect(ctx) })` 模式
  - `ctx` 可 hook：`agent` / `command` / `catalog` / `skill` / `integration` / `reference` / `event` / `tool` / `aisdk` / `plugin`

- **V2 Promise Plugin**：`import { define } from "@opencode-ai/plugin/v2/promise"`
  - `define({ id, setup(ctx) })` 模式，Promise-based

- **V1 Plugin**（遗留）：`Plugin = (input: PluginInput) => Promise<Hooks>`

### 2.2 插件安装协议

用户通过 `opencode.json` 声明插件：

```jsonc
{
  "plugin": [
    "opencode-supermemory",                    // 字符串形式
    { "package": "my-plugin", "options": {} }  // 对象形式（可传配置）
  ]
}
```

OpenCode 启动时（`ConfigExternalPlugin`）：

1. 扫描 `opencode.json` 的 `plugin` 数组
2. 解析包名（支持 `file://`、相对路径、npm 包名）
3. `bun install` 安装 npm 依赖
4. 读取 `manifest.json` 检查 `targets`（server / tui）
5. 加载 entry module → 执行 `setup(effect)`
6. 注册到 `PluginV2.Service`

### 2.3 已知 OpenCode 插件

| 插件 | 仓库 | 功能 |
|------|------|------|
| `opencode-supermemory` | opencode-ai/opencode-supermemory | 跨会话长期记忆 |
| `opencode-gitlab-auth` | 内置 | GitLab OAuth 认证 |
| `opencode-poe-auth` | 内置 | Poe OAuth 认证 |
| `opencode-codex` | 内置 | OpenAI Codex 认证 |
| `opencode-copilot` | 内置 | GitHub Copilot 认证 |

> 更多社区插件待发现。韭菜盒子可以先收录 `opencode-supermemory`，后续按需追加。

---

## 3. 韭菜盒子接入策略

### 3.1 核心原则：不另起炉灶

- **不做**自己的插件 SDK
- **不做**插件运行时
- **不做**插件沙箱
- **只做**：发现 → 一键写入 `opencode.json` → 检测已安装状态

OpenCode 已经负责插件的安装（`bun install`）、加载、运行。韭菜盒子只负责**配置层**——帮用户把插件名写入 `opencode.json`。

### 3.2 插件在工具仓库中的定位

插件是工具仓库的一个**子类别**（`category: "plugin"`），和 CLI 工具并列：

```
工具仓库
├── CLI 工具（category: media/dev/office/ai/utility）
│   └── 安装 = brew/pip/git clone → ~/.jiucaihezi/tools/
│   └── 检测 = Rust check_tool_installed + plugin-fs
│
└── 插件（category: plugin）★ 新增
    └── 安装 = paste-to-chat → LLM 写配置文件（opencode.json 等）
    └── 检测 = Rust check_opencode_plugin（读 opencode.json）
```

复用同一套 `GitHubSkillCard` 组件，只差安装/检测行为。

---

## 4. 数据模型

### 4.1 githubTools.json 新增条目

在现有 `githubTools.json` 的 `tools` 数组末尾追加插件条目。条目结构复用现有 `GitHubSkillEntry` 接口，`category` 设为 `"plugin"`。

```json
{
  "id": "opencode-supermemory",
  "name": "SuperMemory",
  "description": "OpenCode 长期记忆插件 — 自动记住跨会话上下文，让 AI 不遗忘",
  "repo": "opencode-ai/opencode-supermemory",
  "homepage": "https://github.com/opencode-ai/opencode-supermemory",
  "category": "plugin",
  "tags": ["记忆", "上下文", "OpenCode", "官方"],
  "installPrompt": "请帮我在当前项目的 opencode.json 中启用 opencode-supermemory 插件。配置格式: {\"plugin\": [\"opencode-supermemory\"]}。安装后重启 OpenCode server 生效。",
  "uninstallPrompt": "请帮我把 opencode-supermemory 从当前项目 opencode.json 的 plugin 数组中移除。",
  "note": "需要 OpenCode v1.17+。安装后 OpenCode 会自动 npm install 依赖。",
  "commands": [
    {
      "title": "启用长期记忆",
      "desc": "让 AI 记住跨会话的上下文和偏好",
      "template": "请帮我在当前项目的 opencode.json 中启用 opencode-supermemory 插件。"
    },
    {
      "title": "管理记忆内容",
      "desc": "查看/清理 AI 记住的信息",
      "template": "请帮我查看 opencode-supermemory 当前存储的记忆内容，并清理不需要的部分。"
    }
  ]
}
```

### 4.2 可选：githubOpenCodePlugins.json（如果数量多）

如果未来 OpenCode 插件 > 10 个，可拆分为独立文件 `src/data/githubOpenCodePlugins.json`。当前阶段先复用 `githubTools.json`，用 `category` 区分。

---

## 5. UI 变更

### 5.1 ToolWarehousePanel.vue

在 "GitHub 推荐安装" 区块之后，新增 "OpenCode 插件" 区块：

```vue
<!-- OpenCode 插件（新增区块） -->
<div class="tw-section">
  <div class="tw-section-title">
    <JcIcon name="extension" />
    <span>OpenCode 插件</span>
    <span class="tw-count">{{ opencodePlugins.length }} 个</span>
  </div>
  <p class="tw-desc" style="margin-bottom: 8px;">
    这些插件扩展 OpenCode 的能力。安装后 OpenCode 启动时自动加载。
  </p>
  <div class="tw-github-grid">
    <GitHubSkillCard
      v-for="plugin in opencodePlugins"
      :key="plugin.id"
      :skill="plugin"
    />
  </div>
</div>
```

对应的 computed：

```ts
const pluginEntries = computed<GitHubSkillEntry[]>(() => {
  const tools = (githubToolsData as { tools: GitHubSkillEntry[] }).tools || []
  return tools.filter(t => t.category === 'plugin')
})
```

### 5.2 GitHubSkillCard.vue — 安装检测扩展（P0：必须走 Rust）

> **P0 原因**：Tauri fs plugin scope 只放行 `$APPDATA/**` 等路径。`projectDir` 可以是任意目录，前端 `readTextFile(projectDir + '/opencode.json')` 会被 scope 拦截。必须用 Rust `std::fs`（同 `dev_*` 命令模式）。

检测逻辑改为新增 Rust 命令 `check_opencode_plugin`：

```rust
// Rust: check_opencode_plugin(toolId, projectDir)
//   → std::fs::read_to_string(projectDir + "/opencode.json")
//   → serde_json 解析 plugin 数组
//   → 返回 Option<String> (installed path 或 None)
```

前端 `checkInstalled()` 在 `category === 'plugin'` 时调用：

```ts
// ③ 插件检测（Rust 命令，避免 fs scope 限制）
if (props.skill.category === 'plugin') {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const projectDir = localStorage.getItem('jc_project_dir') || ''
    if (!projectDir) return
    const path = await invoke<string | null>('check_opencode_plugin', {
      toolId: props.skill.id,
      projectDir,
    })
    if (path) {
      isInstalled.value = true
      installPath.value = path
      return
    }
  } catch { /* 静默失败 */ }
}
```

检测三段式（更新版）：

```
checkInstalled()
  ├─ ① Rust check_tool_installed           → CLI 工具
  ├─ ② plugin-fs exists()                   → CLI 工具兜底
  ├─ ③ Rust check_opencode_plugin           → 插件 ★ 新增
  └─ ④ 静默失败
```

---

## 6. 安装/卸载行为

### 6.1 安装（粘贴指令到聊天，复用现有模式）

**不做一键安装。** 和 CLI 工具保持一致：用户点击"安装" → `installPrompt` 粘贴到输入框 → 用户发送 → LLM 执行。

```
GitHubSkillCard.install()
  → emitEvent('append-chat-input', skill.installPrompt)
  → 用户发送
  → LLM 读/写 opencode.json 的 plugin 字段
```

`installPrompt` 是指令模板格式（和 yt-dlp、ffmpeg 等完全一致）：

```
"请帮我在当前项目的 opencode.json 中启用 opencode-supermemory 插件。
配置格式: {\"plugin\": [\"opencode-supermemory\"]}。
安装后重启 OpenCode server 生效。"
```

### 6.2 卸载

同样走 paste-to-chat：

```
"请帮我把 opencode-supermemory 从当前项目 opencode.json 的 plugin 数组中移除。"
```

### 6.3 为什么和 CLI 工具一样走 paste-to-chat

- 一致性优先：所有工具仓库的"安装"都是 paste-to-chat → LLM 执行
- 不改 `GitHubSkillCard.install()`：610 处引用，加分支增加风险
- LLM 改写 `opencode.json` 和改写任何代码文件一样可靠
- 如果未来需要一键安装，单独加一个 `category === 'plugin'` 分支，不在此 SDD 范围

---

## 7. 文件变更清单

| 文件 | 变更 | 风险 |
|------|------|:--:|
| `src/data/githubTools.json` | 新增插件条目 | 低 |
| `src/components/tools/ToolWarehousePanel.vue` | 新增 "插件" 区块 + `pluginEntries` computed | 低 |
| `src/components/skills/GitHubSkillCard.vue` | `checkInstalled()` 新增 `check_opencode_plugin` Rust 调用（仅 category=plugin 时） | 中 |
| `src-tauri/src/lib.rs` | 新增 `check_opencode_plugin(toolId, projectDir)` Rust 命令（读 opencode.json → 查 plugin 数组） | 低 |
| `AGENTS.md` | 更新 §2 的 Superpower 描述 → OpenCode 插件 | 低 |
| `docs/sdd/opencode-plugin-tool-warehouse-sdd.md` | 本文件 | — |

> **注意**：不需要修改 `capabilities/default.json`——检测走 Rust `std::fs`，不经过 Tauri fs plugin scope。安装走 paste-to-chat（LLM 执行），也不经过 fs plugin。

---

## 8. 不做的事（明确边界）

- ❌ 不实现自己的插件 SDK / runtime
- ❌ 不运行 `bun install`（那是 OpenCode 的事）
- ❌ 不做插件市场 / 发布平台
- ❌ 不解析插件 manifest.json
- ❌ 不做 TUI 插件（TUI 插件属于 OpenCode 内置 UI）
- ❌ 不修改 `projectStoredNewApiForOpenCode` 的 config 数据结构
- ❌ 不新增一键安装按钮（安装走 paste-to-chat，和 CLI 工具一致）
- ❌ 前端不直接读/写 `opencode.json`（必须走 Rust `std::fs`）
- ❌ 不做生态锁定（插件不限于 OpenCode，任何编码工具的插件都能加）

---

## 9. 验证计划

### 9.1 构建验证

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
cargo check
```

### 9.2 功能验证

1. 打开工具仓库 → 看到 "插件" 区块 → 显示 SuperMemory 卡片
2. 未安装状态：显示 "安装" 按钮
3. 点击安装 → `opencode.json` 出现 `"plugin": ["opencode-supermemory"]`
4. 重新打开工具仓库 → `opencode-supermemory` 显示 "✅ 已安装"
5. 手动删除 `opencode.json` 中的条目 → 再次打开显示 "安装" 按钮
6. 卸载 → `opencode.json` 中条目被移除

### 9.3 边界验证

- 项目目录未选择时：安装按钮正常工作（paste-to-chat 不依赖 projectDir）
- 项目目录未选择时：检测按钮返回未安装（`jc_project_dir` 为空，跳过检测）
- `opencode.json` 不存在时：检测返回未安装（Rust `read_to_string` 失败 → 静默返回 None）
- `opencode.json` 已有其他 plugin 时：LLM 只追加 `opencode-supermemory`，不覆盖
- Web 端：显示 "请在桌面端使用此功能"（工具仓库本身已是 `!isWebRuntime`）

---

## 10. AGENTS.md 更新

在 §2（产品定位）中，将过时的 Superpower 描述替换为：

```markdown
### OpenCode 插件

OpenCode 是项目协作的核心。OpenCode 原生支持通过 `opencode.json` 的
`plugin` 字段安装扩展插件——如 `opencode-supermemory`（跨会话长期记忆）。
OpenCode 插件统一在工具仓库的 GitHub 推荐中展示和管理。

禁止默认产品形态：
- 通用 Agent
- 自主决策 Agent
- 开放式 Agent Loop
- AI 自动选择 Skill/Tool/Model/项目目录
- 用户不可控的黑盒工作流
```
