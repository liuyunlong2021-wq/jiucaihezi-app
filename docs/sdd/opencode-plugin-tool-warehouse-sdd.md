# OpenCode 插件接入工具仓库 SDD

> **分支**: `chajian`
> **日期**: 2026-07-01
> **目标**: 把 OpenCode 官方插件生态接入韭菜盒子工具仓库的 GitHub 推荐，让用户发现、安装、管理 OpenCode 插件。

---

## 1. 背景

### 1.1 现状

韭菜盒子当前有三类扩展能力：

| 层级 | 载体 | 安装方式 |
|------|------|---------|
| Skill 仓库 | `~/.agents/skills/` 目录 + SKILL.md | 内置播种 / GitHub 导入 |
| 工具仓库 | CLI 二进制（yt-dlp、ffmpeg…） | brew / pip / git clone |
| （缺失） | OpenCode 插件 | 未接入 |

OpenCode 从 v1.17+ 起内置了完整的插件系统：插件作者用 `@opencode-ai/plugin` 写插件发布到 npm，用户通过 `opencode.json` 的 `plugin` 字段安装。

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

OpenCode 插件是工具仓库的一个**子类别**，和 CLI 工具并列：

```
工具仓库
├── CLI 工具（category: media/dev/office/ai/utility）
│   └── 安装 = brew/pip/git clone → ~/.jiucaihezi/tools/
│   └── 检测 = Rust check_tool_installed + plugin-fs
│
└── OpenCode 插件（category: opencode-plugin）★ 新增
    └── 安装 = 写入 opencode.json 的 plugin 字段
    └── 检测 = 读 opencode.json 的 plugin 数组
```

复用同一套 `GitHubSkillCard` 组件，只差安装/检测行为。

---

## 4. 数据模型

### 4.1 githubTools.json 新增条目

在现有 `githubTools.json` 的 `tools` 数组末尾追加 OpenCode 插件条目。条目结构复用现有 `GitHubSkillEntry` 接口，`category` 设为 `"opencode-plugin"`。

```json
{
  "id": "opencode-supermemory",
  "name": "SuperMemory",
  "description": "OpenCode 长期记忆插件 — 自动记住跨会话上下文，让 AI 不遗忘",
  "repo": "opencode-ai/opencode-supermemory",
  "homepage": "https://github.com/opencode-ai/opencode-supermemory",
  "stars": null,
  "category": "opencode-plugin",
  "tags": ["记忆", "上下文", "OpenCode", "官方"],
  "installPrompt": "在 opencode.json 中配置: {\"plugin\": [\"opencode-supermemory\"]}。重启 OpenCode server 生效。",
  "uninstallPrompt": "从 opencode.json 的 plugin 数组中移除 opencode-supermemory。",
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
const opencodePlugins = computed<GitHubSkillEntry[]>(() => {
  const tools = (githubToolsData as { tools: GitHubSkillEntry[] }).tools || []
  return tools.filter(t => t.category === 'opencode-plugin')
})
```

### 5.2 GitHubSkillCard.vue — 安装检测扩展

现有三段式检测：

```
checkInstalled()
  ├─ ① Rust check_tool_installed → CLI 工具
  ├─ ② plugin-fs exists()        → CLI 工具兜底
  └─ ③ 静默失败
```

新增第四段（仅在 `category === 'opencode-plugin'` 时触发）：

```
checkInstalled()
  ├─ ① Rust check_tool_installed
  ├─ ② plugin-fs exists()
  ├─ ③ 读 opencode.json → 检查 plugin 数组 ★ 新增
  └─ ④ 静默失败
```

检测逻辑伪代码：

```ts
// ③ OpenCode 插件检测
if (props.skill.category === 'opencode-plugin') {
  const projectDir = localStorage.getItem('jc_project_dir') || ''
  if (projectDir) {
    const configPath = `${projectDir}/opencode.json`
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const raw = await readTextFile(configPath)
      const config = JSON.parse(raw)
      const plugins: string[] = (config.plugin || []).map((p: any) =>
        typeof p === 'string' ? p : p.package || ''
      )
      const pluginName = props.skill.id.replace('opencode-', '')
      if (plugins.some(p => p.includes(pluginName))) {
        isInstalled.value = true
        installPath.value = `opencode.json → plugin: [..., "${pluginName}"]`
        return
      }
    } catch { /* 文件不存在或 JSON 格式错误，视为未安装 */ }
  }
}
```

---

## 6. 安装/卸载行为

### 6.1 安装（一键写入 opencode.json）

用户点击安装 → 调 Rust 命令 `patch_opencode_plugin`：

```
Rust: patch_opencode_plugin({ pluginId, action: "add" })
  → 读 {projectDir}/opencode.json
  → 如果 plugin 字段不存在，创建 []
  → 追加 pluginId 到数组（幂等：已存在则跳过）
  → 写回 opencode.json
  → 返回成功/失败
```

### 6.2 卸载

```
Rust: patch_opencode_plugin({ pluginId, action: "remove" })
  → 读 opencode.json
  → 从 plugin 数组移除匹配的条目
  → 写回
```

### 6.3 为什么用 Rust 而不是前端 JS 写文件

- 前端 `writeTextFile` 可能遇到 Tauri fs plugin scope 限制
- Rust `std::fs` 能处理项目目录（已有 `dev_*` 命令的先例）
- 文件锁：防止并发写入损坏 JSON

---

## 7. 文件变更清单

| 文件 | 变更 | 风险 |
|------|------|:--:|
| `src/data/githubTools.json` | 新增 OpenCode 插件条目 | 低 |
| `src/components/tools/ToolWarehousePanel.vue` | 新增 "OpenCode 插件" 区块 + `opencodePlugins` computed | 低 |
| `src/components/skills/GitHubSkillCard.vue` | `checkInstalled()` 新增 opencode.json 读取检测 | 中 |
| `src-tauri/src/lib.rs` | 新增 `patch_opencode_plugin(add/remove)` Rust 命令 | 中 |
| `src-tauri/capabilities/default.json` | 确保允许读/写 `opencode.json` | 低 |
| `AGENTS.md` | 更新 §2 的 Superpower 描述 → OpenCode 插件 | 低 |
| `docs/sdd/opencode-plugin-tool-warehouse-sdd.md` | 本文件 | — |

---

## 8. 不做的事（明确边界）

- ❌ 不实现自己的插件 SDK / runtime
- ❌ 不运行 `bun install`（那是 OpenCode 的事）
- ❌ 不做插件市场 / 发布平台
- ❌ 不解析插件 manifest.json
- ❌ 不做 TUI 插件（TUI 插件属于 OpenCode 内置 UI，韭菜盒子工具仓库只管理 `opencode.json` 配置层）
- ❌ 不修改 `projectStoredNewApiForOpenCode` 的 config 数据结构（`plugin` 字段不属于 provider 配置，属于项目级 `opencode.json`）

---

## 9. 验证计划

### 9.1 构建验证

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
cargo check
```

### 9.2 功能验证

1. 打开工具仓库 → 看到 "OpenCode 插件" 区块 → 显示 `opencode-supermemory` 卡片
2. 未安装状态：显示 "安装" 按钮
3. 点击安装 → `opencode.json` 出现 `"plugin": ["opencode-supermemory"]`
4. 重新打开工具仓库 → `opencode-supermemory` 显示 "✅ 已安装"
5. 手动删除 `opencode.json` 中的条目 → 再次打开显示 "安装" 按钮
6. 卸载 → `opencode.json` 中条目被移除

### 9.3 边界验证

- 项目目录未选择时：安装按钮 disabled + tooltip "请先选择项目目录"
- `opencode.json` 不存在时：安装自动创建 `{ "plugin": [...] }`
- `opencode.json` 已有其他 plugin 时：安装只追加，不覆盖
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
