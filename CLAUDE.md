# 韭菜盒子 V7 — 桌面版产品说明书

> 本文档是 AI 协作者的完整上手指南。目标：读完即可开始编码，无需额外探索。

---

## 一、产品定位

韭菜盒子是一个 **本地优先的 AI 工作台桌面应用**。核心能力：

1. **多模型对话** — 通过统一 API 网关调用 Claude / GPT / Grok 等模型
2. **搭子系统（Skill/Agent）** — 30+ 预设 AI 角色 + 用户自定义，含自动路由和进化
3. **知识库系统（Vault）** — 对话 → 知识提炼 → 知识召回的闭环
4. **创作面板** — 图片（gpt-image-2、grok）、视频（grok、veo、seedance）、音频（suno）生成
5. **OpenClaw 集成** — 本地 AI Agent 运行时，可操控用户电脑（执行命令、文件读写、浏览器、定时任务）
6. **文档能力** — Office 文档生成/转换/代码执行（通过后端 API）

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri v2 (Rust)                       │
│  Plugins: fs, dialog, shell, process, notification, http│
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
| @tauri-apps/plugin-http | 2.5.9 | JS 侧 HTTP 插件 |
| Vue | 3.x | 前端框架（Composition API） |
| Pinia | 最新 | 状态管理 |
| Tiptap | v3 | 富文本编辑器 |
| marked + dompurify | — | Markdown 渲染 |

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
│   ├── main.ts                 # 启动：theme → patchFetch → initDB → mount → autoBootGateway
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
│   │   │   ├── ChatPanel.vue          #   主对话界面
│   │   │   ├── MessageBubble.vue      #   消息气泡（Markdown + 代码块复制）
│   │   │   ├── OpenClawToolBubble.vue #   OpenClaw 工具调用气泡
│   │   │   ├── ToolCallCard.vue       #   普通工具调用卡片
│   │   │   ├── MediaTaskBubble.vue    #   媒体生成任务气泡
│   │   │   ├── FileUploader.vue       #   文件拖拽上传
│   │   │   ├── SkillPickerBar.vue     #   搭子选择器
│   │   │   ├── VaultPickerBar.vue     #   知识库选择器
│   │   │   ├── AgentStatusBar.vue     #   Agent 阶段状态条
│   │   │   └── ChatScrollNav.vue      #   滚动导航
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
│   │   └── settings/SettingsPanel.vue # 设置面板
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
│   │   ├── idb.ts                 # ★ 双后端存储（Tauri=JSON文件 / Browser=IndexedDB）
│   │   ├── api.ts                 # API 配置解析（key/model/base）
│   │   ├── openclawBridge.ts      # ★ OpenClaw Gateway WebSocket RPC 桥
│   │   ├── openclawSync.ts        # 搭子 ↔ OpenClaw workspace 同步
│   │   ├── httpClient.ts          # Tauri HTTP 插件桥 + openExternal
│   │   ├── eventBus.ts            # 全局事件总线
│   │   ├── brain.ts               # 对话 → 知识提炼 LLM 调用
│   │   ├── webSearch.ts           # Jina 搜索 API
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
│   │   └── superpowerSkills.ts    # 额外预设搭子
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

**位置**: `src/composables/useChat.ts`（~1183 行）

#### 双模式架构

```
用户输入 → sendMessage()
              ├── openclawMode=false → runToolLoop() → SSE 流式对话
              └── openclawMode=true  → sendMessageViaOpenClaw() → WebSocket 事件流
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

1. `buildApiMessages(systemPrompt)` — 组装消息，200K token 预算，自动截断旧消息
2. POST `{apiBase}/v1/chat/completions` with `stream: true`
3. `readSSEStream()` — 解析 SSE delta，累积文本和 tool_calls
4. 若有 tool_calls → `executeToolCall()` 执行 → 结果推回消息 → 循环（最多 10 轮）
5. 无 tool_calls → 完成，调用 `ingestAssistantOutput()` 写入知识库

#### 内置工具清单

| 工具名 | 功能 | 后端 |
|--------|------|------|
| `web_search` / `search` | 网页搜索 | Jina API |
| `office_create` / `create_document` | 创建 Office 文档 | `api.jiucaihezi.studio/office/create` |
| `office_convert` / `convert_document` | 文档格式转换 | `/office/convert` |
| `office_execute` / `run_code` | 代码执行 | `/office/execute` |
| `graphify_build` | 构建知识图谱 | `/graphify/build` |
| `graphify_query` | 查询知识图谱 | `/graphify/query` |

#### OpenClaw 模式（sendMessageViaOpenClaw）

1. 检查 Gateway 连接状态
2. 知识召回 → 注入 systemPrompt
3. `sessionCreate()` → `sessionSend(text)` → 订阅事件流
4. 事件映射：`session.text` → 文本追加，`session.tool` → 工具气泡，`session.done` → 完成
5. 工具执行发生在 Gateway 端（非客户端），客户端只渲染

#### 上下文管理

- `buildApiMessages()`: 从新到旧遍历消息，200K token 预算
- 最近 6 条消息强制保留（3 轮对话）
- 旧图片替换为 `[图片已省略]`，仅保留最近 3 轮的图片
- `autoCompressIfNeeded()`: 128K token 85% 阈值触发 → 用快速模型总结旧消息

#### 知识注入流程

```
sendMessage
  → recallKnowledge(userText, {vaultId, skillId})
    → rankVaultKnowledge() 关键词排名
    → 取 top 4 wiki 页 + 钉选知识 + CLAUDE.md
    → 拼接到 systemPrompt 末尾
  → (可选) webSearch(userText)
    → 拼接搜索结果到 systemPrompt
```

---

### 4.2 存储系统 — idb.ts

**双后端设计**：运行时自动选择。

| 环境 | 后端 | 存储位置 |
|------|------|----------|
| Tauri 桌面 | JSON 文件 + 内存缓存 | `~/.jiucaihezi/data/{store}.json` |
| 浏览器 | IndexedDB | `JiucaiDB` v2 |

**4 个 Store**：
- `kv_store` — 键值对（设置、搭子配置等）
- `conversations` — 对话列表
- `messages` — 消息记录
- `documents` — 文件/知识条目

**统一 API**：
```ts
getItem(key) / setItem(key, value)     // kv_store
getRecord(store, id) / setRecord(store, data)  // 结构化数据
getAll(store) / removeRecord(store, id)
```

---

### 4.3 搭子系统 — agentStore.ts + skill.ts

**SkillConfig 格式**（对齐 SKILL.md 标准）：

```ts
interface SkillConfig {
  id: string
  name: string
  description: string
  triggers: string[]        // 路由关键词
  skillContent: string      // SKILL.md body（角色/工作流/输出格式）
  references: string[]
  examples: string[]
  version: number
  source: 'preset' | 'user' | 'github' | 'evolved' | 'superpower' | 'openclaw'
  oneLineDesc?: string
  enabled?: boolean
  callCount?: number
  evolutionLog: EvolutionEntry[]
}
```

**双区架构**：
- **我的搭子**（`jc_my_skills`）— 用户常用，参与路由
- **内置搭子**（30+ 预设）— `skill://` URI 懒加载 SKILL.md

**自动路由**：`useSkillRouter.ts` 根据 `triggers` 关键词匹配用户输入，自动选择搭子。

---

### 4.4 知识库系统 — vaultStore.ts + useBrain.ts

**三层结构**：

```
Vault/
├── CLAUDE.md          # 配置（编译规则、主题、分类）
├── raw/               # 原始素材（对话摘录、上传文件）
│   ├── topic1/
│   └── topic2/
└── wiki/              # 编译后的知识页
    ├── index.md       # 索引
    ├── log.md         # 变更日志
    └── pages/
```

**知识闭环**：

```
对话消息 → ingestConversation() → raw/ 条目
raw/ 条目 → useVaultCompiler → wiki/ 知识页
wiki/ 知识页 → recallKnowledge() → 注入下次对话
wiki/ 知识页 → feedbackSkillFromVault() → 反哺升级搭子
```

---

### 4.5 OpenClaw 集成 — openclawBridge.ts

**OpenClaw** 是一个本地 AI Agent 运行时（Node.js 进程，端口 18789）。

**通信协议**：WebSocket RPC v4

```
客户端 ──── ws://127.0.0.1:18789 ──── Gateway
  │                                      │
  ├─ connect.challenge ←─────────────────┤
  ├─ connect (auth) ─────────────────────→
  ├─ sessions.create ────────────────────→
  ├─ sessions.send ──────────────────────→
  │                                      │
  │  ←─── session.text (流式文本)         │
  │  ←─── session.tool (工具调用)         │
  │  ←─── session.tool.result            │
  │  ←─── session.done                   │
  │                                      │
  ├─ exec.approval.resolve ──────────────→ (批准/拒绝命令执行)
  └─ tools.invoke ───────────────────────→ (直接工具调用)
```

**6 类工具气泡**（OpenClawToolBubble.vue）：

| 类型 | 交互 |
|------|------|
| exec（命令执行） | 命令预览 + 执行/拒绝按钮 |
| file_read | 文件路径 + 在编辑区打开 |
| file_write | 内容预览 + Finder 打开 |
| file_edit | 补丁预览 |
| browser | URL + 操作 + 允许/拒绝 |
| cron | 周期 + 任务 + 确认/取消 |

**UI 集成方式**：
- Rail 栏有 OpenClaw 切换按钮（`memory` 图标）
- 开启后，对话走 WebSocket（非 HTTP SSE）
- 工具调用渲染为特殊气泡，嵌入普通对话流

---

### 4.6 创作面板 — media-generation.ts + mediaTaskStore.ts

**9 个模型**：

| 模型 | 类型 | 同步/异步 |
|------|------|-----------|
| gpt-image-2 | 图片 | 同步（base64 返回） |
| grok-4.2-image | 图片 | 异步轮询 |
| grok-video-3 / fast | 视频 | 异步轮询 |
| veo31-fast | 视频 | 异步轮询 |
| seedance-2.0 / fast / pro | 视频 | 异步轮询 |
| suno-5.5 | 音频 | 异步轮询 |

**任务状态机**：`pending → running → success / failed / cancelled`

任务持久化到 IndexedDB（上限 50 条），页面刷新后自动恢复轮询。

---

### 4.7 媒体 API 调用路由

所有 API 调用通过 `https://api.jiucaihezi.studio`（NewAPI 网关），统一使用 `Authorization: Bearer {jcApiKey}`。

| 功能 | 端点 |
|------|------|
| 对话 | `/v1/chat/completions` (stream=true) |
| 模型列表 | `/v1/models` |
| 图片生成 | `/v1/images/generations` |
| grok 图片/视频 | `/v1/chat/completions` → 轮询 `/v1/files/{id}` |
| veo 视频 | `/v1/images/generations` → 轮询 `/v1/videos/generations/{id}` |
| seedance 视频 | `/seedance/submit` → 轮询 `/seedance/query` |
| suno 音频 | `/suno/submit/music` → 轮询 `/suno/fetch/{id}` |
| 搜索 | 后端 Nginx 代理 Jina API |
| Office | `/office/create`, `/office/convert`, `/office/execute` |
| 知识图谱 | `/graphify/build`, `/graphify/query` |

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
  8. autoBootGateway()  // OpenClaw 自动启动
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

### 9.1 ❌ 最高优先级：API Key 验证 "Load failed"

**现象**：设置面板填写 API Key 后点保存，显示 `❌ 连接失败: Load failed`。

**根因**：`@tauri-apps/plugin-http` 的 JS 端 `fetch()` 函数内部执行了 `new Request(url, init)` 然后调用 `.arrayBuffer()` 读取 body。在 macOS WKWebView 中，对外部 URL 的 `Request.arrayBuffer()` 会触发 WebKit 的资源加载拦截，被 Tauri 的 WebView 沙箱拦截，报 "Load failed"。**请求根本没有到达 Rust 层**。

**影响范围**：所有通过 `safeFetch()` 或被 `patchFetch()` 劫持的 `fetch()` 调用。包括：
- 设置面板 API Key 验证
- 所有 `/v1/chat/completions` 对话请求
- 所有媒体生成 API 调用
- 搜索 API 调用

**修复方向**（未完成）：

方案 A — **直接调用 Tauri IPC**，绕过 JS 插件的 `fetch()` 封装：
```ts
import { invoke } from '@tauri-apps/api/core'

// 绕过 plugin-http 的 JS 层，直接走 Rust 通道
const result = await invoke('plugin:http|fetch', {
  clientConfig: {
    method: 'GET',
    url: 'https://api.jiucaihezi.studio/v1/models',
    headers: { Authorization: 'Bearer sk-xxx' },
  }
})
```
需要研究 `tauri-plugin-http` Rust 端的 `fetch` command 的准确参数格式。

方案 B — **换用 Tauri 自定义 Rust Command**：在 `lib.rs` 中写一个 `#[tauri::command] fn http_request(url, method, headers, body)` 直接用 `reqwest`。

方案 C — **研究 CSP 配置**：当前 CSP 的 `connect-src` 可能需要调整，或完全移除 CSP（`"csp": null`）测试是否有效。但根据诊断，问题不在 CSP 而在 WKWebView 的 Request 构造行为。

### 9.2 外部链接

Tauri WebView 中 `window.open()` 无效。已改用 `openExternal()` 调用 Tauri Shell 插件（`@tauri-apps/plugin-shell` → `open(url)`）在系统浏览器打开。如果仍有链接打不开，检查是否遗漏了 `window.open` 调用。

### 9.3 OpenClaw Gateway

当前 OpenClaw 集成代码已完成，但需要实际安装并启动 OpenClaw Gateway 才能测试。如果没有安装：
```bash
npm i -g openclaw        # 安装
openclaw gateway          # 启动（端口 18789）
```

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
| `jcOpenClawMode` | OpenClaw 模式 | `false` |
| `jcOpenClawPort` | Gateway 端口 | `18789` |
| `jcOpenClawAuth` | Gateway 认证 Token | 空 |
| `jcOpenClawAutoStart` | 自动启动 Gateway | `false` |
| `jcUseLocalGateway` | 使用本地 Gateway | `false` |
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
│ OpenClaw │ ←────────────────────────┘
│ (动手做)  │   exec / file / browser / cron
└──────────┘
```

**一句话总结**：搭子决定 AI 是谁，知识库提供参考资料，OpenClaw 是 AI 的手脚。

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
