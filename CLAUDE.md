# 韭菜盒子 V7 — 桌面版产品说明书

> 本文档是 AI 协作者的完整上手指南。目标：读完即可开始编码，无需额外探索。

---

## 一、产品定位

韭菜盒子是一个 **本地优先的 AI 工作台桌面应用**。核心能力：

1. **多模型对话** — 通过内置 NewAPI 中转调用 Claude / GPT / Grok 等模型
2. **搭子系统（Skill/Agent）** — 30+ 预设 AI 角色 + 用户自定义，含自动路由和进化
3. **知识库系统（Vault）** — 用户手动添加资料 → 整理为 Wiki → AI 检索召回。**杜绝 AI 自动写入，防止幻觉污染知识库。**
4. **创作面板** — 图片（gpt-image-2、grok）、视频（grok、veo、seedance）、音频（suno）生成
5. **本地工具运行层** — 桌面端直接提供格式转换、浏览器控制、源码项目读写和命令执行
6. **文档能力** — Office 文档生成/转换/代码执行（通过后端 API）

---

## 审查范围（AI 协作者必读）

> 每次改代码前，先看这里确认改动的文件属于哪个优先级。

### 🔴 必检查（改动这些文件必须仔细审查）

| 目录/文件 | 原因 | 审查要点 |
|-----------|------|----------|
| `src/api/media-generation.ts` | 外部 API 调用（图/视频/音频生成） | 超时、重试、错误处理、异步轮询完整性 |
| `src/services/gatewayClient.ts` | NewAPI 网关客户端 + Session Token 安全存储 | 鉴权传递、超时、流式/非流式双通道、Token 不可泄露到 localStorage |
| `src/composables/useChat.ts` | 核心对话引擎（1468 行） | SSE 流解析、工具循环、上下文管理、知识注入 |
| `src/stores/agentStore.ts` | 搭子管理（15 个文件依赖） | 数据迁移兼容、localStorage 序列化 |
| `src/stores/vaultStore.ts` | 知识库状态 | 与 useFileStore 的双向依赖 |
| `src/stores/sessionStore.ts` | 对话历史持久化 | SQLite 读写、消息一致性 |
| `src/utils/idb.ts` | SQLite 存储层（~/.jiucaihezi/data/jiucaihezi.db） | 表结构变更、迁移逻辑、SQL 注入、内存缓存一致性 |
| `src/utils/httpClient.ts` | fetch 劫持 + Rust HTTP 桥接 | SSE 流完整性、错误传播 |
| `src/utils/localContentTools.ts` | 本地格式转换/音视频工具 | 文件路径安全、外部进程调用 |
| `src/utils/browserTools.ts` | Chrome 浏览器控制 | 外部进程安全、URL 校验 |
| `src/utils/webSearch.ts` | Jina 搜索 API（V7.1） | 超时、错误透传、8s AbortController |
| `src/utils/highlight.ts` | 代码高亮（V7.1） | DOMPurify 放行 hljs class |
| `src/utils/mermaidRenderer.ts` | Mermaid 图表（V7.1） | 动态 import、Sandbox 安全 |
| `src/data/modelContextWindows.ts` | 模型窗口映射（V7.1） | 默认值准确性、模型族推断 |
| `src/utils/localCapabilities.ts` | 本地能力注册表（V7.1） | 能力检测准确性、首次引导逻辑 |
| `src/components/settings/LocalCapabilitySetup.vue` | 能力中心 UI（V7.1） | modal/inline 双模式、跳过逻辑 |
| `src/utils/devProjectTools.ts` | 源码项目读写/命令执行 | 路径遍历、命令白名单 |
| `src/utils/brain.ts` | 知识提炼 LLM 调用 | 输入脱敏（sanitizeBrainInput）、提取质量 |
| `src/utils/vaultFs.ts` | 知识库文件系统 | 文件名 NFKC 正规化、路径遍历防护 |
| `src/components/canvas/runtime/canvasInputs.ts` | 画布 prompt 拼接 | 边界标记完整性、注入面 |
| `src/components/canvas/runtime/canvasLlmRuntime.ts` | 画布 LLM 执行 | SKILL.md 加载安全（白名单+大小限制） |
| `src-tauri/src/lib.rs` | Rust 命令入口 | 权限检查、panic 处理、read/write_session_token 文件权限 |
| `src-tauri/capabilities/default.json` | Tauri 权限声明 | 最小权限原则、.session 文件 deny |

### 🟡 改动需注意

| 目录/文件 | 注意事项 |
|-----------|----------|
| `src/stores/mediaTaskStore.ts` | 异步任务队列（媒体生成），注意竞态和页面刷新后恢复轮询 |
| `src/composables/useBrain.ts` | 知识提炼 LLM 调用，依赖 vaultStore + useFileStore |
| `src/composables/useVaultCompiler.ts` | 知识库编译，依赖 vaultStore |
| `src/composables/useSkillRouter.ts` | 搭子自动路由匹配，触发词优先级 |
| `src/composables/useSkillEvolution.ts` | 搭子进化逻辑，修改历史记录 |

### 🟢 可忽略（改动无需深度审查）

| 目录 | 说明 |
|------|------|
| `src/components/**/*.vue` | UI 组件，只影响展示不涉及数据/安全 |
| `src/layouts/` | 布局组件 |
| `src/styles/` | CSS 样式/设计令牌 |
| `src/**/__tests__/` | 测试文件 |
| `docs/` | 文档 |
| `public/skills/` | 预设搭子 SKILL.md 静态文件 |
| `src/data/` | 静态配置数据（模型定义、模板） |

### ⚠️ 已知问题（不要重复排查/修复）

| 问题 | 状态 | 说明 |
|------|------|------|
| API 请求 "Load failed" | ✅ 已修复 | 已用 Rust `http_request` / `http_request_stream` Command 完全绕过 WKWebView fetch |
| `window.open()` 无效 | ✅ 已处理 | 统一用 `openExternal()` (tauri-plugin-shell) |
| Session Token 泄露风险 | ✅ 已修复 | Token 从 localStorage 迁移到 Rust `~/.jiucaihezi/.session` 文件（0600 权限），JS 内存缓存 |
| Tauri FS 权限过宽 | ✅ 已修复 | 移除 `fs:allow-read`/`fs:allow-write`/`fs:allow-copy-file`，token 文件明确 deny |
| SKILL.md 远程加载无校验 | ✅ 已修复 | 加白名单 + 50KB 大小限制 + Content-Type 校验 + agentStore 优先 |
| Canvas ToMD 路径无校验 | ✅ 已修复 | JS 侧加 validateSourcePath（空路径/ null 字节/.. 遍历/相对路径拦截） |
| login/register 参数无校验 | ✅ 已修复 | 客户端 validateLoginPayload / validateRegisterPayload 前置 |
| 工具调用参数无 Schema | ✅ 已修复 | validateToolArgs 加 100KB 限制 + 类型检查 + 错误脱敏 |
| 画布 prompt 注入面大 | ✅ 已修复 | mergePromptInputs 加边界标记 `[用户画布输入开始/结束]` |
| Unicode 同形异义攻击 | ✅ 已修复 | sanitizeName() 加 NFKC 正规化 |
| 知识提炼泄露敏感信息 | ✅ 已修复 | brain.ts 加 sanitizeBrainInput（脱敏 Token/JWT/API Key/密码） |
| 知识库自动沉淀污染 | ✅ 已禁用 | ingestAssistantOutput 从 useChat.ts 彻底移除，知识库只接受用户手动添加 |
| `useCreationEngine.ts` 已废弃 | ✅ 已处理 | 0 调用方，已标记完全废弃可安全删除 |
| 内置搭子 `SKILL_PRESETS` 已重建 | ✅ 已完成 | 19 个 L1 + 1 个 L2，全部通过 skill:// 协议加载 |
| TypeScript 严格性低 | 🟡 故意的 | `noUnusedLocals` / `noUnusedParameters` 已关闭，允许隐式 `any` |
| 日志系统 | ❌ 未做 | 目前散落 `console.log`，无统一日志级别/持久化 |
| 监控告警 | ❌ 未做 | 无 Sentry / 错误汇集 / 崩溃上报 |
| 循环依赖 utils→stores→composables | 🟡 已知 | 12 个 `utils/` 文件反向依赖上层，涉及 `migration.ts`、`brain.ts`、`browserTools.ts` 等 |
| 3 个空目录 | 🟢 低优 | `src/components/agent/`、`common/`、`session/` 预留未用 |
| VaultWizard「添加现有知识库内容」 | ✅ 已实现 | 新增第 4 张卡片：选择知识库 + 上传文件 + 自动整理 |
| 设置页账户区颜色与主题不一致 | ✅ 已修复 | 新增 `--jc-account-card-bg` / `--jc-member-glow` / `--jc-member-glow-text` 三个语义令牌到 4 个主题，SettingsPanel.vue 中 11 处硬编码颜色全部替换为令牌 |
| 非 vision 模型贴图 502 | ✅ 已修复 | `buildApiMessages` 改为模型感知：非 vision 模型所有历史/新消息图片统一扁平化为纯文本。`supportsVision()` 检测 Gateway 端点能力 |
| 图片桥接（text 模型间"读图"） | ✅ 已实现 | `src/utils/imageBridge.ts`：非 vision 模型 + 贴图 → 调 claude-haiku-4-5 描述图片 → 文字注入 user message。会话级缓存复用 |
| Cherry Studio 对话功能对比 | ✅ 已完成 | P0-P3 全部 16 项已实施：代码高亮/highlight.js、时间戳、会话内搜索、KaTeX、Mermaid、搜索引用卡片、TTS朗读、引用回复、编辑消息/重新生成、多模型并行、全局搜索Cmd+K、临时对话、多语言i18n、Jina API搜索、Token水位计 |
| V7.1 Token 水位计 | ✅ 已实现 | 模型感知的 token 水位显示（`≈2.4K / 200K ▓░░░ 1.2%`），替代旧的 N/20 条。`src/data/modelContextWindows.ts` 维护 30+ 模型上下文窗口映射。截断策略从按条改为按 token 预算。 |
| V7.1 搜索互斥设计 | ✅ 已实现 | 搜索按钮 ON→Jina API(Jina-search模型)自动搜索注入，隐藏 browser_search 工具；OFF→暴露浏览器工具供 AI 调用。`buildAvailableTools()` 中条件排除。`webSearch.ts` 含 8s 超时+错误透传。 |
| V7.1 Finder 文件拖拽 | ✅ 已实现 | `ChatPanel.vue` 监听 Tauri `onDragDropEvent`，OS 文件拖入 → FS 读内容 → FileUploader 附件。与 HTML5 拖拽并行。 |
| V7.1 护眼模式代码高亮 | ✅ 已修复 | `highlight-theme.css` 为 green 主题独立配色（浅绿底+高对比文字），不再复用暗色主题。 |
| 临时对话 | 🟢 已删除 | 用户反馈无实用价值，已从 ChatPanel 移除。 |
| mermaid 阻塞启动 | ✅ 已修复 | mermaid(11.x) 改为动态 `import('mermaid')`，仅在渲染 mermaid 代码块时加载，避免 1.5MB 库阻塞 Vue 挂载。 |
| V7.1 本地能力中心 | ✅ 已实现 | `src/utils/localCapabilities.ts` 能力注册表 + `LocalCapabilitySetup.vue` 首次引导弹窗 + 设置页内嵌。统一管理浏览器/文件/Shell/项目/ffmpeg 5 项本地能力，首次启动自动检测，非必需项可跳过。 |

### ✅ 上线标准（每次发版前检查）

- [x] **0 个 critical 安全漏洞**：Session token 已迁移到 Rust 0600 文件，FS 权限已收窄
- [ ] **所有 API 调用有超时/重试**：检查 `src/api/`、`src/services/`、`httpClient.ts` 的 fetch 是否设置 AbortController/超时
- [x] **数据操作有事务保护**：`idb.ts` 的 SQLite 写入、JSON 文件原子替换（先写临时文件再 rename）
- [x] **SSE 流式传输不掉字符**：`http_request_stream` Rust 侧逐块推送完整性
- [x] **外部链接不走 `window.open`**：全部走 `openExternal()` 在系统浏览器打开
- [x] **知识库不自动写入**：`ingestAssistantOutput` 已移除，仅用户手动添加
- [x] **会话 Token 不存 localStorage**：使用 Rust 侧文件存储（0600）+ JS 内存缓存
- [ ] **日志系统**：仍未实现，建议在 V8 添加

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri v2 (Rust)                       │
│  Plugins: fs, dialog, shell, process, notification, http, sql│
│  入口: src-tauri/src/lib.rs                              │
└─────────────┬───────────────────────────┬───────────────┘
              │ IPC (invoke/events)       │ WebView
┌─────────────┴───────────────────────────┴───────────────┐
│              Vue 3 + Pinia + TypeScript                  │
│  构建: Vite 8  |  包管理: pnpm  |  类型检查: vue-tsc     │
└─────────────────────────────────────────────────────────┘
```

### 关键依赖版本

| 组件 | 版本 | 说明 |
|------|------|------|
| Tauri (Rust) | 2.11.2 | 桌面壳，管理窗口/权限/插件 |
| @tauri-apps/api | 2.11.0 | JS 侧 IPC 接口 |
| tauri-plugin-http | 2.5.9 | Rust 侧 HTTP 请求（绕 CORS） |
| Vue | 3.x | 前端框架（Composition API） |
| Pinia | 最新 | 状态管理 |
| Tiptap | v3 | 富文本编辑器 |
| marked + dompurify | — | Markdown 渲染 |
| highlight.js | latest | 代码语法高亮（15 语言） |
| katex | 0.17 | 数学公式渲染 |
| mermaid | 11.x | 图表渲染（动态 import） |
| tokenx | 1.x | Token 估算 |

---

## 三、目录结构

```
jiucaihezi-app/
├── src-tauri/                  # Tauri Rust 后端
│   ├── src/lib.rs              # 应用入口，注册 6 个插件
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # 窗口/CSP/构建配置
│   └── capabilities/default.json # 权限声明（fs/http/shell/dialog...）
│
├── src/                        # Vue 前端
│   ├── main.ts                 # 启动：theme → patchFetch → initDB → mount
│   ├── App.vue                 # 根组件，调用 runAutoMigrations()
│   ├── env.d.ts                # TS 声明（.vue, .css）
│   │
│   ├── layouts/
│   │   └── WorkspaceLayout.vue # ★ 主布局：5 列桌面 + 移动端适配
│   │
│   ├── components/
│   │   ├── rail/ActivityRail.vue      # Col 1: 左侧图标导航栏
│   │   ├── filetree/FileTreePanel.vue # Col 2: 文件树（搭子/知识库/历史）
│   │   ├── chat/                      # Col 4: 对话区
│   │   │   ├── ChatPanel.vue          #   主对话界面（含搜索开关+Token水位计+多模型对比）
│   │   │   ├── MessageBubble.vue      #   消息气泡（KaTeX/Mermaid/代码高亮/TTS/引用卡片）
│   │   │   ├── ToolCallCard.vue       #   普通工具调用卡片
│   │   │   ├── MediaTaskBubble.vue    #   媒体生成任务气泡
│   │   │   ├── FileUploader.vue       #   文件拖拽上传（Finder拖拽+Tauri事件）
│   │   │   ├── SkillPickerBar.vue     #   搭子选择器
│   │   │   ├── VaultPickerBar.vue     #   知识库选择器
│   │   │   ├── AgentStatusBar.vue     #   Agent 阶段状态条
│   │   │   └── ChatScrollNav.vue      #   滚动导航
│   │   ├── search/
│   │   │   └── GlobalSearch.vue       # 全局搜索 Cmd+K 面板
│   │   ├── agents/                    # 搭子管理
│   │   │   ├── AgentWizard.vue        #   创建向导
│   │   │   ├── AgentEditDialog.vue    #   编辑弹窗
│   │   │   └── EvolutionDiff.vue      #   进化对比
│   │   ├── brain/BrainPanel.vue       # 知识库浏览（raw/wiki/lint）
│   │   ├── editor/
│   │   │   ├── EditorPanel.vue        # Tiptap 富文本编辑器
│   │   │   └── WikiLinkExtension.ts   # [[wiki-link]] 扩展
│   │   ├── creation/                  # 创作面板
│   │   │   ├── CreationPanel.vue      #   主面板
│   │   │   ├── GalleryCard.vue        #   媒体卡片
│   │   │   ├── GalleryLightbox.vue    #   灯箱预览
│   │   │   ├── GalleryLoadingCard.vue #   加载占位
│   │   │   └── GallerySizeControl.vue #   网格控制
│   │   ├── vault/VaultWizard.vue      # 知识库创建向导
│   │   ├── settings/
│   │   │   ├── SettingsPanel.vue       # 设置面板
│   │   │   └── LocalCapabilitySetup.vue # 本地能力中心（V7.1）
│   │
│   ├── composables/               # 核心业务逻辑
│   │   ├── useChat.ts             # ★★★ 最核心文件（1183 行）
│   │   ├── useBrain.ts            # 知识提炼 + 召回
│   │   ├── useCreation.ts         # 创作面板状态
│   │   ├── useCreationEngine.ts   # 创作任务执行
│   │   ├── useFileStore.ts        # 文件 CRUD（IndexedDB 封装）
│   │   ├── useEvolution.ts        # 搭子进化（darwin-skill）
│   │   ├── useSkillRouter.ts      # 搭子自动路由
│   │   ├── useSkillFeedback.ts    # 知识库 → 搭子反哺
│   │   ├── useVaultCompiler.ts    # 知识库编译
│   │   ├── useNotebook.ts         # 笔记本
│   │   ├── useFileUpload.ts       # 文件上传
│   │   └── useTheme.ts            # 主题
│   │
│   ├── stores/                    # Pinia 状态
│   │   ├── agentStore.ts          # 搭子管理（30+ 预设 + 用户自定义）
│   │   ├── sessionStore.ts        # 对话历史（IndexedDB）
│   │   ├── vaultStore.ts          # 知识库管理
│   │   └── mediaTaskStore.ts      # 媒体生成任务队列
│   │
│   ├── utils/                     # 工具函数
│   │   ├── idb.ts                 # ★ SQLite 统一存储 (~/.jiucaihezi/data/jiucaihezi.db)
│   │   ├── api.ts                 # API 配置解析（key/model/base）
│   │   ├── httpClient.ts          # Tauri HTTP 插件桥 + openExternal
│   │   ├── imageBridge.ts         # ★ 图片桥接：非 vision 模型贴图 → vision 模型描述 → 文字注入
│   │   ├── providerConfig.ts      # Provider 配置 + supportsVision() 端点能力检测
│   │   ├── highlight.ts           # ★ 代码语法高亮（highlight.js，15语言，按需注册）
│   │   ├── timeFormat.ts          # 消息时间格式化（相对/绝对时间）
│   │   ├── mathRenderer.ts        # KaTeX 数学公式渲染
│   │   ├── mermaidRenderer.ts     # Mermaid 图表渲染（动态import）
│   │   ├── tts.ts                 # Web Speech API 朗读
│   │   ├── webSearch.ts           # ★ Jina API 联网搜索（jina-search模型）
│   │   ├── localMlxRuntime.ts     # 本地 MLX 模型运行时
│   │   ├── localContentTools.ts   # 本地资料/音视频工具
│   │   ├── browserTools.ts        # 可见 Chrome 浏览器控制
│   │   ├── devProjectTools.ts     # 源码项目读写和命令执行工具
│   │   ├── eventBus.ts            # 全局事件总线
│   │   ├── brain.ts               # 对话 → 知识提炼 LLM 调用
│   │   ├── vaultFs.ts             # Tauri 文件系统同步
│   │   ├── vaultCompilerCore.ts   # 知识库纯函数（索引/lint/排名）
│   │   ├── migration.ts           # 数据迁移
│   │   └── ...                    # 其他辅助
│   │
│   ├── api/
│   │   └── media-generation.ts    # 多模型媒体生成 API
│   │
│   ├── data/
│   │   ├── creationModels.ts      # 9 个媒体模型定义
│   │   ├── vaultTemplates.ts      # 3 个知识库模板
│   │   ├── superpowerSkills.ts    # 额外预设搭子
│   │   └── modelContextWindows.ts # ★ 模型上下文窗口映射（30+模型）
│   │
│   ├── types/
│   │   └── skill.ts               # SkillConfig 等核心类型
│   │
│   └── styles/
│       ├── design-tokens.css      # 设计令牌（暖色调米纸 + 橄榄绿主色）
│       └── base.css               # 全局基础样式 + 字体加载
│
├── public/
│   └── skills/                    # 预设搭子 SKILL.md 文件（静态资源）
│
├── package.json
├── tsconfig.app.json
├── tsconfig.node.json
└── vite.config.ts
```

---

## 四、核心模块详解

### 4.1 useChat.ts — 对话引擎（最重要的文件）

**位置**: `src/composables/useChat.ts`（~1360 行）

#### 统一执行架构

```
用户输入 → sendMessage()
              └── runToolLoop() → SSE 流式对话 → 一手本地工具/云端工具闭环
```

#### Agent 阶段状态机

```
idle → sending → thinking → tool → replying → done
                    ↑         │         │        │
                    └─────────┘         │        │
                    (工具循环)           │        │
                                       error ←──┘
```

#### 云端 API 模式（runToolLoop）

1. `sendMessage()` 检测贴图 → 非 vision 模型触发图片桥接（`imageBridge.ts`）→ 文字描述注入
2. `buildApiMessages(systemPrompt, modelId)` — 组装消息，按模型能力决定图片格式
3. POST `{apiBase}/v1/chat/completions` with `stream: true`
4. `readSSEStream()` — 解析 SSE delta，累积文本和 tool_calls
5. 若有 tool_calls → `executeToolCall()` 执行 → 结果推回消息 → 循环（最多 10 轮）
6. 无 tool_calls → 完成。**不再调用 ingestAssistantOutput（已禁用）。**

#### 内置工具清单

| 工具名 | 功能 | 后端 |
|--------|------|------|
| `office_create` / `create_document` | 创建 Office 文档 | `api.jiucaihezi.studio/office/create` |
| `office_convert` / `convert_document` | 文档格式转换 | `/office/convert` |
| `office_execute` / `run_code` | 代码执行 | `/office/execute` |
| `document_to_markdown` | 本地资料转 Markdown | Tauri 本地转换链路 |
| `browser_search` / `browser_open` | 可见 Chrome 搜索/打开网页 | Tauri 本地浏览器控制 |
| `dev_*` | 源码项目读写/搜索/命令执行 | Tauri 本地执行层 |
| `graphify_build` | 构建知识图谱 | `/graphify/build` |
| `graphify_query` | 查询知识图谱 | `/graphify/query` |

#### 上下文管理（V7.1 Token 水位计）

- `buildApiMessages(systemPrompt, modelId)`: 按 **token 预算**（102K tokens，80% 窗口）从最新消息往回累积，不按条数。
- **过滤管线（6 步）**：清除上下文 → 去错误对 → 去尾 asst → 去邻 user → 去空 → 以 user 开头
- **模型感知图片**：非 vision 模型 → 所有消息图片扁平化为 `[图片N]` 或桥接描述；vision 模型 → 正常 `image_url`
- `clearMessages()`: 注入清除标记，后续对话自动跳过之前的消息
- 不做压缩/摘要：知识库 recallKnowledge 承担长内容的前情提要
- 输入框实时 token 计数（`approximateTokenSize`）+ **Token 水位计** `≈2.4K / 200K ▓░░░ 1.2%`（替代旧 N/20 条）
- 模型菜单能力标签：👁（vision）/ 📝（text-only）

#### 知识注入流程

```
sendMessage
  → recallKnowledge(userText, {vaultId, skillId})
    → rankVaultKnowledge() 关键词排名
    → 取 top 4 wiki 页 + 钉选知识 + CLAUDE.md
    → 拼接到 systemPrompt 末尾
  → (可选) jinaWebSearch(userText)
    → Jina API 快速搜索（用户开关控制）
    → 拼接搜索结果到 systemPrompt（标题+URL+摘要，禁止复述）
    → 搜索引用卡片显示来源
```

---

### 4.2 存储系统 — idb.ts (SQLite)

**单后端设计**：SQLite 数据库，内存缓存加速。

| 组件 | 说明 |
|------|------|
| 数据库文件 | `~/.jiucaihezi/data/jiucaihezi.db` |
| 内存缓存 | 启动时全量加载到 Map，读写即时同步 |
| 迁移 | 首次启动从旧 JSON 文件自动迁移，标记 `_migrations` 表 |

**4 个表**：
- `kv_store` — 键值对（设置、搭子配置等）
- `conversations` — 对话列表（索引: scopeKey, updatedAt）
- `messages` — 消息记录（索引: conversationId, updatedAt）
- `documents` — 文件/知识条目（索引: docKey, updatedAt）

**统一 API**：
```ts
getItem(key) / setItem(key, value) / removeItem(key)     // kv_store
getRecord(store, id) / setRecord(store, data)             // 结构化数据
getAll(store) / getAllByIndex(store, index, key)          // 查询
removeRecord(store, id)                                   // 删除
runStorageBatch(() => { ... })                            // 批量（SQLite 自动事务）
```

**浏览器降级**：`pnpm dev` 调试时自动使用 localStorage + 内存模拟，无需 SQLite。

---

### 4.3 搭子系统 — agentStore.ts + skill.ts

**内置搭子（19 L1 + 1 L2）**：

| 分类 | 搭子 | 来源 |
|------|------|------|
| 专业领域 | 律师工作台 | cat-xierluo/legal-skills 改编 |
| 内容创作 | 漫剧剧本生成器 | 用户 openclaw Agent 改编 |
| 创意设计 | algorithmic-art, brand-guidelines, canvas-design, frontend-design, slack-gif-creator, theme-factory, web-artifacts-builder | anthropics/skills |
| 开发技术 | claude-api, mcp-builder, skill-creator, webapp-testing | anthropics/skills |
| 企业沟通 | doc-coauthoring, internal-comms | anthropics/skills |
| 文档技能 | docx, pdf, pptx, xlsx | anthropics/skills（复用 docx/pdf/pptx/xlsx-office） |
| L2 Agent | Superpower | obra/superpowers v5.1.0 |

**搭子锁定**：内置搭子（`source !== 'user'`）SKILL.md 内容锁定，用户双击选择使用、不可编辑；用户自建搭子双击打开编辑对话框。右键菜单根据 `isBuiltinSkill()` 区分选项。

**搭子进化**：多源进化引擎（`useSkillEvolution.ts`），对话历史（始终可用）+ 知识库 + 编辑器 + 用户口述 + 拖入文件，LLM 分析后生成 diff，用户 keep/revert。内置搭子禁止进化。

**SkillConfig 格式**（对齐 SKILL.md 标准 + L1/L2 分层）：

```ts
interface SkillConfig {
  id, name, description, triggers
  skillContent: string      // SKILL.md body
  references, examples, version
  source: 'preset' | 'user' | 'github' | 'evolved' | 'superpower'
  tier?: 'L1' | 'L2'        // L1=用户Skill（默认），L2=后台Agent
  contextCount?: number      // 上下文保留条数（默认 20）
  agentConfig?: {            // 仅 L2：多Skill编排元数据
    skills: { skillId, role, phase }[]
    hardGate: boolean
    autoTrigger: boolean
  }
}
```

**L1/L2 双区架构**：
- **L1 Skill**（`tier: 'L1'`）— 用户创建 + 系统预设，对标 SKILL.md 标准，单一角色
- **L2 Agent**（`tier: 'L2'`）— 后台创建，可包含多 Skill、状态机、强制工作流。当前唯一 L2：Superpower（对齐 obra/superpowers v5.1.0）

**Superpower Agent**（`id: 'superpower'`）：
- The Rule（对齐 using-superpowers）：回复前必须先检查是否有搭子可用
- Red Flags 表：Agent 的 6 种合理化借口及驳斥
- HARD-GATE：确认意图并制定计划前不执行任何任务
- 工作流：意图解析 → 任务规划 → 分派搭子 → 逐步执行 → 交付汇总

---

### 4.4 知识库系统 — vaultStore.ts + useBrain.ts

**核心原则**：知识库**只接受用户手动添加**，AI 不得自动写入。防止 LLM 幻觉污染知识库。

**三层结构**：

```
Vault/
├── CLAUDE.md          # 配置（编译规则、主题、分类）
├── raw/               # 原始素材（用户上传/拖拽的文件）
│   ├── topic1/
│   └── topic2/
└── wiki/              # 编译后的知识页（raw/ 整理后生成）
    ├── index.md       # 索引
    ├── log.md         # 变更日志
    └── pages/
```

**用户手动添加知识的 3 条路径**：

| 入口 | 流程 | 说明 |
|------|------|------|
| FileTree 知识库 Tab | 打开 vault → 上传/拖拽到 raw/ → 右键「整理」→ raw/ 编译 → wiki/ | 方法一 |
| VaultWizard「添加现有知识库内容」 | 选择知识库 → 上传文件 → 自动整理为 wiki/ | 方法二 |
| VaultWizard「有资料创建」 | 新建知识库时上传资料 → LLM 分析生成结构 | 新建 vault |

**知识召回**（只读不写）：

```
用户提问 → recallKnowledge() → 搜索 wiki/ + 钉选 + CLAUDE.md → 注入 systemPrompt
```

> ⚠️ **已禁用**：`writebackAssistantOutput()` / `ingestAssistantOutput()` 不再自动调用。`distillHistoryToWiki` 仅由用户右键「提炼」手动触发。

---

### 4.5 本地工具运行层

桌面版不依赖外部本地 Agent 服务。工具调用统一从 `useChat.ts` 的 tool loop 进入，再分发到一手实现：

| 工具域 | 文件 | 说明 |
|--------|------|------|
| 格式转换/附件读取/音视频 | `localContentTools.ts` | 本地资料转 Markdown、媒体元信息和 ffmpeg/Whisper 类任务 |
| 可见浏览器 | `browserTools.ts` | 调用本地 Chrome 完成搜索、打开、读取、截图、点击和输入 |
| 源码项目 | `devProjectTools.ts` | 在用户选择的项目根目录内读写文件、搜索、查看 diff、执行允许列表命令 |
| 本地模型 | `localMlxRuntime.ts` | 管理 MLX 服务启动、健康检查和本地模型 API 地址 |

用户侧只看见“工具仓库”和“本地模型”，不暴露额外网关、端口或第三方运行时概念。

---

### 4.6 创作面板 & 画布 — media-generation.ts + mediaTaskStore.ts

**13 个媒体模型**：

| 模型 | 类型 | 通路 |
|------|------|------|
| gpt-image-2 | 图片 | 文生图 / 图生图（/v1/images/generations + /v1/images/edits） |
| nano-banana-2k | 图片 | 文生图 / 多图参考（/v1/images/generations） |
| nano-banana-4k | 图片 | 同上 |
| grok-video-3 | 视频 | 文生视频 / 多图参考（/v1/videos，最多7张） |
| veo3.1-fast | 视频 | 文生视频 / 图生视频（/v1/videos，最多3张） |
| rh-mimic | 视频 | 人物模仿（RunningHub：角色图+动作视频） |
| rh-digital-human-fast | 数字人 | 极速数字人（人物图+音频） |
| rh-digital-human | 数字人 | 数字人（首帧图+音频+台词） |
| suno-custom-song | 音频 | 自定义歌曲（/suno/submit/music → /suno/fetch/:id） |
| rh-voice-clone | 音频 | 声音克隆（参考音频→克隆） |
| rh-voice-design | 音频 | 声音设计（文稿+音色描述→合成） |

**任务状态机**：`pending → running → success / failed / cancelled`

任务持久化到 IndexedDB（上限 50 条），页面刷新后自动恢复轮询。

---

### 4.7 媒体 API 调用路由

所有 API 通过 `https://api.jiucaihezi.studio`（Gateway）统一鉴权。

| 功能 | 端点 |
|------|------|
| 对话 | `/v1/chat/completions` (stream=true) |
| 模型列表 | `/v1/models` |
| 图片生成（文生图） | `/v1/images/generations` |
| 图片编辑（图生图） | `/v1/images/edits` (multipart) |
| 视频生成 | `/v1/videos` → 轮询 `/v1/videos/:id` |
| 素材上传 | `/api/creations/uploads` |
| RunningHub 工作流 | `/api/creations/tasks` → 轮询 `/api/creations/tasks/:id` |
| Suno 音频 | `/suno/submit/music` → `/suno/fetch/:id` |
| 搜索 | 后端 Nginx 代理 Jina API |
| Office | `/office/create`, `/office/convert`, `/office/execute` |
| 知识图谱 | `/graphify/build`, `/graphify/query` |

---

### 4.8 搜索系统（V7.1）

**双通道互斥设计**：

| 通道 | 触发方式 | 说明 |
|------|---------|------|
| Jina API 搜索 | 用户点击「搜索」按钮变蓝 | 每条消息自动调 `jina-search` 模型，结果注入 system prompt。隐藏浏览器工具 |
| 浏览器操控 | 搜索按钮关闭时 | AI 通过 `browser_search` 工具调用控制 Chrome。API 搜索不可用 |

**关键文件**：
- `src/utils/webSearch.ts` — Jina API 调用、文本解析、markdown 生成
- `src/composables/useChat.ts` — `buildAvailableTools()` 中互斥排除浏览器工具
- `src/components/chat/ChatPanel.vue` — 搜索开关 UI + 状态提示

---

### 4.9 Token 水位计（V7.1）

**模型感知的上下文用量显示**：
- `src/data/modelContextWindows.ts` — 30+ 模型上下文窗口映射 + 模型族推断
- `ModelEntry.contextWindow` 字段由 `agentStore.fetchModels()` 自动填充
- 截断策略：按 token 预算（102K）从最新消息往回累积，替代旧的按条数截断
- UI：`≈2.4K / 200K ▓░░░░ 1.2%`，含进度条 + 三色预警（绿/橙/红）

---

## 五、UI 布局

### 桌面端 5 列布局

```
┌──────┬──────────┬──────────────┬──────────────────┐
│ Rail │ FileTree │  ChatPanel   │   右侧面板        │
│ 52px │ 280px    │   450px      │   flex: 1         │
│      │ 可隐藏   │  ★不可隐藏★  │   可隐藏          │
│      │          │              │                    │
│ 图标 │ 搭子树   │ 对话消息      │ 创建搭子           │
│ 导航 │ 知识库树 │ 输入框        │ 搭子仓库           │
│      │ 历史树   │ 搭子选择      │ 知识库仓库         │
│      │          │ 知识库选择    │ 编辑区             │
│      │          │              │ 创作面板           │
│      │          │              │ 设置              │
└──────┴──────────┴──────────────┴──────────────────┘
        ↕ 拖拽     ↕ 拖拽                  ↕ 拖拽
```

### 移动端

```
┌──────┬──────────────────────────┐
│迷你  │     全屏单面板            │
│Rail  │  chat / creation / agents│
│44px  │  brain / editor / settings│
└──────┴──────────────────────────┘
```

---

## 六、设计令牌

主题系统在 `src/styles/design-tokens.css`。

**核心色系**：暖色调米纸 + 橄榄绿

```css
--jc-surface: #EEE1CE;    /* 米纸底色 */
--jc-primary: #D5C787;    /* 橄榄金主色 */
--olive: #6B8E23;          /* 橄榄绿强调 */
--olive-dark: #556B2F;     /* 橄榄深绿 */
```

**快捷别名**：`--bg`, `--paper`, `--surface`, `--ink`, `--ink2`, `--ink3`, `--line`, `--border`

**账户区语义令牌**（4 个主题各有适配值）：

| 令牌 | 用途 | light | dark | green | white |
|------|------|-------|------|-------|-------|
| `--jc-account-card-bg` | 账户卡片底色 | `rgba(255,255,255,0.58)` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.45)` | `rgba(255,255,255,0.70)` |
| `--jc-member-glow` | 会员金色高亮 | `#dccb70` | `#c9a834` | `#b8a040` | `#dccb70` |
| `--jc-member-glow-text` | 会员金色文字 | `#745711` | `#f0d878` | `#5c4030` | `#745711` |

**4 个主题**：白色(white)、浅色(light)、黑夜(dark)、护眼(green)

**字体**：Material Symbols Outlined（图标）、Inter（正文）、Noto Serif SC（中文衬线）

**图标用法**：`<span class="mso">icon_name</span>`

---

## 七、启动流程

```
main.ts
  1. 加载 CSS（design-tokens.css + base.css）
  2. 从 localStorage 恢复主题（无闪烁）
  3. 设置 API 默认值（jcApiBase, jcModel）
  4. Tauri 环境标记 [data-platform="desktop"]
  5. boot()
     └─ patchFetch()  // 全局 fetch monkey-patch
  6. initDB()         // 初始化存储后端
  7. createApp → mount('#app')
```

```
App.vue onMounted
  → runAutoMigrations()  // 数据格式迁移
```

---

## 八、构建与运行

```bash
# 安装依赖
pnpm install

# 开发模式（Tauri 桌面）
pnpm tauri dev

# 仅前端开发（浏览器）
pnpm dev

# 构建
pnpm build              # 仅前端
pnpm tauri build        # 完整桌面应用

# 类型检查
npx vue-tsc -b
```

**注意**：`tsconfig.app.json` 需要 `"ignoreDeprecations": "6.0"` 以兼容 TypeScript 7.x 对 `baseUrl` 的弃用警告。

---

## 九、已知问题与陷阱

### 9.1 ✅ 已修复：API 请求 "Load failed" + SSE 流式传输

**原始问题**：`@tauri-apps/plugin-http` 的 JS 端 `fetch()` 在 macOS WKWebView 中触发 "Load failed"。

**修复方案**：完全绕过 `@tauri-apps/plugin-http`，采用自定义 Rust Command：

| 通道 | Rust Command | 用途 |
|------|-------------|------|
| 非流式 | `http_request` | API Key 验证、模型列表、路由 LLM、媒体生成 |
| 流式（SSE） | `http_request_stream` | `/v1/chat/completions` (stream=true) |

**架构**：
```
patchFetch() 全局劫持 window.fetch
  ├─ 检测 body 含 stream:true → rustFetchStream()
  │     → invoke('http_request_stream', { request, onChunk: Channel })
  │     → Rust reqwest bytes_stream() → 逐块推送 → JS ReadableStream
  │     → useChat.ts SSE 解析器正常工作（真正的实时流式输出）
  │
  ├─ 其他外部 HTTP/HTTPS → rustFetch()
  │     → invoke('http_request', { request })
  │     → Rust reqwest → 一次性返回
  │
  └─ 内部请求 → 原生 fetch
```

**关键文件**：
- `src/utils/httpClient.ts` — JS 侧桥接（safeFetch, patchFetch, rustFetchStream）
- `src-tauri/src/lib.rs` — Rust 侧 `http_request` + `http_request_stream` commands
- `src-tauri/Cargo.toml` — reqwest 需要 `stream` feature，依赖 `futures` crate

### 9.2 外部链接

Tauri WebView 中 `window.open()` 无效。已改用 `openExternal()` 调用 Tauri Shell 插件（`@tauri-apps/plugin-shell` → `open(url)`）在系统浏览器打开。如果仍有链接打不开，检查是否遗漏了 `window.open` 调用。

### 9.3 本地工具运行层

本地工具由 Tauri/Rust 和前端一手模块提供，不需要安装额外本地 Agent 服务。新增工具时应优先接入现有 `localContentTools.ts`、`browserTools.ts`、`devProjectTools.ts` 或 Rust command，避免增加用户可见配置。

### 9.4 TypeScript 严格性

项目关闭了 `noUnusedLocals` 和 `noUnusedParameters`。部分文件有隐式 `any`。这是故意的——快速迭代优先于类型完美。

---

## 十、关键 localStorage 键

| 键 | 用途 | 默认值 |
|----|------|--------|
| `jcApiKey` | API 密钥 | 空 |
| `jcApiBase` | API 基址 | `https://api.jiucaihezi.studio` |
| `jcModel` | 当前模型 | `claude-sonnet-4-6` |
| `jcTheme` | 主题 | `light` |
| `jc_bigfont` | 大字模式 | `false` |
| `jc_skills_v2` | 用户搭子配置 | `[]` |
| `jc_my_skills` | 我的搭子 ID 列表 | `[]` |
| `jc_skill_sort` | 搭子排序方式 | `callCount` |
| `jcWebSearchEnabled` | 搜索开关 | `false` |

---

## 十一、协作三方关系

```
┌──────────┐    systemPrompt     ┌──────────┐
│  搭子     │ ──────────────────→ │          │
│ (谁来做)  │                     │   LLM    │
└──────────┘                     │  API 调用 │
                                 │          │
┌──────────┐    知识注入          │          │
│  知识库   │ ──────────────────→ │          │
│ (参考什么) │                     └────┬─────┘
└──────────┘                          │
                                      │ 工具调用
┌──────────┐                          │
│ 工具仓库  │ ←────────────────────────┘
│ (动手做)  │   文档 / 浏览器 / 项目 / 媒体
└──────────┘
```

**一句话总结**：搭子决定 AI 是谁，知识库提供参考资料，工具仓库提供本地手脚。

---

## 十二、给接手 AI 的快速行动指南

### 改 bug 的标准流程

1. 读本文档定位相关模块
2. `pnpm dev` 在浏览器调试前端逻辑（不需要 Tauri）
3. `pnpm tauri dev` 调试桌面端特有功能（HTTP 插件、文件系统、Shell）
4. 改完后 `npx vue-tsc -b` 确认类型检查通过
5. `pnpm build` 确认前端构建成功

### 加功能的注意事项

- 对话相关 → 改 `useChat.ts`，注意双模式分支
- 搭子相关 → 改 `agentStore.ts`，注意 localStorage 迁移兼容
- 知识库相关 → 改 `vaultStore.ts` + `useBrain.ts`
- 媒体生成 → 改 `api/media-generation.ts` + `mediaTaskStore.ts`
- UI 组件 → 用 `var(--olive)` 等设计令牌，图标用 `<span class="mso">icon_name</span>`
- 外部链接 → 用 `openExternal(url)` 而非 `window.open`
- HTTP 请求 → 当前 patchFetch 有 bug（见 9.1），需要先修复才能正常工作
- 新的 Tauri 插件 → 同时改 `Cargo.toml`（Rust 依赖）、`lib.rs`（注册）、`capabilities/default.json`（权限）

### 最紧急的任务

**修复 API 请求 "Load failed"**。这个 bug 阻塞了整个应用的核心功能。修复后所有对话、创作、搜索功能才能正常工作。参见第 9.1 节的修复方向。
