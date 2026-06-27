# 工具即 Prompt — 极简工具发现与安装 SDD

> **状态**: v7 — Phase 0 完成，Phase 1 启动
> **分支**: `gongju`
> **日期**: 2026-06-25
> **核心洞察**: 韭菜盒子不需要做工具容器。OpenCode 已经是全电脑最强的安装引擎和运行时。

---

## Phase 0: ✅ Skill 仓库「GitHub 推荐」— 已完成

改动 5 个文件，已验证通过：

| 文件 | 说明 |
|------|------|
| `src/data/githubSkills.json` | 16 个精选 Skill（Serena 6 + Ren 10） |
| `src/components/skills/GitHubSkillCard.vue` | 推荐卡片（名称/描述/⭐/标签/安装按钮） |
| `src/components/skills/SkillListModeToggle.vue` | 「文件夹」→「GitHub 推荐」 |
| `src/components/skills/CentralSkillsPanel.vue` | `viewMode` 加 `'github'`，渲染推荐列表 |
| `src/assets/icons-bundle.json` | 新增 star 图标 |

**验证通过**: 点击「GitHub 推荐」→ 16 张卡片 → 点安装 → 输入框填 prompt → 发送 → OpenCode clone → Skill 出现在「全部」列表。

---

## Phase 1: 🔧 工具仓库「GitHub 推荐安装」— 本次任务

**策略**: 完全复刻 Phase 0 的成功模式，用同一个 `GitHubSkillCard.vue` 组件，换一个数据源。

### 1.1 改动范围（3 个文件，~100 行新代码）

| 文件 | 改动 |
|------|------|
| `src/data/githubTools.json` | **新增** — 3 个精选软件（yt-dlp + Pixelle-Video + so-novel） |
| `src/components/tools/ToolWarehousePanel.vue` | 加 Tab：「我的工具」\|「GitHub 推荐安装」 |
| （复用）`src/components/skills/GitHubSkillCard.vue` | 不改，直接复用 |

### 1.2 数据模型（与 githubSkills.json 完全一致）

```typescript
// src/data/githubTools.json
interface GitHubToolEntry {
  id: string
  name: string
  description: string
  repo: string              // GitHub owner/repo
  homepage: string
  stars?: number
  category: string
  tags: string[]
  installPrompt: string      // 发给输入框的安装指令
  uninstallPrompt?: string   // 卸载指令
  note?: string
}
```

### 1.3 完整数据

```json
{
  "version": 1,
  "updated": "2026-06-25",
  "tools": [
    {
      "id": "yt-dlp",
      "name": "yt-dlp",
      "description": "从 1800+ 网站下载视频/音频/字幕/元数据（185K ⭐）",
      "repo": "yt-dlp/yt-dlp",
      "homepage": "https://github.com/yt-dlp/yt-dlp",
      "stars": 185000,
      "category": "media",
      "tags": ["视频下载", "音频", "字幕", "网页采集"],
      "installPrompt": "请帮我安装 yt-dlp（https://github.com/yt-dlp/yt-dlp）。从 GitHub Releases 下载最新版二进制：\n- macOS: 下载 yt-dlp_macos，改名为 yt-dlp，chmod +x，xattr -d com.apple.quarantine\n- Windows: 下载 yt-dlp.exe\n放到 ~/.jiucaihezi/tools/yt-dlp/ 目录下。安装完成后运行 yt-dlp --version 验证。",
      "uninstallPrompt": "请帮我卸载 yt-dlp。删除 ~/.jiucaihezi/tools/yt-dlp/ 目录即可。",
      "note": "需要 ffmpeg 才能合并视频和音频。如未安装请先 brew install ffmpeg (macOS)。"
    },
    {
      "id": "pixelle-video",
      "name": "Pixelle-Video",
      "description": "AI 视频生成工作流引擎",
      "repo": "AIDC-AI/Pixelle-Video",
      "homepage": "https://github.com/AIDC-AI/Pixelle-Video",
      "category": "ai",
      "tags": ["AI视频", "生成", "工作流"],
      "installPrompt": "请帮我安装 Pixelle-Video（https://github.com/AIDC-AI/Pixelle-Video）。步骤：\n1. git clone --depth 1 https://github.com/AIDC-AI/Pixelle-Video.git ~/.jiucaihezi/tools/pixelle-video/src/\n2. cd ~/.jiucaihezi/tools/pixelle-video/ && python3 -m venv venv\n3. venv/bin/pip install -r src/requirements.txt\n4. 安装完成后运行 venv/bin/python src/app.py 验证。",
      "uninstallPrompt": "请帮我卸载 Pixelle-Video。删除 ~/.jiucaihezi/tools/pixelle-video/ 目录即可。",
      "note": "需要 Python 3.10+。首次启动可能下载模型文件。"
    },
    {
      "id": "so-novel",
      "name": "so-novel",
      "description": "小说下载与阅读工具",
      "repo": "freeok/so-novel",
      "homepage": "https://github.com/freeok/so-novel",
      "category": "utility",
      "tags": ["小说", "下载", "阅读"],
      "installPrompt": "请帮我安装 so-novel（https://github.com/freeok/so-novel）。git clone --depth 1 到 ~/.jiucaihezi/tools/so-novel/src/，然后按仓库 README 安装依赖。",
      "uninstallPrompt": "请帮我卸载 so-novel。删除 ~/.jiucaihezi/tools/so-novel/ 目录即可。"
    }
  ]
}
```

### 1.4 用户体验

```
工具仓库
  [我的工具]  [GitHub 推荐安装]          ← 新增 Tab

  点击「GitHub 推荐安装」→ 显示 3 个软件卡片
  每张卡片：名称 / 描述 / ⭐ / GitHub 地址 / [安装] [卸载] 按钮

  点击「安装」→ 输入框填入 installPrompt
  用户发送 → OpenCode 下载/编译/配置 → 完成

  点击「卸载」→ 输入框填入 uninstallPrompt
  用户发送 → OpenCode 删除目录 → 完成
```

### 1.5 与 Skill 仓库的差异

| 维度 | Skill 仓库 | 工具仓库 |
|------|-----------|---------|
| 数据文件 | `src/data/githubSkills.json` | `src/data/githubTools.json` |
| 卡片组件 | `GitHubSkillCard.vue`（复用） | 同一个 `GitHubSkillCard.vue` |
| 安装目录 | `~/.agents/skills/` | `~/.jiucaihezi/tools/` |
| 安装后识别 | 文件系统扫描自动发现 | 无自动发现——用户自己知道装没装 |
| 卸载 | 无（Skill 仓库有删除） | ✅ 有卸载按钮 |
| Tab 标签 | 全部 / GitHub 推荐 | 我的工具 / GitHub 推荐安装 |

### 1.6 出口标准

- [ ] 工具仓库出现「我的工具」\|「GitHub 推荐安装」两个 Tab
- [ ] GitHub 推荐安装显示 3 个软件：yt-dlp、Pixelle-Video、so-novel
- [ ] 点击「安装」→ 输入框出现 installPrompt → 用户发送 → 安装成功
- [ ] 点击「卸载」→ 输入框出现 uninstallPrompt → 用户发送 → 卸载成功
- [ ] Web 端展示「桌面端可用」提示
- [ ] vue-tsc + vite build 通过

---

## Phase 2: 后续（本次不做）

- [ ] 从 sindresorhus/awesome 中文版扩展更多软件
- [ ] 清理旧内置工具（`MediaUrlCapturePanel`、`lib.rs` 中 `media_capture_*`、`binaries/yt-dlp-*`）
- [ ] 工具安装状态追踪（已装/未装/版本）

---

## 核心原则（不变）

**APP 只做一件事：让用户发现好工具/Skill，一键填好安装指令到输入框。OpenCode 负责安装和运行。**

| 我们不做 | OpenCode 已经能做 |
|---------|------------------|
| 安装引擎 | `curl -L` / `git clone` / `pip install` / `npm install` |
| 运行时管理 | 文/武模式原生执行 |
| 状态追踪 | 对话中自然知道装没装好 |
| iframe/端口/进程 | 系统浏览器或终端自己跑 |

---

## 文件清单（已完成 + 待完成）

| 状态 | 文件 | 说明 |
|------|------|------|
| ✅ | `src/data/githubSkills.json` | 16 个精选 Skill |
| ✅ | `src/components/skills/GitHubSkillCard.vue` | 推荐卡片组件 |
| ✅ | `src/components/skills/SkillListModeToggle.vue` | 「全部」\|「GitHub 推荐」 |
| ✅ | `src/components/skills/CentralSkillsPanel.vue` | 渲染 GitHub 推荐列表 |
| ⬜ | `src/data/githubTools.json` | 3 个精选软件 |
| ⬜ | `src/components/tools/ToolWarehousePanel.vue` | 加 Tab：「我的工具」\|「GitHub 推荐安装」 |

> **下一步**: 评审 Phase 1 计划 → 写 `githubTools.json` + 改 `ToolWarehousePanel.vue`，~50 行新代码。
