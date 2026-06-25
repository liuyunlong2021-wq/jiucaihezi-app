# 工具插槽架构 SDD

> **状态**: 草稿，待评审
> **分支**: `gongju`
> **日期**: 2026-06-25
> **作者**: 韭菜盒子 Studio
> **目标**: 将 APP 从"内置工具"转型为"工具插槽平台"

---

## 0. 一句话总结

**不做工具的制造者，做工具的插槽。** 韭菜盒子不再是内置 yt-dlp/ffmpeg/Whisper 的"全家桶"，而是用户一键安装、使用 GitHub 原版工具的"启动器"。

---

## 1. 背景：当前工具系统的问题

### 1.1 问题清单

| 问题 | 症状 | 根因 |
|------|------|------|
| **半残工具** | 网页媒体采集只能下载不能播放列表、不能 cookies、不能格式选择 | yt-dlp 二进制锁死在 `src-tauri/binaries/`，版本滞后，功能是上游的 30% |
| **依赖黑洞** | ffmpeg/whisper 在用户机器上找不到 → 静默失败 | APP 假设用户已装依赖，但从不检查也不引导安装 |
| **维护噩梦** | 上游更新了，APP 里的"山寨版"永远停在旧版本 | 工具代码写死在 `localContentTools.ts` 等文件，不是引用上游 |
| **职责混乱** | 40 个 LLM 工具 + 3 个 UI 面板 + 15 个 Rust 命令，互不统一 | 三层工具各自为政，没有统一注册/安装/运行机制 |
| **用户不可控** | 用户不知道 APP 里跑的是什么版本、有没有装好、能不能升级 | 工具对用户是不可见的"黑盒"，出问题无从排查 |
| **Pixelle 残留** | `/Users/by3/Documents/Pixelle-Video` 拆解产生的内置代码散落各处 | 早期把外部项目代码嵌入 APP，现在不知道哪些还能删 |

### 1.2 核心矛盾

```
内置工具的悖论：
  APP 越大越全 → 依赖越多 → 越容易坏 → 用户越不信任
  APP 越精简 → 功能越少 → 用户越不需要
```

**解法不是"做得更全"，而是"做得更薄"。** 把 APP 从工具的"实现者"变成工具的"搬运工"。

---

## 2. 设计目标

### 2.1 北极星

> 用户在韭菜盒子里发现一个 GitHub 工具 → 点安装 → 10 秒后直接在 APP 里使用**原版工具的全部功能**。

### 2.2 设计原则

1. **原版优先** — APP 绝不 fork/修改/阉割工具。跑的就是 GitHub 原版。
2. **一键安装** — 用户点一个按钮，APP 处理所有依赖、下载、配置。
3. **原生界面** — 工具有 Web UI 就嵌入 iframe；纯 CLI 就做终端面板；桌面 GUI 就独立窗口。
4. **版本透明** — 用户能看到装了哪个版本、上游最新是什么、一键升级。
5. **隔离运行** — 每个工具独立目录、独立 venv/node_modules、互不污染。
6. **GitHub 原生** — 99.9% 工具来自 GitHub，适配器利用 GitHub API 自动发现版本/平台/依赖。

### 2.3 非目标（明确不做）

- ❌ 不做通用包管理器（不替代 Homebrew/pip/npm）
- ❌ 不做工具市场/审核系统（初期只做人工精选列表）
- ❌ 不做 Docker/容器化运行（初期直接本地进程，后续可加）
- ❌ 不做工具的"AI 包装"（工具是工具，LLM 是 LLM，不混在一起）
- ❌ 不修改上游工具的源码（patch/fork 是死路）

---

## 3. 架构设计

### 3.1 三层架构

```
┌─────────────────────────────────────────────────────────┐
│                    工具仓库 UI 层                         │
│  ToolWarehousePanel.vue                                  │
│  ├── 工具目录（可浏览/搜索/筛选）                          │
│  ├── 工具卡片（安装/启动/卸载/升级）                       │
│  └── 工具界面容器（iframe / 终端 / 独立窗口）              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                    工具管理层                             │
│  toolRegistry.ts  ───  精选工具清单（人工维护）            │
│  toolManifest.ts  ───  适配器 schema + 解析/校验          │
│  toolInstaller.ts  ──  安装引擎（download/clone/venv）    │
│  toolRuntime.ts   ───  运行时管理（启动/停止/健康检查）     │
│  toolStore.ts     ───  Pinia 状态（已装/版本/运行状态）    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                    工具文件层                             │
│  ~/.jiucaihezi/tools/                                    │
│  ├── registry.json          # 已安装工具索引              │
│  ├── yt-dlp/                                               │
│  │   ├── tool.yaml           # 适配器清单                 │
│  │   ├── yt-dlp              # 二进制（macOS）             │
│  │   └── version.txt         # 当前版本                   │
│  ├── pixelle-video/                                        │
│  │   ├── tool.yaml                                        │
│  │   ├── venv/               # Python 虚拟环境             │
│  │   ├── src/                # git clone 源码              │
│  │   └── version.txt                                      │
│  └── image-reverse-search/                                 │
│      ├── tool.yaml                                        │
│      ├── node_modules/       # npm 依赖                   │
│      ├── src/                                             │
│      └── version.txt                                      │
└─────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户浏览工具目录
  ↓
点击「安装」
  ↓
toolInstaller.install(toolId)
  ├── 读取 tool.yaml → 确定安装方法
  ├── github-release 方法:
  │   ├── GET https://api.github.com/repos/{owner}/{repo}/releases/latest
  │   ├── 匹配平台 → 下载 binary
  │   ├── 校验 SHA256
  │   └── 写入 ~/.jiucaihezi/tools/{toolId}/
  ├── git-clone+venv 方法:
  │   ├── git clone {repo} → ~/.jiucaihezi/tools/{toolId}/src/
  │   ├── python3 -m venv venv
  │   ├── venv/bin/pip install -r requirements.txt
  │   └── 写入 tool.yaml + version.txt
  └── 安装完成 → 更新 toolStore → 卡片变为「已安装」
  ↓
用户点击「启动」
  ↓
toolRuntime.launch(toolId)
  ├── 读取 tool.yaml → 确定启动方式
  ├── webview 模式:
  │   ├── 启动子进程 → 工具在 localhost:{port} 启动 Web 服务
  │   ├── 健康检查 → GET http://localhost:{port}/ (最多等 10s)
  │   └── 打开 iframe → 嵌入工具 Web UI
  ├── terminal 模式:
  │   ├── 打开终端面板 → 显示工具的 CLI 输出
  │   └── 用户可在终端中输入命令
  └── 运行中 → 更新 toolStore → 卡片显示「运行中 ●」
```

---

## 4. 工具适配器规范 (tool.yaml)

这是整个系统的核心抽象。一个工具只需要一个 `tool.yaml` 文件。

### 4.1 Schema

```yaml
# tool.yaml — 工具适配器清单（唯一事实源）
# 位置: ~/.jiucaihezi/tools/{toolId}/tool.yaml

id: yt-dlp                           # 唯一标识，与目录名一致
name: 网页媒体采集                     # 用户可见名称
icon: download                        # JcIcon 图标名
description: 从 1800+ 网站下载视频/音频/字幕/元数据
repo: yt-dlp/yt-dlp                   # GitHub owner/repo
homepage: https://github.com/yt-dlp/yt-dlp
license: Unlicense
category: media                       # media | dev | document | image | audio | video | utility
tags: [视频下载, 音频, 字幕, 网页采集]

# ── 安装配置 ──
install:
  method: github-release              # github-release | git-clone+venv | git-clone+npm | git-clone+cargo
  # github-release 配置
  release:
    repo: yt-dlp/yt-dlp
    tag: latest                       # latest | v2025.01.01 | 固定版本
    platforms:
      darwin-arm64:
        pattern: yt-dlp_macos         # Release asset 文件名匹配（支持 glob）
        binary: yt-dlp                # 安装后的二进制名
      darwin-x64:
        pattern: yt-dlp_macos
        binary: yt-dlp
      windows-x64:
        pattern: yt-dlp.exe
        binary: yt-dlp.exe
    checksum: auto                    # auto = 自动找 .sha256 文件 | 固定值 | skip

# ── 启动配置 ──
launch:
  mode: webview                       # webview | terminal | external-window
  # webview 模式
  webview:
    command: ./yt-dlp                 # 启动命令（相对于工具目录）
    args: [--help]                    # 默认参数（初始不传，用户操作后拼接）
    healthCheck:
      url: http://localhost:7860/     # yt-dlp 本身没有 Web UI，但可配合 yt-dlp-web
      timeout: 10000                  # 毫秒
      interval: 500
    port: 7860
  # terminal 模式（CLI 工具）
  terminal:
    command: ./yt-dlp
    shell: zsh                        # 可选，默认系统 shell
    env: {}                           # 环境变量

# ── 依赖声明（可选，用于安装前检查） ──
requires:
  - name: python3
    version: ">=3.9"
    check: python3 --version
  - name: ffmpeg
    optional: true                    # 可选依赖，没有也能跑但功能受限
    check: ffmpeg -version

# ── 卸载配置 ──
uninstall:
  method: remove-dir                  # remove-dir | pip-uninstall | npm-uninstall
  cleanPaths: []                      # 额外清理路径
```

### 4.2 安装方法详解

#### github-release — 下载 Release 二进制

适用：Go/Rust 编译的 CLI 工具（yt-dlp、ffmpeg、ripgrep、fd 等）

流程：
1. `GET /repos/{owner}/{repo}/releases/latest` (或指定 tag)
2. 从 `assets[]` 中按 `platforms.{os-arch}.pattern` 匹配文件名
3. 下载 → 校验 SHA256 → 设置可执行权限 → 写入工具目录

优点：不需要编译环境，下载即用。
缺点：依赖上游提供预编译二进制。

#### git-clone+venv — 源码安装 Python 工具

适用：Python 工具（Pixelle-Video、yt-dlp-web、gradio 应用等）

流程：
1. `git clone {repo}` → `src/`
2. `python3 -m venv venv`
3. `venv/bin/pip install -r src/requirements.txt`
4. 记录 commit hash 为 `version.txt`

优点：完整源码，可本地修改。
缺点：需要 Python 环境，安装较慢。

#### git-clone+npm — 源码安装 Node.js 工具

适用：Node.js 工具

流程：
1. `git clone {repo}` → `src/`
2. `npm install` (在 src/ 内，无全局污染)
3. 记录 commit hash

#### git-clone+cargo — 源码编译 Rust 工具

适用：Rust CLI 工具（备选，优先用 github-release）

流程：
1. `git clone {repo}` → `src/`
2. `cargo build --release`
3. 记录 commit hash

### 4.3 启动模式详解

#### webview — 嵌入 iframe

工具有自己的 Web UI（通常 localhost 某端口），APP 用 iframe 嵌入。

流程：
1. 启动子进程（`spawn(command, args)`）
2. 轮询 `healthCheck.url` 直到 200
3. 在 ToolWarehousePanel 中嵌入 `<iframe src="http://localhost:{port}">`
4. 用户关闭工具卡片 → kill 子进程

适合：Gradio/Flask/FastAPI/Express 等自带 Web 服务的工具。

#### terminal — 终端面板

工具是纯 CLI，APP 提供终端面板让用户交互。

流程：
1. 打开终端面板（xterm.js 或 Tauri shell）
2. 预填工具的命令名和常用参数
3. 用户输入参数 → 回车执行 → 显示输出

适合：yt-dlp、ffmpeg 等纯 CLI 工具。

#### external-window — 独立窗口

工具是完整桌面应用，APP 只负责启动。

流程：
1. `open` (macOS) / `start` (Windows) 启动工具
2. APP 不管理生命周期

适合：已有完整 GUI 的工具。

---

## 5. 工具目录（精选列表）

初期人工维护一个 JSON 文件，后续可做 GitHub API 自动发现。

### 5.1 首批精选工具

| 工具 | GitHub | 安装方法 | 启动模式 | 替换现有 |
|------|--------|----------|----------|----------|
| **yt-dlp** | yt-dlp/yt-dlp | github-release | terminal | `MediaUrlCapturePanel` + `lib.rs` yt-dlp 段 |
| **Pixelle-Video** | AIDC-AI/Pixelle-Video | git-clone+venv | webview | `/Users/by3/Documents/Pixelle-Video` 残留 |
| **ffmpeg** | 不适用（走 Homebrew 检测） | system-check | terminal | `localContentTools.ts` 媒体处理 |
| **Whisper** | openai/whisper | git-clone+venv | terminal | `localContentTools.ts` 转写工具 |
| **gallery-dl** | mikf/gallery-dl | git-clone+venv | terminal | 新增 |

### 5.2 注册表格式 (registry.json)

```json
{
  "version": 1,
  "tools": [
    {
      "id": "yt-dlp",
      "repo": "yt-dlp/yt-dlp",
      "category": "media",
      "featured": true,
      "minAppVersion": "1.0.16"
    }
  ]
}
```

`tool.yaml` 的详细字段从 GitHub 仓库根目录读取（APP 在安装前 fetch `tool.yaml` 展示详情）。

---

## 6. 安装引擎设计

### 6.1 核心模块

```
src/utils/toolInstaller.ts
  ├── installTool(toolId, manifest)
  │   ├── method === 'github-release' → downloadReleaseBinary()
  │   ├── method === 'git-clone+venv' → cloneAndSetupPython()
  │   ├── method === 'git-clone+npm'  → cloneAndSetupNode()
  │   └── method === 'git-clone+cargo' → cloneAndBuildRust()
  ├── uninstallTool(toolId)
  ├── checkToolStatus(toolId) → { installed, version, running, port }
  └── updateTool(toolId) → 重新安装最新版
```

### 6.2 Tauri 命令封装

需要新增 Rust 命令：

```rust
// src-tauri/src/lib.rs 新增
#[tauri::command]
async fn tool_install(manifest_path: String) -> Result<ToolInstallResult, String>

#[tauri::command]
async fn tool_uninstall(tool_id: String) -> Result<(), String>

#[tauri::command]
async fn tool_launch(tool_id: String) -> Result<ToolLaunchResult, String>

#[tauri::command]
async fn tool_stop(tool_id: String) -> Result<(), String>

#[tauri::command]
async fn tool_status(tool_id: String) -> Result<ToolStatus, String>
```

### 6.3 安全边界

- 工具安装目录限制在 `~/.jiucaihezi/tools/`，禁止路径穿越
- 子进程以工具目录为 cwd，禁止访问用户项目文件（除非用户显式授权）
- 下载的二进制必须校验 SHA256（`auto` 模式自动从 GitHub Release 获取）
- iframe 嵌入限制 `sandbox="allow-scripts allow-same-origin"`，不允许顶层导航

---

## 7. UI 改造

### 7.1 工具仓库面板 (ToolWarehousePanel.vue)

当前状态：15 张静态卡片，无安装/运行概念。

改造后：

```
┌────────────────────────────────────────────┐
│  工具仓库                🔍 搜索  │ 筛选 ▼ │
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────────┐  ┌──────────────┐      │
│  │ yt-dlp       │  │ Pixelle-Video│      │
│  │ 网页媒体采集   │  │ AI 视频生成   │      │
│  │ v2025.06.25  │  │ ⬇ 未安装     │      │
│  │ ✅ 已安装     │  │              │      │
│  │ [启动] [卸载] │  │ [安装]       │      │
│  └──────────────┘  └──────────────┘      │
│                                            │
│  ┌──────────────┐  ┌──────────────┐      │
│  │ ffmpeg       │  │ gallery-dl   │      │
│  │ 媒体处理      │  │ 图库下载      │      │
│  │ ⚠ 未检测到   │  │ ⬇ 未安装     │      │
│  │ [如何安装]    │  │ [安装]       │      │
│  └──────────────┘  └──────────────┘      │
└────────────────────────────────────────────┘
```

### 7.2 工具运行面板

当用户启动一个 webview 模式工具：

```
┌────────────────────────────────────────────┐
│  ◀ 返回工具仓库    yt-dlp Web UI  ● 运行中  │
├────────────────────────────────────────────┤
│                                            │
│  ┌────────────────────────────────────┐   │
│  │                                    │   │
│  │   <iframe src="localhost:7860">    │   │
│  │   工具的原始 Web UI 完整呈现        │   │
│  │                                    │   │
│  └────────────────────────────────────┘   │
│                                            │
│  [停止] [重启] [在浏览器打开]               │
└────────────────────────────────────────────┘
```

### 7.3 已安装 vs 未安装 卡片状态

| 状态 | 卡片显示 | 可用操作 |
|------|---------|---------|
| 未安装 | 灰色图标 + ⬇ 安装按钮 | 安装 |
| 安装中 | 进度条 + 取消按钮 | 取消 |
| 已安装 | 版本号 + 启动按钮 | 启动、卸载、升级 |
| 运行中 | 绿色指示灯 ● + 当前端口 | 打开、停止、重启 |
| 需依赖 | ⚠ 黄色警告 + 安装依赖按钮 | 安装依赖 |
| 安装失败 | ❌ 红色错误信息 + 重试按钮 | 重试、查看日志 |

---

## 8. 迁移计划

### Phase 1: 基建（gongju 分支）

- [ ] 定义 `tool.yaml` schema（最终版）
- [ ] 实现 `toolInstaller.ts`（github-release 方法）
- [ ] 实现 `toolRuntime.ts`（webview + terminal 模式）
- [ ] 实现 `toolStore.ts`（Pinia）
- [ ] 改造 `ToolWarehousePanel.vue`（安装/启动/卸载 三态卡片）
- [ ] 新增 Tauri commands：`tool_install`, `tool_uninstall`, `tool_launch`, `tool_stop`, `tool_status`

### Phase 2: 首批迁移（yt-dlp）

- [ ] 为 yt-dlp 编写 `tool.yaml`
- [ ] 删除 `src-tauri/binaries/yt-dlp-*`（不再内置二进制）
- [ ] 删除 `MediaUrlCapturePanel.vue` 中的 yt-dlp 硬编码调用
- [ ] 删除 `lib.rs` 中 `media_capture_*` 相关 Rust 命令
- [ ] 验证：安装 yt-dlp → 启动终端面板 → 下载一个视频

### Phase 3: Pixelle-Video

- [ ] 清理 `/Users/by3/Documents/Pixelle-Video` 残留引用
- [ ] 为 Pixelle-Video 编写 `tool.yaml`（git-clone+venv 方法）
- [ ] 验证：安装 Pixelle → 启动 webview → 使用原版界面

### Phase 4: 其他工具

- [ ] ffmpeg → 改为 system-check（检测系统是否已装，未装提示 Homebrew）
- [ ] Whisper → git-clone+venv
- [ ] 清理 `localContentTools.ts` 中已被替代的工具定义
- [ ] 清理 `browserTools.ts` 中不再需要的工具
- [ ] 清理 `devProjectTools.ts` 中不再需要的工具

### Phase 5: 工具目录

- [ ] 精选 10-15 个 GitHub 工具加入 `registry.json`
- [ ] 搜索/筛选/分类 UI
- [ ] 一键升级所有已装工具

---

## 9. 风险与边界

### 9.1 风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 上游 Release 格式变动 | 中 | 安装失败 | `tool.yaml` 支持 `tag: latest` 和 `tag: vX.X.X` 双模式，安装前校验 asset 存在 |
| Python 环境问题 | 高 | venv 创建失败 | 安装前 `python3 --version` 检查，失败时引导用户安装 Python |
| iframe 跨域/安全 | 中 | Web UI 不能正常显示 | CSP 需要动态放行 `localhost:{port}`，sandbox 属性限制权限 |
| 工具进程泄漏 | 中 | 端口占用/资源浪费 | toolRuntime 维护子进程 PID 表，APP 退出时 kill 所有 |
| GitHub API 限流 | 低 | 安装超时 | 安装器加 3 次重试 + 指数退避 |

### 9.2 边界（不做的事）

- **不做通用包管理器**：不替代 Homebrew/pip/npm。`git-clone+venv` 模式不需要系统级安装。
- **不做自动更新**：初期用户手动点「升级」。后期可加自动检查更新提示。
- **不做 Docker**：初期直接本地进程。Docker 是好的隔离方案但增加用户门槛。
- **不做工具市场**：初期人工精选 10-15 个工具。不做用户提交/审核/评价系统。
- **不做工具的"AI 改写"**：LLM 可以调用已安装的工具（通过 function calling），但工具本身的功能不受 AI 控制。工具是工具，AI 是 AI。

### 9.3 与 LLM 工具的关系

当前系统有两类"工具"：

| 类型 | 例 | 本次改动 |
|------|-----|----------|
| **用户工具**（用户直接操作） | yt-dlp、Pixelle、ffmpeg | ✅ 全部改为插槽模式 |
| **LLM 工具**（AI function calling） | `dev_read_file`、`browser_search`、`create_document` | 🟡 暂不改动，保留现有 |

LLM 工具是轻量的 API 封装，不涉及外部依赖，直接运行在 APP 进程内。它们和"用户工具插槽"是互补关系：用户工具提供重能力，LLM 工具提供轻操作。

未来：如果某个 LLM 工具对应的用户工具已安装（如 yt-dlp），LLM 可以自动发现并调用已装工具，而不是用内置的简化版。

---

## 10. 文件清单（本次改动涉及）

### 新增文件

| 文件 | 说明 |
|------|------|
| `docs/sdd/tool-slot-architecture.md` | 本文档 |
| `src/utils/toolManifest.ts` | tool.yaml 解析/校验 |
| `src/utils/toolInstaller.ts` | 安装引擎（github-release/git-clone+venv） |
| `src/utils/toolRuntime.ts` | 运行时管理（启动/停止/健康检查） |
| `src/stores/toolStore.ts` | Pinia 状态管理 |
| `src/components/tools/ToolRunPanel.vue` | 工具运行面板（iframe + 终端） |
| `public/tools/registry.json` | 精选工具目录 |
| `public/tools/yt-dlp/tool.yaml` | yt-dlp 适配器 |
| `public/tools/pixelle-video/tool.yaml` | Pixelle-Video 适配器 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/components/tools/ToolWarehousePanel.vue` | 重构为安装/启动/卸载三态卡片 |
| `src-tauri/src/lib.rs` | 新增 `tool_*` commands，删除 `media_capture_*` 命令 |
| `src-tauri/capabilities/default.json` | 调整工具目录权限 |
| `src-tauri/Cargo.toml` | 删除 yt-dlp binary 引用（如存在） |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src-tauri/binaries/yt-dlp-*` | 不再内置二进制 |
| `src/components/tools/MediaUrlCapturePanel.vue` | 替换为 yt-dlp 终端面板 |
| `/Users/by3/Documents/Pixelle-Video/` (残留引用) | 清理由外部项目拆解产生的内置代码 |

---

## 11. 开放问题（待讨论）

1. **工具界面的"原生"到底多原生？** yt-dlp 是纯 CLI，没有 Web UI。我们要么：
   - A) 做一个终端面板（像 VS Code 的 Terminal），用户在终端敲 yt-dlp 命令
   - B) 做一个参数表单（URL 输入框 + 格式选择 + 下载按钮），后台拼命令
   - C) 等社区有人给 yt-dlp 做了 Web UI，我们嵌入那个
   - 建议：初期 B（表单），后续可加 A（高级模式终端）

2. **Pixelle-Video 的网络依赖？** Pixelle 可能有自己的 API 调用和模型下载，安装后是否需要额外配置？

3. **工具安装是否需要管理员密码？** `git clone` 和 `pip install --user` 不需要。但某些工具可能写 `/usr/local/bin`。

4. **Windows 兼容性？** `git-clone+venv` 在 Windows 上 `python3 -m venv` 路径不同，需要适配。

---

> **下一步**: 评审本文档 → 确认方向 → 开始 Phase 1 实施。
