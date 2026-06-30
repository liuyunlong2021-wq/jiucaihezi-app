https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/tag/v1.0.1# 韭菜盒子 Studio - AI 协作者上手手册

> **最后更新**: 2026-07-01
> **服务器 NewAPI 版本**: v1.0.0-rc.15（2026-06-24 升级完成）
> **升级方案**: 小版本升级无需完整备份，`docker compose --force-recreate` 即可安全升级
>
> **2026-06 重要更新（AI 协作者必读）**：
> 桌面 APP 与 Web 端是**同等重要**的两个产品形态。两者共享核心体验、视觉组件、模型/Skill/创作等产品能力；最大架构分界是：桌面端包含 OpenCode 文 / 武模式，Web 端不使用 OpenCode，只提供直连模式。
>
> **2026-06-25 画布已移除**：画布源码移至 `_canvas-archive/`，本仓库不再维护。详见 `APPyouhua` 分支。
>
> ### 本地开发 CORS 铁律
> `getGatewayBaseUrl()` 和 `resolveApiConfig()` 必须在 localhost 环境返回 `/__jc_api`（Vite proxy），不能直接访问 `api.jiucaihezi.studio`。
>
> 详细移植记录见：`docs/sdd/webhuabu-huobao-transplant-sdd.md`
>
> **💀 创作面板 RH 视频排障铁律（2026-06-20 血泪教训）**：
>
> 两天耗时教训：之前两轮 AI 协作者把"前端不显示视频 + 自动退款"误判为前端 bug 或 NewAPI 升级问题，把生产 NewAPI 升级到了 v1.0.0-rc.13、改了 ParseTaskResult、调整了前端轮询路径——**全部都不是真因**。真因只是 rh-adapter 缺一个路由别名，sed 一行解决。
>
> ### 排障第一信号：PostgreSQL `tasks` 表，不是浏览器 Console
>
> 任何"RH 视频/图片/音频任务"出问题（不显示、超时、误退款），第一步必须 ssh 到生产服务器查 `tasks` 表，不要先看前端控制台。
>
> ```bash
> ssh root@47.82.86.196
> docker exec postgres psql -U newapi -d new-api -c "
>   SELECT task_id, status, fail_reason, LEFT(data::text, 300),
>          (private_data::json)->>'upstream_task_id' AS rh_id,
>          created_at, updated_at
>   FROM tasks
>   WHERE task_id = '<最新失败任务 ID>';"
> ```
>
> ### 已知的"指纹"信号
>
> | 数据库症状 | 真因 | 修法 |
> |-----------|------|------|
> | `fail_reason: "upstream returned unrecognized message"` + `data: {"detail":"Not Found"}` + `updated_at` 距 `created_at` 不到 30 秒 | rh-adapter 没注册 NewAPI Sora adaptor 期望的路由 `/v1/videos/{task_id}` | `/opt/rh-adapter/src/main.py` 必须同时有 `@app.get("/v1/videos/{task_id}")` 和 `@app.get("/tasks/{task_id}")` 两个装饰器（或两个独立 handler 调同一个 `build_task_status_response`） |
> | 前端日志连续 60 次返回 `Array(2)` data keys（只有 detail/id） | NewAPI 在第一次同步检查时就判失败了，前端看到的是"失败任务的 data"，不是"实时状态" | 同上 |
>
> ### 死路：不要再走这些
>
> - 不要再升级 NewAPI 镜像/二进制以"修 RH 视频"——升级是上一轮的死胡同
> - 不要改 `relay/channel/task/sora/adaptor.go` 的 ParseTaskResult——NewAPI 这边的解析没问题
> - 不要从前端开始排查"为什么轮询拿不到 URL"——前端只是症状方
> - 不要把"10 分钟前端超时"当成"任务运行了 10 分钟"——任务可能 9 秒就在数据库被判失败
>
> ### FastAPI 默认 404 指纹
>
> `{"detail":"Not Found"}` 这两个 key 是 FastAPI 的默认 404 响应。在 NewAPI 的 `tasks.data` 字段或 rh-adapter 的 curl 响应看到这个，**第一反应是"那个路由根本没注册"**，不要先怀疑业务逻辑。
>
> ### rh-adapter 同步注意
>
> 本地仓库 `rh-adapter/src/main.py` 是权威版本（含 `/v1/videos/{task_id}` 路由）。如果服务器跑的版本不一致，应该用 git 推送统一，**不要在服务器手动改后忘记 commit 回 git**——这会导致下次部署时修复丢失，问题复发。
>
> 详细排障 SOP + 真因证据链见：`docs/sdd/chuangzuomianbanxiufu-sdd.md`
>
> **任何新的 AI 会话或不同开发工具，必须先完整阅读**：本文件 + AGENTS.md。
>

**💀 新增 RH 图片模型铁律（2026-06-22，RH-flux 血泪教训）**：

两天踩坑：新增 FLUX Klein 9B 三个模型，触发 NewAPI 字段过滤 + Pydantic 类型校验两层隐藏 bug。

- **铁律一 - NewAPI 只透传 4 个顶层字段**：`model`/`prompt`/`images`/`extra_fields`。所有模型参数（`aspectRatio`/`ratio`/`resolution`/`outputFormat`/`lora` 等）**必须放入 `extra_fields`**。
- **铁律二 - extra_fields 必须严格白名单**：`normalizedParams` 含 `image`（数组），若漏入 `extra_fields`，Pydantic `ImageRequest.image`（期望 `str`）触发 422。三道防线：字段黑名单 + `Array.isArray()` + `typeof v === 'object'`。
- **铁律三 - 必须先测 image-to-image**：文生图绕过图片上传链路。第一个测试必须是图生图，验证参考图上传 → `imageUrl` 映射 → 参数进 RH payload。
- **铁律四 - 排障第一信号是 rh-adapter 日志**：`docker logs rh-adapter-rh-adapter-1 | grep ">>> RAW|POST /v1/images"`，直接看 NewAPI 转发来的字段。
- **死路**：参数放顶层（被 NewAPI 吃掉）；normalizedParams 全量 dump 进 extra_fields（数组炸 Pydantic）；只测文生图就认为通了。

> 完整排障记录见 `docs/sdd/rh-flux-klein-9b-sdd.md`。

> **Web 上传资料 OCR 修复结论（2026-06-21，webwenjianshangchuanxiufu）**：
> Web 端上传文件已改成「文件 → 8091 attachment-processor → Markdown → LLM 上下文」链路。普通图片/截图/印章图默认走 PaddleOCR，不再把 `blob:` / `data:` / `jc-media://` 这类浏览器内部引用直接发给 NewAPI。
>
> 当前可用方案：
> - 8091 服务目录：`attachment-processor/`
> - Web 适配层：`src/utils/webChatAttachments.ts`
> - 图片 OCR 模型：`PP-OCRv6_small_det + PP-OCRv6_small_rec`
> - 图片预处理：OCR 前最长边压到 `2000`
> - 并发策略：OCR 单队列执行，避免把 NewAPI 的 CPU 保护顶到 `system cpu overloaded`
> - Office/PDF：Office 走服务器已有 8090 `/api/office/read`，PDF 先走 pdfplumber 文本层
>
> 本分支明确不做：
> - 不启用 PaddleOCR-VL
> - 不把 PP-StructureV3 作为普通图片默认路径
> - 不做音频/视频解析
> - 不把生活照片语义理解伪装成 OCR 能力
>
> 产品边界：
> OCR 能读截图、票据、文档照片、印章、扫描件里的文字；不能真正理解生活照片画面。用户问「图片里有什么」且图片没有文字时，需要 vision 模型，不是 OCR 能解决。
>
> 验证记录：
> - 服务器 curl：`OCR_SMALL_OK: pp-ocr-v6-small`
> - Web 本地端到端：上传印章图后，DeepSeek 回复引用 OCR 结果「龙刘 / 印云 / 5101085845157」
> - 交接文档：`docs/handover/webwenjianshangchuanxiufu-completion-report.md`
>
> 双端同等重要开发原则：
> - 共享产品能力（创作面板、编辑区、消息渲染、模型/Skill 配置等）应尽量保持双端一致。
> - 平台专属能力必须显式隔离：桌面专属是 Tauri + OpenCode + 本地工具；Web 专属是浏览器直连 + Web 持久化/搜索/工具层。
> - 对话（聊天）不是完全共享的核心：
>   - Web 端：直连模式（标准 LLM 消息 + system prompt，直接 NewAPI 云端路径，不走 OpenCode parts）。
>   - 桌面端：文 / 武模式走 OpenCode（project directory 贯穿、完整 timeline/permission/question/session 命令 + 事件驱动），未来桌面直连模式应尽量复用 Web 直连引擎。
>   两者可复用部分 UI 组件保持一致，但执行引擎和上下文管理是两条独立路径。
>
> **🔑 一键抄配置 成功经验（2026-06-22，xiugaiui）**：
> 分支目标：设置页新增「一键抄配置」按钮，用户登录后点击即可弹出完整 API 配置信息（URL + Key + 可用模型 + 用法说明），一键复制到剪贴板，方便小白用户在任何 AI 客户端使用。
>
> 关键文件：
> - `src/components/auth/JcCloudLoginBox.vue` — 新增 `handleCopyConfig`、`buildConfigText`、`copyConfigToClipboard`、配置预览弹窗
> - `src/components/settings/SettingsPanel.vue` — 传递当前模型和远端模型列表；`onMounted` 时主动 `fetchModels`
> - `src/stores/agentStore.ts` — 缓存保护：`loadCachedModelEntries` 和 `fetchModels` 缓存回退均检测缓存是否比 DEFAULT_MODELS 少，坏缓存不覆盖
> - `src/services/newApiOneClickLogin.ts` — `resolveBaseUrl()` dev 模式走 Vite proxy（`/__jc_api`），生产走直连
>
> 重要教训：
> - `createAutoGroupApiKey` 需要 NewAPI 的 Web Session Cookie，而 `gatewayLogin` 登录后主动 `clearGatewaySession()`。两条认证路线互不相通，在 dev/Web 端永远拿不到 auto-group Key。解决方案：已有 Key 时跳过 `createAutoGroupApiKey`，直接用已有 Key 生成配置。
> - `agentStore` 的 `loadCachedModelEntries` 在 localStorage 缓存存在时**完全替换** DEFAULT_MODELS。如果缓存被污染（如只有 5 个垃圾模型），模型选择器只剩 5 个。修复：缓存文本模型数 < DEFAULT_MODELS 数 → 丢弃缓存。
> - `fetchModels` 失败后的缓存回退也**无条件覆盖** `availableModels`，同样加了保护。
> - 模型选择器用 `agentStore.availableModels`（全部），一键抄配置用 `agentStore.textModels` filter `providerId === 'jiucaihezi'`（排除本地 Ollama/MLX）。
>
> 按钮命名经验（小白用户导向）：
> - 「一键抄配置」= 点一下抄走全部配置 -> 优于「自动获取」
> - 「管理密钥」= 跳转 /keys 管理 -> 优于「手动获取」
>
> **🧠 指令系统设计经验（2026-06-29，zhilingtianjia）**：
>
> 目标：为工具仓库和 Skill 仓库的每个卡片增加「指令」按钮，点击弹出功能指令列表，点击指令直接粘贴到输入框。让小白用户不需要知道命令行参数，一键告诉 AI 要做什么。
>
> **架构**：
> ```
> 卡片「指令」按钮 → 弹窗（2列网格指令卡片） → 点击 → emitEvent('append-chat-input', template) → 输入框
> ```
>
> **关键文件**：
> - `src/components/skills/GitHubSkillCard.vue` — 工具卡片指令按钮 + 安装状态三段式检测
> - `src/components/skills/shared/SkillCard.vue` — Skill 卡片指令按钮
> - `src/data/githubTools.json` — 工具指令数据源（`commands` 字段，每工具 2-15 条）
> - `src/data/skillCommands.json` — Skill 指令数据源（按 skill name 映射，共 48 条）
> - `src-tauri/src/lib.rs` — `check_tool_installed` Rust 命令（目录 + PATH 二进制两段式回退）
>
> **指令全覆盖方法论**：
> 1. 打开对应 GitHub 仓库 README，通读所有功能
> 2. 按功能分类拆成独立指令（每类 1 条，关键词向）
> 3. 每条指令用 `[参数名]` 标记用户需替换的部分
> 4. 小白用户只需粘贴 → 把 `[xxx]` 替换成自己的内容 → 发送
>
> **安装状态三段式检测（对标 ObsidianWizard）**：
> ```
> checkInstalled()
>   ├─ ① Rust invoke('check_tool_installed')  → 目录 + PATH 二进制查找
>   ├─ ② plugin-fs exists()                   → 兜底
>   └─ ③ 静默失败                              → Web 端
> ```
>
> **内置 Skill 自动播种**：
> - 问题：Skill 仓库扫描 `~/.agents/skills/`，但内置 JC-* Skill 在 `public/skills/`，两条路径不互通
> - 桌面端搜索 `getPresetSkills()` 和 `webBuiltInSkills` 各有一道 `isTauriRuntime() return []` 守卫
> - 修复：去掉两道守卫 + Rust `seed_preset_skills` 启动时自动软链到 `~/.agents/skills/`
>
> **重要教训**：
> - `resources` 字段在 Tauri v2 CI 环境解析异常，Vite 已自动将 `public/` 复制到 `dist/`，无需额外配置
> - 图标必须先确认在 `icons-bundle.json` 中，否则空白
> - 指令弹窗用 `position: fixed` + `@click.self="close"` 遮罩关闭，不污染卡片布局
>
> **📁 项目文件树 VS Code Explorer 复刻经验（2026-06-29，wenjianshu）**：
>
> 目标：文件树区域 1:1 复刻 VS Code Explorer — 新建/重命名/删除/右键菜单/键盘导航/自动刷新。
>
> **架构**：`ChatPanel 项目选择器 → projectStore → FileTreePanel「项目」Tab → ProjectFileTree → Rust dev_* 命令 → 左键 → EditorPanel / 系统程序`
>
> **关键文件**：
> - `src/stores/projectStore.ts` — 全局项目目录（ChatPanel ↔ FileTreePanel 共享）
> - `src/components/filetree/ProjectFileTree.vue` — ★ 核心组件，顶部工具栏 + 递归树 + 右键菜单 + 键盘导航 + 5s 轮询
> - `src/components/editor/EditorPanel.vue` — 新增 `lastSavedMarkdown` isDirty 语义
> - `src/utils/editorDiffBridge.ts` — 读写新增 `projectDir` 分支走 Rust 命令
> - `src-tauri/src/lib.rs` — 新增 `dev_rename_file/delete_file/create_dir/reveal_in_finder`
>
> **重要教训 — Tauri fs plugin scope 陷阱**：`@tauri-apps/plugin-fs` 仅白名单路径，用户项目目录必须用 Rust `std::fs`。读写必须对称，否则文件静默打不开 / 磁盘保存失败。
>
> **重要教训 — 轮询展开状态**：5s 轮询重建树木 → `saveExpandState/restoreExpandState` 保留展开。`loading` 用 `v-show` 不销毁 DOM 防滚动跳顶。
>
> **重要教训 — isDirty**：`setContent` → `onUpdate` → auto-save 未改就写回 → 弹出 toast。修复：`lastSavedMarkdown` 对比跳过。
>
> **重要教训 — 二进制卡死**：PDF/PPTX `std::fs::read` → `from_utf8_lossy` → Tiptap 卡死。修复：`isTextFile` 前置检测。
>
> **重要教训 — click vs mousedown**：`@click.self` mouseup 触发 → 拖选文字误关弹窗。全局改 `@mousedown.self`。
>
> 本文档是本仓库的产品说明、架构边界和开发作业手册。目标：AI 协作者读完后，可以在不重新考古旧设计的情况下开始安全改代码。
>
> 最后更新：2026-06-30
> 当前发布基线：`v1.1.1` + **画布已移除** + **指令全覆盖（工具72条+Skill48条）** + **工具安装状态三段式检测** + **内置Skill自动播种** + **知识库内循环 Phase 1/2/2.5** + **小说临摹三件套 skill** + **项目文件树 VS Code Explorer 复刻**
>
> **📌 服务器升级实操记录（2026-06-30）**：
> - **升级版本**：2026-06-20 → v1.0.0-rc.15（2026-06-24）
> - **升级方式**：小版本升级，无需完整备份
> - **核心命令**：`docker pull calciumion/new-api:latest && cd /root/new-api-new && docker compose up -d --force-recreate new-api`
> - **验证结果**：✅ `HTTP/2 200`，`x-new-api-version: v1.0.0-rc.15`，所有服务正常
> - **耗时**：~1 分钟，停机 ~1 秒
> - **回滚**：秒级可用（同一条命令）
> - **详细记录**：见 `docs/notes/我的服务器运维手册.md` § 小版本升级方案

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
| MediaViewer 文本卡按钮溢出 | 🟢 | `isMedia` 已加 `'text'` 让「复制 URL」可见，但 `reference / regenerate / download` 按钮也对歌词显示了，对文本不合理。应拆为 `canCopyUrl` / `canDownload` 等细粒度判定 |
| 画布系统 | ✅ 已移除 | v1.0.15 起移至 `_canvas-archive/` |

### 0.5 常见踩坑

- **`assetRowToRealPath` 兼容新旧路径**：旧数据 `logicalPath` 以 `media/` 开头，实际文件在 `data/media/` 下，需拼 `appData + 'data' + logicalPath`；新数据以 `output/` 开头，直接拼 `appData + logicalPath`。
- **`getAll` 的 `fullyLoaded` 标记**：`idb.ts` 的 cache 结构是 `{ map: Map, fullyLoaded: boolean }`，`getAll` 只在 `fullyLoaded=true` 时信任缓存。不要直接 `.get()/.set()` 在 cache 上，用 `.map.get()/.map.set()`。
- **MediaAssetCard / MediaViewer 共享 `resolveJcMediaUrl`**：该函数在 `mediaFileReader.ts`，自动将 `jc-media://` 转为 `convertFileSrc` URL。新组件需要渲染本地媒体时直接 import 使用，不要 copy-paste。
- **`media_assets` 表 schema**：加列必须走 `_migrations` 登记 + `ALTER TABLE ADD COLUMN`，`CREATE TABLE IF NOT EXISTS` 不会给旧表加列。

### 0.6 图标系统（2026-06-21 重大变更，接手必读）

> **3.5MB Material Symbols 字体已彻底删除。** 所有图标现在走 SVG，通过 `<JcIcon name="...">` 统一入口（601 处调用）。

**架构**：
```
<JcIcon name="add_circle" />  ← 601 处调用，API 不变
  └─ JcIcon.vue
       ├─ addCollection()  ← 模块加载时注入本地 bundle
       ├─ icons-bundle.json ← 211 图标/57KB（build 时由 bundle-icons.mjs 生成）
       └─ <Icon> ← @iconify/vue 渲染 SVG
           └─ 零外部请求，CSP 无需放行任何 CDN
```

**关键文件**：

| 文件 | 说明 |
|------|------|
| `src/components/icons/JcIcon.vue` | ★ 图标唯一入口，`addCollection` 注入本地数据 |
| `src/assets/icons-bundle.json` | 构建产物，不要手改 |
| `scripts/bundle-icons.mjs` | 扫描 JcIcon 用法 → 生成 bundle |
| `node_modules/@iconify-json/material-symbols/icons.json` | 完整 MS 数据集（16322 图标） |

**新增图标流程**：
1. 在 .vue 中写 `<JcIcon name="新图标名" />`
2. `node scripts/bundle-icons.mjs` 重新生成 bundle
3. bundle 不到的加 `ICON_ALIAS` 映射（JcIcon.vue + bundle-icons.mjs **两处同步**）

**硬性规则**：
- ❌ 不要恢复 `<span class="mso">` 写法
- ❌ 不要往 CSP 加 `api.iconify.design`
- ❌ 不要换图标库
- ✅ 所有图标走 `<JcIcon>`

### 0.7 常见踩坑（图标相关）

- **新增图标 bundle 不到**：`node scripts/bundle-icons.mjs --check` 看 unmapped 列表，在 JcIcon.vue 和 bundle-icons.mjs 的 `ICON_ALIAS` 加映射。
- **JSON import 类型报错**：`tsconfig.app.json` 需含 `"resolveJsonModule": true`。

---

## 分支边界（必须遵守）

当前产品有两条并行开发线：

- 桌面 APP 主线：`desktop`
  - 负责桌面端 OpenCode 文 / 武模式、Tauri、opencodeClient、project directory、timeline、permission、桌面打包发布。
  - 不允许混入 Web 直连实验代码；OpenCode 相关实现必须局限在桌面运行路径。

- Web 直连主线：`web`
  - 负责 Web 端直连模式、WongSaang/chatgpt-ui 核心能力、Web 会话历史、streaming、tools、web search、持久化。
  - 不允许修改 `src-tauri/**`、`src/opencodeClient/**`，不得影响桌面 OpenCode 文 / 武模式。

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
  Skills / Tools / Creation / Settings / Help 等入口

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

### 4.1 OpenCode SDK 对齐检查清单（改代码前必过）

> **每次改 `src/opencodeClient/**`、`useChat.ts` 的 OpenCode 路径、或升级 `@opencode-ai/sdk` 版本后，必须逐条确认。**

- [ ] `session.prompt()` 的参数格式和 SDK `Session2.prompt()` 签名一致？（`parts`/`model`/`agent`/`tools`/`system`，不需要 `messageID`/`variant`/`format`）
- [ ] 所有 `client.session.*` / `client.event.*` 调用**直接走官方 SDK 路径**，不自创 `v2.xxx`、`promptAsync` 等不存在的方法？
- [ ] 事件处理中 `payload?.type` 是否与官方 Event 类型字段一致？（官方 SSE 事件的 `data` 被 SDK 的 `createSseClient` 直接 yield，顶层即含 `type` 字段）
- [ ] 有没有**不 await** 的 SDK 调用？（`fireOpenCodePrompt` 必须是 `async` 且调用方 `await` 它）
- [ ] 有没有自创的事件名（官方 `SessionStatus`/`SessionMessage`/`Part` 等类型中没有的）？
- [ ] 300s watchdog 是否有误杀长任务的风险？（如果 OpenCode 官方单步 timeout 超过 300s，需同步提升）
- [ ] 有没有新增 `Record<string, any>` 替代 SDK 导出的强类型？（`import type { Session, SessionMessage, Part, Event } from '@opencode-ai/sdk/v2'`）
- [ ] `pnpm run test:focused` 通过了吗？（含 `sdkContract.test.ts`）
- [ ] `sdkContract.test.ts` 有没有因 SDK 升级而需要更新的断言？

### 4.2 契约测试

`src/opencodeClient/__tests__/sdkContract.test.ts` 启动真实 OpenCode 二进制，验证：

1. `session.create` → 返回带 `id` 的 session
2. `session.prompt` → 返回带 `info` + `parts` 的 message
3. `event.subscribe` → 收到带 `type` 属性的事件流
4. `session.messages` → prompt 后能查到消息
5. `session.abort` → 不抛异常

**这些是 SDK 与我们的代码之间的"接口契约"。如果契约测试挂了，说明 SDK 行为变了，必须同步更新我们的代码。**

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
- `docs/notes/dazi-studio-prompt-reference.md` — ★ 提示词参考站（`dazi.studio`）完整说明，含部署/数据同步/排障记录

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

如果只改前端参数物化，不需要重新部署 `rh-adapter`；如果改了 `rh-adapter/`，在服务器 `cd /opt/rh-adapter && git pull origin media-creation-optimization && docker compose up -d --build rh-adapter`（详见 `docs/rh-adapter-server-deploy-runbook.md` §3.1）。

### 7.2 JC-meitichuangzuo — 媒体创作引擎 Skill（2026-06-29 全新落地）

**定位**：film pipeline 的**程序化执行层**，不是对话交互 skill。上游 skill（`film-shot-design`、`ltx-video-action` 等）产出 prompt + model 后交给本 skill 执行。

**核心脚本**：`public/skills/JC-meitichuangzuo/scripts/jc_media.py`（纯 Python stdlib + curl）

**6 个子命令**：

| 命令 | 功能 |
|------|------|
| `run` | 提交 → 轮询 → 下载（单任务） |
| `submit` | 仅提交，立即返回 task_id（批量并发用） |
| `poll` | 批量轮询并下载（`--task-ids "id1,id2,id3"`） |
| `list` | 查询可用模型（`--type image/video/audio`） |
| `info <model>` | 查看模型参数规格 |
| `check` | 验证连接（自动适配 rh-adapter / NewAPI） |

**双通道架构**：

```
jc_media.py --host http://127.0.0.1:8789    → rh-adapter → RunningHub（29 模型）
jc_media.py --host https://api.jiucaihezi.studio → NewAPI → 火山/T8（Seedance 等）
```

**关键能力**：
- `--params key=value`：透传模型参数（ratio/resolution/duration），自动类型转换
- `--input-video URL`：视频编辑传参考视频
- 大文件自动上传：<5MB 转 data URI 直传，>=5MB 走 rh-adapter proxy 上传 RH CDN
- 自动适配 rh-adapter（`/tasks/{id}`）和 NewAPI（`/v1/videos/{id}`）不同轮询端点

**模型对齐**：SKILL.md 模型表与 `rh-adapter/src/models/mapping.py` 100% 对齐（29 个 RH + 3 个 Seedance）。

**skill 注册**：
- `src/stores/agentStore.ts` — `preset_JC-meitichuangzuo`
- `src/data/skillCommands.json` — 10 条指令全覆盖
- `src-tauri/src/lib.rs` / `src-tauri/capabilities/default.json` — 无桌面专属依赖，纯 CLI 脚本

**改代码前必读**：
- `public/skills/JC-meitichuangzuo/SKILL.md` — skill 完整文档
- `rh-adapter/src/models/mapping.py` — 模型映射事实源
- `docs/model-registry-matrix.md` — 全渠道模型矩阵

```bash
# 测试命令
cd rh-adapter && python3 ../public/skills/JC-meitichuangzuo/scripts/jc_media.py check
python3 ../public/skills/JC-meitichuangzuo/scripts/jc_media.py list --type video
```

---

## 8. 本地工具

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
| @iconify/vue 5.x | 图标渲染引擎（SVG） |
| @iconify-json/material-symbols | 图标数据（devDep，build 时打包） |

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
| `src/components/icons/JcIcon.vue` | ★ 图标唯一入口，601 处调用。内部用 @iconify/vue addCollection + 本地 bundle。改这里影响全站图标 |
| `src/assets/icons-bundle.json` | 构建产物（211 图标/57KB），由 scripts/bundle-icons.mjs 自动生成。不要手改 |
| `scripts/bundle-icons.mjs` | 扫描 JcIcon 用法 → 生成 bundle。新增图标后跑 `node scripts/bundle-icons.mjs` |
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
| `src/stores/agentStore.ts` | Skill 配置 + 模型选择器数据源 |
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
| `public/landing/index.html` | ★ 产品首页（`api.jiucaihezi.studio/`），下载按钮 → GitHub Releases |
| `src/components/filetree/ProjectFileTree.vue` | ★ 项目文件树核心（403行），所有文件操作入口 |
| `src/stores/projectStore.ts` | 全局项目目录状态，ChatPanel/FileTreePanel 共享 |
| `src/components/skills/GitHubSkillCard.vue` | 工具卡片：指令按钮 + 安装状态三段式检测 + 弹窗 |
| `src/components/skills/shared/SkillCard.vue` | Skill卡片：指令按钮 + 弹窗 |
| `src/data/githubTools.json` | 工具数据源：10个工具 + commands指令字段 |
| `src/data/skillCommands.json` | Skill指令映射：34个Skill的58条指令 |
| `src/utils/directMessageBuilder.ts` | ★ 直连模式统一消息构建器，纯函数。三个 sender 唯一入口 |
| `src/utils/skillContentResolver.ts` | Skill 内容解析器：`resolveWebSkillSystemPrompt` + `resolveSkillUriContent` |
| `src/opencodeClient/contextMetrics.ts` | 上下文用量数据层（对齐官方 session-context-metrics.ts） |
| `src/opencodeClient/contextBreakdown.ts` | Input token 角色拆解（对齐官方 session-context-breakdown.ts） |
| `public/skills/JC-meitichuangzuo/scripts/jc_media.py` | ★ 媒体引擎核心脚本：6子命令、双通道、大文件上传、自动轮询。改这里影响所有电影管线 |
| `public/skills/JC-meitichuangzuo/SKILL.md` | 媒体引擎 skill 文档：模型表必须与 `mapping.py` 对齐 |
| `rh-adapter/src/models/mapping.py` | ★ RH 模型映射事实源：JC-meitichuangzuo 的模型表以此为权威 |

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
# 完整构建（含图标 bundle 生成）
pnpm run build

# 手动构建（跳过 test）
pnpm exec vue-tsc -b && pnpm exec vite build && node scripts/prune-web-dist.mjs

# ⚠️ 新增图标后必须先跑 bundle 再构建
node scripts/bundle-icons.mjs && pnpm exec vite build && node scripts/prune-web-dist.mjs
```

不要把 Web dist 和 Desktop dist 混用。桌面构建会裁剪 landing 等 Web 资源。

### 15.1.1 Web 生产部署：Cloudflare Pages

**项目特征**：`public/_headers` 文件是 Cloudflare Pages 专属约定（不是普通 Nginx 配置）。`jiucaihezi.studio` 域名指向 Cloudflare Pages，**不要手工 scp 到服务器 Nginx**——这条路径是死的。

**正确发布命令**（最稳，不会漏文件）：

```bash
cd /Users/by3/Documents/jiucaihezi-app
pnpm exec vue-tsc -b && pnpm exec vite build && node scripts/prune-web-dist.mjs
npx wrangler pages deploy dist
```

**第一次跑** `npx wrangler pages deploy dist` 时会要求：

1. 浏览器弹出 Cloudflare 登录 → 用 `liuyunlong2021-wq@github.com` 关联的 Cloudflare 账号登录
2. 命令行问 project name → 选 `jiucaihezi`
3. 然后自动上传整个 dist（约 45MB，100+ 文件）

**输出成功标志**：

```text
✨ Success! Uploaded X files (Y already uploaded)
✨ Deployment complete!
✨ https://<commit-hash>.jiucaihezi.pages.dev
✨ Or https://jiucaihezi.studio
```

**死路（不要走）**：

- ❌ Cloudflare Dashboard 拖拽 dist 文件夹 —— 浏览器拖拽会**跳过部分子文件夹**（assets/ 太多文件常被漏），导致部署后 `index.html` 引用的 JS 文件 404，网站只显示 logo
- ❌ 手动 scp dist 到 47.82.86.196 服务器 —— 那不是 Web 部署目标
- ❌ 跑 `pnpm run build`（带 `test:focused` 测试门）—— 当前 main 分支有 ~11 个失败测试（属于其他在跑的工作），会卡住 build。直接用 `vue-tsc -b && vite build` 跳过

**CSP / urlSafety 双白名单铁律**：

媒体 URL 域名白名单是**两套并行**的：

1. **前端 `src/utils/urlSafety.ts`** 的 `CREATION_RESULT_HOST_PATTERNS` —— JS 层 mediaTaskStore 检查
2. **`public/_headers`** 的 CSP `connect-src` —— 浏览器层强制检查（Cloudflare Pages 部署的 HTTP header）

**修白名单时必须双修**——只修 urlSafety.ts 而不修 _headers，浏览器仍会 CSP 拦截 fetch（控制台报 `Connecting to 'xxx.com' violates the following Content Security Policy directive`）。

### 15.1.2 产品首页（`api.jiucaihezi.studio/`）

首页由两层服务接力：

```
浏览器 → api.jiucaihezi.studio/
  → Cloudflare Worker (gateway/src/index.js) 拦截 "/"
    → fetch https://jiucaihezi.studio/landing/index.html
    → 返回给用户
```

**源码文件**：`public/landing/index.html`

**Worker 路由**：`gateway/src/index.js` 的 `handleLandingHome` 函数（第 345 行）代理到 Cloudflare Pages 上的 `landing/index.html`。

**下载按钮约定**：首页的「下载 APP」按钮统一指向 `https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases`，不直接链 DMG/zip 文件。改主页 HTML 后用 `wrangler pages deploy dist` 部署即可生效。

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
git push origin HEAD:desktop

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
- **Web 端平台隔离修复**（2026-06-19，分支 `webyouhua`→`desktop`）：创作落地不再调 Tauri invoke（Web 端 `remote-only`）；`jc-media://` 和 `jc-media:` 双格式在 Web 端自动 fallback 到 `sourceUrl`；创作面板顶部统一 24h 失效提醒 banner；`/v1/models` 前端加重试；boot 防重入 + 假超时日志清除。详见 `docs/webyouhua/optimization-plan-v4.md`。
- **OpenCode 全面对齐 v1.17.9**（2026-06-22，分支 `duiqiopencode`→`main`）：
  - SDK / Plugin / 二进制三件套统一升级到 v1.17.9（原 1.17.6 / 1.17.0 / 1.17.0）。
  - 事件处理对齐官方 D0 矩阵：`applyOpenCodePartDelta` 支持任意 string field；`message.part.updated` 跳过 `patch`/`step-start`/`step-finish`；新增 `message.removed`、`message.part.removed`、`session.created/updated/deleted`、`vcs.branch.updated` 五个 handler；`isOpenCodeRunCompleteEvent` 补全 `session.closed` 系列。
  - 修复 `fetchOpenCodeVcsDiff` 的错误调用路径（`v2.vcs.diff` → `client.vcs.diff`，`vcs` 是 `OpencodeClient` 顶层属性而非 `V2` 子节点）。
  - 验证：并发 3 个 subagent 独立审计（事件正确性 / 兼容性 / 回归风险），2 个 P1 问题（SKIP_PARTS 高频 GC + vcs 路径错误）已在合并前修复。
  - 对齐计划文档：`docs/sdd/opencode-alignment-duiqiopencode-plan.md`，D0 矩阵共 50+ 条目，附录 C 提供 ⬜/✅ 状态速查。
  - 注意：计划文档附录 C 的状态列滞后于实际代码，后续若做 D1/D2 增量需先逐条对齐 ✅ 实际状态。
- **OpenCode 体验层 Bug 修复**（2026-06-22，分支 `fix/opencode-ux-bugs`→`main`，实测通过）：
  - Bug #2「任务完成 UI 仍显示正在回复」：真因是完成事件触发后 status API 返回 busy 时 finalize 被静默跳过。修复：信任完成事件直接 finalize + 新增 `session.next.idle` 识别 + 泛化 `session.*` status===idle 兜底 + 事件 handler 入口 `finalized` 守卫。
  - Bug #1「变更审查无内容」：真因是 diff-summary 依赖 `summary.diffs` 字段（OpenCode API 未必返回）。修复：改用 `turnDiffs`（`session.diff` 事件驱动 + fallback `sessionDiffs`）渲染到消息流末尾。附带 ToolErrorCard 双区块（输入参数/错误信息）+ edit/write/apply_patch 工具卡默认展开。
  - 改动文件：`useChat.ts`、`runEvents.ts`、`eventBridge.ts`、`timelineRows.ts`、`ChatPanel.vue`、`OpenCodePartList.vue`。
  - 交接文档：`docs/handover/opencode-alignment-known-bugs-next-round.md`。
- **OpenCode 对齐遗留问题 — 下一轮修复**（2026-06-23，分支 `fix/opencode-next-round`→`main`，v1.0.13）：
  - **Phase A — Bug #2 任务完成状态收敛**：`resetIdleTimer` 从 no-op 改为 120s watchdog；每个事件重置 watchdog；**修复 P0 — 审计发现的 watchdog/completion 共用 `finalizeTimer` 互斥 bug**（拆分为独立 `idleTimer`/`finalizeTimer`，`clearFinalizeTimer` 同时清除两者），否则所有完成/错误路径被阻塞。
  - **Phase B — Bug #1 变更审查对齐**：`diff-summary` 渲染管道完整打通 — idle 事件中提取 `summary.diffs` 注入 user message → `buildOpenCodeTimelineRows` 生成 row → ChatPanel 模板新 `v-else-if` 块渲染 inline diff-summary 按钮。底部 `turnDiffs` 机制保留为 fallback。
  - **Phase C — 交互偏好打磨**：SettingsPanel 新增「OpenCode 交互」设置区，Shell 输出 / 文件编辑详情默认展开双 toggle，localStorage 双向同步。
  - 改动文件：`useChat.ts`、`ChatPanel.vue`、`SettingsPanel.vue`（3 文件，+201/-2）。
  - 验证：`vue-tsc -b` + `vite build` 通过；3 subagent 并发独立审计（事件正确性/兼容性/回归风险）；P0 修复后 686/688 测试通过；用户桌面实测通过。
  - 交接文档：`docs/handover/opencode-alignment-known-bugs-next-round.md`（已标记完成）。
- **OpenCode 完成检测对齐官方 SDK**（2026-06-23，分支 `fix/opencode-align-official-events`→`main`，v1.0.14）：
  - 对照 `@opencode-ai/sdk` v1.17.6 类型定义，`isOpenCodeRunCompleteEvent` 精简为官方 2 个信号：`session.idle` + `session.status{type:"idle"}`。
  - 移除 4 个不存在的非官方事件（`session.next.idle`/`session.finished`/`session.next.finished`/`session.closed`），移除泛化 `session.*` 兜底。
  - 去掉 120s watchdog 超时 + `idleTimer` 定时器（官方无此概念），仅保 `lastEventTime` 追踪。
  - 保留 250ms 状态轮询 API 兜底。
  - 附带编辑器修复：PDF 导出统一路径、ReviewPanel→编辑区联动、import-to-editor 支持 append、长文导入阈值优化。
  - 改动文件：`runEvents.ts`、`useChat.ts`、`ChatPanel.vue`、`EditorPanel.vue`、`ReviewPanel.vue`、`editorExport.ts`、`exportSave.ts`、`MessageBubble.vue`（8 文件）。
  - 验证：`vue-tsc -b` + `vite build` 通过，686/688 测试通过。
- **8091 OCR 附件解析全面启用**（2026-06-22，分支 `webwenjianshangchuanxiufu` 收尾→`main`）：
  - 核心链路：`用户贴图 → 8091 PaddleOCR → OCR文字 → 注入LLM上下文`。
  - Web 端：之前代码已合入但 CORS 缺失导致浏览器拒绝 → 服务器 Nginx `/api/attachments/` location 新增 CORS 响应头 + OPTIONS 预检。
  - 桌面端（直连模式 + 本地模型）：之前 `ChatPanel.vue` 只在 Web runtime 走 8091 → 改为双端通用。`useChat.ts` `buildDirectLocalMessages` 注入 parsedAttachments。`ChatPanel.vue` 直连消息结构增加了 parsedAttachments 字段。
  - 桌面端 Tauri HTTP 桥：Rust bridge 不支持 FormData → `webChatAttachments.ts` 双模传输（Web 端 FormData，Tauri 端 base64 JSON body）。Tauri dev 模式 `/__jc_api` 不代理 `/api/attachments/` → 桌面端直连生产域名 `https://api.jiucaihezi.studio`。
  - 未登录用户：`parseFileOnServer` 走 `allowAnonymous` + 占位 Bearer token（8091 只做格式校验不验真伪）。
  - 8091 后端：新增 JSON body 入口（`application/json` → base64 decode），修复 health 检查 import 错误。
  - 图标修复：`volume_up` 加入 ICON_ALIAS → 重新 bundle → CSP 错误消失。
  - 大图编码：`btoa+spread` 对大文件爆栈 → `arrayBufferToBase64()` 分块 32KB 编码。
- **xiubug0623 上线前全面修复**（2026-06-23，分支 `xiubug0623`→`main`，v1.0.9）：
  - **构建与 CI**：新增 `build:desktop:quick` / `build:quick` 跳过测试快速打包；`tauri.conf.json` `beforeBuildCommand` 改用 `build:desktop:quick`；CI workflow 证书 secrets 去 `|| ''` fallback，空时不传 env 自动 ad-hoc。
  - **CSP**：`connect-src` 补全 `api.github.com`（`public/_headers` + `tauri.conf.json`）。
  - **401 收敛**：`gatewayModels()` 无认证时返回 `[]`，不发起网络请求。
  - **CORS 重试**：Web 端 `sendWebCloudMessage` 遇网络/CORS 错误自动重试 2 次（间隔 1s/2s）。
  - **`tauri://localhost` 误判修复**：3 处 `origin.includes('localhost')` 加 `!origin.startsWith('tauri://')` 前置排除（`api.ts` / `newApiClient.ts` / `media-generation.ts`）。
  - **`window.prompt` 替换**：新增 `src/utils/safePrompt.ts`，Tauri 桌面端用 DOM overlay 替代不可靠的 `window.prompt`，Web 端保留原生 prompt。
  - **网关重试**：`gatewayJsonWithResponse` 加 5xx + 网络错误重试（2 次，间隔 1s/2s）。
  - **模型选择器**：新增 `getInitialModels()`，无认证无缓存时仅本地模型，不暴露 DEFAULT_MODELS 云端兜底。`textModels` computed 过滤生图/视频模型。
  - **RH_ONLY_MODE 修复**：`mediaModelCapabilities.ts` + `creationModelRegistry.ts` 两处 `RH_ONLY_MODE = true` → `false`，修复创作面板任务列表为空。
  - **画布**：`V8ImageResultNode` `handlePreview` Tauri 环境走 `openExternal`。
  - **移动端**：导航栏按钮 `font-size` 修复（图标迁移 JcIcon 后 `.mso` 选择器失效）。
  - **测试**：13 个失败全修复 → 688/688 全绿。
  - **新增文件**：`src/utils/safePrompt.ts`、`docs/sdd/xiubug0623-pre-release-bugfix-sdd.md`。
  - **变更文件**：`public/_headers` `src-tauri/tauri.conf.json` `.github/workflows/build.yml` `src/stores/agentStore.ts` `src/services/newApiClient.ts` `src/composables/chatCloud.ts` `src/composables/useChat.ts` `src/utils/api.ts` `src/api/media-generation.ts` `src/layouts/WorkspaceLayout.vue` `src/utils/safePrompt.ts` `package.json` `src/data/mediaModelCapabilities.ts` `src/runtime/creation/creationModelRegistry.ts` `src/components/canvas/v8/nodes/V8ImageResultNode.vue` `src/stores/canvasStore.ts` `src/components/editor/EditorPanel.vue` `src/components/mcp/McpManagerPanel.vue` + 8 个测试文件。
- **知识库内循环 Phase 1/2/2.5**（2026-06-26，分支 `gongju`，commit `8d5569d`）：
  - **三层知识库架构**：`.raw/`（原始素材）+ `wiki/`（整理档案）+ `CLAUDE.md`（记忆锚点），防止 AI 续写长篇时失忆。
  - **vaultTemplates.ts**：3 个开箱即用模板（律师案件库 / 小说知识库 / 漫剧剧本项目），含 `claudeMd`、`rawFolders`、`wikiFolders` 字段。
  - **vaultScaffold.ts**：`buildVaultScaffoldInput()` 将模板展开为 `{ folders, files }` 传给 Rust `scaffold_vault`。
  - **kbCommandPresets.ts**：6 条常用指令模板（完本导入 / 续写防失忆 / 从 0 新书 / 查询记忆体 / 一致性体检 / 写短剧剧本）。
  - **lib.rs `scaffold_vault`**：路径遍历保护、文件已存在不覆盖、最多 200 目录 / 50 文件上限。
  - **ToolWarehousePanel**：新增「知识库模板」区块，一键建库按钮；Web 端自动提示去桌面端操作。
  - **ChatPanel「指令」按钮**：桌面端专属，点击弹出 6 条指令模板，「填入」直接写入输入框。
  - **agentStore `vault-architect` 预设**：Skill 名「知识库架构师」，触发词：建库/知识库/wiki架构/防失忆等。
  - **配套 Skill**：`skill://vault-architect/SKILL.md` 需在 `~/.agents/skills/` 手动放置（SDD 见 `docs/sdd/knowledge-base-inner-loop-sdd.md`）。
- **bianji + gongju 合并到 main**（2026-06-27，commits `511b17d` + `219cc9b`）：
  - **bianji 分支**（编辑区增强）：Tiptap 扩展补全、TableKit 迁移、双栏 diff 视图、hunk 操作、多文件 Tab、PDF 导出统一路径、ReviewPanel→编辑区联动、import-to-editor 支持 append。
  - **gongju 分支**（工具 + 输入区）：知识库内循环完整落地、ToolWarehousePanel 知识库模板区块、ChatPanel「指令」按钮（桌面端专属）、SkillPickerBar `mentionActive` prop（`@` 时自动折叠 Skill picker）、输入框文字与模型区重叠修复（padding-right 118px→162px）、Obsidian 检测三重回退 + Tauri 2.x 兼容（`__TAURI_INTERNALS__`）。
  - **合并后修复**：删除重复 import、补回 `showComposerCommandMenu` + `openSlashCommandPalette`（bianji 逻辑，gongju 合并时遗漏）、删除 template 中残留的 `cp-kb-wrap` 重复块。
  - 验证：`vue-tsc -b` 零错误。
- **小说临摹三件套 skill + 小说标签指令**（2026-06-28）：
  - 新增 3 个内置 skill（`public/skills/` + 注册进 `agentStore.ts` 的 `SKILL_PRESETS`，source=preset 锁定不可编辑）：
    - `JC-linmoxiaoshuo`（小说临摹换皮器）：拿一部范本逐章换皮——换人名/地名/时代/世界观/台词，但保留情节走向、人物命运、主题、文风。核心是 `wiki/映射表.md`（v2 起含「桥段/道具/动作/符号」映射，"保功能换实现"防一眼被认出临摹自哪部）。带 `scripts/check_consistency.py` 单章自查（漏改/撞车/不一致）。
    - `JC-yizhixing`（一致性巡检官）：对 wiki 知识库做全库体检，抓单章自查抓不到的跨章问题（漏改/命名漂移/撞车/伏笔没收/断链/孤儿笔记/设定矛盾）。带 `scripts/scan_vault.py`，**只读不改**。库里有 `映射表.md` 自动启用换皮专项检查，否则做通用角色一致性检查。
    - `JC-jiyiyasuo`（记忆压缩官）：把 `.raw/` 素材提炼归档进 `wiki/`、补 `[[双链]]`、刷新 `hot.md`，防长篇失忆。带 `scripts/digest_raw.py` 整理前盘点。**会主动改 wiki**。
  - 三者协作靠共享文件约定（`映射表.md` / `改写稿/` / `伏笔账本.md` / `.raw/` / `hot.md`），不互相调用：linmo 写（紧循环单章自查）→ yizhixing 隔几章广扫挑错 → jiyiyasuo 沉淀记忆。设计哲学同 `JC-manjuxiezuo`（忠于结构、只在表层发挥）。
  - `kbCommandPresets.ts` 的「小说」标签新增 4 条带序号直白指令：临摹①开局（导入范本/定方案/建映射表）、临摹②改写下一章（主力循环）、临摹③全库巡检（找穿帮）、临摹④整理记忆体（防失忆）。序号即新手该点的先后；与上方「原创创作」指令（灵感策划→全书复盘）区分，避免和「知识库」标签旧通用指令（完本导入/续写/一致性体检/批量整理）混淆。
  - skill 加载机制：`skill://JC-xxx/SKILL.md` → `fetch('/skills/JC-xxx/SKILL.md')`，源即 `public/skills/`。新增内置 skill 只需两步：文件放 `public/skills/` + 登记 `SKILL_PRESETS`，无 manifest/copy 脚本。
  - 实战验证：用 654 章范本《测字有术》换皮成「东北出马仙」试用，完整跑通 linmo 改写→yizhixing 巡检→jiyiyasuo 整理闭环，前 3 章全库巡检 ❌0/🔻0/⚠️0。
  - 验证：`vue-tsc -b` 零错误。
- **短剧临摹换皮器 + 一新两复用架构**（2026-06-28）：
  - 新增第 4 个内置 skill `JC-linmoduanju`（短剧临摹换皮器）：拿一部范本（成稿剧本**或**小说/故事文，双输入），一集一集换皮改写成自己的短剧剧本，输出统一为标准剧本格式（`## 场X-Y` + `△▲` + `角色名（情绪）："台词"`）。范本是小说时额外做散文→剧本的跨体裁改编。
  - **关键架构决策——临摹家族"一新两复用"**：临摹三件套里只有"改写器"绑定输出格式（小说=散文 vs 短剧=剧本），需各做一个；而 `JC-yizhixing`（巡检）和 `JC-jiyiyasuo`（整理）**格式无关**（读映射表/查漏改撞车断链伏笔/整理 .raw 刷 hot.md，小说库短剧库通用），直接复用，不做副本。即：两个改写器（`JC-linmoxiaoshuo` / `JC-linmoduanju`）共用同一套巡检官 + 压缩官。
  - 复用细节：`JC-linmoduanju/scripts/validate_scene.py` 直接复制自 `JC-manjuxiezuo`（剧本格式校验，无需重写）；`JC-yizhixing/scripts/scan_vault.py` 加 1 处微调——`check_reskin` 的草稿目录识别补上 `剧本正文/`（原只认 `改写稿/`、`作品/`），让短剧库也能扫换皮漏改。
  - 短剧临摹与已有两个短剧 skill 的区别：`manhua-script-agent`=从零涌现剧情；`JC-manjuxiezuo`=按用户已有大纲扩写；`JC-linmoduanju`=拿现成范本换皮临摹。三者互补不重叠。
  - 映射表第 5 张表「桥段·道具·动作·反转映射（保功能换实现）」是短剧临摹命门——短剧"名场面/卡点"最易被认出，照搬只换名字=抄袭，必须换实现。
  - 注册：`agentStore.ts` 的 `SKILL_PRESETS` 加 `preset_JC-linmoduanju`（紧跟 JC-manjuxiezuo）；`kbCommandPresets.ts` 的「短剧」标签加临摹①②③④四条带序号指令（①开局②换皮改写下一集 走 JC-linmoduanju，③巡检④整理 复用通用两件套）。
  - 验证：`vue-tsc -b` 零错误；`validate_scene.py` / `scan_vault.py` py_compile + 冒烟测试通过。
- **指令全覆盖 + 安装状态三段式检测**（2026-06-29，分支 `zhilingtianjia`→`main`）：
  - **工具仓库指令按钮**：`GitHubSkillCard.vue` 新增 🧠「指令」按钮，点击弹出 2 列指令卡片弹窗，点击指令直接粘贴到输入框。9 个工具共 72 条指令（yt-dlp 14 / FFmpeg 15 / pandoc 8 / ripgrep 6 / whisper 6 / Pixelle-Video 10 / ebook-treasure-chest 3 / so-novel 2 / ImageMagick 8），全覆盖各工具功能。
  - **Skill 仓库指令按钮**：`SkillCard.vue` 新增指令按钮（复用同样弹窗模式）。33 个内置 Skill 共 48 条指令，数据源 `src/data/skillCommands.json`。
  - **安装状态三段式检测**：对标 ObsidianWizard 的三段式回退——Rust `check_tool_installed` 命令（目录 + PATH 二进制）→ `plugin-fs` 目录检查 → 静默失败。已安装工具显示绿色「✅ 已安装 + 路径」，隐藏安装按钮。`lib.rs` 新增 `resolve_local_binary_option` + `check_tool_installed` + invoke 注册。
  - **工具卡片精简**：删除 obsidian-local-rest-api / jq / bat / fd / tesseract，保留 8 个核心工具。
  - **指令数据文件**：`src/data/githubTools.json`（工具指令 + commands 字段）、`src/data/skillCommands.json`（Skill 指令映射）。
  - 改动文件：`GitHubSkillCard.vue`、`SkillCard.vue`、`lib.rs`、`githubTools.json`、`skillCommands.json`（新）。
  - 验证：`vue-tsc -b` 零错误，`vite build` 构建成功。
- **JC-meitichuangzuo 媒体创作引擎 skill**（2026-06-29，分支 `wenjianshu`→`main`）：
  - 6 个子命令全覆盖（`run`/`submit`/`poll`/`list`/`info`/`check`）
  - 双通道架构：rh-adapter（29个RH模型）+ NewAPI（3个火山Seedance）
  - `--params key=value` 透传模型参数 + `--input-video` 视频编辑
  - 大文件自动上传：<5MB data URI 直传，>=5MB 走 rh-adapter proxy 上传 RH CDN
  - 自动适配 rh-adapter（`/tasks/{id}`）和 NewAPI（`/v1/videos/{id}`）不同轮询端点
  - SKILL.md 模型表与 `mapping.py` 100% 对齐
  - skill 注册：`agentStore.ts` + `skillCommands.json` 10 条指令全覆盖
  - 实测通过：`rh-pro-image`(20s) / `doubao-seedance-2-0-mini-260615`(142s) / `rh-grok-video-edit`(45s) / 5.9MB大文件上传(47s)
  - 验证：`vue-tsc -b` 零错误，`vite build` 构建成功
  - 改动文件：`jc_media.py`(新)、`SKILL.md`(新)、`skillCommands.json`、`agentStore.ts`、`AGENTS.md`
- **内置Skill自动播种 + 搜索修复**（2026-06-29，分支 `wenjianshu`→`main`）：
  - **桌面端搜索修复**：`agentStore.ts` `getPresetSkills()` 和 `ChatPanel.vue` `webBuiltInSkills` 去除 `isTauriRuntime()` 守卫，桌面端 Skill 选择器现在可搜索所有预设 Skill。
  - **Skill 仓库搜索修复**：Rust 新增 `seed_preset_skills` 函数，数据库初始化时自动将 `public/skills/` 下所有内置 Skill 软链到 `~/.agents/skills/`（幂等），使 JC-* 系列在 Skill 仓库中可被搜索。
  - **资源打包**：`tauri.conf.json` 新增 `resources: ["../public/skills/*"]`，内置 Skill 随 APP 分发。
  - 改动文件：`lib.rs`、`db.rs`、`tauri.conf.json`、`ChatPanel.vue`、`agentStore.ts`。
  - 验证：`vue-tsc -b` 零错误，`cargo check` 通过，`tauri:build` 签名打包成功。
- **手机端适配 Phase 1**（2026-06-30，分支 `shoujishipei`→`main`）：
  - **目标**：手机端(≤768px)体验优化，尤其是输入框上方指令显示不全问题。
  - **ChatPanel 响应式**（纯 CSS，`@media (max-width: 768px)`）：
    - 指令弹窗：`max-width: calc(100vw - 32px)` 桌面兜底 + 手机端 `calc(100vw - 16px)` 全宽
    - 指令卡片网格：5 列 → 2 列
    - 输入区顶栏：`min-height` 38→32px，按钮字号/高度缩小
    - 模式菜单：手机端全宽响应式
  - **WorkspaceLayout 移动端 Rail 精简**（模板层，`v-if="isMobile"` 分支）：
    - Rail 按钮 8→3：创作面板 / 对话⇄记录(切换) / 用户中心
    - 切换逻辑：当前在聊天/创作/设置 → 显示 📋 history 图标 → 点击进对话记录；在记录中 → 显示 💬 chat → 回到聊天
    - 新增 `FileTreePanel` 渲染于 `mobilePanel === 'history'`，点击会话自动切回聊天（复用已有 `switch-panel` 事件）
    - 移除编辑区/Skill仓库/工具仓库/画布等桌面专属入口
    - `mobilePanel` 类型收窄为 `'chat' | 'history' | 'creation' | 'settings'`
  - **图标修复**：`photo_camera` 因 Vue `:name` 动态绑定被 bundle 扫描器漏掉 → `JcIcon.vue` + `bundle-icons.mjs` 两处 ICON_ALIAS 同步添加 `photo_camera → photo-camera`
  - **关键文件**：`ChatPanel.vue`、`WorkspaceLayout.vue`、`JcIcon.vue`、`bundle-icons.mjs`
  - **设计原则**：
    - 手机端是桌面端的精简视图，不是独立产品
    - 共享核心组件（ChatPanel/FileTreePanel/CreationPanel/SettingsPanel），仅布局不同
    - 隐藏不适合小屏的功能（编辑器、Skill管理、工具仓库），不删除代码
    - 对话记录与聊天合为切换按钮，减少 Rail 按钮数
  - 验证：`vue-tsc -b` 零错误，`vite build` 通过，桌面端零影响。
- **Skill 系统统一简化**（2026-06-30，分支 `manjucuangzuo`）：
  - **核心思路**：大道至简——一个目录（`~/.agents/skills/`）、一份扫描结果、一次刷新。模型选择器和 Skill 仓库共享同一数据源。
  - **关键架构决策**：
    - 删除 `SKILL_PRESETS` 硬编码（~465行），统一为文件系统扫描
    - `source` 字段存 DB 不存 SKILL.md（防用户篡改绕过保护）
    - 种子策略：软链→原子 copy + 崩溃哨兵 `.seed_complete`
    - `skill://` 协议分阶段退役（改造 5 个消费者）
    - `parse_commands` 从 SKILL.md ````commands` 代码块提取指令
    - frontmatter 解析失败降级（目录名兜底）不静默跳过
    - `scan_all_skills` 并发锁（AtomicBool）+ await seed 串行化
    - 系统级 Agent 注册：15 个外部工具目录 + 修正 codex/cline 路径 + 新增 grok
  - **Skill 仓库 UI 重设计**：
    - 三标签切换：「我的Skill / 其他Skill / GitHub推荐」（pill 风格 + 数量角标）
    - 内置+GitHub 导入的 skill 自动归入"我的"（localStorage 持久化，可手动切换）
    - 卡片按钮：logo 切换（实心=我的）+ 指令 + 别名 + 详情 + 删除
    - 详情页精简：4 标签 → 2 标签（文件 / 摘要）
    - 摘要 API 改为连 `api.jiucaihezi.studio`，自动同步主 Key + Model
  - **教训**：
    - `seed_preset_skills` 的 `preset_skills_src` dev 路径 `../public/skills/` 是错的（实际需要 `../../..` 才到项目根）
    - `parseCommandsField` 回滚时容易丢失——git checkout 后需重新确认
    - 种子用 `INSERT OR IGNORE` 导致已有的 scan 行不被更新为 `source='builtin'`——改用 `ON CONFLICT UPDATE`
    - Python 脚本删代码比 sed 危险（大括号计数失灵导致删空整个文件）
  - **文件清单**：`scanner.rs`、`db.rs`、`discover.rs`、`marketplace.rs`、`agentStore.ts`、`skillsManageStore.ts`、`SkillCard.vue`、`CentralSkillsPanel.vue`、`SkillDetailPanel.vue`、`SkillAiSummaryPanel.vue`、`skill.ts`、`skillsManage.ts`、`skillContentResolver.ts`
  - **设计文档**：`docs/sdd/skill-system-unified-simplification-tdd.md` + `docs/sdd/manjucuangzuo-concurrent-audit-2026-06-30.md`
  - 验证：`vue-tsc -b` + `cargo check` 零错误；联网审计 3 轮；TDD 完成度 95%。
- **项目文件树 VS Code Explorer 复刻**（2026-06-29，分支 `wenjianshu`，未合并）：
  - **目标**：编辑区右侧文件树区域 1:1 复刻 VS Code Explorer。
  - **全局 projectStore**：`src/stores/projectStore.ts` — ChatPanel 项目选择器 ↔ FileTreePanel 共享状态。
  - **ProjectFileTree 组件**（403 行）：顶部工具栏（新建/文件夹/折叠/刷新/隐藏） + 递归树 + 文件右键菜单（编辑/重命名/删除/电脑中打开/复制路径/复制相对路径） + 目录右键菜单（新建文件/文件夹/重命名/删除/打开/复制路径） + 空白右键（切换项目文件夹） + 键盘导航（↑↓←→/Enter/F2/Delete） + 5s 轮询自动刷新（保留展开状态） + Fuzzy 筛选 + 自动定位。
  - **Rust 后端**：新增 `dev_rename_file` / `dev_delete_file` / `dev_create_dir` / `dev_reveal_in_finder`。
  - **关键修复**：Tauri fs plugin scope 陷阱（读写走 Rust dev_* 命令）、轮询展开状态保留、isDirty 语义（`lastSavedMarkdown`）、二进制文件卡死（`isTextFile` 前置检测）、click→mousedown 拖选文字误关弹窗。
  - **关键文件**：`ProjectFileTree.vue`(新)、`projectStore.ts`(新)、`lib.rs`、`EditorPanel.vue`、`editorDiffBridge.ts`、`safePrompt.ts`、`JcCloudLoginBox.vue`、`ChatPanel.vue`、`FileTreePanel.vue`。
  - 验证：`vue-tsc -b` 零错误，`vite build` 通过。

- **系统优化（xitongyouhua）**（2026-07-01，分支 `xitongyouhua`，未合并）：
  - **直连模式消息构建器统一**：删除 `buildDirectLocalMessages` + `buildWebCloudMessages` 两个 ~90% 重复的函数，合并为纯函数 `src/utils/directMessageBuilder.ts`（7 个测试全部通过）。三个 sender 统一接线。
  - **直连模式多模态支持**：`ChatPanel.vue` 直连模式下 FileReader → data: URL → builder 构建 `image_url` parts。Web 端和 APP 直连模式均验证通过。根本原因修复见下文"响应式回归"。
  - **上下文用量 100% 对齐官方 OpenCode**：新建 `contextMetrics.ts` / `contextBreakdown.ts` / `contextFormat.ts`（9 个测试全部通过），重写 `ContextUsagePanel.vue`（16 项 stats + 角色拆分堆叠条 + system prompt + 原始消息 accordion）。Web 端面板隐藏（`WEB_UNSUPPORTED_PANELS` 加 `'context'`）。
  - **8091 OCR 全面清理**：删除 `src/utils/webChatAttachments.ts`（~400 行），移除 ChatPanel 中 `needsServerParse`/`parseFilesOnServer` 上传链路，删除 `ChatMessage`/`SendMessageOptions` 的 `parsedAttachments` 字段，更新 `localContentTools.ts` 工具描述。
  - **工具仓库**：新增 gallery-dl（11 条指令，插在 yt-dlp 和 ffmpeg 之间，共 10 个工具）。修复 `GitHubSkillCard.vue`「在 GitHub 打开」→ `openExternal()`（Tauri `shell.open`）。
  - **修复**：`catalog.ts` usage 从原始比值 → `Math.round((total/limit)*100)`。`resolveWebSkillSystemPrompt` 从 useChat.ts/chatCloud.ts 两处重复定义提取到 `skillContentResolver.ts`。
  - **教训**：
    - **assistant push 必须在 builder 之后**：`sendDesktopDirectCloudMessage` 里 `messages.value.push(assistantMsg)` 在 builder 之前会导致 builder 看到最后一条是 assistant（不是 user），跳过 multimodal 分支。三个 sender 全部修复。
    - **Web 云端路径的响应式回归**：`chatCloud.ts` 里把 assistant push 从 useChat 挪进来后，漏了"push 后重新取响应式代理"这一步。Vue 3 响应式只有通过下标访问时才返回 Proxy，直接 mutate 裸对象不会触发更新通知。导致模型回复拿到了（finalText 629 字符）、存进 IDB 了（count=2），但 UI 空白。修复：[chatCloud.ts:201](src/composables/chatCloud.ts#L201) `webAssistantMsg = currentMessages[currentMessages.length - 1]`。
    - **`persistCurrentSession` 的 shallow copy**：`{...message}` 让 images 数组引用共享。`saveSession` 里的 images→jc-media:// 转换会通过引用污染内存。改为 `sendPromise` 之后 persist，避免并发。
    - **工作区被 formatter 还原**：VSCode 的自动格式化可能触发 git checkout 行为导致未提交改动丢失。大规模改动后应立即 commit。
  - **关键文件**：`directMessageBuilder.ts`(新)、`contextMetrics.ts`(新)、`contextBreakdown.ts`(新)、`contextFormat.ts`(新)、`ContextUsagePanel.vue`、`useChat.ts`、`chatCloud.ts`、`ChatPanel.vue`、`WorkspaceLayout.vue`、`skillContentResolver.ts`、`catalog.ts`、`githubTools.json`、`GitHubSkillCard.vue`。
  - **测试**：`directMessageBuilder.test.ts` 7/7 ✅、`contextMetrics.test.ts` 5/5 ✅、`contextBreakdown.test.ts` 2/2 ✅。
  - **交接文档**：`docs/handover/xitongyouhua-handover.md`。

需要继续注意：

- 当前仍无崩溃上报（Sentry 等）。
- 部分媒体模型和画布模型能力仍在持续收敛。
- Windows portable zip 是当前稳定路线；安装器以后再做。
- 旧知识库代码不要误复活。
- “Platform”等内部英文词不要暴露给普通用户。
- **Skill 系统**：TDD 完成 95%，剩余 P2 优化（组件合并、skillContent 加载路径统一）可后续迭代。
  - `skillCommands.json` 已被 fallback 引用兜底，彻底删除需确认所有路径已切到 `skill.commands`。
  - 旧 Vault 函数体仍在 `skillsManageStore.ts` 中（已不导出），下次大清理可删。
  - `SkillAiSummaryPanel` 的"生成"按钮请求格式是 Anthropic 协议，连 NewAPI 的 OpenAI-compatible 端点可能需适配。
- **手机端已做 Phase 1 适配**：Rail 精简、指令弹窗响应式、对话⇄记录切换。后续改动注意：
  - 新增手机端功能优先在已有 4 个面板（聊天/记录/创作/设置）内扩展，不要往 Rail 加回按钮
  - `:name="expr"` 动态图标绑定会漏出 bundle 扫描，新增此类用法需同步 `ICON_ALIAS`
- Intel/Windows 启动根因尚未彻底排查（CSP/assetProtocol/SQLite 等候选），bootLog 可帮助定位。
- **服务端 CORS 双头**：`/api/creation/models` 返回重复 `Access-Control-Allow-Origin`，需 Nginx/Worker 去重（前端无法修复）。
- **创作结果 COS URL 24h 失效**：上游 RunningHub 限制，前端已加提醒 banner + 下载按钮。永久存储需服务端方案。

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
