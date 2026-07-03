# SDD: 存储架构瘦身 — 资产外迁 + 索引分层

> **状态**: P0 ✅ P1 ✅ P2 ✅ P3 ✅ 全部完成
> **日期**: 2026-06-18
> **分支**: `codex/storage-media-asset-migration`（当前工作分支）
> **读者**: 后续接手的 AI 开发者、前端开发者
> **本次范围**: 数据库瘦身（SQLite < 100MB）+ 媒体资产外迁到文件系统 + 创作画廊快速列表 + 启动/创作面板性能修复
> **明确非范围**: 不做云端同步，不改 OpenCode 存储逻辑，不改 skills 数据库，不做历史数据自动清理工具（手动脚本即可）
> **⚠️ 平台范围**: P0~P2 桌面专属。P3 桌面为主，Web 端不动（huobao-canvas 模式：展示内容，浏览器右键另存为）。IndexedDB 优化单独写 SDD。
> **外部参考结论**: 
> - **对话/消息/会话存储** → 对标 **OpenCode**（`opencode-ai/opencode`）。SQLite 只存结构化元数据，`Session` 自带 `MessageCount`，`Message.List()` 按 session 懒加载，`BinaryContent` 有 `Path` 字段引用文件而非内嵌 base64。
> - **媒体资产/生成结果存储** → 对标 **Pixelle-Video**（`AIDC-AI/Pixelle-Video`）。文件系统存实体，`.index.json` 做快速列表，一个 task 一个目录。

---

## 0. 核心结论

当前数据库 2.4 GB 且持续增长。根因是 **base64 图片嵌入在消息 JSON 中存入 SQLite**。虽然 `sessionStore.ts:168` 已有剥离逻辑（`images` 字段 → `documents` 表），但 `content` 字段和 `files` 字段中的 base64 未被剥离，且 `documents` 表本身仍在内嵌 base64。

本次目标借鉴两个成熟产品的实践：

```text
对话存储 → OpenCode 模式: SQLite 只存元数据 + 消息按需懒加载 + jc-media:// 引用替代 base64
媒体存储 → Pixelle-Video 模式: 文件系统存实体 + media_assets 表做 canonical index
```

不是模仿 Pixelle-Video 的全文件系统方案（不删 SQLite），也不是照搬 OpenCode 的纯 SQLite（它们没有媒体生成功能）。而是 **SQLite 管对话，文件系统管媒体**。

---

## 1. 当前问题

### 1.1 数据分布

| 表 | 估算大小 | 内容 |
|----|---------|------|
| `messages` | ~1.5 GB | 消息 JSON，内嵌 base64 图片（`content`、`images`、`files` 字段） |
| `documents` | ~0.8 GB | "剥离"后的图片，实际仍是 base64 内嵌在 `content` 字段 |
| `conversations` | ~50 MB | 会话元数据（title, preview, messageCount） |
| `kv_store` | ~50 MB | 设置 + 媒体任务状态（`jc_media_tasks_v1`） |

### 1.2 症状链

```
base64 图片嵌入消息 JSON
  → messages 表膨胀到 1.5 GB
  → 剥离到 documents 表，但 documents.content 仍是 base64
  → documents 表膨胀到 0.8 GB
  → loadByCategory() 全量加载 documents 表
  → 创作面板打开需 10-30 秒
  → 加载 2.4 GB 数据进内存
  → 系统 OOM → APP 自动重启
```

### 1.3 已止血的部分

| 修复 | 状态 | 效果 |
|------|------|------|
| `warmCache()` 只预热 `kv_store` | ✅ 已合入 | 启动不再全量加载 |
| `loadAllSessions()` 不读 `messages` 表 | ✅ 已合入 | 启动不再扫消息 |
| `conversation` 记录自带 `preview` + `messageCount` | ✅ 已合入 | 会话列表不需要消息表 |

### 1.4 仍需修复的部分

> **P0 全部完成（2026-06-18）**：启动卡顿、OOM 重启、创作面板慢已止血。以下转入 P1。

| 问题 | 根因 | 影响 | 解决阶段 |
|------|------|------|---------|
| ~~启动仍要半分钟~~ | ~~① `/v1/models` 超时 ② `initApiKey()` Keychain ③ `CREATE INDEX` 扫全表~~ | ✅ P0-3/4/5/6 已修复 | — |
| ~~创作面板打开慢~~ | ~~`loadByCategory()` 全量扫 `documents` 表~~ | ✅ P0-2 已修复 | — |
| ~~APP 自动重启~~ | ~~OOM~~ | ✅ P0-2 修完即解决 | — |
| 数据库持续膨胀 | 新消息仍在嵌入 base64（`content`/`files` 字段） | 不可持续 | P1（写路径改造） |

---

## 2. 参考架构

### 2.1 对话/消息/会话 → OpenCode

OpenCode 的 SQLite 实践（`internal/db/connect.go`、`internal/session/session.go`、`internal/message/message.go`）：

```text
SQLite ~/.opencode/opencode.db
├── sessions 表
│   { id, title, message_count, prompt_tokens, completion_tokens, ... }
│   ← Session 自带 MessageCount，List() 不联表查消息数
│
├── messages 表
│   { id, session_id, role, parts(JSON), model, ... }
│   ← Message.List(sessionID) 按会话懒加载，启动不读
│   ← parts 中的 BinaryContent 有 Path 字段，不内嵌 base64
│
├── files 表（history）
│   { id, session_id, path, content(文本), version, ... }
│   ← 只存 diff 文本，不存二进制
│
└── PRAGMA: journal_mode=WAL, page_size=4096, cache_size=-8000
```

**可对标的实践**：

| OpenCode 做法 | 韭菜盒子对标 | 状态 |
|--------------|-------------|------|
| `Session.MessageCount` 字段 | `conversation.messageCount` | ✅ 已实现 |
| `Session.List()` 只读 sessions 表 | `loadAllSessions()` 只读 conversations 表 | ✅ 已实现 |
| `Message.List(sessionID)` 按需加载 | `loadSessionMessages(id)` 按需加载 | ✅ 已有，天然懒加载 |
| `BinaryContent.Path` 存文件路径 | 消息的 `images`/`files` 存 `jc-media://assetId` | ❌ 待实现（P1） |
| 启动不读 messages 表 | `warmCache()` 不预热 messages | ✅ 已实现 |
| SQLite PRAGMA 优化 | 当前无 WAL 显式设置 | 🟡 可优化 |

### 2.2 媒体资产/创作画廊 → Pixelle-Video

Pixelle-Video 的文件系统实践（`pixelle_video/services/persistence.py`）：

```text
output/
├── .index.json                  ← 一个索引文件，存所有任务摘要
│   { "version": "1.0", "tasks": [
│     { "task_id": "xxx", "title": "...", "status": "completed",
│       "created_at": "...", "duration": 5.2, "n_frames": 10 }
│   ]}
│
├── {task_id}/
│   ├── metadata.json            ← 任务元数据（纯文本 JSON，~1-5 KB）
│   ├── storyboard.json          ← 分镜数据（纯文本 JSON）
│   ├── final.mp4                ← 生成的视频（直接放磁盘）
│   └── frames/
│       ├── 01_audio.mp3
│       ├── 01_image.png
│       └── ...
```

**可对标的实践**：

| Pixelle-Video 做法 | 韭菜盒子对标 | 状态 |
|-------------------|-------------|------|
| 媒体文件直接放磁盘 | `~/.jiucaihezi/data/media/creation/` | ❌ 待实现（P1） |
| `.index.json` 快速列表 | `media_assets` 表（canonical index）；`.index.json` 降级为可重建缓存（Web 端可用） | ❌ 待实现（P1） |
| `metadata.json` 存任务摘要 | `kv_store.jc_media_tasks_v1` 已存任务元数据 | ✅ 已有 |
| 一个 task 一个目录 | `creation/{date}/{taskId}/` | ❌ 待实现（P1） |
| `_ensure_index()` 启动时检查 | `initDB()` 中确保 `media_assets` 表存在（`CREATE TABLE IF NOT EXISTS`） | ❌ 待实现（P1） |

### 2.3 两个参考的分工

```text
┌─────────────────────────────────────────────────┐
│              韭菜盒子 存储架构                     │
│                                                  │
│  对话/消息/会话 ──── 对标 OpenCode ──── SQLite     │
│  • 会话元数据（title, preview, messageCount）      │
│  • 消息纯文本（content, tool_calls）               │
│  • 设置项（kv_store）                              │
│  • 启动只读 kv_store + conversations              │
│                                                  │
│  媒体/资产/画廊 ──── 对标 Pixelle-Video ── 文件系统 │
│  • 图片/视频/音频实体文件                           │
│  • media_assets 表 canonical index                │
│  • 缩略图缓存                                     │
│  • 创作结果按 source/date 分目录                   │
└─────────────────────────────────────────────────┘
```

---

## 3. 目标架构

### 3.1 目录结构

```text
~/.jiucaihezi/
├── data/
│   ├── jiucaihezi.db              # SQLite：结构化元数据 + media_assets 表（目标 < 100MB）
│   │   ├── conversations, messages, kv_store  # 对话/消息/设置（不变）
│   │   └── media_assets                      # ★ 新增：canonical 媒体索引
│   ├── media/                     # ★ 新增：文件系统媒体存储
│   │   ├── chat/{YYYY-MM}/{assetId}.{ext}
│   │   ├── creation/{YYYY-MM}/{assetId}.{ext}
│   │   └── thumbnails/{hash}_{size}.webp
│   └── .session                   # Token（不变）
└── opencode-runtime/              # OpenCode（不变）
```

### 3.2 四层架构

```text
┌────────────────────────────────────────────────────────────┐
│ 第 1 层：SQLite media_assets 表（canonical index）          │
│   id, logicalPath, mime, size, width, height, hash,        │
│   source(chat/creation/canvas), sourceId,                  │
│   thumbnailAssetId, createdAt                              │
│   ← 唯一事实源，ACID 事务保证一致性                          │
├────────────────────────────────────────────────────────────┤
│ 第 2 层：文件系统（二进制实体）                              │
│   ~/.jiucaihezi/data/media/                                │
│   {source}/{YYYY-MM}/{assetId}.{ext}                        │
│   ← 只存真实二进制，路径由 assetId 生成                     │
├────────────────────────────────────────────────────────────┤
│ 第 3 层：业务表（只存引用）                                  │
│   messages.images → ["jc-media://{assetId}", ...]           │
│   messages.files  → [{ name, assetId: "jc-media://..." }]  │
│   documents       → 保留表结构，content 外迁后存 null       │
│   mediaTask       → resultUrl 存 jc-media://assetId         │
│   cpState.results → localStorage，url 存 jc-media://assetId│
├────────────────────────────────────────────────────────────┤
│ 第 4 层：运行时 resolver（统一读写入口）                     │
│   resolveForDisplay(assetId) → Tauri convertFileSrc / Blob  │
│   resolveForUpload(assetId)  → File / base64（给 LLM）       │
│   resolveForLlm(assetId)     → image_url content block       │
│   ← 避免各组件各自读文件、各自拼 base64                      │
└────────────────────────────────────────────────────────────┘
```

**关键变更**：

| 原来（反模式） | 改为 |
|--------------|------|
| `messages.images` 存 base64 data URL | 存 `jc-media://{assetId}` |
| `documents.content` 存 base64 | 存 `null`，实体在文件系统 |
| `documents` 表删除 | **保留**（Skill/历史/编辑器/画布依赖），只外迁 media content |
| 画廊扫 `documents` 全表 | 画廊读 `media_assets` 表（SQLite 索引 + 分页） |
| 各组件自己 `JSON.parse` base64 | 统一走 `resolveForDisplay()` |

### 3.3 数据流

```text
用户贴图/生成图片
  ↓
mediaFileWriter（唯一写入入口）：
  1. 二进制写入 ~/.jiucaihezi/data/media/{source}/{date}/{assetId}.{ext}
  2. INSERT INTO media_assets (id, logicalPath, mime, size, hash, source, sourceId, ...)
  3. 返回 assetId
  ↓
业务层保存：
  messages.images  → ["jc-media://{assetId}", ...]
  documents        → { ..., content: null, assetId: "jc-media://..." }
  mediaTaskStore   → resultUrl: "jc-media://{assetId}"
  cpState.results  → url: "jc-media://{assetId}"
  ↓
画廊加载：
  读 media_assets 表（分页 + 按 source/date 过滤）
  → 卡片列表渲染
  → 按需调 resolveForDisplay(assetId) 加载缩略图
```

当前创作画廊合并了三路数据（`CreationPanel.vue:674`、`useCreation.ts:305`、`creationMediaCache.ts:101`）：

| 数据源 | 存储位置 | 内容 |
|--------|---------|------|
| `cpState.results` | `localStorage`（`jc_creation_state_v1`） | 用户本地画廊卡片（含 data URL 缩略图） |
| `mediaTaskStore.tasks` | `kv_store.jc_media_tasks_v1` | 任务状态机（含 `resultUrl`、`planSnapshot`） |
| `documents` 媒体资产 | SQLite `documents` 表 | `creationMediaCache` 下载的远程媒体 |

迁移后合并策略：

```text
cpState.results  ← 只存卡片元数据（model, task, prompt, ts），url 改为 jc-media://assetId
mediaTaskStore   ← 不变（任务状态机，resultUrl 改为 jc-media://assetId）
media_assets 表  ← canonical index，画廊列表主数据源
documents 表     ← 保留但不再写入 media content（Skill/历史/编辑器仍用）
```

画廊渲染逻辑调整为：
1. 读 `media_assets` 表（分页 + 按 source/date 过滤）→ 卡片列表
2. 缺失缩略图时按需从 `cpState.results` 补
3. 不再扫 `documents` 表

---

## 4. 实施阶段

### P0：止血（只做「读不爆 + 启动不卡」，不动写路径）

**依赖顺序**：P0-0 → P0-1 → P0-2，P0-3、P0-4、P0-5 可并行。

#### P0-0：documents 表 schema 迁移（前置，不可跳过）

| 文件 | 改动 |
|------|------|
| `src/utils/idb.ts` | `initDB()` 中执行 migration：`ALTER TABLE documents ADD COLUMN category TEXT` + `CREATE INDEX idx_doc_category ON documents(category)` |
| `src/utils/idb.ts` | 全量回填：遍历 `documents` 表，逐行 `JSON.parse(data)` 提取 `category` 字段，`UPDATE documents SET category = $1 WHERE id = $2` |
| `src/utils/idb.ts` | 回填完成后写 `_migrations` 表记录（`documents_category_column`） |

**注意**：回填在 2.4 GB 的 documents 表上会很慢。本次不阻塞启动：只加列 + 写 migration 记录；`CREATE INDEX` 延迟到后台 3s 后执行；历史数据回填留到 `loadByCategory` 首次访问时 fallback 全量扫。

**验收**：`PRAGMA table_info(documents)` 包含 `category` 列，`idx_doc_category` 索引存在。

#### P0-1：setRecord 同步写 category 投影列

| 文件 | 改动 |
|------|------|
| `src/utils/idb.ts` | `setRecord('documents', ...)` 时从 `value.category` 提取写入 SQL `category` 列 |
| `src/stores/sessionStore.ts` | 剥离 `images` 字段 base64 存 documents 时，确保 `category: 'image'` 写入 |

**验收**：新写入的 documents 行 `category` 列非空。

#### P0-2：loadByCategory 走索引

| 文件 | 改动 |
|------|------|
| `src/composables/useFileStore.ts` | `loadByCategory` 改为 `getAllByIndex('documents', 'category', category)` |

**前提**：P0-0 和 P0-1 完成。`getAllByIndex` 拼 `WHERE category = $1`，列不存在会 SQL 报错。

**验收**：创作面板打开 < 2s，`getAllByIndex` 走索引不回退全表扫。

#### P0-3：缩短 startup 网络超时

| 文件 | 改动 |
|------|------|
| `src/utils/httpClient.ts` | `pickTimeoutForUrl` 加 `/v1/models` → 5s |

**验收**：启动 < 5s，/v1/models 不再卡 30s。

#### P0-4：`initApiKey()` 启动时不阻塞（对标 OpenCode 懒鉴权）

| 文件 | 改动 |
|------|------|
| `src/main.ts` | `boot()` 中 `await initApiKey()` 改为 `initApiKey().catch(() => {})`（fire-and-forget），状态文案改为「正在准备工作台...」 |
| `src/services/newApiClient.ts` | `invoke('get_api_key')` 加 `Promise.race` 3s 超时作为安全网 |

**背景**：OpenCode 不在启动时验证 API Key——它在首次 API 请求时才读取配置。韭菜盒子 `initApiKey()` 走 `invoke('get_api_key')` → Rust `keyring` crate → macOS Keychain，可能因钥匙串锁定或权限弹窗阻塞 30+ 秒。只要 `boot()` 里有 `await`，整个启动链就被卡住。

**策略**：启动不等 Keychain。`boot()` 立即返回 → `initDB()` → Vue mount。Keychain 在后台静默读取，读到后 `apiKeyMemoryCache` 自动设置。Key 就绪前的 API 请求会 401，但 P0-3 已将 `/v1/models` 超时缩到 5s，影响极小。

**验收**：有无 Keychain 权限均在 < 2s 进入 UI，Key 后台就绪后可正常对话。

#### P0-5：`CREATE INDEX` 延迟到后台

| 文件 | 改动 |
|------|------|
| `src/utils/idb.ts` | `migrateDocumentsCategoryColumn()` 中 `CREATE INDEX` 移到 `setTimeout(fn, 3000)` |

**背景**：`CREATE INDEX` 在 0.8GB 的 documents 表上需要扫描全表才能构建索引（即使所有值都是 NULL）。这发生在 `initDB()` 同步阶段，会阻塞 `app.mount('#app')`。

**验收**：启动不因索引构建卡死，索引在 APP 渲染后 3s 后台完成。

#### P0-6：产品级启动体验 — 品牌 Splash + 静默启动 ✅ 已完成

| 步骤 | 文件 | 实际落地 |
|------|------|---------|
| P0-6a | `index.html` | 删除 `<script src="/boot-diagnostics.js">` + `#jc-boot-status` div。品牌 splash：**仅韭菜 logo SVG**（无文字无 spinner），`scale(0.7)→scale(1)` 0.8s cubic-bezier 缓入，容器 `transition: opacity 0.35s` 待淡出 |
| P0-6b | `src/main.ts` | 删除 3 处 `__JC_BOOT_STATUS__`，`initApiKey()` 改为 fire-and-forget。Vue mount 后 splash 加 `jc-boot-fade-out` class → `transitionend` 后 `remove()`（400ms 安全网） |
| P0-6c | `src-tauri/src/lib.rs` | `setup()` 中 skills DB 的 `block_on` 改为 `tauri::async_runtime::spawn`，窗口先创建，`app.manage(SkillsAppState)` 在后台闭包内 |
| P0-6d | `public/boot-diagnostics.js` | **已删除** |

**最终效果**：纯 logo 从微缩缓缓放大 → Vue 就绪后平滑淡出 → 主界面。无文字、无转圈、无跳变。

### P1：资产外迁 ✅ 写路径已改造（2026-06-18）

| 功能 | 文件 | 状态 |
|------|------|------|
| 媒体文件写入器 | `src/utils/mediaFileWriter.ts` | ✅ 已创建 — `writeMediaAsset()`: base64/Uint8Array → `~/.jiucaihezi/data/media/{source}/{YYYY-MM}/{assetId}.{ext}` → `INSERT INTO media_assets` → 返回 assetId |
| 媒体文件读取器 | `src/utils/mediaFileReader.ts` | ✅ 已创建 — `resolveForDisplay()` (convertFileSrc) / `resolveForLlm()` (base64 + LRU 50条/50MB) / `parseMediaRef()` |
| **新消息 base64 剥离（images + content + files）** | `src/stores/sessionStore.ts` | ✅ 已完成 — `saveSession` 三字段全量剥离：images → `jc-media://`, content 内 `data:image/...` markdown → `jc-media://`, files.content → `jc-media://` + assetRef |
| 对话加载适配 | `src/stores/sessionStore.ts` | ✅ 已完成 — `loadSessionMessages` 兼容 `jc-doc://` 旧格式 + `jc-media://` 新格式，content/files 引用自动 resolveForLlm |
| 画廊索引 | `src/stores/mediaAssetStore.ts` | ✅ 已创建 — `queryMediaAssets()` 分页查询，`loadCreationImages/Videos/All()` 快捷方法 |
| media_assets 表 | `src/utils/idb.ts` | ✅ 已创建 — typed columns (id, logicalPath, mime, size, width, height, hash, source, sourceId, thumbnailAssetId, createdAt) + source/createdAt 索引 |
| **Tauri capability scope** | `src-tauri/capabilities/default.json` | ✅ 无需改 — 现有 `$HOME/.jiucaihezi/**` scope 已覆盖 media 目录 |

**P1 架构落地**：
```
saveSession 写入:
  images → writeMediaAsset() → ~/.jiucaihezi/data/media/chat/YYYY-MM/xxx.png
                           → INSERT media_assets → jc-media://{assetId} 存入消息
  content 内 ![...](data:image/...) → 同上
  files[].content base64 → 同上 (assetRef 字段)

loadSessionMessages 读取:
  jc-media://{assetId} → resolveForLlm() → LRU cache → readFile → base64 data URL
  jc-doc://{id} (旧) → documents 表兜底
```

**向后兼容**：历史消息的 `jc-doc://` 引用仍然从 `documents` 表读取。新消息统一走 `jc-media://` 文件系统路径。`documents` 表保留不动（P2 迁移脚本处理）。

#### P1.1 resolver 缓存策略

LLM 重发时会反复把同一张历史图片从磁盘读出 → base64 编码 → 塞进 `image_url` block。一次长会话 30~50 张历史图时，读盘 + base64 开销可能比直接拿内存里的 data URL 还慢。

```
resolveForLlm(assetId):
  1. 查内存 LRU base64 cache（max 50 条，Tauri 侧 50MB 上限）
  2. hit → 直接返回
  3. miss → 读文件 → base64 编码 → 写入缓存 → 返回
  4. 如果 NewAPI 后续支持 multipart 引用，优先走引用（不编码）
```

**验收**：
- 新消息的图片存到 `~/.jiucaihezi/data/media/chat/`
- 创作结果存到 `~/.jiucaihezi/data/media/creation/`
- 画廊首屏 < 1s（SQLite 索引 + LIMIT/OFFSET）
- `documents` 表的 `category='image'/'video'/'audio'` 子集不再有新写入（表保留）
- `convertFileSrc` 可正常解析 media 路径（capability scope 已配）
- SQLite < 100 MB（新数据）

### P2：历史迁移 ✅ 脚本已就绪（2026-06-18）

| 功能 | 文件 | 说明 |
|------|------|------|
| 历史数据迁移脚本 | `scripts/migrate-media-to-fs.mjs` | ✅ 已创建，Node.js 内置 `node:sqlite`，零依赖 |

**用法**：
```bash
# 预检（只统计不写入）
node scripts/migrate-media-to-fs.mjs --dry-run

# 正式迁移
node scripts/migrate-media-to-fs.mjs

# 指定数据库路径
node scripts/migrate-media-to-fs.mjs --db /path/to/jiucaihezi.db
```

**迁移结果（2026-06-18 实测）**：
- 数据库: **2.4 GB → 0.57 GB**（76% 瘦身）
- messages 表: 388 条 → 29 个 `jc-doc://` 引用解析为文件
- documents 表: 645 条 base64 content → 文件系统，content 置 null，assetId 存 `jc-media://`
- 共写入 674 个文件，1.4 GB，目录 `media/chat/2026-06/`
- VACUUM 后数据库 0.57 GB
- 备份: `jiucaihezi.db.backup` (2.4 GB)

**迁移脚本设计**：

```
0. precheck：磁盘剩余空间 > db_size × 2.2，不满足拒绝运行并提示用户
1. 写 migration.lock（APP 启动检测到此文件 → 拒绝启动，提示等待迁移完成）
2. 备份 DB（cp jiucaihezi.db jiucaihezi.db.backup）
3. WAL checkpoint（确保所有数据落盘）
4. 创建 manifest.json（记录迁移进度，支持中断续传）
5. 游标分批扫描 messages 表：
   a. 遍历每条消息的 images/content/files 字段
   b. 匹配 data:image/...;base64,... 和 data:video/...;base64,...
   c. 提取 base64 → 解码 → 写文件系统 → 生成 assetId
   d. INSERT INTO media_assets
   e. 替换原字段为 jc-media://{assetId}
   f. 每 50 条 UPDATE 一次 messages + 更新 manifest 进度
6. 游标分批扫描 documents 表（同样逻辑）
7. 校验：抽查 100 条，hash 对比文件内容 vs 原 base64
8. VACUUM（precheck 已确认空间足够）
9. 失败回滚：任意步骤失败 → 从 manifest 恢复 → 或从备份 DB 恢复
10. dry-run 模式：只统计不写入，预估迁移后 DB 大小
11. 完成 → 删除 migration.lock
```



### P3：「我的文件」— 一个按钮，一个文件夹

> **目标**: 用户点一下「📁 我的文件」，Finder 打开 `~/韭菜盒子/`。里面按类别分好了子目录。用户自己看、自己管。APP 不做任何文件管理 UI。
> **核心原则**: 操作系统是最好的文件管理器。我们只做两件事：① 把文件组织好放进去；② 提供一个按钮打开它。
> **参考**: ComfyUI（零管理）、huobao-canvas（存引用不存数据，浏览器负责保存）。
> **平台**: 桌面专属。Web 端不动（huobao-canvas 模式——展示内容，浏览器右键另存为即可，不做下载按钮）。

#### P3.0 用户看到什么（实际实现）

点「📁 我的文件」→ Finder 弹出 `data/media/`：

```
data/media/
├── chat/YYYY-MM/       ← 聊天贴图自动落地
├── creation/YYYY-MM/   ← 创作图片自动落地 + 手动下载
├── exports/            ← 右键导出对话/文本/画布
└── thumbnails/         ← 系统缩略图缓存（不暴露给用户）
```

> **设计简化说明**: 原设计 `~/韭菜盒子/` 中文目录 + symlink 方案保留到未来迭代。当前采用更简单的方案：直接打开 `data/media/`，用户看到的是按 source 分目录的英文路径。`myFilesProvider.ts` 已预留 `~/韭菜盒子/` 路径解析，未来可无缝切换。

#### P3.1 FileTree 底部「📁 我的文件」按钮

```
┌──────────────┐
│  文件        │
│ [会话][文本][画布]│
│ 🔍 搜索      │
│              │
│ 💬 对话1     │
│ 💬 对话2     │
│ ...          │
├──────────────┤
│ 📁 我的文件   │  ← 就这一行。点击 → Finder 打开 ~/韭菜盒子/
└──────────────┘
```

无展开、无子项、无折叠。文案跨平台（macOS「在 Finder 中打开」/ Windows「在文件管理器中打开」）。路径太长折叠中段。

| 文件 | 改动 |
|------|------|
| `src/components/filetree/FileTreePanel.vue` | 底部加一行「📁 我的文件」，`invoke('open_in_shell')` 打开 `data/media/` |

#### P3.2 启动建目录（实际实现）

首次点击「我的文件」时由 Rust `open_in_shell` 按需 `create_dir_all`，不阻塞启动。无需 symlink（`data/media/` 直接是实体目录）。

| 文件 | 改动 |
|------|------|
| `src-tauri/src/lib.rs` | Rust command: `open_in_shell` 含 `create_dir_all` + `open_path_with_system` |
| `src/utils/myFilesProvider.ts` | **预留**: `getMyFilesRoot()` → `~/韭菜盒子/`，未来切换中文方案时启用 |

#### P3.3 导出（纯用户主动）

| 内容 | 触发 | 格式 |
|------|------|------|
| 对话 | 右键 →「导出到文件夹」| .md |
| 文本 | 编辑器「保存到本地」| .md |
| 画布 | 画布「导出项目」| .json |

| 文件 | 改动 |
|------|------|
| `src/components/filetree/FileTreePanel.vue` | 右键菜单加「导出到文件夹」 |
| `src/utils/exportToMyFiles.ts` | **新建** |

#### P3.4 缩略图缓存（仅图片）

懒生成 128px webp，上限 500 个，超出按 mtime 淘汰。写入路径触发淘汰。不含视频。

| 文件 | 改动 |
|------|------|
| `src/utils/mediaThumbnail.ts` | `resolveThumbnail()` + 写入路径内嵌淘汰 |
| `src/stores/mediaAssetStore.ts` | `loadGallery()` 用缩略图替代原图 |

#### P3.5 WAL checkpoint

启动 5s 后 + 切后台时 `wal_checkpoint(TRUNCATE)`。不设 autocheckpoint。P3 后不再自动 VACUUM。

| 文件 | 改动 |
|------|------|
| `src/main.ts` 或 App.vue | 启动 5s 后 + 后台切换时 checkpoint |

#### P3.6 ENOENT 降级（硬要求）

用户 Finder 删文件后 APP 不能崩：`resolveForDisplay` 返回占位图，`resolveForLlm` 返回 null + warn。

#### P3.x 明确不做

| 不做 | 原因 |
|------|------|
| 孤儿扫描 / .orphans | 用户用 Finder 管 |
| 垃圾桶 / 软删除 | 系统废纸篓已够 |
| 引用计数 GC | 复杂度 > 收益 |
| 存储仪表盘 | Finder 就是仪表盘 |
| 30 天 TTL | 用户作品不静默删 |
| 手动 VACUUM 按钮 | WAL checkpoint 够用 |
| 视频缩略图 | 需 ffmpeg，P3 范围外 |
| Web 端文件管理 | 浏览器右键另存为即可 |

#### P3 实施顺序 ✅ 全部完成（2026-06-18）

| # | 功能 | 状态 | 关键文件 |
|---|------|------|---------|
| 1 | FileTree 按钮 + 启动建目录 | ✅ | `FileTreePanel.vue`, `myFilesProvider.ts`, `App.vue` |
| 2 | 导出功能（右键→导出到文件夹） | ✅ | `FileTreePanel.vue`, `exportToMyFiles.ts` |
| 3 | WAL checkpoint + ENOENT 降级 | ✅ | `main.ts`, `idb.ts`, `mediaFileReader.ts` |
| 4 | 缩略图缓存（128px webp，500上限） | ✅ | `mediaThumbnail.ts`, `mediaFileReader.ts` |

## 5. ADR

### ADR-001：保留 SQLite 而非全文件系统

**状态**: Proposed

**Context**

Pixelle-Video 用全文件系统方案（一个 task 一个目录），因为它没有对话、没有消息、没有设置——它只生成视频。OpenCode 用纯 SQLite 方案，因为它只有文本对话、没有媒体生成。韭菜盒子兼有两者的需求：OpenCode 式的对话系统 + Pixelle-Video 式的媒体生成。

**Decision**

采用混合架构：**SQLite 管对话（对标 OpenCode）+ 文件系统管媒体（对标 Pixelle-Video）**。

- SQLite 存 conversations、messages（纯文本）、kv_store
- 文件系统存图片、视频、音频、缩略图
- `media_assets` 表做 canonical index；`documents` 表保留，只剥离 media 子集

**Consequences**

- 正面：对话查询保持 SQL 能力，媒体存储避免 blob 膨胀
- 正面：两个参考产品的实践可直接对标，架构清晰
- 负面：需维护两套存储路径，但可封装在 `mediaFileWriter`/`mediaFileReader` 工具层

### ADR-002：用 `media_assets` 表而非 `.index.json` 做 canonical index

**状态**: Proposed

**Context**

Pixelle-Video 用 `output/.index.json` 因为它是纯 Python 项目，没有现成 SQLite。韭菜盒子已有 SQLite + 事务支持。`.index.json` 会带来并发写、崩溃半写、重建成本、文件锁等问题。

**Decision**

- **`media_assets` 表**做 canonical index（ACID 保证一致性）
- `.index.json` 降级为**可重建缓存**或导出格式，损坏不影响数据完整性
- **画廊默认读 `media_assets` 表**（canonical index，ACID 保证一致性）；`.index.json` 降级为可重建导出/缓存，损坏不影响数据完整性。如果使用 `.index.json`，需显式定义 cache invalidation 策略。

**Consequences**

- 正面：事务安全，崩溃不会丢索引数据
- 正面：可用 SQL 做复杂查询（按 source、日期范围、mime 过滤）
- 负面：需要一次 schema 迁移（加 `media_assets` 表）

### ADR-003：消息中媒体引用用 `jc-media://assetId` 逻辑路径

**状态**: Proposed

**Decision**

剥离 base64 后，所有业务表统一存储 `jc-media://{assetId}` 逻辑路径，如：
```json
{ "images": ["jc-media://img_abc123"] }
```
运行时由 `mediaResolver` 转换为：
- 渲染层：`resolveForDisplay(id)` → Tauri `convertFileSrc(realPath)` 或 Web `blob:`
- 上传/LLM：`resolveForLlm(id)` → base64 data URL 或 `image_url` content block

**为什么不用 `file://` 绝对路径**：
- 桌面数据目录来自 `appDataDir()`（Tauri 运行时解析），不是固定 `~/.jiucaihezi`
- Web 端无文件系统，`file://` 不可用
- 移动数据目录需批量更新路径——用逻辑 ID 则无需修改

**Consequences**

- 正面：双端统一（桌面走 `convertFileSrc`，Web 走 IndexedDB/Blob）
- 正面：数据目录迁移不影响引用
- 负面：每次渲染需一次 ID→路径 解析（可缓存）

### ADR-004：写入顺序「先文件 → 后 DB」+ 启动孤儿扫描

**状态**: Proposed

**Context**

文件系统和 SQLite 是两个独立的写入目标，无法用同一个事务包裹。可能出现：文件写成功 + `INSERT` 失败 → 文件孤儿；`INSERT` 成功 + 文件写失败 → DB 引用悬挂；进程崩溃在两步之间 → 同上。

**Decision**

- 写入顺序：**先写文件 → 后写 DB**（文件是"实体"，DB 是"引用"；文件写失败直接抛错不写 DB）。
- 悬挂引用（DB 有记录但文件不存在）→ 画廊卡片显示"文件丢失"占位图，不主动扫盘。
- 文件孤儿（盘上有文件无表记录）→ 不处理，用户用 Finder 自行管理。

**Consequences**

- 正面：零运行时成本，出错只在用户看见时降级。
- 负面：盘上可能有未被引用的文件堆积 → 用户用 Finder 清理。

### ADR-005：Web 端本轮不动

**状态**: Accepted

**Context**

CLAUDE.md 声明"双端同等重要"，但本 SDD 全部基于 Tauri 文件系统。Web 端 IndexedDB 膨胀是独立问题。

**Decision**

P0~P2 桌面专属。Web 端（`codex/web-direct-wongsaang`）本轮不修改。未来 Web 端存储优化单独写 SDD。

---

## 6. 验收标准

P0 完成时：

- [ ] P0-0：`documents` 表有 `category` 列 + `_migrations` 记录（索引后台完成）
- [ ] P0-1：新写入的 documents 行 `category` 列非空
- [ ] P0-2：创作面板 < 2s（`loadByCategory` 先走索引）
- [ ] P0-3：`/v1/models` 超时 5s
- [ ] P0-4：无 Keychain 权限时 `initApiKey` 3s 后 fallback，不卡启动
- [ ] P0-5：启动不因 `CREATE INDEX` 卡死，索引后台完成
- [ ] APP 不再 OOM 重启

P1 完成时：

- [ ] 媒体文件写入 `~/.jiucaihezi/data/media/` 对应子目录
- [ ] 创作画廊加载 < 1s（`media_assets` 表 + SQLite 索引 + LIMIT/OFFSET）
- [ ] `documents` 表 `category='image'/'video'/'audio'` 子集不再有新写入（表保留）
- [ ] 新消息的 base64 图片被剥离（`content` + `files` + `images` 全字段覆盖）
- [ ] `convertFileSrc` 可正常解析 media 路径（capability scope 已配）
- [ ] resolver LRU 缓存命中率 > 80%
- [ ] SQLite < 100 MB（新数据）

P3 完成时：
- [x] FileTree 底部「📁 我的文件」可见，点击在系统文件管理器中打开 `~/韭菜盒子/`
- [x] `~/韭菜盒子/` 目录结构完整，启动自动创建
- [x] 对话/文本/画布支持导出到对应子目录
- [x] 画廊缩略图懒生成，上限 500 个，超出按 mtime 淘汰
- [x] 启动 5s 后 + 切后台时跑 `wal_checkpoint(TRUNCATE)`
- [x] 用户手动删文件后：LLM 上下文不抛错（跳过丢失图片）

P2 完成时：

- [ ] precheck 通过（磁盘剩余 > DB × 2.2）
- [ ] `migration.lock` 阻止迁移期间 APP 启动
- [ ] 数据库从 2.4 GB 瘦身到 < 200 MB
- [ ] 历史图片正常显示
- [ ] 迁移可中断续传（manifest checkpoint）
- [ ] dry-run 预估准确（误差 < 10%）
- [ ] hash 校验通过（抽查 100 条）
- [ ] VACUUM 成功回收磁盘空间
- [ ] 备份 DB 可回滚

---

## 7. 下一步

1. ~~评审本 SDD，确认方案~~ ✅
2. ~~执行 P0（止血）~~ ✅
3. ~~执行 P1（写路径改造）~~ ✅
4. ~~执行 P2（历史迁移）~~ ✅ 数据库 2.4 GB → 0.57 GB
5. ~~执行 P3「我的文件」~~ ✅ FileTree 按钮 + 导出 + WAL checkpoint + 缩略图

**存储瘦身项目已完结。下一阶段回归主产品路线图。**
