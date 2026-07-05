# SDD: 系统架构优化 — 收束核心、轻量化、跨平台稳健

> **状态**: Phase 0 ✅ | Phase 1 ✅ | Phase 2 ✅ | Phase 3 ✅ | Phase 4 ✅ | Phase 5 ✅ **全部完成！**
> **日期**: 2026-07-05（更新）
> **最后提交**: `55b45fa` refactor(Phase5): 编辑器文件归位
> **分支**: `xitonggoujia`
> **作者**: by3 / Codex
> **背景**: `0704-shanchuzhilian` 结束后进行的全代码库架构审查。产品定位已明确：**OpenCode 的小白版本**。在此基础上收束架构，删除冗余，降低跨平台 bug。

---

## 一、产品定位收束

韭菜盒子 Studio 的定位是：

> **OpenCode 的小白版桌面壳**。核心引擎是 OpenCode，我们做的是：极简聊天界面 + 一键登录/模型配置 + 编辑器 + Skill/工具仓库 + 指令按钮 + 云端创作面板——这些是 OpenCode 没有的「小白友好层」。Agent 执行层能力以 OpenCode 为唯一事实源；韭菜盒子只保留面向小白用户的入口、配置、展示和内容管理能力。

| 我们做什么 | 我们不做（交给 OpenCode） |
|---|---|
| 聊天 UI（文/武切换） | Agent 调度和工具执行 |
| 一键登录/模型配置 | 让用户手填 Key、URL、模型名 |
| 编辑器（查看/整理 OpenCode 写出的内容） | Agent 的 Git 操作 |
| Skill / 工具仓库管理 | Agent 的 MCP 调用 |
| 指令按钮 / Skill 入口 | 让小白自己研究怎么写复杂提示词 |
| 云端创作面板（生图/生视频/生音频 API） | 本地媒体转码/下载/转写 |
| 项目文件树 / 产物浏览 | Shell 命令执行 |

边界原则：

1. **OpenCode 负责执行**：模型运行、上下文组织、工具调用、文件修改、Shell、Git、权限审批，都以 OpenCode 官方能力为准。
2. **韭菜盒子负责入口**：用户如何登录、选模型、看文件、管理 Skill/工具、点击指令、预览云端创作产物、编辑文本，是小白壳的产品层能力。
3. **本地媒体工具不承诺开箱即用**：ffmpeg、yt-dlp、whisper、浏览器自动化等开源工具只进入工具仓库推荐列表；App 不内置、不维护生命周期、不把缺失视为核心启动失败。
4. **删除前必须有替代或产品删除**：OpenCode 有能力 ≠ 我们的 UI 可以直接删除。删除任何本地能力前，必须确认没有产品入口依赖它，或已有 OpenCode SDK/事件流替代路径。

### 1.1 跨平台安装目标（P0）

用户从 GitHub Release 下载对应平台安装包后，核心路径必须成立：

```
下载 → 安装/解压 → 打开 App → 登录/填 Key → 选择模型 → 文/武对话进入 OpenCode
```

验收口径：

- macOS Apple Silicon、macOS Intel、Windows x64 都必须有对应产物；Linux 只有明确发布时才纳入承诺。
- 干净机器上不要求预装 Node/Rust/ffmpeg/yt-dlp/whisper/Chromium。
- **唯一必须保障的是 OpenCode runtime**：App 内置、随包下载、或首启一键修复三选一；不能要求小白先去命令行安装 OpenCode。
- Windows 若继续发布 portable zip，必须明确“解压整个文件夹后运行”；目标形态应升级为安装器（NSIS/MSI）并处理 WebView2 引导。
- 本地媒体工具缺失只能影响对应工具卡/Skill，不允许导致 App 白屏、卡 logo、文/武对话不可用。

官方参考：

- OpenCode 官方 CLI 默认运行 `opencode` 进入 TUI，也支持 `opencode run`、`opencode serve`、`opencode mcp`、`opencode plugin` 等命令：https://opencode.ai/docs/cli/
- OpenCode 官方提供 Terminal 安装方式和 Desktop Beta 下载，覆盖 macOS Apple Silicon / Intel、Windows x64、Linux deb/rpm：https://opencode.ai/download
- OpenCode Desktop 自身也是在后台运行本地 `opencode-cli` sidecar/server：https://opencode.ai/docs/troubleshooting/

---

## 二、当前架构问题清单

### 2.1 `lib.rs` 功能审计：哪些留、哪些删（P0）

判断原则：**Agent 执行层交给 OpenCode；产品壳层入口只在确实无人用、无核心价值、或已有 OpenCode SDK 替代时删除。**

| 功能 | OpenCode 有？ | 影响创作/Web？ | 判定 | 理由 |
|---|---|---|---|---|
| OpenCode 进程管理 | ⬜ 我们管 OpenCode | 核心引擎 | ✅ **保留** | 桌面壳必须 |
| HTTP 代理 | ⬜ 没有 | API 基础设施 | ✅ **保留** | NewAPI 直连必须 |
| 项目文件读写 | ✅ 有 | 文件树 UI | ✅ **保留** | 小白文件树 |
| FFmpeg/本地媒体处理 | ⬜ 没有 | 工具仓库/部分 Skill | ❌ **迁出核心** | 不承载本地媒体工具，交给工具仓库 + OpenCode 辅助安装 |
| Skill 素材编译 | ✅ 有 | Skill 仓库 | ✅ **保留** | Skill 安装/编译 |
| 剪贴板 | ⬜ 没有 | 轻量工具 | ✅ **保留** | 复制粘贴 |
| Session Token | ⬜ 没有 | 登录系统 | ✅ **保留** | 账号体系 |
| 文档转换 | ⬜ 没有 | 不影响 | ⚠️ **简化** | 3 引擎→1 个 |
| 插件安装 | ✅ 有（plugin） | 不影响 | ⚠️ **简化** | 精简 npm 逻辑 |
| Git Worktree | ✅ 有（原生） | WorktreeDialog 入口 | ⚠️ **条件删除** | 先删/替换 UI 入口，再删 IPC |
| MCP stdio 桥接 | ✅ 有（原生） | 工具/Skill 测试可能依赖 | ⚠️ **条件删除** | 确认仓库 UI 不再本地连 MCP |
| MLX 本地模型 | ⬜ Ollama 已覆盖 | 不影响 | ❌ **删除** | 仅 Apple Silicon |
| Chromium 浏览器 | ⬜ 没有 | 不影响 | ❌ **删除** | 重量依赖无人用 |
| yt-dlp 媒体下载 | ⬜ 没有 | 工具仓库 | ❌ **迁出核心** | 只保留 GitHub 项目推荐和安装指令 |
| 截图 | ⬜ 没有 | 随浏览器 | ❌ **删除** | 浏览器配套功能 |

**结论**：15 项 → 保留核心壳层能力，简化文档/插件链路，删除或迁出本地执行工具。删除的主要是**平台受限/低价值/历史遗留**（MLX、Chromium、本地媒体工具、yt-dlp）；Worktree、MCP 必须先处理产品入口；画布和知识库备份移出工作区归档保存。

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

代码里已有 fallback 到 `PATH` / `~/.jiucaihezi/tools/` 的逻辑，但历史方案把本地媒体工具当成“开箱即用”能力，导致 Intel Mac 和 Windows 上容易断。正确目标是：**核心 App 不依赖这些工具启动；工具仓库只提供 GitHub 项目、安装链接和可发送给 OpenCode 的安装指令。**

### 2.3 `utils/` 86 个文件（P2）

多个薄封装、多版本并存：
- `localDocx.ts` + `localDocxV2.ts` — 两个 docx 转换版本
- `skillMaterialCompiler.ts` + `skillMaterialNormalizer.ts` + `skillMaterialRuntime.ts` + `skillTextBuilder.ts` + `skillCreatorScriptRunner.ts` + `skillCreatorWorkspace.ts` — 6 个 Skill 素材
- `editorContent.ts` + `editorDocument.ts` + `editorExport.ts` + `editorDiffBridge.ts` — 4 个编辑器
- `providerCapabilityProbe.ts` + `providerProbeBootstrap.ts` — 2 个探测

这些可以合并或按领域重组。

### 2.4 Composable 端混用（P2）

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

### 2.5 文档转换三引擎（P2）

`markitdown`（Microsoft）+ `docling`（IBM）+ `RapidOCR` 三个不同的文档转 Markdown 引擎。都依赖 Python 环境。`resolve_local_python()` 函数遍历多个路径查找 Python，平台差异大。

---

## 三、优化方案

### Phase 0: 删除死重（P0 — 先删，后拆）

**原则**：先砍确定无价值的旧能力，再拆分剩下的。删除 IPC 前先 `rg` 全部前端入口；有 UI 入口的能力必须整套删除或改成 OpenCode 替代，不能只删后端半截。

#### 0.1 删除 MLX 本地模型

- 删除所有 `local_mlx_*` 命令（约 500 行 Rust）
- 删除 `LocalMlxRuntime` / `LocalMlxSession`
- 删除 `src/utils/localMlxRuntime.ts`
- 删除 `src/utils/providerConfig.ts` 中 MLX 相关常量
- 前端 `agentStore.ts` 中移除 MLX model entries
- 前端设置面板移除 MLX 安装/管理 UI
- 迁移旧 localStorage：`jcModelProviderId=local-mlx` / `jcModel=local-mlx/*` → 清空或切到 Ollama/云端默认模型
- 删除 `api.ts`、`agentStore.ts`、`runtimeCapabilities.ts`、`llmRuntime.ts` 中 MLX 分支和对应测试

**保留 Ollama**：用户用 Ollama 跑本地模型，不管理任何模型生命周期。

#### 0.2 删除 Chromium 浏览器自动化

- 删除所有 `browser_*` 命令（约 600 行 Rust）
- 删除 `BrowserRuntime` / `BrowserSession`
- `Cargo.toml` 移除 `chromiumoxide = "0.9.1"`
- 删除 `src/utils/browserTools.ts`
- 删除/隐藏工具仓库和旧直连工具系统中的 browser tool 入口
- 保留 OpenCode 自己的 Web/Search 能力；韭菜盒子不再维护 Chromium 会话

#### 0.3 删除 MCP stdio 桥接

- 删除 `mcp_spawn_stdio` / `mcp_write_stdin` / `mcp_kill_stdio` 命令
- 删除 `McpStdioProcess` / `MCP_PROCESSES`
- 删除 `src/services/mcpStdioTransport.ts`
- 前置条件：确认工具仓库/Skill 仓库没有“本地测试 MCP server”入口；如仍需要，先改为 OpenCode 原生 MCP 配置/测试路径

#### 0.4 删除 yt-dlp / 本地媒体工具开箱即用残余

- 删除所有 `media_url_*` 命令（约 500 行 Rust）
- 删除 `MediaCaptureJobs` / `MediaCaptureCommandCandidate`
- 删除 `src-tauri/src/lib.rs` 中 `MediaCaptureJobs`
- 前端如有引用 `media-url-*` 事件，一并清理
- 删除“内置 ffmpeg/yt-dlp/whisper”的开箱即用文案和检测流程
- 工具仓库保留 GitHub 项目卡片、安装链接、安装指令；点击后把指令送入 OpenCode 对话，由 OpenCode 辅助小白执行

#### 0.5 删除 Git Worktree

- 删除 `worktree_create` / `worktree_list` / `worktree_remove` 命令
- 删除 `src-tauri/src/worktree.rs`
- 删除 `src/composables/useWorktree.ts`
- 删除或替换 `WorktreeDialog.vue` 及其入口
- 前置条件：产品上确认不再提供“Git Worktree 沙箱”独立 UI；若保留 UI，必须先接 OpenCode 原生 worktree 能力

#### 0.6 清理工作区归档文件

- `_canvas-archive/` 和 `知识库备份/` 移出工作区 → `~/Documents/知识库和画布备份/`
- AGENTS.md 移除所有画布引用
- 工作区根目录只保留活跃代码

**Phase 0 验收**：`cargo check` + `vue-tsc -b` + `vite build` 通过

---

### Phase 1: 拆分 lib.rs 为领域模块（P0）

**时机**：Phase 0 删除死重后，lib.rs 从 ~5000 行缩减到约 3500 行，再拆分。

```
src-tauri/src/
  lib.rs                   ← 仅 IPC 注册 + run()，约 150 行
  main.rs                  ← 不变
  commands/
    opencode.rs            ← OpenCode 进程管理
    creation.rs            ← 云端创作 API / 产物引用（不含本地 ffmpeg 生命周期）
    doc_convert.rs         ← 文档转 Markdown（简化后）
    dev_tools.rs           ← 项目文件读写
    system.rs              ← 剪贴板 / 打开文件 / session token
    plugin.rs              ← 插件管理（简化后）
  services/
    http_proxy.rs          ← HTTP 代理
    skills/                ← 已有，不变
    secure_store.rs        ← 已有，不变
```

**拆分不改变行为——纯文件搬家。** 每拆一个模块跑 `cargo check`。

---

### Phase 2: 本地工具 sidecar 移出核心（P0）

- `binaries/` 目录不再放 ffmpeg/ffprobe/yt-dlp/whisper-cli 这类平台受限二进制
- OpenCode runtime 不能影响小白首启：保留内置、自动下载或一键修复其一，不能只提示用户自行安装
- `resolve_app_media_binary` → 纯 `resolve_local_binary`
- `Cargo.toml` 移除 `flate2`、`tar`
- `check_tool_installed` 只服务工具仓库状态展示；缺失本地媒体工具不影响 App 启动和 OpenCode 对话
- 工具仓库安装动作改为“发送安装指令到对话框”，由 OpenCode 辅助执行/解释，不由韭菜盒子维护安装器

---

### Phase 3: 文档转换简化 + 插件简化（P2）

- 文档转换：3 引擎 → 保留 1 个最稳定的（`markitdown`）
- 删除慢、重、不可控兜底链路；PDF/Office/OCR 支持边界写进错误提示，不隐式多方案回退
- 插件：精简 npm install 逻辑

---

### Phase 4: 按端分离 composable + 必要 utils 精简（P2）

第一优先级是边界，不是文件数量。只整理会降低误伤风险的文件；不要为了“86 个文件变 55 个文件”做大搬家。

**utils 合并**：

| 操作 | 文件 |
|---|---|
| 合并 | `localDocx.ts` + `localDocxV2.ts` → `localDocx.ts` |
| 合并 | `providerCapabilityProbe.ts` + `providerProbeBootstrap.ts` → `providerProbe.ts` |
| 视情况合并 | `skillMaterial*` + `skillTextBuilder.ts` → `skillMaterial.ts` |
| 视情况合并 | `editorContent.ts` + `editorDocument.ts` + `editorDiffBridge.ts` → `editorCore.ts` |
| 删除 | `localMlxRuntime.ts`、`browserTools.ts`、`obsidianDetect.ts`（如无引用） |

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
    useWorktree.ts ← 随 Phase 0.5 删除
  web/                ← 仅 Web
    chatCloud.ts
    webDirectEngine.ts
```

---

### Phase 5: 编辑器文件归位（P3）

- `editor*.ts` → `src/components/editor/`，更新 import 路径

---

## 四、实施顺序与当前进度

### 已完成 ✅

| Phase | 内容 | 提交 |
|-------|------|------|
| 0.1-0.6 | Phase 0 全部：删 MLX/MCP/Chromium/yt-dlp/Worktree | ✅ `9411e43` |
| 1 | **lib.rs 拆分完成**：11 个模块全部提取 | ✅ `1652e0b` |
| 2 | 移除内置媒体二进制 + 简化 resolve_app_media_binary | ✅ `b1d6207` |

**成果**: lib.rs 6229 → 1628 行 (-74%)。

### 模块清单（11 个全部完成）

| 模块 | 行数 | 内容 |
|------|------|------|
| media.rs | 1648 | 媒体处理 + 文档转换（OCR 已删） |
| dev.rs | 617 | 项目文件读写 + 开发工具 |
| opencode.rs | 532 | OpenCode 进程管理 |
| tools.rs | 432 | 工具检测 + resolve_* 辅助函数 |
| skill_material.rs | 324 | Skill 素材编译 |
| http.rs | 304 | HTTP 代理 |
| plugin.rs | 68 | 插件管理 |
| session.rs | 59 | 登录 token |
| obsidian.rs | 51 | Obsidian 检测 |
| greet.rs | 38 | greet + save_generated_file |
| clipboard.rs | 11 | 剪贴板 |

### 全部完成 ✅

| Phase | 内容 | 提交 |
|-------|------|------|
| 0 | 删 MLX/MCP/Chromium/yt-dlp/Worktree | `9411e43` |
| 1 | lib.rs 拆 11 模块 (6229→1628) | `418103b` |
| 2 | 移除媒体二进制 + 简化 resolve | `b1d6207` |
| 3 | 删 RapidOCR ~500行 | `3e18433` |
| 4 | composable web/ 隔离 + 删 obsidianDetect | `21d05fc` |
| 5 | 编辑器文件归位 | `55b45fa` |

---

## 五、不做（明确排除）

- ❌ 不删除创作面板（产品核心差异化功能）
- ❌ 不删除编辑区（产品核心差异化功能）
- ❌ 不删除 Skill / 工具仓库
- ❌ 不修改 NewAPI / rh-adapter
- ❌ 不删除 Ollama 本地模型支持（通过 providerProjection 接入 OpenCode）
- ❌ 不删除自定义 provider（OpenAI-compatible）支持
- ❌ 不重写 OpenCode 集成层（`opencodeClient/`）；必要时只做对齐官方 SDK 的小改
- ❌ 不把 Web 端升级为桌面工作台
- ❌ 不承诺本地媒体工具开箱即用；ffmpeg/yt-dlp/whisper/浏览器自动化只作为工具仓库推荐项

---

## 六、验收标准（项目级）

- ✅ Phase 0: 删除 ~2200 行 Rust + ~350 行 TS；全部验证通过
- ✅ Phase 1: **lib.rs 6229 → 1628 行**；11 个模块全部提取；验证通过
- ✅ Phase 2: 4 个媒体二进制已移除；`resolve_app_media_binary` 简化为纯 PATH 查找
- ✅ Phase 3: OCR 引擎已删除 (~500行)；markitdown 为唯一文档转换引擎
- ✅ Phase 4: `composables/web/` 隔离 Web 专属文件；obsidianDetect 删除
- ✅ Phase 5: 编辑器文件归入 `src/components/editor/`
- 全程：桌面文/武正常、创作面板正常、Web 聊天正常
- 跨平台安装：macOS ARM、macOS Intel、Windows x64 在干净机器上安装/解压后，App 能打开、登录/填 Key、启动 OpenCode 文/武对话

---

## 七、决策记录

- **2026-07-04**: 全代码库架构审查完成，形成本文档初版
- **2026-07-04**: 用户确认：全部 5 项删除判定（MLX/Chromium/MCP/yt-dlp/Worktree）；画布直接删除不归档
- **2026-07-04**: Phase 0 全部完成（提交 `9411e43`），lib.rs 6229→5916 行
- **2026-07-04**: Phase 1 HTTP 模块提取完成（提交 `0318491`），建立 `commands/` 目录结构和模块样板
- **2026-07-05**: Phase 1 全部完成。11 个模块全部提取，lib.rs 6229 → 1628 行 (-74%)。采用"函数搬走 + struct 暂留 + crate::* glob import"的渐进策略。
- **2026-07-05**: Phase 2 媒体二进制移除完成。删除 4 个 aarch64-only 二进制，resolve_app_media_binary 简化为纯 PATH 查找。
- **2026-07-05**: Phase 3-5 全部完成。OCR 删除 (~500行)、composable web/ 隔离、编辑器文件归位。全部验证 cargo check + vue-tsc 零错误。

---

## 八、AI 交接清单

> **当前状态**: Phase 0-5 ✅ 全部完成  
> **分支**: `xitonggoujia`  
> **验证命令**: `cargo check --manifest-path src-tauri/Cargo.toml && pnpm exec vue-tsc -b`  
> **lib.rs**: 1628 行（从 6229 缩减 74%）  
> **commands/**: 11 个模块文件 (~4600 行合计)

### 已完成 ✅

全部 11 个模块已提取到 `src-tauri/src/commands/`：
http / tools / opencode / skill_material / dev / media / clipboard / greet / session / plugin / obsidian

Phase 0-5 全部完成 ✅。媒体二进制已删除（仅保留 opencode），`resolve_app_media_binary` 简化为纯 PATH 查找。
OCR 已删除 ~500 行，markitdown 为唯一文档转换引擎。composable web/ 目录已隔离。编辑器文件已归位。
