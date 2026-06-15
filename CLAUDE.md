# 韭菜盒子 Studio - AI 协作者上手手册

> **2026-06 重要更新（AI 协作者必读）**：
> 云端轻量创作台（创作面板 + 画布 + 编辑区 + 对话）是当前产品**重心**。桌面端是次要产品，主要目标是忠实复刻 OpenCode 官方能力。
>
> **任何新的 AI 会话或不同开发工具，必须先完整阅读**：本文件 + AGENTS.md。
>
> 云端优先开发原则：
> - 优先保证云端轻量、简洁、可快速迭代。
> - 共享的创作组件主要是画布、创作面板、编辑区，改动必须首先对云端友好、干净。
> - 对话（聊天）不是完全共享的核心：
>   - 云端走轻量简化（标准 LLM 消息 + system prompt，直接 NewAPI 云端路径，不走 OpenCode parts）。
>   - 桌面专注 100% 复刻官方 OpenCode（project directory 贯穿、完整 timeline/permission/question/session 命令 + 事件驱动）。
>   两者可复用部分 UI 组件保持一致，但执行引擎和上下文管理是两条独立路径。
>
> 本文档是本仓库的产品说明、架构边界和开发作业手册。目标：AI 协作者读完后，可以在不重新考古旧设计的情况下开始安全改代码。
>
> 最后更新：2026-06-14
> 当前发布基线：`v0.1.7`（云端轻量创作台为当前重心）。

---

## 分支边界（必须遵守）

当前产品有两条并行开发线：

- 桌面 APP 主线：`codex/opencode-core-execution`
  - 负责桌面端 OpenCode 文 / 武模式、Tauri、opencodeClient、project directory、timeline、permission、桌面打包发布。
  - 不允许混入 WongSaang/chatgpt-ui 的 Web 直连实验代码。

- Web 直连主线：`codex/web-direct-wongsaang`
  - 负责 Web 端直连模式、WongSaang/chatgpt-ui 核心能力、Web 会话历史、streaming、tools、web search、持久化。
  - 不允许修改 `src-tauri/**`、`src/opencodeClient/**`，不得影响桌面 OpenCode 文 / 武模式。

最终发布整合分支是 `main`。`main` 只接收已验证的桌面分支和 Web 分支，不作为日常实验分支。

合并顺序：

1. 桌面分支单独验证通过后合并到 `main`。
2. Web 分支单独验证通过后合并到 `main`。
3. 合并前必须做边界审计，确认 Web 改动没有污染桌面 OpenCode，桌面改动没有夹带 Web direct/WongSaang 实验。

---

## 0. 当前结论

韭菜盒子 Studio 已经进入接近成熟的桌面产品阶段。当前主线不是通用 Agent、不是自动替用户做所有选择的黑盒 Agent Loop，而是：

```text
用户选择项目目录
用户选择 Skill 或不选
用户选择工具开关
用户选择模型
用户输入任务
OpenCode / NewAPI / 本地工具按显式配置执行
```

最重要的现状：

- **项目目录是 OpenCode 运行链路的核心上下文**：project directory 必须贯穿 server/client/session/tool，不能只存在 UI 选择器里。
- **知识库主产品面已删除**：旧“创建知识库 / 知识库仓库 / Vault picker / VaultWizard / BrainPanel”已经退出主界面。备份放在 `知识库备份/`，未来要恢复时从备份取，不要在当前主链路里继续引用旧 Vault。
- **Skill 仓库是当前重点**：保留中央 Skill 库能力、GitHub 导入、Skill 仓库、别名编辑展示；文案上统一叫“Skill 仓库”，不是“知识库”。
- **账号登录和手动 API Key 双路线共存**：用户已登录或填 Key 后，不应再提示“当前没有可用于模型调用的 API Key”。手动 Key 永远优先；无手动 Key 时才走账号 Session。
- **三平台发布已打通**：macOS ARM DMG、macOS Intel DMG、Windows x64 portable zip。

---

## 1. AI 开发行为规范

### 1.1 先理解再修改

开始动代码前先搞清楚：

- 用户要解决的具体问题是什么。
- 当前代码真实状态是什么。
- 旧设计是否已经废弃。
- 修改会影响哪些模块。

如果需求存在歧义，先用自然语言说清楚你的理解，再行动。不要默默猜。

### 1.2 外科手术式修改

只改当前任务需要改的文件。禁止顺手：

- 重构无关模块
- 格式化大文件
- 升级依赖
- 删除用户未要求删除的内容
- 回滚用户或其他协作者的改动

当前仓库可能存在未提交改动。遇到 dirty worktree 时，默认认为它们是用户改动；除非任务要求，否则不要碰。

### 1.3 验证才算完成

代码写完不等于完成。根据改动范围选择验证：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
pnpm run test:focused:run
pnpm run test:tauri
pnpm run tauri:build
```

发布/CI 相关改动至少检查：

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
```

桌面包和 release workflow 修改后，还要解释哪些内容只能在 GitHub Actions 的目标平台验证。

### 1.4 沟通原则

回答用户时：

- 先说结论，再说证据。
- 不夸大“彻底修复”，除非已经验证。
- 遇到 CI 失败先找真实日志，不要猜。
- 解释 GitHub/tag/release 这类问题时，用具体 tag、commit、run 号。

---

## 2. 产品定位

韭菜盒子 Studio 是一个本地优先的纯手动 AI 工作台桌面应用。它服务三类核心任务：

1. **对话和项目协作**：通过 OpenCode 内核在用户选择的项目目录中读写、搜索、运行命令。
2. **Skill 工作流**：用户选择官方 Skill 形态的能力包，LLM 按 SKILL.md 执行。
3. **创作和工具**：图片、视频、音频、文档导出、网页媒体采集、本地文件处理等工具由用户显式开启。

禁止默认产品形态：

- 通用 Agent
- 自主决策 Agent
- 开放式 Agent Loop
- AI 自动选择 Skill/Tool/Model/项目目录
- 用户不可控的黑盒工作流

Superpower / 帮我配置只保留为未来运行前配置助手：它可以推荐 Skill、Tool、Model、项目目录，但用户确认前不得进入执行链。

---

## 3. 当前信息架构

### 3.1 主界面

当前主布局仍是桌面工作台结构：

```text
ActivityRail
  Skills / Tools / Creation / Canvas / Settings / Help 等入口

FileTreePanel
  历史会话 / 文本与文件 / 画布相关入口

ChatPanel
  第 4 列始终是对话区
  承载 OpenCode timeline、工具卡片、消息渲染、输入框、模型选择

Right panels
  Skill 管理、工具仓库、创作面板、设置等
```

### 3.2 已删除的知识库主链路

以下内容已从主产品链路删除：

- `VaultPickerBar`
- `VaultWizard`
- `BrainPanel`
- `vaultStore`
- `useBrain`
- `useVaultCompiler`
- 旧 `vault*` 工具链
- ActivityRail 中的“创建知识库 / 知识库仓库”
- ChatPanel 中的知识库选择器
- Tauri capability 中 `.jiucaihezi-vaults/current` 相关 scope

备份目录：

```text
知识库备份/
```

后续原则：

- 不要把旧 Vault 重新接回 ChatPanel。
- 不要新增“知识库选择器”。
- 如果未来要重启这条产品线，从 `知识库备份/` 单独做新方案，而不是把旧代码偷偷接回来。
- Obsidian Vault 相关命名如果出现在 Skill 管理里，属于 Skill 来源/发现能力，不等于旧知识库主产品面。

---

## 4. OpenCode 集成原则

OpenCode 是当前项目协作链路的核心。必须完整复刻官方“project directory 贯穿 server/client/session/tool”的数据流，而不是把某个路径硬编码成事实来源。

标准数据流：

```text
用户在 UI 选择项目目录
  ↓
客户端保存当前 project directory
  ↓
ensureOpenCodeServer / session 创建时传入 project directory
  ↓
OpenCode server 以该目录作为 workspace/project root
  ↓
session / prompt / tool call 都带同一 project context
  ↓
文件读写、搜索、命令执行都限制在该目录语义内
```

关键文件：

- `src/opencodeClient/*`
- `src/composables/useChat.ts`
- `src/stores/sessionStore.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- `src/utils/devProjectTools.ts`

硬性规则：

- UI 选择项目目录必须真的进入 OpenCode server/client/session/tool 链路。
- 不能只在聊天 prompt 里说“项目是某路径”。
- 不能默认落到 `~/.jiucaihezi/opencode-runtime/workspace/default` 后还声称已选择项目。
- 遇到 `forbidden path` 时先查 Tauri capability scope 和实际路径流，不要绕过权限。
- OpenCode 官方 timeline、permission、question、todo、tool parts 要作为一等 UI carrier，不要压扁成普通 markdown。

---

## 5. Skill 仓库

### 5.1 Skill 定义

Skill 就是官方 Anthropic Skill，目录形态：

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

原则：

- 不发明私有 Skill schema。
- 不把 Skill 改造成 Agent。
- `SKILL.md` 是核心。
- references/scripts/assets 按 progressive disclosure 加载。

### 5.2 当前 Skill 产品形态

当前重点是 Skill 仓库能力：

- 中央 Skill 库
- GitHub 导入
- Skill 仓库展示
- Skill 详情
- 编辑显示别名
- 平台/安装状态
- collections / marketplace / discovery 能力

相关目录：

- `src/components/skills/`
- `src/stores/skillsManageStore.ts`
- `src/utils/*Skill*`
- `src-tauri/src/skills/`
- `public/skills/`
- `~/.agents/skills/`

旧 `agentStore.ts` 仍有兼容职责，但新产品理解应围绕真实 Skill 包和 Skill 仓库，不围绕旧 Agent 配置。

### 5.3 命名

产品文案尽量使用：

- Skill
- Skill 仓库
- 中央 Skill 库
- GitHub 导入
- 平台安装

避免把 Skill 仓库叫“知识库”。

---

## 6. 账号、Key 与 NewAPI

当前是双路线鉴权：

```text
路线 A：手动 API Key
用户粘贴 sk-xxx
  → 安全存储/内存缓存
  → resolveApiConfig() 返回真实 key
  → /v1/* 直连 NewAPI 源站

路线 B：账号登录 Session
用户一键登录
  → Cloudflare Worker / auth 登录
  → Session 安全存储
  → 无手动 Key 时 resolveApiConfig() 返回 Session 路线
  → /v1/* 通过 Worker 代理调用
```

硬性规则：

- 手动 Key 永远优先。
- 用户已登录且有可用 Session 时，不要再提示“当前没有可用于模型调用的 API Key”。
- “Platform” 这类内部/英文概念不应暴露给普通用户。
- 注册入口不在应用内重做；需要注册时打开 NewAPI 注册页。

关键文件：

- `src/utils/api.ts`
- `src/services/newApiClient.ts`
- `src/services/newApiAuth.ts`
- `src/components/settings/SettingsPanel.vue`
- `src-tauri/src/lib.rs`

---

## 7. 创作面板与媒体模型

创作面板负责图片、视频、音频生成。当前媒体生成统一走主 NewAPI Token，不再提供独立媒体 Key。

关键链路：

```text
CreationPanel
  → mediaTaskStore
  → media-generation.ts
  → NewAPI / rh-adapter / provider endpoint
  → 轮询任务
  → 画廊回写成功或失败状态
```

重要文件：

- `src/api/media-generation.ts`
- `src/data/mediaModelCapabilities.ts`
- `src/data/creationModels.ts`
- `src/services/creationModelAvailability.ts`
- `src/stores/mediaTaskStore.ts`
- `src/components/creation/`

当前状态：

- `safeFetch` 已用于主要媒体请求。
- 模型可用性由 `/api/creation/models` 和本地能力表共同决定。
- 失败任务必须保留失败原因并回写画廊，不允许“转圈消失”。
- RunningHub 走 rh-adapter；视频类模型不要误走 NewAPI 异步包装导致永远 processing。

---

## 8. 画布

画布是 VueFlow 节点式创作工作台，已经从 T8 体系迁入大量节点。

关键目录：

- `src/components/canvas/`
- `src/components/canvas/nodes/`
- `src/components/canvas/runtime/`
- `src/canvas/providers/`
- `src/canvas/services/`
- `src/stores/canvasStore.ts`

当前原则：

- 节点保存必须经过 `canvasSerialization.ts` 白名单，不能让新节点保存后丢失。
- 执行引擎按层并发，媒体节点需要限流。
- LLM 节点支持流式输出。
- 媒体节点要复用创作面板的模型可用性和鉴权规则，避免两套模型状态分叉。
- 批量创建节点必须走 `startBatch/endBatch`，避免一个模板占几十条 undo。

---

## 9. 本地工具

桌面端提供本地能力：

- 文件读取/拖拽
- 文档转 Markdown
- Office 文档创建/导出
- ffmpeg / ffprobe 媒体处理
- yt-dlp 网页媒体采集
- Chrome 浏览器控制
- 项目文件读写和命令执行
- OpenCode sidecar

关键文件：

- `src/utils/localContentTools.ts`
- `src/utils/browserTools.ts`
- `src/utils/devProjectTools.ts`
- `src/utils/localCapabilities.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/binaries/`

安全边界：

- 文件路径必须校验，禁止路径穿越。
- 命令执行必须白名单或限制在明确 project root。
- 媒体下载输出目录必须可控。
- 高风险工具必须由用户显式开启/确认。

---

## 10. 对话体验

对话区已经接近 ChatGPT-like 体验：

- Markdown 渲染
- 代码高亮
- KaTeX
- Mermaid 动态加载
- 搜索引用卡片
- TTS
- 图片灯箱
- 工具卡片
- OpenCode timeline parts
- progressive stream reveal
- auto-scroll policy
- Token 水位计

相关目录：

- `src/components/chat/`
- `src/components/chat/display/`
- `src/opencodeClient/`
- `src/composables/useChat.ts`

硬性规则：

- 当前用户输入必须是本轮 messages 最后一条 user message。
- 不要把工具结果、OpenCode parts 和 markdown 普通消息混成一坨字符串。
- 流式显示状态要和实际 run/message 绑定，避免“已经结束但 UI 仍运行中”。
- 滚动逻辑必须尊重用户手动上滑。

---

## 11. 存储与本地路径

主要本地路径：

```text
~/.jiucaihezi/
  data/jiucaihezi.db
  .session
  opencode-runtime/

~/.agents/skills/
  jiucaihezi-builtin/
  user-installed-skills/

~/.skillsmanage/
  db.sqlite
```

存储原则：

- 会话、消息、文档等结构化数据走 SQLite / `idb.ts`。
- Session token 不进 localStorage。
- Skill 真源优先真实文件包。
- 删除旧知识库后，不要再恢复 `jc_vaults_v1` 作为主产品数据。

---

## 12. 技术架构

```text
Tauri v2 + Rust
  src-tauri/src/lib.rs
  plugins: fs/dialog/shell/process/notification/sql/http bridge
  sidecars: opencode, ffmpeg, ffprobe, yt-dlp, whisper-cli placeholder

Vue 3 + Pinia + TypeScript
  Vite 8
  pnpm
  vue-tsc

API
  api.jiucaihezi.studio
  NewAPI
  Cloudflare Worker auth/session route
  rh-adapter for RunningHub
```

关键依赖：

| 组件 | 当前角色 |
|------|----------|
| Tauri 2.11.x | 桌面壳、权限、IPC、打包 |
| Vue 3 | 前端 UI |
| Pinia | 状态管理 |
| Tiptap | 编辑区文档工作台 |
| marked + DOMPurify | Markdown 渲染 |
| highlight.js | 代码高亮 |
| KaTeX | 数学公式 |
| Mermaid | 图表 |
| tokenx | Token 估算 |
| @opencode-ai/sdk | OpenCode 客户端 |

---

## 13. 目录速览

```text
jiucaihezi-app/
├── src/
│   ├── api/                    # 媒体生成等 API
│   ├── canvas/                 # 画布服务层和模型注册
│   ├── components/
│   │   ├── chat/               # 对话区
│   │   ├── canvas/             # 画布 UI 和节点
│   │   ├── creation/           # 创作面板
│   │   ├── editor/             # 文档编辑/导出
│   │   ├── filetree/           # 左侧文件/历史
│   │   ├── rail/               # Activity rail
│   │   ├── settings/           # 设置
│   │   ├── skills/             # Skill 仓库 UI
│   │   └── tools/              # 工具仓库
│   ├── composables/
│   ├── data/
│   ├── i18n/
│   ├── layouts/
│   ├── opencodeClient/         # OpenCode SDK 封装、timeline、session、permission
│   ├── runtime/
│   │   ├── connection/         # Skill/Tool runtime connection
│   │   ├── conversationContext/# 会话上下文引擎
│   │   └── tools/
│   ├── services/
│   ├── stores/
│   ├── styles/
│   └── utils/
├── src-tauri/
│   ├── src/lib.rs              # Rust 命令入口
│   ├── src/skills/             # Skill 管理后端
│   ├── binaries/               # release 时下载/准备 sidecars
│   ├── capabilities/default.json
│   └── tauri.conf.json
├── public/
│   ├── skills/
│   └── landing/
├── .github/workflows/build.yml # 三平台发布
├── scripts/
├── 知识库备份/                  # 旧知识库产品面备份
└── package.json
```

---

## 14. 高风险文件

改这些文件前必须读上下文、缩小影响面、跑对应验证：

| 文件/目录 | 风险 |
|-----------|------|
| `src/composables/useChat.ts` | 对话主链路、OpenCode、工具循环、上下文 |
| `src/opencodeClient/**` | OpenCode 官方 session/timeline/permission/tool 映射 |
| `src-tauri/src/lib.rs` | Rust IPC、HTTP bridge、sidecar、文件/命令安全 |
| `src-tauri/capabilities/default.json` | Tauri 权限 |
| `src/utils/api.ts` | 手动 Key / Session 路由 |
| `src/services/newApiClient.ts` | NewAPI 客户端 |
| `src/api/media-generation.ts` | 媒体生成 API、异步轮询 |
| `src/data/mediaModelCapabilities.ts` | 媒体模型可用性和字段契约 |
| `src/stores/mediaTaskStore.ts` | 媒体任务恢复、失败回写 |
| `src/stores/skillsManageStore.ts` | Skill 仓库主状态 |
| `src-tauri/src/skills/**` | Skill 文件系统、GitHub 导入、平台安装 |
| `src/runtime/conversationContext/**` | 会话上下文引擎 |
| `src/runtime/connection/**` | Skill/Tool 运行连接 |
| `src/components/chat/display/**` | 消息显示和滚动体验 |
| `src/components/canvas/runtime/**` | 画布执行 |
| `.github/workflows/build.yml` | 三平台发布产物 |

---

## 15. 发布流程

### 15.1 本地构建

桌面构建：

```bash
pnpm run build:desktop
pnpm run tauri:build
```

Web 构建：

```bash
pnpm run build
```

不要把 Web dist 和 Desktop dist 混用。桌面构建会裁剪 landing 等 Web 资源。

### 15.2 GitHub Actions 发布

workflow：

```text
.github/workflows/build.yml
```

触发条件：

```text
push tags: v*
workflow_dispatch
```

当前发布产物：

```text
macOS Apple Silicon:
  *_aarch64.dmg
  *_aarch64.app.tar.gz

macOS Intel:
  *_x64.dmg
  *_x64.app.tar.gz

Windows x64:
  *_x64_windows_portable.zip
```

Windows 当前使用 portable zip，不走 MSI/WiX，也不走 NSIS。原因：MSI 的 WiX `light.exe` 在 Windows runner 上曾失败；zip 更稳定，且用户解压即可运行。

### 15.3 打 tag

发新版：

```bash
git add <changed-files>
git commit -m "..."
git push origin HEAD:codex/opencode-core-execution

git tag v0.1.x
git push origin v0.1.x
```

如果 tag 已存在，不建议复用旧 tag；优先递增版本号。

Release 下载页：

```text
https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/latest
```

用户下载说明：

```text
M 芯片 Mac：选择 aarch64.dmg
Intel Mac：选择 x64.dmg
Windows：选择 x64_windows_portable.zip，解压后运行 韭菜盒子.exe
```

---

## 16. 当前已知状态

已完成：

- OpenCode 项目目录链路修复。
- 旧知识库主产品面删除并备份。
- Skill 仓库成为主能力面。
- GitHub 导入、Skill 仓库、别名展示保留。
- macOS ARM / macOS Intel / Windows x64 portable zip CI 发布成功。
- 对话显示体验大幅收敛。
- 账号登录和手动 Key 双路线基本稳定。
- 创作面板媒体任务、失败回写、模型可用性持续完善。

需要继续注意：

- 当前仍无统一日志系统和崩溃上报。
- 部分媒体模型和画布模型能力仍在持续收敛。
- Windows portable zip 是当前稳定路线；安装器以后再做。
- 旧知识库代码不要误复活。
- “Platform”等内部英文词不要暴露给普通用户。

---

## 17. 常用命令

```bash
pnpm install
pnpm dev
pnpm exec vue-tsc -b
pnpm exec vite build
pnpm run test:focused:build
pnpm run test:focused:run
pnpm run test:focused
pnpm run test:conversation
pnpm run test:tauri
pnpm run build:desktop
pnpm run tauri:build
```

查询 release run：

```bash
gh run list --limit 10
gh run view <run-id> --log
```

如果本机 `gh` 未登录：

```bash
gh auth login
```

---

## 18. 给未来 AI 协作者的一句话

这个项目已经从“功能堆叠期”进入“产品收口期”。现在最重要的不是再开新口子，而是守住几条主线：

```text
OpenCode 项目目录真实贯穿
Skill 仓库清晰可用
账号/Key 不串线
工具必须用户显式开启
媒体生成失败可解释
三平台发布稳定
旧知识库不回流主链路
```

每次修改都要让产品更清楚，而不是更像一个什么都能做但没人知道怎么用的工具箱。
