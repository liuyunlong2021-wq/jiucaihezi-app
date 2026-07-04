# SDD: 系统架构优化 — 收束核心、轻量化、跨平台稳健

> **状态**: 待决策（分支 `0704-xitongjiegou`）
> **日期**: 2026-07-04
> **作者**: by3 / Codex
> **背景**: `0704-shanchuzhilian` 结束后进行的全代码库架构审查。产品定位已明确：**OpenCode 的小白版本**。在此基础上收束架构，删除冗余，降低跨平台 bug。

---

## 一、产品定位收束

韭菜盒子 Studio 的定位是：

> **OpenCode 的小白版桌面壳**。核心引擎是 OpenCode，我们做的是：聊天界面 + 创作面板 + 编辑区 + Skill/工具仓库——这些是 OpenCode 没有的「小白友好层」。除此之外的一切（模型管理、文件操作、Shell 执行、权限控制）全部由 OpenCode 原生能力承担。

| 我们做什么 | 我们不做（交给 OpenCode） |
|---|---|
| 聊天 UI（文/武切换） | Agent 调度和工具执行 |
| 创作面板（生图/生视频/生音频） | 文件系统读写 |
| 编辑区（Tiptap 轻量编辑器） | Git 操作 |
| Skill / 工具仓库管理 | MCP 服务器管理 |
| 模型选择器（聚合云端+Ollama+自定义） | 权限和审批流程 |
| 项目文件树 | Shell 命令执行 |

---

## 二、当前架构问题清单

### 2.1 `lib.rs` 单文件上帝对象（P0）

```
src-tauri/src/lib.rs — 约 5000 行
  75 个 #[tauri::command]
  全部业务逻辑混在一起
```

一个文件里包含：OpenCode 进程管理、Chromium 浏览器自动化、MLX 本地模型、yt-dlp 媒体下载、FFmpeg 处理、文档转换（3 个引擎）、MCP stdio 桥接、Skill 素材编译、插件 npm 安装、项目文件读写、HTTP 代理、Git Worktree、剪贴板、Session Token、截图。

**后果**：任何 Rust 层的修改都要导航这个巨型文件；新增功能自然倾向于继续往里塞；平台相关的 `#[cfg]` 散落各处难以验证。

### 2.2 Binary sidecar 仅 aarch64（P0）

```
binaries/
  ffmpeg-aarch64-apple-darwin       ← 仅 Apple Silicon
  ffprobe-aarch64-apple-darwin      ← 仅 Apple Silicon
  opencode-aarch64-apple-darwin     ← 仅 Apple Silicon
  opencode-x86_64-apple-darwin      ← 有 Intel，但仅限 opencode
  whisper-cli-aarch64-apple-darwin  ← 仅 Apple Silicon
  yt-dlp-aarch64-apple-darwin       ← 仅 Apple Silicon
```

代码里已有 fallback 到 `PATH` / `~/.jiucaihezi/tools/` 的逻辑，但**首次启动体验**在 Intel Mac 和 Windows 上会断——提示「未找到 ffmpeg」「未找到 yt-dlp」而用户不知道为什么。

### 2.3 Chromium 浏览器自动化（P1）

`chromiumoxide` crate 依赖完整 Chromium 浏览器：
- 编译体积大、启动慢
- 平台差异大（Chrome 路径、沙箱、无头模式）
- 实际使用频率极低（浏览器自动化仅在「网页媒体下载」中用于获取 Cookie）
- OpenCode 不内置浏览器，Claude Code 也不内置

`src-tauri/Cargo.toml` 中 `chromiumoxide = "0.9.1"` 是可移除的。

### 2.4 MLX 本地模型仅 Apple Silicon（P1）

500+ 行 Rust 代码专门管理 MLX 下载/安装/启动。依赖 Python venv、`mlx_lm`、HuggingFace。非 Apple Silicon 上完全不可用，每次都会报「仅支持 Apple Silicon Mac」。

这与 Ollama 路径不同：Ollama 是用户自己安装的外部服务，MLX 是我们的代码去管理它的整个生命周期。这增加了维护负担。

### 2.5 `utils/` 86 个文件（P2）

多个薄封装、多版本并存：
- `localDocx.ts` + `localDocxV2.ts` — 两个 docx 转换版本
- `skillMaterialCompiler.ts` + `skillMaterialNormalizer.ts` + `skillMaterialRuntime.ts` + `skillTextBuilder.ts` + `skillCreatorScriptRunner.ts` + `skillCreatorWorkspace.ts` — 6 个 Skill 素材
- `editorContent.ts` + `editorDocument.ts` + `editorExport.ts` + `editorDiffBridge.ts` — 4 个编辑器
- `providerCapabilityProbe.ts` + `providerProbeBootstrap.ts` — 2 个探测

这些可以合并或按领域重组。

### 2.6 Composable 端混用（P2）

```
src/composables/
  useChat.ts          ← 桌面 + Web 双路径混在一起
  chatCloud.ts        ← 纯 Web
  webDirectEngine.ts  ← 纯 Web
  useCreation.ts      ← 桌面 + Web
  useFileStore.ts     ← 纯桌面
  useWorktree.ts      ← 纯桌面
```

没有物理隔离。改 `useChat.ts` 时不知道会不会影响 Web 端。

### 2.7 文档转换三引擎（P2）

`markitdown`（Microsoft）+ `docling`（IBM）+ `RapidOCR` 三个不同的文档转 Markdown 引擎。都依赖 Python 环境。`resolve_local_python()` 函数遍历多个路径查找 Python，平台差异大。

---

## 三、优化方案

### Phase 1: 拆分 lib.rs 为领域模块（P0）

**目标**：每个模块 200-500 行，可独立理解、独立测试。

```
src-tauri/src/
  lib.rs                   ← 仅 IPC 注册 + run()，约 200 行
  main.rs                  ← 不变
  commands/
    opencode.rs            ← OpenCode 进程管理（ensure_server / status / stop / mcp_status）
    browser.rs             ← 浏览器自动化（若保留）或直接删除
    mlx_model.rs           ← MLX 本地模型（若保留）
    media_capture.rs       ← 媒体下载（yt-dlp）
    media_convert.rs       ← FFmpeg 音视频处理
    doc_convert.rs         ← 文档转 Markdown
    dev_tools.rs           ← 项目文件读写（list / read / write / search / diff）
    system.rs              ← 剪贴板 / 通知 / 打开文件 / session token
    plugin.rs              ← 插件管理（npm install / manifest / config）
    mcp.rs                 ← MCP stdio 桥接
  services/
    http_proxy.rs          ← HTTP 代理（NewAPI 直连）
    worktree.rs            ← 已有，不变
    skills/                ← 已有，不变
    secure_store.rs        ← 已有，不变
```

**实施要点**：
- 拆分不改变任何行为——纯文件搬家
- 每拆一个模块，`cargo check --manifest-path src-tauri/Cargo.toml` 验证编译通过
- 公共类型（struct/enum）抽到 `types.rs`
- 公共工具函数抽到 `utils.rs`

### Phase 2: Binary sidecar 全移除（P0）

**目标**：不内置任何二进制。全部从用户系统 PATH 或 `~/.jiucaihezi/tools/` 读取。

**变更**：
- `binaries/` 目录清空（只保留 `opencode-runtime.json` 配置）
- `resolve_app_media_binary` 改为纯 `resolve_local_binary`
- `Cargo.toml` 移除不再需要的 `flate2`、`tar`（原用于解压 sidecar）
- Tauri `tauri.conf.json` 移除 `externalBin` 配置（如果有）
- `check_tool_installed` 增强：未找到时给出各平台的安装命令（`brew install ffmpeg`、`choco install ffmpeg`、`apt install ffmpeg`）
- 首次启动时运行 `check_tool_installed` 并提示用户

**缓解跨平台 bug**：用户装的工具就是适配自己平台的版本，不再有 aarch64 binary 在 Intel Mac 上跑不了的问题。

### Phase 3: 砍掉 Chromium 浏览器自动化（P1）

**目标**：移除 `chromiumoxide` 依赖和所有 `browser_*` 命令。

**变更**：
- 删除 `BrowserRuntime` / `BrowserSession` 相关代码（约 600 行）
- 删除 `browser_launch`、`browser_open`、`browser_read`、`browser_screenshot`、`browser_state`、`browser_search`、`browser_click`、`browser_type`、`browser_close` 命令
- `Cargo.toml` 移除 `chromiumoxide`
- `media_capture_site_args` 中 `--cookies-from-browser` 参数改为可选项（无浏览器时跳过）

**影响**：网页媒体下载（yt-dlp）的「使用浏览器 Cookie」功能受影响。替代方案：
- 用户在 yt-dlp 配置中自行设置 cookie 文件
- 或者保留 `--cookies-from-browser` 但不再自动管理浏览器进程（yt-dlp 自带浏览器 cookie 提取能力）

### Phase 4: 精简 utils/ 和按端分离 composable（P2）

**目标**：utils 从 86 个文件缩减到约 60 个；composable 按平台物理隔离。

**utils 合并**：

| 操作 | 文件 |
|---|---|
| 合并 | `localDocx.ts` + `localDocxV2.ts` → `localDocx.ts` |
| 合并 | `providerCapabilityProbe.ts` + `providerProbeBootstrap.ts` → `providerProbe.ts` |
| 合并 | `skillMaterial*` 6 个 + `skillTextBuilder.ts` → `skillMaterial.ts` |
| 合并 | `editorContent.ts` + `editorDocument.ts` + `editorDiffBridge.ts` → `editorCore.ts` |
| 删除 | `obsidianDetect.ts`（如确认无使用） |
| 删除 | `notebook*.ts`（如确认无使用） |

**composable 隔离**：

```
src/composables/
  core/               ← 桌面+Web 共用
    useChat.ts
    useTheme.ts
    useCreation.ts
    useFileUpload.ts
  desktop/            ← 仅桌面
    useFileStore.ts
    useWorktree.ts
  web/                ← 仅 Web
    chatCloud.ts
    webDirectEngine.ts
```

### Phase 5: 编辑器文件归位（P3）

**目标**：编辑器相关代码收束到 `src/components/editor/` 下。

**变更**：
- `editorContent.ts`、`editorDocument.ts`、`editorExport.ts`、`editorDiffBridge.ts` → 移入 `src/components/editor/`
- 更新 import 路径

### Phase 6: 确认画布归档（P3）

**目标**：清理不用的代码。

**变更**：
- 确认 `_canvas-archive/` 不再需要 → `git rm -r _canvas-archive/`
- 在 `AGENTS.md` 中移除所有画布引用

---

## 四、实施顺序

```
Phase 1: lib.rs 拆分（先拆，后续改动才能小范围进行）
Phase 2: Binary sidecar 全移除（减少跨平台 break）
Phase 3: 砍掉 Chromium 浏览器
Phase 4: utils 精简 + composable 隔离
Phase 5: 编辑器归位
Phase 6: 画布归档确认

每个 Phase 独立提交，独立验证。
```

---

## 五、不做（明确排除）

- ❌ 不删除创作面板（产品核心差异化功能）
- ❌ 不删除编辑区（产品核心差异化功能）
- ❌ 不删除 Skill / 工具仓库
- ❌ 不修改 NewAPI / rh-adapter
- ❌ 不删除 Ollama 本地模型支持
- ❌ 不删除自定义 provider（OpenAI-compatible）支持
- ❌ 不修改 OpenCode 集成层（`opencodeClient/`）
- ❌ 不把 Web 端升级为桌面工作台

---

## 六、验收标准

- `lib.rs` 从 ~5000 行缩减到 ~200 行（纯注册）
- `binaries/` 不再包含二进制文件
- `Cargo.toml` 移除 `chromiumoxide` 依赖
- `utils/` 从 86 文件缩减到约 60 个
- `composables/` 明确分离 `core/`、`desktop/`、`web/`
- `cargo check` + `vue-tsc -b` + `vite build` 均通过
- 桌面：文/武模式正常对话
- 桌面：创作面板正常
- Web：轻量聊天正常

---

## 七、决策记录

- **2026-07-04**: 全代码库架构审查完成，形成本文档。待用户确认后逐 Phase 实施。
