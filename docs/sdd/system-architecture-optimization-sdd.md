# SDD: 系统架构优化 — 收束核心、轻量化、跨平台稳健

> **状态**: 已决策，待实施（分支 `0704-xitongjiegou`）
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

### 2.1 `lib.rs` 功能审计：哪些留、哪些删（P0）

判断原则：**OpenCode 有的我们不留（交给它），OpenCode 没有但影响创作面板/Web 端的保留，其余删除**。

| 功能 | OpenCode 有？ | 影响创作/Web？ | 判定 | 理由 |
|---|---|---|---|---|
| OpenCode 进程管理 | ⬜ 我们管 OpenCode | 核心引擎 | ✅ **保留** | 桌面壳必须 |
| HTTP 代理 | ⬜ 没有 | API 基础设施 | ✅ **保留** | NewAPI 直连必须 |
| 项目文件读写 | ✅ 有 | 文件树 UI | ✅ **保留** | 小白文件树 |
| FFmpeg 处理 | ⬜ 没有 | 创作面板 | ✅ **保留** | 视频处理必须 |
| Skill 素材编译 | ✅ 有 | Skill 仓库 | ✅ **保留** | Skill 安装/编译 |
| 剪贴板 | ⬜ 没有 | 轻量工具 | ✅ **保留** | 复制粘贴 |
| Session Token | ⬜ 没有 | 登录系统 | ✅ **保留** | 账号体系 |
| 文档转换 | ⬜ 没有 | 不影响 | ⚠️ **简化** | 3 引擎→1 个 |
| 插件安装 | ✅ 有（plugin） | 不影响 | ⚠️ **简化** | 精简 npm 逻辑 |
| Git Worktree | ✅ 有（原生） | 不影响 | ❌ **删除** | OpenCode 原生 |
| MCP stdio 桥接 | ✅ 有（原生） | 不影响 | ❌ **删除** | OpenCode 原生 |
| MLX 本地模型 | ⬜ Ollama 已覆盖 | 不影响 | ❌ **删除** | 仅 Apple Silicon |
| Chromium 浏览器 | ⬜ 没有 | 不影响 | ❌ **删除** | 重量依赖无人用 |
| yt-dlp 媒体下载 | ⬜ 没有 | 不影响 | ❌ **删除** | 与创作面板无关 |
| 截图 | ⬜ 没有 | 随浏览器 | ❌ **删除** | 浏览器配套功能 |

**结论**：15 项 → 保留 7 项，简化 2 项，删除 6 项。删除的主要是**OpenCode 原生已有**（Worktree、MCP）或**平台受限/无人用**（MLX、Chromium、yt-dlp）的功能。

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

**原则**：先把确定要删的砍掉，再拆分剩下的。删错了容易回滚，拆错了难排查。

#### 0.1 删除 MLX 本地模型

- 删除所有 `local_mlx_*` 命令（约 500 行 Rust）
- 删除 `LocalMlxRuntime` / `LocalMlxSession`
- 删除 `src/utils/localMlxRuntime.ts`
- 删除 `src/utils/providerConfig.ts` 中 MLX 相关常量
- 前端 `agentStore.ts` 中移除 MLX model entries
- 前端设置面板移除 MLX 安装/管理 UI

**保留 Ollama**：用户用 Ollama 跑本地模型，不管理任何模型生命周期。

#### 0.2 删除 Chromium 浏览器自动化

- 删除所有 `browser_*` 命令（约 600 行 Rust）
- 删除 `BrowserRuntime` / `BrowserSession`
- `Cargo.toml` 移除 `chromiumoxide = "0.9.1"`
- 删除 `src/utils/browserTools.ts`

#### 0.3 删除 MCP stdio 桥接

- 删除 `mcp_spawn_stdio` / `mcp_write_stdin` / `mcp_kill_stdio` 命令
- 删除 `McpStdioProcess` / `MCP_PROCESSES`
- OpenCode 原生管理 MCP，我们不用重复造轮子

#### 0.4 删除 yt-dlp 媒体下载

- 删除所有 `media_url_*` 命令（约 500 行 Rust）
- 删除 `MediaCaptureJobs` / `MediaCaptureCommandCandidate`
- 删除 `src-tauri/src/lib.rs` 中 `MediaCaptureJobs`
- 前端如有引用 `media-url-*` 事件，一并清理

#### 0.5 删除 Git Worktree

- 删除 `worktree_create` / `worktree_list` / `worktree_remove` 命令
- 删除 `src-tauri/src/worktree.rs`
- 删除 `src/composables/useWorktree.ts`
- OpenCode 有原生 worktree 功能

#### 0.6 删除画布归档

- `git rm -r _canvas-archive/`
- AGENTS.md 移除所有画布引用

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
    media_convert.rs       ← FFmpeg 音视频处理
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

### Phase 2: Binary sidecar 全移除（P0）

- `binaries/` 目录清空，只保留 `opencode-runtime.json`
- `resolve_app_media_binary` → 纯 `resolve_local_binary`
- `Cargo.toml` 移除 `flate2`、`tar`
- `check_tool_installed` 增强：给出平台安装命令

---

### Phase 3: 文档转换简化 + 插件简化（P2）

- 文档转换：3 引擎 → 保留 1 个最稳定的（`markitdown`）
- 插件：精简 npm install 逻辑

---

### Phase 4: 精简 utils/ + 按端分离 composable（P2）

**utils 合并**：

| 操作 | 文件 |
|---|---|
| 合并 | `localDocx.ts` + `localDocxV2.ts` → `localDocx.ts` |
| 合并 | `providerCapabilityProbe.ts` + `providerProbeBootstrap.ts` → `providerProbe.ts` |
| 合并 | `skillMaterial*` + `skillTextBuilder.ts` → `skillMaterial.ts` |
| 合并 | `editorContent.ts` + `editorDocument.ts` + `editorDiffBridge.ts` → `editorCore.ts` |
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

## 四、实施顺序

```
Phase 0: 删除死重（MLX + Chromium + MCP + yt-dlp + Worktree + 画布）
Phase 1: 拆分 lib.rs（在精简后的代码上拆分）
Phase 2: Binary sidecar 全移除
Phase 3: 文档转换简化 + 插件简化
Phase 4: utils 精简 + composable 隔离
Phase 5: 编辑器文件归位

每个 Phase 独立提交，每步跑 cargo check + vue-tsc -b 验证。
```

---

## 五、不做（明确排除）

- ❌ 不删除创作面板（产品核心差异化功能）
- ❌ 不删除编辑区（产品核心差异化功能）
- ❌ 不删除 Skill / 工具仓库
- ❌ 不修改 NewAPI / rh-adapter
- ❌ 不删除 Ollama 本地模型支持（通过 providerProjection 接入 OpenCode）
- ❌ 不删除自定义 provider（OpenAI-compatible）支持
- ❌ 不修改 OpenCode 集成层（`opencodeClient/`）
- ❌ 不把 Web 端升级为桌面工作台

---

## 六、验收标准

- Phase 0: 删除 ~1800 行 Rust + ~200 行 TS；`cargo check` + `vue-tsc -b` + `vite build` 通过
- Phase 1: `lib.rs` 缩减到 ~200 行（纯注册）；6 个领域模块独立可读
- Phase 2: `binaries/` 不再包含二进制；跨平台不再因 sidecar 架构报错
- Phase 3: 文档转换从 3 引擎 → 1 个；插件 npm 逻辑精简
- Phase 4: `utils/` 从 86 → ~55 文件；`composables/` 分离 `core/` `desktop/` `web/`
- Phase 5: 编辑器代码归入 `editor/` 目录
- 全程：桌面文/武正常、创作面板正常、Web 聊天正常

---

## 七、决策记录

- **2026-07-04**: 全代码库架构审查完成，形成本文档初版
- **2026-07-04**: 用户确认：全部 5 项删除判定（MLX/Chromium/MCP/yt-dlp/Worktree）；画布直接删除不归档；Phase 4 前端整理也要做
