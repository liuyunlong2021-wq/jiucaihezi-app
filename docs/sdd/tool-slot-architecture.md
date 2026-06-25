# 工具插槽架构 SDD

> **状态**: 评审修订版 v2
> **分支**: `gongju`
> **日期**: 2026-06-25
> **范围**: 桌面端（Tauri）。Web 端仅展示工具目录 + "桌面端可用"提示。
> **核心契约**: 韭菜盒子只负责发现、安装、隔离、启动、授权和观测原版工具，不负责重写工具能力。

---

## 0. 一句话总结（可执行契约）

**APP 不拥有工具实现，但必须拥有工具的安装可信度、运行隔离、用户授权、生命周期和故障可解释性。**

韭菜盒子不做 yt-dlp/ffmpeg/Whisper 的"内置版"——那些是上游的事。韭菜盒子做的是：
- **发现**：精选 GitHub 工具，展示给用户
- **安装**：一键下载/编译/配置，可见进度，可取消，可恢复
- **隔离**：独立目录、独立 venv、独立端口，互不污染
- **启动**：托管子进程，嵌入 Web UI 或终端面板
- **授权**：工具访问项目文件/网络/系统资源必须经用户显式开启
- **观测**：版本、运行状态、日志、错误码全透明

---

## 1. 背景：当前工具系统的问题

### 1.1 问题清单

| 问题 | 症状 | 根因 |
|------|------|------|
| **半残工具** | 网页媒体采集只能下载，不能播放列表/cookies/格式选择 | yt-dlp 二进制锁死在 `src-tauri/binaries/`，版本滞后 |
| **依赖黑洞** | ffmpeg/whisper 找不到 → 静默失败，无错误提示 | APP 假设用户已装依赖，从不检查也不引导安装 |
| **维护噩梦** | 上游更新，APP 内置版永远停在旧版本 | 工具代码写死在 `localContentTools.ts` 等文件 |
| **职责混乱** | 40 个 LLM 工具 + 3 个 UI 面板 + 15 个 Rust 命令，三层不统一 | 各自为政，无统一注册/安装/运行机制 |
| **用户不可控** | 不知道装的什么版本、能不能升级、为什么失败 | 工具对用户是不可见黑盒 |
| **内置≠可信** | 内置二进制无校验、无签名、无来源证明 | 用户不知道跑的是什么 |

### 1.2 核心矛盾

```
内置工具的悖论：
  APP 越大越全 → 依赖越多 → 越容易坏 → 用户越不信任
  APP 越精简 → 功能越少 → 用户越不需要

解法：不要做得更全，做得更薄。
      APP 是工具的"搬运工"，不是工具的"制造者"。
```

---

## 2. 设计目标

### 2.1 北极星

> 用户在韭菜盒子里发现一个 GitHub 工具 → 点安装 → 看见进度直到完成 → 在 APP 内使用原版工具的全部能力。

### 2.2 设计原则

1. **原版优先** — APP 绝不 fork/修改/阉割工具。跑的就是上游原版。
2. **信任可控** — 适配器清单由 APP 内置/人工精选，GitHub 只作为源码和 Release 信息来源；远程 manifest 禁止直接执行。
3. **一键安装** — 用户点一个按钮，APP 处理下载、依赖、配置。可见进度、可取消、可恢复、日志可查。
4. **全能力保留** — 基础表单是低门槛入口，终端/高级模式保留 CLI 原版完整能力。不做"山寨封装"。
5. **隔离运行** — 每个工具独立目录、独立 venv/node_modules、独立端口、环境变量隔离。互不污染。
6. **显式授权** — 工具访问网络、项目文件、系统资源必须经用户显式开启（Connection/Tool 开关 + 任务授权）。
7. **版本透明** — 显示已装版本、上游最新版本、一键升级、变更日志可查。
8. **故障可解释** — 每个失败状态有日志、错误码、重试路径、清理策略。不留僵尸进程、孤儿端口、残留文件。
9. **平台平等** — macOS arm64/x64 和 Windows x64 同等支持，不在 schema 里硬编码 Unix 假设。

### 2.3 非目标（明确不做）

- ❌ 不做通用包管理器（不替代 Homebrew/pip/npm/cargo）
- ❌ 不做工具市场/审核系统（初期人工精选 10-15 个）
- ❌ 不做 Docker/容器化运行（初期直接本地进程）
- ❌ 不做工具的"AI 包装"（工具是工具，LLM 是 LLM）
- ❌ 不修改上游工具的源码（patch/fork 是死路）
- ❌ 不做远程 manifest 的自动下载和执行（安全红线）
- ❌ 不做 Web 端的工具安装/运行（Web 端仅展示目录）

---

## 3. 范围：桌面端能力

### 3.1 双端边界

```
桌面端 (Tauri)：  安装 / 隔离 / 子进程 / 二进制 / venv / iframe localhost / 终端面板
                  ✅ 工具插槽全能力

Web 端 (Cloudflare)： 展示工具目录 / "桌面端可用"提示 / 工具文档链接
                      ❌ 不安装、不运行、不管理子进程
```

**铁律**：`gongju` 分支的所有安装/运行/子进程相关代码只落在 Tauri 桌面路径。不允许污染 Web 直连主线（`web` 分支）。涉及文件必须在 `isTauriRuntime()` 守卫下执行，或通过 `src-tauri/` Rust 命令暴露。

### 3.2 与现有架构的关系

工具插槽系统与现有 OpenCode 文/武模式、直连模式的关系：

```
桌面端：
  OpenCode（文/武模式）── 项目协作链路，不动
  直连模式 ── 对话链路，不动
  工具插槽 ── ★ 新增，独立于对话和 OpenCode
  
  LLM 可通过 Connection/Tool 开关显式调用已安装工具（见 §9）

Web 端：
  直连模式 ── 对话链路，不动
  工具目录 ── ★ 只读展示，"桌面端可用"提示
```

---

## 4. 架构设计

### 4.1 三层架构

```
┌─────────────────────────────────────────────────────────┐
│                    工具仓库 UI 层                         │
│  ToolWarehousePanel.vue                                  │
│  ├── 工具目录（桌面：安装/启动/卸载 | Web：只读展示）      │
│  ├── 工具卡片（完整状态机，§7）                           │
│  └── 工具界面容器（iframe / 终端 / 独立窗口）              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                    工具管理层                             │
│  toolRegistry.ts  ───  精选工具清单（APP 内置，人工维护）  │
│  toolManifest.ts  ───  适配器 schema + 解析/校验 + 白名单  │
│  toolInstaller.ts  ──  安装引擎（download/clone/venv）    │
│  toolRuntime.ts   ───  运行时（启动/停止/健康检查/端口）   │
│  toolStore.ts     ───  Pinia 状态（完整状态机驱动）        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                    工具文件层                             │
│  ~/.jiucaihezi/tools/                                    │
│  ├── installed.json         # 已安装工具索引              │
│  ├── yt-dlp/                                               │
│  │   ├── tool.yaml           # APP 写入的适配器副本        │
│  │   ├── yt-dlp              # 二进制（macOS/Linux）       │
│  │   ├── yt-dlp.exe          # 二进制（Windows）           │
│  │   ├── version.txt         # 当前版本（tag 或 commit）   │
│  │   └── install.log         # 安装日志                   │
│  ├── pixelle-video/                                        │
│  │   ├── tool.yaml                                        │
│  │   ├── venv/               # Python 虚拟环境             │
│  │   ├── src/                # git clone 源码              │
│  │   ├── version.txt         # commit hash                 │
│  │   ├── install.log                                      │
│  │   └── run.log             # 运行日志                   │
│  └── ...                                                  │
└─────────────────────────────────────────────────────────┘
```

### 4.2 数据流（安装→运行）

```
用户浏览工具目录
  ↓
点击「安装」
  ↓
toolStore 状态 → installing
  ↓
toolInstaller.install(toolId)
  ├── 读取 APP 内置 `public/tools/{toolId}/tool.yaml` → 解析安装方法
  ├── 前置检查：系统依赖（python3/node/cargo）、磁盘空间、网络连通
  ├── github-release 方法:
  │   ├── GET https://api.github.com/repos/{owner}/{repo}/releases/latest
  │   ├── 匹配 platforms.{os-arch}.pattern → 下载 binary
  │   ├── 校验 SHA256（auto 模式从 Release assets 自动找 .sha256）
  │   ├── macOS: xattr -d com.apple.quarantine（解除 Gatekeeper）
  │   ├── 写入 ~/.jiucaihezi/tools/{toolId}/
  │   └── 进度回调 → toolStore 实时更新百分比
  ├── git-clone+venv 方法:
  │   ├── git clone --depth 1 {repo} → src/
  │   ├── python3 -m venv venv（Windows: python -m venv venv）
  │   ├── venv/bin/pip install -r requirements.txt
  │   │   (Windows: venv\Scripts\pip install ...)
  │   └── commit hash → version.txt
  ├── 安装成功 → toolStore 状态 → installed
  └── 安装失败 → toolStore 状态 → failed + errorCode + 清理
  ↓
用户点击「启动」
  ↓
toolRuntime.launch(toolId)
  ├── 读取 ~/.jiucaihezi/tools/{toolId}/tool.yaml
  ├── webview 模式:
  │   ├── 分配端口（从 tool.yaml port 或自动找可用端口）
  │   ├── spawn 子进程 → 工具在 localhost:{port} 启动
  │   ├── 健康检查轮询（timeout/interval 按 manifest）
  │   ├── CSP 动态放行 localhost:{port}
  │   └── iframe 嵌入（sandbox="allow-scripts allow-same-origin"）
  ├── terminal 模式:
  │   ├── 打开终端面板
  │   ├── 预填命令名 + 基础参数表单（低门槛入口）
  │   └── 高级模式可切换至完整 CLI 终端
  ├── external-window 模式:
  │   └── Tauri shell open / Windows start 启动独立进程
  └── 运行中 → toolStore 更新 PID + port + 启动时间
```

---

## 5. 工具适配器规范 (tool.yaml)

### 5.1 信任模型（安全红线）

```
适配器来源层级（从上到下可信度递减）：

  L1 ✅ APP 内置: public/tools/{toolId}/tool.yaml
      → 随 APP 发布，经过代码审查。唯一的事实源。
  
  L2 🟡 人工精选缓存: APP 内置的 registry.json 指向已知 tool.yaml
      → 仍来自 APP 发布包，但内容可能由维护者远程更新
  
  L3 ❌ 远程 Manifest（本期不做）: 从 GitHub 仓库根目录 fetch tool.yaml
      → 需要：签名校验 + 域名白名单 + 用户确认 + 命令参数白名单
      → 本期明确禁用。L3 上线前必须完成安全审计（独立 SDD）。
```

**本期铁律**：所有 `tool.yaml` 来自 `public/tools/` 目录，随 APP 打包发布。GitHub 仓库只作为源码和 Release 二进制文件的下载源，不作为 manifest 来源。用户永远不执行未经 APP 审查的远程命令。

### 5.2 Schema

```yaml
# tool.yaml — 工具适配器清单
# 来源: APP 内置 public/tools/{toolId}/tool.yaml
# 安装后副本写入: ~/.jiucaihezi/tools/{toolId}/tool.yaml

id: yt-dlp                           # 唯一标识（与目录名一致）
name: 网页媒体采集                     # 用户可见名称
icon: download                        # JcIcon 图标名
description: 从 1800+ 网站下载视频/音频/字幕/元数据
repo: yt-dlp/yt-dlp                   # GitHub owner/repo（仅下载源，非 manifest 源）
homepage: https://github.com/yt-dlp/yt-dlp
license: Unlicense
category: media                       # media | dev | document | image | audio | video | utility
tags: [视频下载, 音频, 字幕, 网页采集]

# ── 安装配置 ──
install:
  method: github-release              # github-release | git-clone+venv | git-clone+npm | system-check
  githubRelease:
    owner: yt-dlp                     # GitHub owner
    repo: yt-dlp                      # GitHub repo
    tag: latest                       # latest | v2025.01.01（固定版本）
    platforms:
      darwin-arm64:
        assetPattern: yt-dlp_macos    # Release asset 文件名匹配（glob）
        binaryName: yt-dlp            # 安装后的文件名
      darwin-x64:
        assetPattern: yt-dlp_macos
        binaryName: yt-dlp
      windows-x64:
        assetPattern: yt-dlp.exe
        binaryName: yt-dlp.exe
    checksum: auto                    # auto=自动找 .sha256 | sha256:abc123 | skip
    stripQuarantine: true             # macOS: xattr -d com.apple.quarantine
  # git-clone+venv 示例（见附录 A）

# ── 依赖声明（安装前检查） ──
requires:
  - name: python3
    version: ">=3.9"
    checkCommand: python3 --version       # macOS/Linux
    checkCommandWindows: python --version # Windows fallback
    installHint: "请安装 Python 3.9+: https://www.python.org/downloads/"
  - name: ffmpeg
    optional: true                    # 可选依赖：没有也能跑但功能受限
    checkCommand: ffmpeg -version
    checkCommandWindows: ffmpeg -version
    installHint: "请安装 ffmpeg: brew install ffmpeg (macOS) 或 https://ffmpeg.org/download.html (Windows)"

# ── 启动配置 ──
launch:
  mode: terminal                      # terminal | webview | external-window
  terminal:
    # 基础表单（低门槛入口）
    form:
      fields:
        - name: url
          label: 视频链接
          type: text
          required: true
          placeholder: https://www.youtube.com/watch?v=...
        - name: format
          label: 下载格式
          type: select
          options:
            - { label: 最佳视频+音频, value: best }
            - { label: 仅音频 MP3, value: bestaudio --extract-audio --audio-format mp3 }
            - { label: 仅字幕, value: --write-subs --skip-download }
        - name: outputDir
          label: 保存目录
          type: path
          default: ~/Movies/韭菜盒子/
      # 命令模板：{url} {format} 等占位符由表单填充
      commandTemplate: ./yt-dlp {url} -o "{outputDir}/%(title)s.%(ext)s" {format}
    # 高级模式（完整 CLI）
    advancedShell: true               # 允许切换到终端面板手动输入完整命令
    shell: ${SHELL}                    # macOS: /bin/zsh, Windows: pwsh.exe 或 cmd.exe
    env:
      PATH: "${TOOL_DIR}:${PATH}"     # 工具目录优先于系统 PATH

  # webview 模式示例（见附录 A）

# ── 卸载配置 ──
uninstall:
  method: remove-dir                  # remove-dir | remove-venv | remove-node-modules
  cleanPaths: []                      # 额外清理的路径（相对于工具目录）
```

### 5.3 安装方法详解

#### github-release — 下载 Release 二进制

适用：Go/Rust 编译的 CLI 工具（yt-dlp、ffmpeg 静态构建、ripgrep、fd 等）

流程：
1. `GET /repos/{owner}/{repo}/releases/latest`（或指定 tag）
2. 从 `assets[]` 中按 `platforms.{os-arch}.assetPattern` glob 匹配文件名
3. 下载二进制 → SHA256 校验 → 设置可执行权限（macOS: `chmod +x`；Windows: 无需）
4. macOS: `xattr -d com.apple.quarantine` 解除 Gatekeeper 隔离
5. 写入工具目录，记录版本号 → `version.txt`

优点：不需要编译环境，下载即用。
缺点：依赖上游提供预编译二进制。

#### git-clone+venv — 源码安装 Python 工具

适用：Python 工具（Pixelle-Video、gallery-dl、gradio 应用等）

流程：
1. `git clone --depth 1 {repo}` → `src/`
2. `python3 -m venv venv`（Windows: `python -m venv venv`）
3. `venv/bin/pip install -r src/requirements.txt`（Windows: `venv\Scripts\pip`）
4. 记录 commit hash → `version.txt`

#### git-clone+npm — 源码安装 Node.js 工具

适用：Node.js 工具。流程同 Python 模式，替换为 `npm install`（在 src/ 内，不全局安装）。

#### system-check — 检测系统已安装

适用：ffmpeg、python3、git 等常见系统工具。不自动安装，仅检测是否存在 + 引导用户自行安装（Homebrew / 官方下载）。

### 5.4 启动模式详解

#### terminal — 终端面板（CLI 工具）

默认呈现**基础参数表单**（低门槛入口），用户填 URL/格式/目录 → 点击执行 → 命令在后台运行 → 终端面板显示实时输出。

提供「高级模式」切换按钮 → 进入完整 CLI 终端（xterm.js 或 Tauri shell），用户可以输入任意 yt-dlp 命令参数。

**关键**：表单是入口，终端是全能力。不做"只给表单不给终端"的山寨封装。

#### webview — 嵌入 iframe

工具有自己的 Web UI（Gradio/Flask/FastAPI/Express），APP 用 iframe 嵌入。

约束：
- iframe `sandbox="allow-scripts allow-same-origin"`
- CSP 动态放行 `localhost:{port}`（APP 启动工具后注入）
- 禁止顶层导航（`allow-top-navigation` 不设置）
- 禁止弹出窗口（`allow-popups` 不设置）

#### external-window — 独立窗口

工具是完整桌面应用，APP 只负责启动。不管理生命周期，不嵌入。

---

## 6. 工具插槽安全模型

### 6.1 核心原则

> APP 不拥有工具实现，但必须拥有工具的安装可信度、运行隔离、用户授权、生命周期和故障可解释性。

### 6.2 安装安全

| 措施 | 说明 |
|------|------|
| **目录限制** | 所有工具安装到 `~/.jiucaihezi/tools/{toolId}/`，禁止路径穿越（`../`、绝对路径、symlink 外链） |
| **symlink 防护** | 安装前检查目标目录无外部 symlink；安装后不跟踪工具目录内的外部 symlink |
| **二进制校验** | `checksum: auto` 自动从 GitHub Release 获取 `.sha256` 文件校验；`checksum: sha256:xxx` 硬编码校验；`checksum: skip` 需在 manifest 中显式声明原因 |
| **来源可信** | 二进制只从 GitHub Releases 官方域名下载（`https://github.com/{owner}/{repo}/releases/download/...`），禁止重定向到第三方 |
| **manifest 来源** | 只从 APP 内置 `public/tools/` 读取，不 fetch 远程 manifest |
| **macOS quarantine** | 下载的二进制自动解除 `com.apple.quarantine` 扩展属性 |
| **安装回滚** | 安装失败时自动清理已下载/已解压的文件，不留残留 |

### 6.3 运行隔离

| 措施 | 说明 |
|------|------|
| **独立目录** | 每个工具以 `~/.jiucaihezi/tools/{toolId}/` 为 cwd |
| **独立 venv/node_modules** | 不共享、不依赖系统全局 site-packages |
| **环境变量隔离** | tools 自己的 `PATH`、`VIRTUAL_ENV` 等环境变量，不污染 APP 进程 |
| **端口分配** | 工具端口由 APP 统一管理，避免冲突；端口范围：17860-17999 |
| **进程管理** | 子进程 PID 注册到 `toolRuntime`；APP 退出时 SIGTERM → 等 5s → SIGKILL 所有工具进程 |
| **网络访问提示** | 工具首次启动需要网络访问时，APP 显示提示："[工具名] 将访问网络，是否允许？" |
| **项目目录隔离** | 工具默认不访问用户项目文件；需要项目文件访问的工具需在 launch 配置中声明，且用户需在 Connection/Tool 中显式授权 |

### 6.4 命令参数白名单（terminal 模式）

基础表单模式下，命令由 `commandTemplate` + 用户表单输入拼接，参数值经过：
- URL：`new URL()` 校验，拒绝 `file://`、`javascript:` 等非 http/https 协议
- 路径：限制在用户选择的输出目录内，禁止 `~/.ssh`、`/etc/` 等敏感路径
- 其他参数：白名单匹配，拒绝 shell 元字符（`;`, `|`, `$()`, `` ` `` 等）

高级终端模式下，用户直接输入完整命令 → APP 显示警告："你将直接执行命令，请确认命令安全" → 用户确认后执行。

### 6.5 工具间隔离

- 工具 A 不能访问工具 B 的目录
- 工具 A 不能监听工具 B 的端口
- 工具 A 的子进程不能访问工具 B 的环境变量

### 6.6 LLM 调用已安装工具的授权链

见 §9，核心：LLM 不得自动发现并调用已安装工具。必须经过用户显式开启（Connection/Tool 开关 + 任务授权）。

---

## 7. 完整状态机

### 7.1 工具生命周期状态

```
                    ┌─────────────┐
                    │ not_installed│
                    └──────┬──────┘
                           │ 用户点击「安装」
                           ▼
                    ┌─────────────┐
              ┌────│  checking    │────┐
              │     └──────┬──────┘    │
              │            │ 依赖满足   │ 依赖缺失/网络不通
              │            ▼           ▼
              │     ┌─────────────┐  ┌──────────────────┐
              │     │ installing  │  │ needs_dependency │
              │     │ (含进度%)   │  └──────┬───────────┘
              │     └──────┬──────┘         │ 用户安装依赖后
              │            │                ▼
              │            │           ┌─────────────┐
              │            │           │  checking   │（重新检查）
              │            │           └─────────────┘
              │            │ 成功
              │            ▼
              │     ┌─────────────┐
              │     │  installed  │◄──────────────────────┐
              │     └──────┬──────┘                       │
              │            │ 用户点击「启动」               │ 停止成功
              │            ▼                              │
              │     ┌──────────────┐                    ┌─┴──────────┐
              │     │launch_pending│                    │  stopping  │
              │     └──────┬───────┘                    └─┬──────────┘
              │            │ 子进程启动 + 健康检查OK        │ 用户点击「停止」
              │            ▼                              │
              │     ┌─────────────┐              ┌──────────────┐
              │     │   running   │──────────────│   running    │
              │     │ (含PID+端口) │  用户点击停止  │              │
              │     └──────┬──────┘              └──────────────┘
              │            │
              │            │ 进程异常退出 / 健康检查失败
              │            ▼
              │     ┌─────────────┐
              │     │   failed    │（含 errorCode + 日志 + 重试/清理）
              │     └─────────────┘
              │
              │ 用户点击「升级」
              │   installed → checking → installing → installed
              │
              │ 用户点击「卸载」
              │   installed → 清理目录 → not_installed
              │
              └── installing 失败 ──→ failed（含 errorCode + 清理）
```

### 7.2 状态定义

| 状态 | 含义 | 卡片表现 | 可用操作 |
|------|------|---------|---------|
| `not_installed` | 工具未安装 | 灰色图标 + 安装按钮 | 安装 |
| `checking` | 正在检查依赖 | 旋转图标 + "检查环境中..." | 取消 |
| `needs_dependency` | 缺少系统依赖 | ⚠ 黄色 + 依赖名 + 安装指引 | 查看指引、重新检查 |
| `installing` | 正在安装（含进度%） | 进度条 + 百分比 + 取消按钮 | 取消（触发清理） |
| `installed` | 已安装，未运行 | 版本号 + 绿色对勾 + 启动按钮 | 启动、卸载、升级 |
| `launch_pending` | 正在启动 | 旋转图标 + "启动中..." | 取消 |
| `running` | 运行中 | ● 绿色指示灯 + PID + 端口 | 打开界面、停止、重启 |
| `stopping` | 正在停止 | 旋转图标 + "停止中..." | 强制停止 |
| `failed` | 安装/运行失败 | ❌ 红色 + 错误摘要 + 错误码 | 查看日志、重试、清理 |
| `update_available` | 有新版本可升级 | 🔔 新版本号 + 升级按钮 | 升级、忽略此版本 |

### 7.3 失败处理策略

每个失败状态必须包含：

```typescript
interface ToolFailure {
  errorCode: string           // 机器可读错误码，如 'E_NETWORK' | 'E_CHECKSUM' | 'E_PORT_BUSY'
  message: string             // 用户可读错误信息
  logPath: string             // 详细日志文件路径
  recoverable: boolean        // 是否可重试
  cleanupRequired: boolean    // 是否需清理残留文件
  suggestedActions: string[]  // 建议操作：['重试', '检查网络', '手动安装依赖', '清理后重装']
}
```

---

## 8. 平台矩阵

### 8.1 macOS vs Windows 差异

| 维度 | macOS (arm64/x64) | Windows (x64) |
|------|-------------------|---------------|
| **Python 命令** | `python3` | `python`（或 `py`） |
| **venv 路径** | `venv/bin/pip` | `venv\Scripts\pip.exe` |
| **Shell 默认** | `/bin/zsh` | `pwsh.exe` 或 `cmd.exe` |
| **可执行权限** | `chmod +x` + `xattr -d com.apple.quarantine` | 无需（`.exe` 直接可执行） |
| **二进制扩展名** | 无 | `.exe` |
| **进程终止** | `SIGTERM` → `SIGKILL` | `taskkill /PID` → `taskkill /F /PID` |
| **端口检测** | `lsof -i :{port}` | `netstat -ano | findstr :{port}` |
| **路径分隔符** | `/` | `\` |
| **HOME 目录** | `$HOME` | `%USERPROFILE%` |
| **GitHub Release asset** | `yt-dlp_macos` | `yt-dlp.exe` |
| **下载 quarantine** | 需 `xattr -d` | 不适用 |
| **长路径支持** | 默认支持 | 需 `\\?\` 前缀或启用长路径 |

### 8.2 平台适配策略

- `tool.yaml` 的 `platforms` 字段必须包含所有目标平台条目
- 安装/运行代码不硬编码 Unix 路径约定，通过 `src/utils/platform.ts` 统一分派
- 每个平台差异点在 `toolInstaller.ts` 和 `toolRuntime.ts` 中用 `platform` 守卫，不做 `if(darwin) ... else if(windows)` 散落
- CI 验证：macOS arm64 + Windows x64 至少各跑一次安装→启动→停止→卸载

---

## 9. 与 LLM 工具的关系

### 9.1 两类"工具"的严格区分

| 类型 | 例 | 运行位置 | 本次改动 |
|------|-----|----------|----------|
| **用户工具**（用户直接操作） | yt-dlp、Pixelle、ffmpeg | `~/.jiucaihezi/tools/` 独立进程 | ✅ 全部改为插槽模式 |
| **LLM 工具**（AI function calling） | `dev_read_file`、`browser_search`、`create_document` | APP 进程内 | 🟡 暂不改动，保留现有 |

LLM 工具是轻量 API 封装，不涉及外部依赖，直接运行在 APP 进程内。用户工具是完整的外部程序，通过子进程运行。

两者是互补关系：用户工具提供重能力（视频下载、AI 生成），LLM 工具提供轻操作（文件读写、浏览器控制）。

### 9.2 LLM 调用已安装用户工具的授权链

**铁律**：LLM 不得自动发现并自动调用已安装工具。必须经过用户显式授权：

```
LLM 想使用 yt-dlp 下载视频
  ↓
① Connection/Tool 开关：用户必须先在 Tool Warehouse 或 Connection 面板中
   为当前会话开启「允许 LLM 调用 yt-dlp」
  ↓
② 任务授权：LLM 在 function call 中声明 tool=yt-dlp + 具体操作时，
   APP 弹出确认："AI 请求使用 yt-dlp 下载 {url}，是否允许？"
  ↓
③ 参数校验：用户确认后，参数经过 §6.4 的命令白名单校验
  ↓
④ 执行：toolRuntime 执行命令，结果返回 LLM
```

这与 `CLAUDE.md` 的核心原则一致：

> 用户选择 Tool（或关闭）→ LLM 只按这套显式配置执行

工具插槽系统不改变这个原则。已安装工具只是"可被选择的工具"多了一个来源，不代表 LLM 可以跳过选择直接调用。

### 9.3 LLM 工具的"升级"路径

未来（Phase 5+）：如果某个 LLM 工具对应的用户工具已安装（如 yt-dlp），LLM function calling 可以路由到已安装的原版工具，而不是用内置的简化版。但路由切换必须在 Connection/Tool 面板中显式配置，不能自动发生。

---

## 10. UI 改造

### 10.1 工具仓库面板 (ToolWarehousePanel.vue)

当前状态：15 张静态卡片，无安装/运行概念。

改造后：

```
┌──────────────────────────────────────────────┐
│  工具仓库                  🔍 搜索  │ 筛选 ▼  │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────┐  ┌────────────────┐    │
│  │ yt-dlp         │  │ Pixelle-Video  │    │
│  │ 网页媒体采集     │  │ AI 视频生成     │    │
│  │ ✅ v2025.06.25 │  │ ⬇ 未安装       │    │
│  │ [启动] [卸载]   │  │ [安装]         │    │
│  └────────────────┘  └────────────────┘    │
│                                              │
│  ┌────────────────┐  ┌────────────────┐    │
│  │ ffmpeg         │  │ gallery-dl     │    │
│  │ 媒体处理        │  │ 图库下载        │    │
│  │ ⚠ 未检测到     │  │ ⬇ 未安装       │    │
│  │ [如何安装]      │  │ [安装]         │    │
│  └────────────────┘  └────────────────┘    │
│                                              │
│  ┌────────────────┐                        │
│  │ yt-dlp 安装中   │                        │
│  │ ████████░░ 78% │  [取消]                │
│  │ 正在下载二进制... │                        │
│  └────────────────┘                        │
│                                              │
│  ┌────────────────┐                        │
│  │ yt-dlp 启动失败 │                        │
│  │ ❌ E_PORT_BUSY │                        │
│  │ 端口 7860 被占用│  [查看日志] [重试]     │
│  └────────────────┘                        │
└──────────────────────────────────────────────┘
```

### 10.2 工具运行面板

terminal 模式（yt-dlp）：

```
┌──────────────────────────────────────────────┐
│  ◀ 返回    yt-dlp 网页媒体采集    ● 运行中    │
│             PID 12345 : 端口 N/A               │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─ 基础模式 ──────────────────────────┐    │
│  │ 视频链接: [https://...          ]    │    │
│  │ 下载格式: [最佳视频+音频      ▼]    │    │
│  │ 保存目录: [~/Movies/韭菜盒子/  ]    │    │
│  │            [开始下载]                │    │
│  └────────────────────────────────────┘    │
│                                              │
│  [切换到高级终端模式]  ← 完整 CLI 能力入口     │
│                                              │
│  ┌─ 下载进度 ──────────────────────────┐    │
│  │ [download] 45.2% of 128MB at 8MB/s │    │
│  │ ETA: 00:08                            │    │
│  └────────────────────────────────────┘    │
│                                              │
│  [停止] [查看文件]                            │
└──────────────────────────────────────────────┘
```

webview 模式（Pixelle-Video）：

```
┌──────────────────────────────────────────────┐
│  ◀ 返回    Pixelle-Video    ● 运行中          │
│            端口 17860                          │
├──────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐   │
│  │                                      │   │
│  │   <iframe src="localhost:17860">     │   │
│  │   Pixelle-Video 原生 Web UI 完整呈现  │   │
│  │                                      │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  [停止] [重启] [在浏览器打开]                  │
└──────────────────────────────────────────────┘
```

### 10.3 Web 端工具面板

```
┌──────────────────────────────────────────────┐
│  工具仓库                                     │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────┐  ┌────────────────┐    │
│  │ yt-dlp         │  │ Pixelle-Video  │    │
│  │ 网页媒体采集     │  │ AI 视频生成     │    │
│  │ 🖥 桌面端可用   │  │ 🖥 桌面端可用   │    │
│  │ [查看详情]      │  │ [查看详情]      │    │
│  └────────────────┘  └────────────────┘    │
│                                              │
│  💡 下载韭菜盒子桌面 APP 即可安装和使用这些工具  │
└──────────────────────────────────────────────┘
```

---

## 11. 迁移计划

### 原则

1. **永不直接删除还在用的旧代码** — 先做插槽版，并行验证通过后再清理
2. **feature flag 隔离** — `jc_tool_slot_ytdlp` flag 控制新/旧 yt-dlp 路径
3. **全链路验收** — 每个 Phase 有明确验收标准（§12）

### Phase 1: 基建（预估 3-5 天）

| 任务 | 文件 | 依赖 |
|------|------|------|
| 定义 `tool.yaml` TypeScript 类型 + 校验函数 | `src/utils/toolManifest.ts` | — |
| 实现安装引擎（github-release 方法） | `src/utils/toolInstaller.ts` | toolManifest |
| 实现运行时管理（启动/停止/健康检查/端口分配） | `src/utils/toolRuntime.ts` | — |
| 实现 Pinia 状态管理（完整状态机） | `src/stores/toolStore.ts` | — |
| 新增 Rust commands（`tool_install/uninstall/launch/stop/status`） | `src-tauri/src/lib.rs` | — |
| 注册 Tauri capabilities（`~/.jiucaihezi/tools/` scope） | `src-tauri/capabilities/default.json` | — |
| 插件：安装进度事件通道 | `src-tauri/src/lib.rs` | — |
| 插件：平台检测工具（`src/utils/platform.ts`） | `src/utils/platform.ts` | — |

**Phase 1 出口标准**：toolStore 状态机可独立在浏览器 dev 模式运行（mock install/runtime），vue-tsc 通过。

### Phase 2: yt-dlp 插槽版（预估 2-3 天）★ 不做删除

| 任务 | 说明 |
|------|------|
| 编写 `public/tools/yt-dlp/tool.yaml` | 按 §5.2 schema |
| 在 ToolWarehousePanel 新增 yt-dlp 插槽卡片 | feature flag `jc_tool_slot_ytdlp` 控制 |
| 实现 github-release 安装 → 终端面板基础表单 → 高级 CLI 模式 | — |
| **并行验证**：旧 `MediaUrlCapturePanel` 保持不变，feature flag ON 时走新路径 | `localStorage.setItem('jc_tool_slot_ytdlp', '1')` |

**Phase 2 出口标准**（feature flag ON，老代码仍在）：
- [ ] 安装 yt-dlp → 显示版本号
- [ ] 下载一个 YouTube 视频（基础表单模式）
- [ ] 使用 cookies 下载（高级终端模式，`--cookies-from-browser`）
- [ ] 下载播放列表（`--playlist` 参数）
- [ ] 格式选择（`-f bestaudio` 等）
- [ ] 自定义下载目录
- [ ] 查看安装/运行日志
- [ ] 停止运行中的下载
- [ ] 卸载 yt-dlp → 目录清理干净
- [ ] 重启 APP → 识别已安装 → 可再次启动
- [ ] macOS x64 和 arm64 均通过
- [ ] Windows x64 通过（CI 验证）

### Phase 3: 旧代码清理（yt-dlp）★ 全链路通过后执行

| 任务 | 文件 |
|------|------|
| 删除 `src-tauri/binaries/yt-dlp-*` | 二进制文件 |
| 删除 `src/components/tools/MediaUrlCapturePanel.vue` | 旧 UI |
| 删除 `lib.rs` 中 `media_capture_*` 命令段 | Rust 端 |
| 删除 `capabilities/default.json` 中旧 yt-dlp scope | 权限 |
| 删除 `localContentTools.ts` 中 `local_media_url_download` 工具定义 | LLM 工具 |
| 移除 feature flag `jc_tool_slot_ytdlp` | 清理 |

**Phase 3 出口标准**：Phase 2 全部验收项 + 旧代码删除后无编译错误 + 旧功能全部在新路径可用。

### Phase 4: Pixelle-Video（预估 2-3 天）

| 任务 | 说明 |
|------|------|
| 编写 `public/tools/pixelle-video/tool.yaml` | git-clone+venv 方法 |
| 清理 `/Users/by3/Documents/Pixelle-Video` 在代码中的残留引用 | grep 全仓 |
| 实现 git-clone+venv 安装 → webview 启动 | — |
| **并行验证**：Pixelle 插槽版安装→启动→使用 Web UI→停止→卸载 |

**Phase 4 出口标准**：
- [ ] git clone Pixelle-Video 源码
- [ ] 创建 venv + 安装依赖
- [ ] 启动 Web 服务 → iframe 嵌入 → 原生界面可用
- [ ] 停止进程 → 端口释放
- [ ] 卸载 → venv + 源码目录清理干净
- [ ] macOS arm64 通过
- [ ] 旧残留引用全部清理（grep `Pixelle` 在 `src/` 中零结果）

### Phase 5: 工具目录扩展 + 系统工具检测

| 任务 | 说明 |
|------|------|
| ffmpeg → system-check 方法 | 检测系统是否已装，未装引导 Homebrew/官网 |
| Whisper → git-clone+venv | openai/whisper |
| gallery-dl → git-clone+venv | mikf/gallery-dl |
| 精选 10-15 个工具加入 `registry.json` | — |
| 搜索/筛选/分类 UI | — |
| 一键升级所有已装工具 | — |

---

## 12. 验收标准

### 12.1 功能验收（每 Phase 必须全绿）

#### Phase 1 基建

- [ ] `tool.yaml` schema 可解析 4 种安装方法 + 3 种启动模式，拒绝非法配置
- [ ] toolStore 10 个状态全部可触发，状态转换符合 §7.1 图
- [ ] 安装失败 → errorCode + log + recoverable/cleanup 标记正确
- [ ] vue-tsc 零错误

#### Phase 2 yt-dlp

- [ ] 安装成功：版本号显示正确
- [ ] 下载视频（基础表单）：文件落盘，格式正确
- [ ] cookies 下载（高级终端）：`--cookies-from-browser chrome` 工作
- [ ] 播放列表下载：多文件落盘，命名正确
- [ ] 格式选择：`bestaudio` 仅下载音频
- [ ] 自定义目录：文件落盘到用户指定目录
- [ ] 安装日志：`install.log` 包含下载 URL、SHA256、耗时
- [ ] 运行日志：`run.log` 包含 yt-dlp 原始输出
- [ ] 停止运行：SIGTERM → 进程退出 → 端口释放
- [ ] 卸载清理：工具目录完全删除
- [ ] 重启恢复：APP 重启后 toolStore 识别已安装，可再次启动
- [ ] 升级：检测到新版本 → 下载 → 替换 → 旧版本备份
- [ ] macOS arm64 + x64 均通过
- [ ] Windows x64 通过（至少 CI 验证安装→启动→停止→卸载）

#### Phase 3 旧代码清理

- [ ] `MediaUrlCapturePanel.vue` 已删除
- [ ] `lib.rs` 中 `media_capture_*` 已删除
- [ ] `binaries/yt-dlp-*` 已删除
- [ ] 编译通过，无 broken import
- [ ] Phase 2 全部验收项在新路径仍然通过

#### Phase 4 Pixelle-Video

- [ ] git clone + venv 创建成功
- [ ] Web 服务启动 → iframe 嵌入 → 原生界面可用
- [ ] 停止 → 端口释放
- [ ] 卸载 → 清理干净
- [ ] `src/` 中 grep `Pixelle` 零结果（旧残留清理完毕）

### 12.2 非功能验收

- [ ] 安装 50MB 二进制：进度条平滑更新，不卡 UI
- [ ] 安装失败（断网）：显示 E_NETWORK + 重试按钮，不残留文件
- [ ] 端口冲突：检测到 `E_PORT_BUSY`，提示释放端口或自动换端口
- [ ] APP 退出：所有工具子进程被 kill（macOS + Windows）
- [ ] macOS Gatekeeper：下载的二进制不弹 "无法验证开发者" 警告

---

## 13. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| 上游 Release 格式/命名变动 | 中 | 安装失败 | `assetPattern` glob 匹配 + 固定 `tag` 版本双支持；安装前校验 asset 存在 |
| Python 环境缺失或版本过低 | 高 | venv/pip 失败 | Phase 1 做 cross-platform 检测，引导安装页 |
| Windows venv/pip 行为不同于 macOS | 高 | git-clone+venv 在 Windows 失败 | §8 平台矩阵驱动，CI 双边验证 |
| 端口冲突 | 中 | 启动失败 | 自动检测 → 自动换端口或提示用户 |
| 子进程泄漏 | 中 | 资源浪费 | PID 注册 + APP 退出 killAll + 5s 超时 SIGKILL |
| GitHub API 限流 | 低 | 安装超时 | 3 次重试 + 指数退避 + 本地缓存 Release 信息 |
| iframe CSP/安全漏洞 | 低 | 工具 Web UI 越权 | sandbox 属性严格限制，禁止顶层导航和弹窗 |
| macOS Gatekeeper | 中 | 二进制被隔离 | `xattr -d com.apple.quarantine` 自动解除 |

---

## 14. 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `docs/sdd/tool-slot-architecture.md` | 本文档 |
| `src/utils/toolManifest.ts` | tool.yaml 解析/校验 + 类型定义 |
| `src/utils/toolInstaller.ts` | 安装引擎（github-release / git-clone+venv / git-clone+npm / system-check） |
| `src/utils/toolRuntime.ts` | 运行时管理（启动/停止/健康检查/端口分配） |
| `src/utils/platform.ts` | 平台检测与分派（macOS/Windows 差异统一入口） |
| `src/stores/toolStore.ts` | Pinia 状态管理（完整状态机） |
| `src/components/tools/ToolRunPanel.vue` | 工具运行面板（iframe + 终端 + 表单） |
| `public/tools/registry.json` | 精选工具目录 |
| `public/tools/yt-dlp/tool.yaml` | yt-dlp 适配器（APP 内置） |
| `public/tools/pixelle-video/tool.yaml` | Pixelle-Video 适配器（APP 内置） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/components/tools/ToolWarehousePanel.vue` | 重构：完整状态机卡片 + 安装/启动/卸载 + 双端分叉 |
| `src-tauri/src/lib.rs` | 新增 `tool_install/uninstall/launch/stop/status` + 事件通道 |
| `src-tauri/capabilities/default.json` | 新增 `~/.jiucaihezi/tools/` scope |

### Phase 3 删除文件（延迟执行，先并行验证）

| 文件 | 原因 |
|------|------|
| `src-tauri/binaries/yt-dlp-*` | 不再内置二进制 |
| `src/components/tools/MediaUrlCapturePanel.vue` | 替换为 yt-dlp 插槽版 |
| `src/utils/localContentTools.ts` 中 `local_media_url_download` 段 | 替换为 yt-dlp 插槽版 |

---

## 附录 A: git-clone+venv 配置示例

```yaml
# Pixelle-Video 示例
id: pixelle-video
name: Pixelle-Video
icon: movie
description: AI 视频生成工作流
repo: AIDC-AI/Pixelle-Video
homepage: https://github.com/AIDC-AI/Pixelle-Video
license: Apache-2.0
category: video
tags: [AI视频, 生成, 工作流]

install:
  method: git-clone+venv
  gitClone:
    repo: AIDC-AI/Pixelle-Video
    depth: 1
    branch: main
  venv:
    pythonCommand: python3
    pythonCommandWindows: python
    requirementsFile: requirements.txt
    systemDeps: []                 # apt/brew 系统依赖（如有）

requires:
  - name: python3
    version: ">=3.10"
    checkCommand: python3 --version
    checkCommandWindows: python --version
  - name: git
    version: ">=2.0"
    checkCommand: git --version

launch:
  mode: webview
  webview:
    command: venv/bin/python        # macOS/Linux
    commandWindows: venv\Scripts\python.exe  # Windows
    args: [src/app.py]
    healthCheck:
      url: http://localhost:7860/
      timeout: 30000
      interval: 1000
    port: 7860
    env:
      PYTHONUNBUFFERED: "1"

uninstall:
  method: remove-venv
```

---

> **下一步**: 评审本文档 v2 → 确认 Phase 1 启动 → 从 `toolManifest.ts` + `toolStore.ts` 开始编码。

