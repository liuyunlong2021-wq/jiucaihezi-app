# 工具即 Prompt — 极简工具发现与安装 SDD

> **状态**: v3 — 极简化重写
> **分支**: `gongju`
> **日期**: 2026-06-25
> **核心洞察**: OpenCode 已经是全电脑最强的安装引擎和运行时。APP 不需要再做一层工具容器。

---

## 0. 一句话总结

**APP 只需要做一件事：让用户发现好工具，然后交给 OpenCode 去安装和运行。**

用户看到工具 → 点「安装」 → OpenCode 输入框自动生成一句话 → 用户发送 → OpenCode 搞定一切。就这么简单。

---

## 1. 为什么之前的方案太重

之前想的是：APP 管理工具生命周期 → 安装引擎 → 运行时 → 状态机 → iframe 嵌入 → 端口管理 → 进程控制...

但冷静下来看，这些东西 OpenCode 全能做，而且做得更好：

| 我们想做的 | OpenCode 已经能做 |
|-----------|------------------|
| 下载 GitHub Release 二进制 | `curl -L {url} -o {path}` |
| 校验 SHA256 | `shasum -a 256 {file}` |
| git clone | `git clone {repo}` |
| 创建 venv | `python3 -m venv venv` |
| pip/npm install | `pip install` / `npm install` |
| 运行命令 | 文/武模式原生执行 |
| 管理进程 | 原生进程控制 |
| 多工具协调 | 同一个 OpenCode session 里串行/并行 |

**结论：APP 不需要做一个"工具容器"。APP 只需要做一个"工具目录"——把好工具的链接和一句安装 prompt 准备好，剩下的全交给 OpenCode。**

---

## 2. 核心设计

### 2.1 用户路径

```
用户在工具栏看到「GitHub 工具精选」
  ↓
浏览排行榜 / 分类 / 搜索
  ↓
看到 yt-dlp：⭐ 185K | 网页媒体采集 | 1800+ 网站
  ↓
点「安装」
  ↓
OpenCode 输入框自动填入：
  "请帮我安装 yt-dlp（https://github.com/yt-dlp/yt-dlp）。
   从 GitHub Releases 下载最新版二进制到 ~/.jiucaihezi/tools/yt-dlp/，
   校验 SHA256，macOS 执行 xattr -d com.apple.quarantine 解除隔离。"
  ↓
用户点发送 → OpenCode 自动完成安装
  ↓
安装完后，用户可以：
  - 在终端直接用 yt-dlp
  - 继续跟 OpenCode 说「用 yt-dlp 下载 xxx」
  - OpenCode 自动协调 yt-dlp + 其他工具做复杂任务
```

### 2.2 一句话架构

```
┌─────────────────────────────────────────────┐
│              工具发现层（APP 唯一新增）        │
│                                             │
│  public/tools/registry.json  ← 精选工具清单   │
│  ToolWarehousePanel.vue      ← 排行榜 UI     │
│  每个工具：名称 / 描述 / ⭐ / 分类 / 安装提示词 │
│                                             │
│  用户点「安装」 → 往 OpenCode 输入框填 prompt   │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│            OpenCode（已有的，不改）           │
│                                             │
│  接收 prompt → 下载/编译/配置 → 完成          │
│  后续：运行工具 / 协调多工具 / 项目集成        │
└─────────────────────────────────────────────┘
```

### 2.3 不做什么

- ❌ 不做安装引擎（OpenCode 自己做）
- ❌ 不做运行时管理（OpenCode / 终端自己做）
- ❌ 不做 iframe 嵌入（工具在系统浏览器或终端用）
- ❌ 不做状态机（工具装没装好，OpenCode 会话里自然知道）
- ❌ 不做端口管理、进程控制、日志系统
- ❌ 不做 tool.yaml schema（一个 prompt 字符串就够了）

---

## 3. 工具注册表

### 3.1 数据模型

```typescript
// public/tools/registry.json
interface ToolEntry {
  id: string                    // 唯一标识
  name: string                  // 显示名称
  description: string           // 一句话描述
  repo: string                  // GitHub owner/repo
  homepage: string              // GitHub URL
  stars?: number                // GitHub Stars（可定期更新）
  category: string              // media | dev | ai | document | utility
  tags: string[]
  installPrompt: string         // ★ 核心：发给 OpenCode 的安装指令
  note?: string                 // 额外提示（依赖要求、已知问题等）
}
```

### 3.2 完整示例

```json
{
  "version": 1,
  "updated": "2026-06-25",
  "tools": [
    {
      "id": "yt-dlp",
      "name": "yt-dlp",
      "description": "从 1800+ 网站下载视频/音频/字幕/元数据",
      "repo": "yt-dlp/yt-dlp",
      "homepage": "https://github.com/yt-dlp/yt-dlp",
      "stars": 185000,
      "category": "media",
      "tags": ["视频下载", "音频", "字幕", "网页采集"],
      "installPrompt": "请帮我安装 yt-dlp（https://github.com/yt-dlp/yt-dlp）。从 GitHub Releases 下载最新版二进制：\n- macOS: 下载 yt-dlp_macos，改名为 yt-dlp，chmod +x，xattr -d com.apple.quarantine\n- Windows: 下载 yt-dlp.exe\n放到 ~/.jiucaihezi/tools/yt-dlp/ 目录下。安装完成后运行 yt-dlp --version 验证。",
      "note": "需要 ffmpeg 才能合并视频和音频。如未安装请先 brew install ffmpeg (macOS)。"
    },
    {
      "id": "pixelle-video",
      "name": "Pixelle-Video",
      "description": "AI 视频生成工作流引擎",
      "repo": "AIDC-AI/Pixelle-Video",
      "homepage": "https://github.com/AIDC-AI/Pixelle-Video",
      "stars": null,
      "category": "ai",
      "tags": ["AI视频", "生成", "工作流"],
      "installPrompt": "请帮我安装 Pixelle-Video（https://github.com/AIDC-AI/Pixelle-Video）。步骤：\n1. git clone --depth 1 https://github.com/AIDC-AI/Pixelle-Video.git ~/.jiucaihezi/tools/pixelle-video/src/\n2. cd ~/.jiucaihezi/tools/pixelle-video/ && python3 -m venv venv\n3. venv/bin/pip install -r src/requirements.txt\n4. 安装完成后运行 venv/bin/python src/app.py 验证。",
      "note": "需要 Python 3.10+。首次启动可能下载模型文件。"
    },
    {
      "id": "gallery-dl",
      "name": "gallery-dl",
      "description": "从 Pixiv/Twitter/Instagram 等图库批量下载",
      "repo": "mikf/gallery-dl",
      "homepage": "https://github.com/mikf/gallery-dl",
      "stars": 15000,
      "category": "media",
      "tags": ["图库下载", "Pixiv", "Twitter", "批量"],
      "installPrompt": "请帮我安装 gallery-dl（https://github.com/mikf/gallery-dl）。用 pip 安装到用户目录：pip3 install --user gallery-dl。安装完成后运行 gallery-dl --version 验证。",
      "note": "需要 Python 3.8+。可通过 gallery-dl --config 配置 cookies。"
    }
  ]
}
```

### 3.3 installPrompt 编写规范

- 明确写出下载 URL、目标路径
- 区分 macOS / Windows 命令
- 包含安装后的验证命令（`--version`）
- 如有系统依赖（ffmpeg/python），在 `note` 字段提示
- 不假设用户机器上有 Homebrew/pip/npm——如果缺依赖，让 OpenCode 自己去检测和安装

---

## 4. UI 设计

### 4.1 工具排行榜

```
┌──────────────────────────────────────────────┐
│  🔧 GitHub 工具精选              搜索 ██     │
│  全部 │ 媒体 │ AI │ 开发 │ 文档 │ 工具        │
├──────────────────────────────────────────────┤
│                                              │
│  #1  ⭐ yt-dlp                    185K ⭐    │
│      从 1800+ 网站下载视频/音频/字幕          │
│      yt-dlp/yt-dlp                           │
│      [安装] [GitHub]                         │
│                                              │
│  #2  ⭐ ffmpeg                    45K ⭐     │
│      音视频处理瑞士军刀                        │
│      FFmpeg/FFmpeg                            │
│      [安装] [GitHub]                         │
│                                              │
│  #3     Pixelle-Video                -      │
│      AI 视频生成工作流引擎                     │
│      AIDC-AI/Pixelle-Video                    │
│      [安装] [GitHub]                         │
│                                              │
│  #4  ⭐ gallery-dl                15K ⭐     │
│      图库批量下载（Pixiv/Twitter/...）         │
│      mikf/gallery-dl                          │
│      [安装] [GitHub]                         │
│                                              │
│  ...                                         │
└──────────────────────────────────────────────┘
```

### 4.2 点击「安装」后的行为

```
┌──────────────────────────────────────────────┐
│  🔧 GitHub 工具精选                          │
├──────────────────────────────────────────────┤
│                                              │
│  #1  ⭐ yt-dlp                    185K ⭐    │
│      从 1800+ 网站下载视频/音频/字幕          │
│                                              │
│  ┌─ 安装指令已生成 ──────────────────────┐  │
│  │                                       │  │
│  │  请帮我安装 yt-dlp（https://github.    │  │
│  │  com/yt-dlp/yt-dlp）。从 GitHub       │  │
│  │  Releases 下载最新版二进制...           │  │
│  │                                       │  │
│  │  [复制指令]  [发送到 OpenCode →]       │  │
│  └───────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

点击「发送到 OpenCode」→ 填入 ChatPanel 输入框 → 用户确认发送 → OpenCode 开始安装。

### 4.3 星空标和排序

- 排序方式：默认按 GitHub Stars 降序（排行榜）
- 可切换按分类筛选、按名称搜索
- `stars` 字段可定期通过 GitHub API 批量更新（非实时）
- 没有 `stars` 数据的工具排在有数据之后

---

## 5. 与 OpenCode 的集成

### 5.1 往 OpenCode 输入框填文本

这是唯一需要的"集成"。不需要新增 Tauri command、不需要新增 IPC 通道。

```typescript
// 工具卡片点击「发送到 OpenCode」
function sendToOpenCode(installPrompt: string) {
  // 通过现有机制往 ChatPanel 输入框填文本
  // 可以用 eventBus.emit('chat:setInput', installPrompt)
  // 或者用 chatStore 的 setInput 方法
}
```

具体接入点看现有 `ChatPanel.vue` 的输入框绑定方式，可能是一个 `ref` 或 `store.inputText`。

### 5.2 OpenCode 之后的事

安装完成后的工具使用，完全在 OpenCode 的自然对话中进行：

```
用户: "用 yt-dlp 下载 https://www.youtube.com/watch?v=xxx 到 ~/Movies/"
OpenCode: [执行 yt-dlp 命令] → 下载完成

用户: "把刚才下载的视频用 ffmpeg 转成 MP3"
OpenCode: [执行 ffmpeg 命令] → 转换完成

用户: "用 Pixelle-Video 生成一个 10 秒的 AI 视频，主题是赛博朋克"
OpenCode: [启动 Pixelle → 调 API → 生成视频] → 完成
```

**这就是我们想要的能力——OpenCode 协调多个工具完成复杂任务。APP 不需要在中间再做一层抽象。**

---

## 6. 双端差异

```
桌面端 (Tauri + OpenCode):
  - 完整工具排行榜
  - 点击「安装」→ 填 OpenCode 输入框 → 安装
  - 安装后 OpenCode 可以直接用工具

Web 端 (Cloudflare):
  - 展示工具排行榜（只读）
  - 每个工具显示「桌面端可用」提示
  - 点击「查看详情」→ 跳转 GitHub
  - 不展示安装按钮（Web 端没有 OpenCode）
```

Web 端和桌面端共用同一份 `registry.json` 和同一套排行 UI 组件，只差在「安装」按钮的行为。

---

## 7. 迁移计划

### 原则

> 不删旧代码，先上新 UI。旧工具面板（`ToolWarehousePanel` 的静态卡片）保留不变，
> 在旁边加一个新 Tab「GitHub 工具」放排行榜。用户自然切换过去后再考虑清理。

### Phase 1: 排行榜上线（1-2 天）

- [ ] 创建 `public/tools/registry.json`，首期录入 5-10 个精选工具
- [ ] 新建 `src/components/tools/GitHubToolRanking.vue`（排行榜 UI）
- [ ] 在 `ToolWarehousePanel.vue` 加 Tab：「我的工具」|「GitHub 工具」
- [ ] 实现「安装」按钮 → 填 OpenCode 输入框
- [ ] Web 端展示「桌面端可用」提示

**出口标准**：
- [ ] 排行榜显示 5-10 个工具，按 Stars 排序
- [ ] 点击「安装」→ OpenCode 输入框出现 installPrompt
- [ ] 用户发送 → OpenCode 实际完成安装（找一个工具实测）
- [ ] Web 端正确展示「桌面端可用」
- [ ] vue-tsc + vite build 通过

### Phase 2: 工具扩展（持续）

- [ ] 补充到 20-30 个精选工具
- [ ] 加搜索和分类筛选
- [ ] 定期通过 GitHub API 更新 Stars 数据（脚本，非实时）

### Phase 3: 旧工具清理（Phase 1 验证稳定后）

- [ ] 评估哪些旧内置工具已被 GitHub 工具替代
- [ ] 逐个将旧工具从 `localContentTools.ts` 等文件移除
- [ ] 删除 `src-tauri/binaries/yt-dlp-*`
- [ ] 删除 `MediaUrlCapturePanel.vue`
- [ ] 清理 `lib.rs` 中 `media_capture_*` 命令

---

## 8. 首批精选工具清单

| # | 工具 | GitHub | Stars | 分类 | 为什么选它 |
|---|------|--------|-------|------|-----------|
| 1 | yt-dlp | yt-dlp/yt-dlp | ~185K | 媒体 | 最强视频下载器，替换内置残缺版 |
| 2 | ffmpeg | FFmpeg/FFmpeg | ~45K | 媒体 | 音视频瑞士军刀，几乎所有媒体工具依赖它 |
| 3 | gallery-dl | mikf/gallery-dl | ~15K | 媒体 | 图库批量下载，补 yt-dlp 不擅长的场景 |
| 4 | Pixelle-Video | AIDC-AI/Pixelle-Video | — | AI | AI 视频生成工作流，替换旧内置碎片 |
| 5 | Whisper | openai/whisper | ~70K | AI | 语音转文字，替代内置残缺版 |
| 6 | ImageMagick | ImageMagick/ImageMagick | ~12K | 媒体 | 图片处理，配合 ffmpeg 覆盖全媒体 |
| 7 | ripgrep | BurntSushi/ripgrep | ~48K | 开发 | 代码搜索，比 grep 快 10 倍 |
| 8 | fd | sharkdp/fd | ~34K | 开发 | 文件查找，比 find 好用 |
| 9 | bat | sharkdp/bat | ~50K | 开发 | 带高亮的 cat，代码查看利器 |
| 10 | jq | jqlang/jq | ~30K | 开发 | JSON 处理，API 调试必备 |

---

## 9. 安全与信任模型

因为安装是由 OpenCode 执行的（用户可以看到完整 prompt 并确认后才发送），安全模型天然比"APP 静默执行"强：

1. **用户可见**：installPrompt 全文展示在输入框，用户可以看到要执行的每一条命令
2. **用户确认**：用户必须手动点发送，APP 不自动执行
3. **OpenCode 沙箱**：OpenCode 的权限系统（approval/deny）自然适用
4. **工具来源**：`registry.json` 由人工维护，只收录已知的、活跃维护的 GitHub 仓库
5. **安装目录**：prompt 中指定 `~/.jiucaihezi/tools/{id}/`，不污染系统

**不需要**：二进制签名校验、symlink 防护、端口白名单——这些要么 OpenCode 已有的权限模型覆盖了，要么根本不适用（因为安装行为是用户确认后由 OpenCode 执行的）。

---

## 10. 文件清单

### 新增

| 文件 | 说明 |
|------|------|
| `public/tools/registry.json` | 精选工具清单（~100 行） |
| `src/components/tools/GitHubToolRanking.vue` | 排行榜 UI（~200 行） |

### 修改

| 文件 | 改动 |
|------|------|
| `src/components/tools/ToolWarehousePanel.vue` | 加 Tab：「我的工具」\|「GitHub 工具」 |
| 无其他 | — |

### 后续清理（Phase 3）

| 文件 | 原因 |
|------|------|
| `src-tauri/binaries/yt-dlp-*` | 不再内置二进制 |
| `src/components/tools/MediaUrlCapturePanel.vue` | 替换为 yt-dlp + OpenCode |
| `lib.rs` 中 `media_capture_*` 段 | 不再需要 |

---

> **下一步**: 确认方向 → 写 `registry.json` + `GitHubToolRanking.vue`，总共不到 400 行新代码。


