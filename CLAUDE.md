https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/tag/v1.0.1# 韭菜盒子 Studio - AI 协作者上手手册

> **2026-06 重要更新（AI 协作者必读）**：
> 桌面 APP 与 Web 端是**同等重要**的两个产品形态。两者共享核心体验、视觉组件、模型/Skill/创作/画布等产品能力；最大架构分界是：桌面端包含 OpenCode 文 / 武模式，Web 端不使用 OpenCode，只提供直连模式。
>
> **任何新的 AI 会话或不同开发工具，必须先完整阅读**：本文件 + AGENTS.md。
>
> 双端同等重要开发原则：
> - 共享产品能力（画布、创作面板、编辑区、消息渲染、模型/Skill 配置等）应尽量保持双端一致。
> - 平台专属能力必须显式隔离：桌面专属是 Tauri + OpenCode + 本地工具；Web 专属是浏览器直连 + Web 持久化/搜索/工具层。
> - 对话（聊天）不是完全共享的核心：
>   - Web 端：直连模式（标准 LLM 消息 + system prompt，直接 NewAPI 云端路径，不走 OpenCode parts）。
>   - 桌面端：文 / 武模式走 OpenCode（project directory 贯穿、完整 timeline/permission/question/session 命令 + 事件驱动），未来桌面直连模式应尽量复用 Web 直连引擎。
>   两者可复用部分 UI 组件保持一致，但执行引擎和上下文管理是两条独立路径。
>
> 本文档是本仓库的产品说明、架构边界和开发作业手册。目标：AI 协作者读完后，可以在不重新考古旧设计的情况下开始安全改代码。
>
> 最后更新：2026-06-19
> 当前发布基线：`v1.0.1`（存储瘦身完成 + 画廊缩略图修复 + 文本歌词支持 + 启动架构修复）

---

## 0. 存储架构（2026-06 重大变更，接手必读）

> **本节是媒体存储事实源。** SDD-v1 / SDD-v2 中提到的 `data/media/{source}/` 路径已过时，**以本节 §0.2 的 `output/{source}/` 为准**。SDD-v2 文档路径将在下一轮同步。
>
> **本节涉及 SDD**：
> - `docs/sdd/unified-file-access-design-v2.md` — 当前版本（2026-06-18 已实施，完整 6 条决策见 §5）
> - `docs/sdd/unified-file-access-design.md` — v1 评审稿，仅供参考
> - `docs/sdd/storage-media-asset-migration.md` — P0-P3 存储瘦身原始计划

### 0.1 核心原则：媒体字节禁止进入 SQLite

```
✅ 正确：图片/视频/音频 → 文件系统 output/{source}/{YYYY-MM}/{assetId}.{ext}
         数据库只存引用 → media_assets 表（~200B/行）
         UI 渲染走 convertFileSrc → asset://localhost/...（零内存）

❌ 禁止：base64 data URL 嵌入 SQLite（messages / documents / kv_store）
         启动时全量加载 documents 表（1.34GB → JS heap 爆炸）
         <img src="jc-media://..."> 不经过 resolver 直接喂给 WebView
```

### 0.2 目录结构

```
~/.jiucaihezi/
├── data/
│   ├── jiucaihezi.db          # SQLite（目标 < 100MB，只存元数据+引用）
│   │   ├── media_assets       # ★ 媒体索引（id/logicalPath/mime/size/sourceUrl/...）
│   │   ├── messages           # 消息（images 存 jc-media:// 引用）
│   │   ├── documents          # 旧表（1.34GB，待迁移，勿新增写入）
│   │   └── kv_store           # 设置+任务状态
│   └── media/                 # 旧路径（P1 迁移前，兼容读取）
└── output/                    # ★ 新路径（对齐 ComfyUI）
    ├── chat/YYYY-MM/          # 聊天贴图自动落地
    ├── creation/YYYY-MM/      # 创作图片自动落地
    ├── exports/               # 右键导出对话/文本/画布
    └── thumbnails/            # 缩略图缓存
```

### 0.3 jc-media:// 渲染契约（三个推论）

**决策一：本地文件是第一公民，远程 URL 是 fallback。**

**推论 1**：UI 渲染必须通过 resolver。`jc-media://` 是逻辑路径，`<img src>` 必须拿到 `asset://localhost/...`（`convertFileSrc` 产物）才能渲染。任何直接塞 `jc-media://` 给 `<img>/<video>/<audio>` 的代码都是 bug。

**推论 2**：对外分享必须用上游 CDN URL（`sourceUrl`），不能用内部引用。`media_assets.sourceUrl` 列存原始 URL，「复制 URL」功能走这个字段。

**推论 3**：Tauri 配置必须显式启用 asset 协议。`tauri.conf.json` 必须包含：
```json
"assetProtocol": { "enable": true, "scope": ["$APPDATA/output/**", "$APPDATA/data/media/**"] }
```
且 CSP 的 `img-src` / `media-src` 必须含 `asset: http://asset.localhost`。缺一不可。

> 完整 6 条决策（含字段兼容、双端入口分叉、下载失败状态机、Web 端不复刻「我的文件」、文件命名规则）见 `docs/sdd/unified-file-access-design-v2.md` §5。本节只展开「决策一」是因为它的推论是日常踩坑高发区。

### 0.3.1 数据字段契约（避免 `resultUrl` / `assetUri` / `sourceUrl` 混淆）

三个名字指向**同一份远程 URL**，落在不同位置。改媒体链路前必须分清：

| 字段 | 含义 | 位置 | 写入时机 | 不可变 |
|------|------|------|---------|:--:|
| `mediaTask.resultUrl` | 原始远程 CDN URL，历史兼容字段 | `mediaTaskStore` 内存 + `kv_store.jc_media_tasks_v1` | 任务成功，URL 通过 `assertSafeResultUrl` 白名单后 | ✅ |
| `mediaTask.assetUri` | 本地引用 `jc-media://{assetId}` | `mediaTaskStore` 内存 + 持久化 | `downloadAndPersistMediaAsset` 下载成功后 | — |
| `mediaTask.assetStatus` | `'pending'` / `'local'` / `'remote-only'` | 同上 | 决策四状态机 | — |
| `media_assets.sourceUrl` | 同 `resultUrl`，持久化到 SQLite | `media_assets` 表 | `insertMediaAsset` 时 | — |
| `MediaDisplayAsset.displayUrl` | 渲染层 URL（`jc-media://...` 或 `http(s)://...`） | 运行时计算 | `mediaDisplayAssetFromMediaRow` 等工厂函数 | — |
| `MediaDisplayAsset.originalUrl` | 同 `sourceUrl`，给「复制 URL」按钮 | 运行时 | 工厂函数从 row.sourceUrl 填 | — |

**渲染优先级**：`displayUrl`（jc-media://）→ resolver 成功 → `asset://localhost/...`；resolver 失败/空 → fallback `originalUrl`。

**「复制 URL」契约**：永远取 `originalUrl`（即 sourceUrl/resultUrl 的渲染层投影），**禁止 fallback 到 `jc-media://`**——那串字符串复制出去毫无意义。`originalUrl` 缺失时改为 toast 提示用户「该资产没有可分享的源 URL」。

### 0.4 已知债务

| 项目 | 优先级 | 说明 |
|------|:--:|------|
| `documents` 表媒体数据迁移到 `output/` | 🟡 | 1.34GB 历史 base64，需跑迁移脚本 |
| `kv_store.jc_media_tasks_v1` 压缩 | 🟡 | 270MB，内含 base64，任务只应存摘要 |
| 视频缩略图持久化 | 🟡 | 当前只存 `mediaLibraryAssets` 内存，**重启后全部重新生成；视频多时可能触发 6 路并发解码内存峰值**。修法：`media_assets` 加 `thumbnailDataUrl TEXT` 列（轻）或走 `thumbnailAssetId` 链（重，架构对） |
| `sourceUrl` 历史回填 | 🟢 | 旧 media_assets 行 sourceUrl=NULL，「复制 URL」会走 toast 兜底；可写脚本从 `mediaTaskStore.tasks.resultUrl` 反查回填 |
| `searchMessages` 全表扫 | 🟡 | 应改为按 sessionId 逐个 getRecord |
| `deleteSession` 全表扫 documents | 🟡 | 应走 getAllByIndex |
| cache map 加 LRU 上限 | 🟢 | 防长跑内存膨胀 |
| MediaViewer 文本卡按钮溢出 | 🟢 | `isMedia` 已加 `'text'` 让「复制 URL」可见，但 `reference / regenerate / sendToCanvas / download` 按钮也对歌词显示了，对文本不合理。应拆为 `canCopyUrl` / `canDownload` 等细粒度判定 |

### 0.5 常见踩坑

- **`assetRowToRealPath` 兼容新旧路径**：旧数据 `logicalPath` 以 `media/` 开头，实际文件在 `data/media/` 下，需拼 `appData + 'data' + logicalPath`；新数据以 `output/` 开头，直接拼 `appData + logicalPath`。
- **`getAll` 的 `fullyLoaded` 标记**：`idb.ts` 的 cache 结构是 `{ map: Map, fullyLoaded: boolean }`，`getAll` 只在 `fullyLoaded=true` 时信任缓存。不要直接 `.get()/.set()` 在 cache 上，用 `.map.get()/.map.set()`。
- **MediaAssetCard / MediaViewer 共享 `resolveJcMediaUrl`**：该函数在 `mediaFileReader.ts`，自动将 `jc-media://` 转为 `convertFileSrc` URL。新组件需要渲染本地媒体时直接 import 使用，不要 copy-paste。
- **`media_assets` 表 schema**：加列必须走 `_migrations` 登记 + `ALTER TABLE ADD COLUMN`，`CREATE TABLE IF NOT EXISTS` 不会给旧表加列。

---

## 分支边界（必须遵守）

当前产品有两条并行开发线：

- 桌面 APP 主线：`codex/opencode-core-execution`
  - 负责桌面端 OpenCode 文 / 武模式、Tauri、opencodeClient、project directory、timeline、permission、桌面打包发布。
  - 不允许混入 Web 直连实验代码；OpenCode 相关实现必须局限在桌面运行路径。

- Web 直连主线：`codex/web-direct-wongsaang`
  - 负责 Web 端直连模式、WongSaang/chatgpt-ui 核心能力、Web 会话历史、streaming、tools、web search、持久化。
  - 不允许修改 `src-tauri/**`、`src/opencodeClient/**`，不得影响桌面 OpenCode 文 / 武模式。
  - 除 OpenCode/Tauri 等桌面专属层外，Web 直连能力应尽量设计成未来可被桌面直连模式复用。

最终发布整合分支是 `main`。`main` 只接收已验证的桌面分支和 Web 分支，不作为日常实验分支。

合并顺序：

1. 桌面分支单独验证通过后合并到 `main`。
2. Web 分支单独验证通过后合并到 `main`。
3. 合并前必须做边界审计，确认 Web 改动没有污染桌面 OpenCode，桌面改动没有夹带 Web direct/WongSaang 实验。

---

## 当前执行入口（换工具必读）

当前目标：完成最终产品形态。

```text
桌面 APP：文模式 + 武模式 + 直连模式
Web 端：直连模式
最大边界：桌面文/武使用 OpenCode，Web 不使用 OpenCode
```

任何 AI 工具接手前必须按顺序阅读：

1. `CLAUDE.md`
2. `AGENTS.md`
3. `docs/sdd/dual-client-final-product-roadmap.md`
4. `docs/superpowers/plans/2026-06-15-dual-client-final-product.md`

执行时按计划文件里的 Phase 推进。每个 Phase 完成后更新计划状态，不要跨 Phase 抢做未验收内容。

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
- `src/runtime/creation/`
- `src/composables/useCreation.ts`
- `src/services/creationModelAvailability.ts`
- `src/stores/mediaTaskStore.ts`
- `src/components/creation/`
- `rh-adapter/`
- `docs/model-registry-matrix.md` — ★ 全渠道·全模型·全端点映射表（修改媒体模型前必读）
- `docs/rh-adapter-server-deploy-runbook.md` — rh-adapter 服务器部署成功经验手册

当前状态：

- `safeFetch` 已用于主要媒体请求。
- 模型可用性由 `/api/creation/models` 和本地能力表共同决定。
- 失败任务必须保留失败原因并回写画廊，不允许“转圈消失”。
- RunningHub 走 rh-adapter；视频类模型不要误走 NewAPI 异步包装导致永远 processing。

### 7.1 创作面板 2.0 / RunningHub 成功经验

2026-06 的 RunningHub 创作面板修复证明：媒体生成问题不能只看“能不能生成”，必须验证“用户在 UI 填的参数是否准确进入上游官方 API”。后续新增模型、修复模型或接入工作流时，必须按这条链路逐层核对：

```text
CreationPanel UI
  → useCreation.buildCurrentCreationParams()
  → CreationModelRegistry / CreationRunPlan
  → creationMediaRuntime
  → media-generation.ts / mediaTaskStore
  → NewAPI 直连 或 NewAPI RH channel
  → rh-adapter（仅 RunningHub 渠道）
  → RunningHub 官方 API / AI App
```

硬性原则：

- `CreationModelSpec.fields` 是模型参数事实源，不只是 UI 展示说明。
- 用户显式选择的参数优先；未选择时只能使用 `fields.defaultValue`，不能由 Runtime 临时猜默认值。
- `buildCurrentCreationParams()` 必须把当前模型的普通字段物化进 RunPlan；否则 UI 看起来有参数，实际请求会丢参数。
- RunningHub 渠道中，NewAPI 只承担鉴权、计费和渠道转发；RH 业务参数映射属于 `rh-adapter`。不要把 RH 标准 API / AI App 的业务逻辑塞进 NewAPI。
- NewAPI 直连渠道不经过 `rh-adapter`；不要为了修 RH 模型影响 T8、火山、WorldRouter、特朗普渠道等直连模型。
- 对 RH image 这类 OpenAI-compatible 端点，非标准字段可能需要通过 `extra_fields` 透传，并在 `rh-adapter` 恢复为 RunningHub 官方字段。
- 不接受“兜底能生成就行”。验收标准是：比例、分辨率、格式、LoRA、时长、素材等 UI 参数准确进入最终官方 payload，并返回符合这些参数的成果。

典型排障方法：

1. 先读对应 SDD 和 `docs/notes/` 官方/实测文档，确认模型属于 NewAPI 直连还是 RunningHub。
2. 在前端检查 `buildCurrentCreationParams()` 和 RunPlan，不要只看 UI 是否显示了字段。
3. 在 Runtime 检查提交 body，确认参数没有在标准化时被覆盖或丢弃。
4. 在 `rh-adapter` 增加短期日志，打印模型、比例、分辨率、格式等关键字段，定位参数在哪一层消失。
5. 用测试固化链路，例如验证 `z-image-turbo` 默认也会提交 `outputFormat=png`，用户改成 `jpeg` 时必须提交 `jpeg`。

RunningHub 相关改动建议至少跑：

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build && pnpm run test:focused:run
cd rh-adapter && python -m pytest
```

如果只改前端参数物化，不需要重新部署 `rh-adapter`；如果改了 `rh-adapter/`，必须重新上传并在服务器 `docker compose up -d --build rh-adapter` 后再测。

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

## 12. 启动架构（2026-06-19 重构，接手必读）

> **旧架构**：`boot() → initDB() → .finally(mount)` 串行链。任一步挂起 → splash 永不死 → 用户看到"卡 logo"。
> **新架构**：对标 OpenCode 懒初始化——UI 立即挂载，后端异步初始化，超时降级。

### 12.1 启动流程

```
main.ts 加载
  ├─ CSS / 主题 / 默认值（同步，瞬间）
  ├─ mountApp()            ← ★ UI 立即挂载，splash 消失
  └─ initBackend()          ← 后台异步（不阻塞 UI）
       ├─ boot()            ← patchFetch + API key + deep link（8s 超时）
       └─ initDB()          ← SQLite/IndexedDB 初始化（10s 超时）
            ├─ 成功 → __JC_STORAGE_READY__=true, __JC_STORAGE_DEGRADED__=false
            └─ 失败/超时 → __JC_STORAGE_DEGRADED__=true, idb.ts 走 localStorage fallback
```

### 12.2 降级兜底（P0）

当 Tauri 环境 SQLite 初始化失败时，`idb.ts` 自动对 kv_store / conversations / messages 三张表走 `localStorage` 兜底（键格式 `jc_fallback_{store}_{id}`），防止设置/会话/Key 静默丢失。

WorkspaceLayout 检测到降级时显示黄色警告条：
> ⚠️ 本地存储未就绪，数据可能无法保存。建议重启 APP 或清空 ~/.jiucaihezi/data 后重试。

### 12.3 调试标志（排查 Intel/Windows 启动问题）

| window 属性 | 含义 |
|-------------|------|
| `__JC_APP_MOUNTED__` | Vue 已挂载（UI 可见） |
| `__JC_APP_READY__` | 后端初始化完成 |
| `__JC_STORAGE_READY__` | SQLite 初始化成功 |
| `__JC_STORAGE_DEGRADED__` | 存储降级模式（SQLite 挂了，走 localStorage） |
| `__JC_FETCH_PATCHED__` | fetch 劫持成功（Tauri HTTP bridge 就绪） |
| `__JC_BOOT_LOG__` | 启动日志数组 `[{ts, level, msg}]` |

用户报"打不开"时，让他在 Console 执行：
```js
JSON.stringify(__JC_BOOT_LOG__, null, 2)
```

---

## 13. 技术架构

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

## 14. 目录速览

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

## 15. 高风险文件

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
| `src/utils/mediaFileWriter.ts` | 媒体唯一写入入口，落地 `output/{source}/...` + `insertMediaAsset` |
| `src/utils/mediaFileReader.ts` | `resolveForDisplay` / `resolveForLlm` / 共享 `resolveJcMediaUrl`，jc-media:// → asset:// 渲染契约 |
| `src/main.ts` | 启动流程、fetch 劫持、存储初始化、降级逻辑 | 改之前必须读 §12 启动架构 |
| `src/utils/idb.ts` | SQLite schema、`_migrations` 登记、`ALTER TABLE` 迁移、`insertMediaAsset` 容错、localStorage 降级兜底 |
| `src/layouts/WorkspaceLayout.vue` | 主布局壳、存储降级警告 banner |
| `src-tauri/tauri.conf.json` | `assetProtocol.enable + scope` + CSP `img-src/media-src` 必须含 `asset:`，缺一画廊全黑 |
| `src/components/media/MediaAssetCard.vue` | 画廊卡片渲染，懒解析 jc-media:// |
| `src/components/media/MediaViewer.vue` | 大图查看器，懒解析 jc-media:// |

---

## 16. 发布流程

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

## 17. 当前已知状态

已完成：

- OpenCode 项目目录链路修复。
- 旧知识库主产品面删除并备份。
- Skill 仓库成为主能力面。
- GitHub 导入、Skill 仓库、别名展示保留。
- macOS ARM / macOS Intel / Windows x64 portable zip CI 发布成功。
- 对话显示体验大幅收敛。
- 账号登录和手动 Key 双路线基本稳定。
- 创作面板媒体任务、失败回写、模型可用性持续完善。
- 媒体资产唯一索引（`media_assets` 表 + `output/{source}/` 文件系统），不再把 base64 嵌进消息/文档表。
- 创作图片下载本地化 + 「复制 URL」走 `sourceUrl` 列、Tauri asset 协议放行（assetProtocol + CSP）。
- 画廊缩略图、大图查看器统一走 `resolveJcMediaUrl` 共享懒解析。
- 文本歌词在画廊可见（`MediaAssetKind` 加 `'text'`，卡片 80 字预览，MediaViewer 文本渲染）。
- **启动架构重构**（2026-06-19）：UI 优先挂载 + 异步后端初始化 + 超时降级，修复 Intel/Windows 卡 logo。
- **存储降级兜底**：SQLite 失败时 kv_store/conversations/messages 自动走 localStorage，UI 显示黄色警告条。
- **启动日志**：`window.__JC_BOOT_LOG__` 可排查平台启动挂死。

需要继续注意：

- 当前仍无崩溃上报（Sentry 等）。
- 部分媒体模型和画布模型能力仍在持续收敛。
- Windows portable zip 是当前稳定路线；安装器以后再做。
- 旧知识库代码不要误复活。
- “Platform”等内部英文词不要暴露给普通用户。
- Intel/Windows 启动根因尚未彻底排查（CSP/assetProtocol/SQLite 等候选），bootLog 可帮助定位。

---

## 18. 常用命令

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

## 19. 给未来 AI 协作者的一句话

这个项目已经从“功能堆叠期”进入“产品收口期”。现在最重要的不是再开新口子，而是守住几条主线：

```text
OpenCode 项目目录真实贯穿
Skill 仓库清晰可用
账号/Key 不串线
工具必须用户显式开启
媒体资产走 media_assets + output/，不再嵌 base64 进消息/文档表
媒体生成失败可解释
三平台发布稳定
旧知识库不回流主链路
```

每次修改都要让产品更清楚，而不是更像一个什么都能做但没人知道怎么用的工具箱。
