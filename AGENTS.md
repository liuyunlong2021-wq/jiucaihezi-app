# 韭菜盒子 Studio — AI 协作者手册

> **最后更新**: 2026-07-08
> **当前活跃分支**: `0708-skillxianshi` — Skill 自动检测实时显示 + 短剧 Skill 全面重构
> **当前版本**: v1.2.2

---

## 一、项目概述

韭菜盒子 Studio 是一个**本地优先的 AI 工作台桌面应用**（Tauri v2 + Vue 3）。同时有 Web 端（Cloudflare Pages）。

```
桌面 APP = OpenCode 文/武模式 + 本地/云端 Provider + Tauri 本地能力（直连模式已于 2026-07-04 移除，统一进入 OpenCode）
Web 端  = 轻量直连聊天+创作面板（无 OpenCode）
后端    = NewAPI（api.jiucaihezi.studio）聚合 40+ AI 供应商
```

**技术栈**: Tauri v2 / Rust | Vue 3 / Pinia / TypeScript / Vite | SQLite | NewAPI (Go) | rh-adapter (Python)

**服务器**: 47.82.86.196 (阿里云香港) → **计划迁移至新加坡 2C/4G/50G**，运维手册见 `docs/notes/我的服务器运维手册.md`

---

## 二、代码架构

```
jiucaihezi-app/
├── src/                          # ★ 前端源码
│   ├── components/
│   │   ├── chat/                 # 对话区（ChatPanel, MessageBubble, ChatScrollNav）
│   │   ├── creation/             # 创作面板（图片/视频/音频生成）
│   │   ├── editor/               # 文档编辑器（Tiptap）
│   │   ├── filetree/             # 左侧文件树/会话历史
│   │   ├── skills/               # Skill 仓库 UI
│   │   ├── tools/                # 工具仓库 UI
│   │   ├── rail/                 # Activity Rail
│   │   ├── settings/             # 设置面板
│   │   ├── icons/                # JcIcon 图标系统
│   ├── composables/              # Vue composables（useChat, useCreation 等）
│   ├── stores/                   # Pinia stores（agentStore, sessionStore, projectStore 等）
│   ├── services/                 # API 客户端（newApiClient, newApiAuth）
│   ├── api/                      # 媒体生成 API（media-generation.ts）
│   ├── data/                     # 静态数据（模型能力表, githubTools.json, skillCommands.json）
│   ├── runtime/                  # 运行时引擎（creation, conversationContext, tools）
│   ├── runtime/                  # 运行时引擎（creation, conversationContext, tools）
│   ├── opencodeClient/           # OpenCode SDK 集成
│   ├── utils/                    # 工具函数
│   ├── layouts/                  # 布局组件
│   └── styles/                   # 样式
├── src-tauri/                    # ★ Rust 后端
│   ├── src/lib.rs                # IPC 入口 (1622行, 11个命令模块)
│   ├── src/commands/             # 按领域拆分的 IPC 命令模块
│   ├── src/skills/               # Skill 扫描/管理/导入
│   ├── src/secure_store.rs       # Keychain 安全存储
│   ├── binaries/                 # sidecar (仅 opencode)
│   ├── capabilities/default.json # Tauri 权限
│   └── tauri.conf.json           # Tauri 配置（CSP, assetProtocol）
├── public/
│   └── landing/                  # 产品首页
├── rh-adapter/                   # RunningHub 适配器（Python, 独立部署）
├── gateway/                      # Cloudflare Worker（登录/首页代理）
├── docs/                         # 文档
└── .github/workflows/build.yml   # CI 三平台发布
```

### 关联仓库

| 仓库 | 路径 | 作用 |
|------|------|------|
| NewAPI | `../搭子Studio桌面版/MYnewapi/` | AI API 网关，聚合 40+ 供应商 |
| RH_CLI | `../RH_CLI/` | RunningHub CLI 工具 |

---

## 三、铁律

### 开发铁律

0. **照抄 OpenCode**: OpenCode 有的架构/功能/行为，一字不差照抄。——全部以 OpenCode 源码为唯一事实源。不自创，不简化，只"适配git push origin main && git tag v1.1.6 && git push origin v1.1.6"。
1. **CORS**: 本地开发 `getGatewayBaseUrl()` 必须返回 `/__jc_api`（Vite proxy），不能直连 `api.jiucaihezi.studio`
2. **画布/知识库已归档**: `_canvas-archive/` + `知识库备份/` 为历史归档，不在架构中
3. **面板挂载不阻塞**: `onMounted` 中重操作用 `setTimeout(fn, 100)` 延迟
4. **图标**: 所有图标走 `<JcIcon name="xxx">`，新增后跑 `node scripts/bundle-icons.mjs`
5. **跨平台正确性**: M 芯片不是测试标准——你的代码必须在最慢的机器上也能跑对。详见 `docs/sdd/apple-intel-adaptation-sdd.md` §10。核心规则：
   - **异步操作必须等待**：`spawn` 创建的资源在被消费前必须 `await` 或 join。Rust: `tokio::spawn` 返回 `JoinHandle`，必须 `.await`。TS: `Promise` 不能裸奔，开 `@typescript-eslint/no-floating-promises`。
   - **并发调用必须去重**：同一 `invoke` 命令若可能被多个 UI 组件同时触发，store/composable 层必须复用同一个 Promise。
   - **弹窗/菜单事件必须隔离**：全局 `click` handler 关闭弹窗时，弹窗内部的 `click` 必须 `stopPropagation()`。
   - **文件路径操作必须防御**：读取目录前先 `create_dir_all` / `mkdir -p`。`canonicalize()`（Rust）和 `realpath`（Node）要求目标存在，用前确保目录已创建。
   - **relative path 跳转必须验证**：`resource_dir()/../../..` 这类 hack 在 dev/prod/不同架构下层级可能不同。优先用 Tauri 官方 API 获取资源路径，不用相对跳转。
   - **锁超时必须保守**：任何 `AtomicBool` 锁的超时设为最慢目标平台的 3 倍（如 Intel Mac 慢盘 → 120s），并在 `finally`/`Drop` 中释放，不能依赖 `panic` 自动回收。

### 媒体铁律

- **NewAPI 只透传 4 个顶层字段**: `model`/`prompt`/`images`/`extra_fields`。模型参数必须放 `extra_fields`
- **媒体字节不进 SQLite**: 图片/视频/音频 → 文件系统 `output/{source}/`，数据库只存引用
- 详: `docs/troubleshooting/rh-video-debug.md` / `docs/sdd/rh-flux-klein-9b-sdd.md`

### 服务器铁律

- **排障第一信号**: PostgreSQL `tasks` 表，不是浏览器 Console
- **升级**: `docker compose up -d --force-recreate new-api`，~1 秒停机
- 详: `docs/notes/我的服务器运维手册.md`

---

## 四、开发规范

1. **先理解再修改** — 读代码、读文档、确认设计未废弃
2. **外科手术** — 只改必要的文件，不顺手重构/格式化/升级
3. **验证才算完成** — `vue-tsc -b && vite build` 至少跑这个
4. **沟通** — 先说结论再给证据，不夸大"彻底修复"

```bash
# === 桌面端（Tauri）===
pnpm tauri dev                 # 桌面开发（热重载）
pnpm tauri build               # 桌面打包（DMG + portable zip）
# 桌面发布：git tag v1.1.7 && git push origin v1.1.7 → CI 自动构建三平台

# === Web 端 ===
pnpm build                     # Web 完整构建（类型检查+图标+构建+裁剪+审计）
pnpm build:quick               # Web 快速构建（跳过测试）
npx wrangler pages deploy dist # Web 部署到 Cloudflare Pages
pnpm preview                   # Web 本地预览构建产物

# === 检查（不构建）===
pnpm exec vue-tsc -b           # TypeScript 检查
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 检查

# ⚠️ pnpm dev 只起 Vite dev server，不是 Tauri；桌面开发用 pnpm tauri dev
```

---

## 五、产品架构

### 双端边界

| | 桌面端 | Web 端 |
|---|--------|--------|
| 执行引擎 | OpenCode（文/武；云端/NewAPI、本地/Ollama、自定义 Provider） | 轻量直连 |
| 本地工具 | Tauri（文件/命令/OpenCode） | 无 |
| 发布 | DMG + portable zip | Cloudflare Pages |

**Web 端注意事项**：
- Web 端文件在浏览器内本地处理（FileReader → data URL / 文本提取），不经过服务端
- PDF/Office 转换需桌面端 Tauri（`convertDocumentToMarkdown`），Web 端直接失败
- 平台专属能力必须显式隔离：桌面是 Tauri + OpenCode + 本地工具；Web 是浏览器直连 + Web 持久化

### 手机端适配（Phase 1，2026-06-30）

手机端(≤768px)与桌面端**共享核心组件**，仅布局不同。不删除代码，只隐藏不适合小屏的功能。

**ChatPanel 响应式**（纯 CSS `@media (max-width: 768px)`）：
- 指令弹窗：`max-width: calc(100vw - 16px)` 全宽
- 指令卡片网格：5 列 → 2 列
- 输入区顶栏：`min-height` 38→32px，按钮缩小
- 模式菜单：全宽响应式

**WorkspaceLayout 移动端 Rail 精简**（模板层 `v-if="isMobile"`）：
- Rail 按钮 8→3：创作面板 / 对话⇄记录(切换) / 用户中心
- 切换逻辑：聊天/创作/设置 → 📋 history → 点击进记录；记录中 → 💬 chat → 回聊天
- 移除编辑区/Skill仓库/工具仓库/画布等桌面专属入口

**注意事项**：
- 手机端是桌面端精简视图，不是独立产品
- 新增功能优先在已有 4 个面板（聊天/记录/创作/设置）内扩展，不要往 Rail 加回按钮
- `:name="expr"` 动态图标绑定会漏出 bundle 扫描，新增此类用法需同步 `ICON_ALIAS`

### OpenCode 集成

项目目录必须贯穿 server/client/session/tool。关键文件: `src/opencodeClient/*`、`src/composables/useChat.ts`。

本地模型（Ollama）和自定义 OpenAI-compatible Provider 已作为 OpenCode Provider 接入，可驱动文/武模式。不要把本地模型当成独立“本地模式”恢复；它是模型 Provider，不是执行引擎。

改 OpenCode 代码前过检查清单: 见原 AGENTS.md §4.1（保留在本文档末尾附录A）

### Skill 仓库

Skill = Anthropic 标准 Skill 包（`SKILL.md` + `references/` + `scripts/` + `assets/`）。
用户安装的在 `~/.agents/skills/`。无内置 Skill，均由用户自行安装。
扫描逻辑: `src-tauri/src/skills/scanner.rs`。关键 store: `src/stores/skillsManageStore.ts`。

### 创作面板

链路: `CreationPanel → useCreation → media-generation.ts → NewAPI/rh-adapter → 轮询 → 任务列表`。
产出直写项目文件夹 `{projectDir}/jc-media/`，系统默认程序打开。**桌面端专属**，Web 端不可用。
模型参数事实源: `src/data/mediaModelCapabilities.ts` + `src/runtime/creation/creationModelRegistry.ts`。
模型映射: `rh-adapter/src/models/mapping.py` + `docs/model-registry-matrix.md`。

### 账号/Key

双路线: 手动 Key（优先）→ Keychain / 账号登录 Session → Worker 代理。
关键文件: `src/utils/api.ts`、`src/services/newApiClient.ts`。

### 对话

Markdown/Katex/Mermaid/代码高亮/TTS。关键文件: `src/components/chat/`、`src/composables/useChat.ts`。
桌面端产品决策: 取消普通聊天/直连模式，所有桌面对话进入 OpenCode Agent 运行时；简单问题通过“本地模型 + 文模式”低成本处理。Web 端保持当前轻量直连聊天入口。详见 `docs/sdd/app-opencode-only-sdd.md`。

---

## 六、存储架构

```
~/.jiucaihezi/
├── data/jiucaihezi.db          # SQLite（目标 <100MB）
└── output/{source}/             # 媒体文件（chat/creation/exports/thumbnails）
```

核心原则: 媒体字节不进 SQLite。`jc-media://` → resolver → `asset://localhost/...`。
详: `docs/sdd/unified-file-access-design-v2.md`。

---

## 七、启动 & 构建

### 启动流程

```
main.ts → mountApp()（UI 立即挂载，splash 消失）
       → initBackend()（异步，不阻塞）
           → boot()（8s 超时）
           → initDB()（10s 超时，失败走 localStorage 兜底）
```

### 调试标志

| window 属性 | 含义 |
|-------------|------|
| `__JC_APP_MOUNTED__` | Vue 已挂载 |
| `__JC_STORAGE_READY__` | SQLite 就绪 |
| `__JC_STORAGE_DEGRADED__` | 降级模式 |
| `__JC_BOOT_LOG__` | 启动日志 |

卡启动时: `JSON.stringify(__JC_BOOT_LOG__, null, 2)`

### Web 部署

```bash
pnpm exec vite build && node scripts/prune-web-dist.mjs
npx wrangler pages deploy dist
```

**死路**: 不要 Cloudflare Dashboard 拖拽（漏文件），不要 scp 到 47.82.86.196（那是 API 服务器不是 Web 服务器）。

### 桌面发布

发新版三步：

```bash
# 1. 升级版本号（同时改 package.json + tauri.conf.json）
pnpm run bump-version 1.1.7

# 2. 提交
git add -A && git commit -m "chore: bump to 1.1.7"

# 3. 打 tag → CI 自动构建三平台
git tag v1.1.7 && git push origin v1.1.7
```

本地打包: `pnpm exec tauri build` → `src-tauri/target/release/bundle/`

---

## 八、当前状态

**发布基线**: v1.2.2 | **NewAPI**: v1.0.0-rc.15
**当前分支**: `main`（会话生命周期 P0 修复已合入并推送）

### 已完成（含历史）

画布移除、Skill 系统统一简化、JC-meitichuangzuo 媒体引擎、知识库内循环 v3、项目文件树、手机端适配 Phase 1、Windows CSP/黑框修复、stickyScroll、15 个 youhua Bug 修复、创作面板全链路修复、本地模型驱动 OpenCode 文武模式、桌面端取消直连模式。

### 0705-xiu 新增

- **Web 端 Skill 系统** — 详见 `docs/sdd/web-skill-system-sdd.md`
  - 内置 Skill `JC-taijianskill-creator`（对标官方 skill-creator 90%+）
  - WebSkillPanel（Web 版 Skill 管理面板，对齐桌面 CentralSkillsPanel UI）
  - SkillPickerBar 数据管道（`public/skills/` + `bootstrapWebSkills()` + localStorage）
  - 纯文本 Skill 可跨三端使用（桌面/Web/手机）
- **Skill 推荐置顶** — `src/data/githubSkills.json` 顶部新增 3 个自有仓库
- **pick_project_folder 修复** — lib.rs 拆分时遗漏的命令已补回，Mac/Windows 均可选项目文件夹
- **折叠全部 → 切换项目** — ProjectFileTree 工具栏按钮改为切换项目文件夹
- **折叠按钮竞态修复** — `doCollapseAll` 先 clone 再 collapse 避免 Vue 响应式竞态
- **rh-gpt2-official** — RH GPT Image 2 官方稳定版（来自 0705-chuagnzuo）
- **会话选中高亮修复** — FileTreePanel 历史 tab 用 `sourceSessionId` 匹配选中态
- **Skill 编辑名称修复** — WebSkillPanel 保存时表单 name 优先于 parseSkillMd 解析结果

### Web Skill 系统架构速览

> 详细 SDD: `docs/sdd/web-skill-system-sdd.md`

```
三端 Skill 能力矩阵:
           纯文本 Skill    带脚本 Skill
桌面端      ✅ 聊天注入     ✅ OpenCode 武模式
Web 端      ✅ 聊天注入     ❌ 浏览器沙箱限制
手机端      ✅ 聊天注入     ❌ 同上

关键文件:
  src/stores/agentStore.ts       bootstrapWebSkills + persistWebSkills
  src/components/skills/WebSkillPanel.vue   Web 版 Skill 管理面板
  src/layouts/WorkspaceLayout.vue           skills 对 Web 开放
  src/components/rail/ActivityRail.vue      skills Rail 按钮
  public/skills/                           内置 Skill SKILL.md

CSS 变量（Web 组件必须用这些，不能用 --jc-*）:
  var(--surface) var(--ink1/ink2/ink3) var(--border) var(--paper)
  var(--olive-pale) var(--olive) var(--olive-dark) var(--error)
```

### 0706-cangkuyouhua 新增

- **工具仓库批量扫描+缓存** — 详见 `docs/sdd/tools-repo-scan-optimization-sdd.md`
  - `check_all_tools` 一次 IPC 批量扫描（抄 vscode-project-manager `alreadyLocated` 模式）
  - 缓存 `~/.jiucaihezi/tools/tools_cache.json`，5min TTL
  - 7 种检测策略: `dir`/`which`/`brew`/`npm`/`pip`/`npx`(已移除)/`command`
  - 每个工具 `githubTools.json` 声明 `detection` 字段
- **登录持久化** — 详见 `docs/sdd/login-persistence-sdd.md`
  - `apiKeyReady` reactive ref，`initApiKey`/`setApiKey` 完成后写入
  - `SettingsPanel` 通过 `watch(apiKeyReady)` 订阅，重启 APP 自动恢复登录
- **设置面板清理**
  - 删除 OpenCode 内核版本显示、桌面端网页备份导入
  - AI 执行偏好标签改为直白语言，版本号对齐 `package.json`
- **创作面板文件拖拽** — 全面板 drop zone + 拖拽高亮虚线提示
- **帮助弹窗 Markdown 化** — 硬编码卡片 → `public/help/guide.md` + `marked` 渲染
- **i18n 全局切换** — `locale` 模块级 reactive ref，`toggleLocale()` 全局生效
  - 迁移计划: 分 6 批逐步覆盖各组件，每批 ~10-20 处 `tr()`

### 0708-skillxianshi 新增

- **Skill 自动检测实时显示** — `session.next.agent.switched` 事件驱动
  - `useChat.ts`: 新增 `autoDetectedSkillName` ref，`beginRun()` 重置，`agent.switched` 捕获 `properties.agent`
  - `SkillPickerBar.vue`: 合并两个 `v-if`/`v-else` div 为单元素，优先级 `selectedSkillName` → `autoDetectedName` → `'Skill：自动'`
  - `ChatPanel.vue`: 解构 `autoDetectedSkillName` 传入 `SkillPickerBar`
  - 并发审计: `memories/repo/skillxianshi-concurrent-audit-2026-07-08.md`

- **JC-duanju-shijiemoxing 全面重构** — 详见 `docs/handover/AI交互创作模式-可复制Skill架构.md`
  - 文件架构：700行→176行统帅+5个references/（渐进式披露）
  - 建制阶段：5轮渐进式收集，每轮A/B/C+自定义
  - 写作质量手册：15章吸收04-other全部经验
  - 续写工作流：新增步骤二点五场景工作台
  - Wiki架构：面向记忆+市场+三Skill协作
  - 三Skill管道：创作→压缩→巡检
  - JC-jiyiyasuo升级：新增模式二摄入资料
  - 双Skill交叉审计：修复jiyiyasuo 6处旧路径
  - 可复制架构文档：`docs/handover/AI交互创作模式-可复制Skill架构.md`
  - skill-creator 新增创作型Skill生成模式：`references/创作Skill模板.md`

### 0706-xiaobug 新增

- **@mention & /command Autocomplete（照抄 OpenCode）** — 详见 `docs/sdd/at-mention-opencode-port-sdd.md`
  - textarea → contenteditable + pill chip + fuzzysort 模糊搜索
  - `@` 菜单：reference / agent / resource / recent / file（5组分组排序）
  - `/` 菜单：builtin 指令 + skill 命令（`source: "skill"` + badge），扁平列表
  - 新增 `useFilteredList.ts`、`useContentEditable.ts`、`MentionPopover.vue`
- **并发审计** — 详见 `docs/sdd/concurrent-audit-0706-xiaobug.md`
  - 修复 `useFilteredList.reload()` stale async 覆盖（`++reloadVersion` 令牌）
  - `handleAtSelect` 加 `try/finally` 确保 popover 清理
- **Skill 结构修正**
  - `JC-GPT-Image2-Skill` `gpt-image/` 内容摊平到根目录
  - `JC-manju-skills` 新增调度根 `SKILL.md`，合并 `JC-manju-shengchan` 消除雷同
- **GitHub 导入成功提醒** — 导入后显示 ✅ 绿色成功提示 + "完成"按钮
- **右键菜单边缘防截断** — 靠近底部/右侧自动翻转，不再被视口截断
- **Grok 视频模型修复**
  - RH `upload_file` 补传 `apikey` 到 form data，修复 "ApiKey verification error"
  - 启用 `rh-grok-video-edit`（视频编辑），隐藏已坏 T8 `grok-video-3`
  - 服务器 rh-adapter 已部署修复

---

## 九、高风险文件

改这些文件前必须读上下文、跑验证:

| 文件 | 风险 |
|------|------|
| `src/components/icons/JcIcon.vue` | 全站图标唯一入口 |
| `src/composables/useChat.ts` | 对话主链路 |
| `src/composables/useFilteredList.ts` | @mention 模糊搜索引擎 |
| `src/composables/useContentEditable.ts` | contenteditable DOM 操作 |
| `src/components/chat/MentionPopover.vue` | @ / 弹出层 UI |
| `src-tauri/src/lib.rs` | Rust IPC 入口 |
| `src-tauri/tauri.conf.json` | CSP + assetProtocol，错一个画廊全黑 |
| `src/utils/idb.ts` | SQLite schema，加列必须走 `_migrations` |
| `src/opencodeClient/providerProjection.ts` | OpenCode 多 Provider 配置生成 |
| `src/api/media-generation.ts` | 媒体生成 API |
| `src/data/githubTools.json` | 工具仓库数据源 |
| `src/data/skillCommands.json` | Skill 指令映射 |
| `public/skills/JC-meitichuangzuo/scripts/jc_media.py` | 媒体引擎核心脚本 |
| `rh-adapter/src/models/mapping.py` | RH 模型映射事实源 |

## 九-二、已知架构风险

> 2026-07-05 系统架构优化已完成（`xitonggoujia` 分支），以下风险已解决或缓解。详见 `docs/sdd/system-architecture-optimization-sdd.md`

| 风险 | 状态 | 说明 |
|---|---|---|
| `lib.rs` 单文件 ~5000 行 | ✅ 已解决 | 拆为 11 个命令模块，6229→1622 行 (-74%) |
| Binary sidecar 仅 aarch64 | ✅ 已解决 | ffmpeg/whisper/yt-dlp 已移除，仅保留 opencode |
| Chromium 浏览器自动化 | ✅ 已删除 | Phase 0 移除 |
| MLX 本地模型仅 Apple Silicon | ✅ 已删除 | Phase 0 移除 |
| composable 端混用 | ✅ 已隔离 | web/ 目录隔离 Web 专属文件 |
| utils/ 薄封装多 | 🔧 持续 | editor*.ts 已归位，其余按需合并 |

---

## 附录A: OpenCode SDK 对齐检查清单

改 `src/opencodeClient/**` 前逐条确认:
- `session.prompt()` 参数格式与 SDK 一致
- 不自创不存在的方法名
- 事件 `payload?.type` 与官方 Event 类型一致
- 不遗漏 `await`
- `pnpm run test:focused` 通过

---

## 附录B: 历史版本记录

### 2026-06 主要里程碑

- 06-19: 启动架构重构（UI 优先挂载 + 超时降级）
- 06-20: RH 视频排障（`docs/troubleshooting/rh-video-debug.md`）
- 06-21: 图标系统迁移 → SVG/JcIcon / Web OCR 附件解析
- 06-22: OpenCode 对齐 v1.17.9 / RH 图片模型铁律 / 一键抄配置
- 06-23: OpenCode Bug 修复 + 上线前全面修复（xiubug0623）
- 06-25: 画布移除 → `_canvas-archive/`
- 06-26: 知识库内循环 Phase 1/2（gongju 分支）
- 06-27: 编辑区增强 + 工具/输入区合并 main
- 06-28: 小说/短剧临摹四件套 skill
- 06-29: 指令系统全覆盖 + JC-meitichuangzuo 媒体引擎 + 项目文件树
- 06-30: Skill 系统统一简化 + 手机端适配 Phase 1 + 服务器升级 rc.15

### 2026-07 主要改动 (youhua 分支)

**07-01 修复**：
- P1: skill 安装重复（seed 小写 id）
- P2: stickyScroll 粘性滚动（ChatScrollNav 重写 + 滚底按钮）
- P3: Intel Mac 卡 logo（15s 超时安全网 + 早期错误捕获）
- P4: JC-360huangjing 内置 skill + multi-style-image-generator GitHub 推荐
- P5: JC-meitichuangzuo Key 自动同步（Keychain↔文件）
- P6: T8 GPTImage2 比例映射扩展（3→10 种）
- P7: 画廊引用按钮 jc-media:// 解析修复
- P8: 移除「我的文件」组件
- P9: 删除创作面板技术条幅
- P10: FileTreePanel tab 不再被后台事件切换
- P11: Windows skill 扫描锁超时修复 + canvas 死代码清理
- P12: NewAPI logo 完整显示 + OG 标签（`docs/handover/newapi-logo-fix-handover.md`）
- P13: Windows 一键建库 canonical_root 修复
- P14: 编辑区工具栏精简为一行
- P15: manhua-script-agent→JC-duanju-shijiemoxing + 知识库内循环 v3

**07-02**：
- AGENTS.md 重构（1560→291行）+ 历史笔记提取到 docs/

### 2026-07-02/03 主要改动 (0702xiufu 分支)

**OpenCode 三层隔离（照抄官方源码）**：
- 铁律零确立：OpenCode 源码为唯一事实源，架构/行为/UI 全抄
- 上下文泄露修复 + 粘底滚动失效修复
- 一个进程管理多 project，不杀进程切换
- 会话列表按 project 目录过滤（照抄 OpenCode project 隔离）
- SessionFork（照抄 OpenCode）→ 后续回退：二进制单目录模式限制
- 模型切换修复 + Plugin 系统 + Git Worktree 沙箱

### 2026-07-02/03 主要改动 (0702-xiufu-2 分支)

**07-02 UI 清理**：
- 隐藏 sessionCommandNotice 通知条（不再显示「已新建 OpenCode 会话」等）
- 隐藏 AgentStatusBar 工具进度条（不再显示「正在运行」+ edit/bash 堆叠）
- `src/components/chat/ChatPanel.vue` -14 行
- **提案 SDD**: APP 专注 OpenCode、砍直连/本地模式（`docs/sdd/app-opencode-only-sdd.md`，待研究决定）

### 2026-07-02/03 主要改动 (0702-xiufu-3 分支)

**创作面板全链路修复与增强**（15 文件，+248/-66）：

**1) GPTImage2 T8 超时修复**
- 图片生成 HTTP 超时 180s→300s（`httpClient.ts` + `media-generation.ts` 4 处）
- GPTImage2 加 `pollKind: 'newapi-task'`，支持异步轮询（`creationModelRegistry.ts`）

**2) 比例 3:4 等不生效修复**
- `sizeFromRatioResolution` 从 3 个硬编码比例扩展为 10 种（`creationMediaPlan.ts`）
- `setAspect`/`setResolution` 变化时同步重算 `cpState.size`（`useCreation.ts`）

**3) 图生图（参考图）卡死修复**
- 参考图下载从浏览器 fetch 改为 Tauri `http_download_base64`，避免跨域卡死（`creationMediaRuntime.ts`）

**4) 媒体产出直写项目文件夹**
- 新增 Rust 命令 `dev_write_file_bytes`（base64→二进制→项目文件夹，绕过 fs scope）
- 新增 `projectMediaWriter.ts`：文件名安全化 + 写入 `{projectDir}/jc-media/{images,videos,audio,text}/`
- `mediaTaskStore`、`CreationPanel`、`creationMediaCache` 三处落地路径：项目文件夹优先，无项目回退 `output/creation/`
- ProjectFileTree 点图片改用系统默认程序打开
- 方案文档：`docs/sdd/media-output-to-project-folder-sdd.md`

**5) 创作面板预览/下载失效修复**
- `getAll('media_assets')` SQL 错误（`no such column: data`）→ 改用 `queryMediaAssets`（`idb.ts`）

**6) 服务器运维手册更新**
- 数据库命令全部改为粘贴即用单行格式（`docker exec ... psql -c "SQL"`）
- 新增渠道配置内部说明（setting 字段含义）、任务日志查询、排障速查
- `docs/notes/我的服务器运维手册.md`

**7) UI 微调**
- 隐藏 AgentStatusBar 和 sessionCommandNotice（`ChatPanel.vue`，来自 youhua 分支）
- Rail 图标：Skill 仓库 → 💲(`paid`)，创作面板 → 📷(`photo_camera`)

### 2026-07-04 主要改动 (pingguo-inter 分支)

**本地模型驱动文武模式**（3 commits，`src/opencodeClient/providerProjection.ts` + `src/utils/providerConfig.ts` + `src/stores/agentStore.ts`）：
- 多 Provider OpenCode 配置：按 `providerId` 分组模型，为每个 Provider 生成独立 OpenCode config 条目
  - `jiucaihezi` → `api.jiucaihezi.studio/v1`（需 apiKey）
  - `local-ollama` → `127.0.0.1:11434/v1`（免 key）
  - 自定义 openai-compatible → 用户配置的 baseURL（可选 apiKey）
- `toOpenCodeModelProjection` 正确解析 Ollama/自定义 provider 的模型路由
- `attachment: true` 恒为 true（照抄 OpenCode），确保本地模型能接收文件上下文
- `CustomProviderConfig` 存储：`getCustomProviders()` / `saveCustomProviders()`
- 真实修复完成：本地模型仅在 direct 以外的文/武模式进入 OpenCode；未登录/无 NewAPI Key 时选择 Ollama 不再触发 `jiucaihezi` API Key 错误；用户已手测“武模式 + 你好”成功
- Provider 投影规则：当前选中本地/自定义模型且没有 NewAPI API Key 时，OpenCode config 只投本地/自定义 provider，避免缓存云端模型拦路；有 Key 时可同时投云端和本地 provider

**欢迎页优化**（1 commit，`src/components/chat/ChatPanel.vue`）：
- 主文案：「聊天用豆包，干活用韭菜盒子。」→「国产Codex」
- 建议卡片 4→2：创建/修改Skill + 安装GitHub项目

**创作面板**（3 commits）：
- 画廊→任务列表重构：任务队列视图替代网格画廊，进度计时器修复
- SDD 合规：`field-sizing:content` + 清理 expiry 死 CSS
- 任务列表布局对齐修复

**Intel Mac 全面修复**（15 commits，`src-tauri/` + `src/components/`）：
- 项目选择器死锁：JS event loop → Rust side（tokio oneshot + rfd 替代 tauri dialog）
- AppleScript 方案作为 fallback
- z-index 修复：model menu teleport 到 body
- titleBarStyle overlay 适配 Tauri v2.5 schema
- 移除 bundled sidecar binaries，改用户自装工具
- 死代码清理：`delete_skill`、`get_discovered_project_count`、`ImportTarget`、`central_root_path`
- macOS Hardened Runtime：新增 `entitlements.plist`
- 文件树主题和文本 fallback 对齐

**桌面端去直连产品决策**（`docs/sdd/app-opencode-only-sdd.md`）：
- 已决策：桌面端取消普通聊天/直连模式，所有桌面对话进入 OpenCode Agent 运行时
- 文模式承担轻量问答/分析；武模式承担执行/改文件/跑命令
- 本地模型不再是单独模式，而是低成本 OpenCode Provider
- Web 端长期保持轻量直连聊天入口，不升级成浏览器版工作台

**分支状态**：
- `pingguo-inter` 已 fast-forward 合并到 `main`
- `main` 已通过 HTTPS 推送到 `origin/main`（SSH remote 当前 publickey 不可用；`gh` 登录态可用）

### 详细文档索引

| 主题 | 文档 |
|------|------|
| RH 视频排障 | `docs/troubleshooting/rh-video-debug.md` |
| RH 图片模型 | `docs/sdd/rh-flux-klein-9b-sdd.md` |
| 一键抄配置 | （见 AGENTS.md 历史版本） |
| 指令系统 | （见 AGENTS.md 历史版本） |
| 项目文件树 | （见 AGENTS.md 历史版本） |
| 存储架构 | `docs/sdd/unified-file-access-design-v2.md` |
| 知识库 v3 | `docs/sdd/knowledge-base-inner-loop-v3.md` |
| 服务器运维 | `docs/notes/我的服务器运维手册.md` |
| NewAPI logo | `docs/handover/newapi-logo-fix-handover.md` |

---

## 十、服务器迁移步骤

> **目标**: 47.82.86.196 (香港 4C/8G/70G) → 新加坡 2C/4G/50G
> **策略**: 凌晨停机迁移，零数据丢失

### 前置准备（本机 Mac）

```bash
cd /Users/by3/Documents/jiucaihezi-app
git push https://github.com/liuyunlong2021-wq/jiucaihezi-app.git 0705-chuagnzuo
```

### 旧服务器：备份

```bash
mkdir -p /root/migration-backup && cd /root/migration-backup
docker exec postgres pg_dump -U newapi -d new-api > new-api.sql
cp /root/new-api-new/docker-compose.yml .
cp /root/new-api-new/.env new-api.env 2>/dev/null
cp /opt/rh-adapter/.env rh-adapter.env
cp /etc/nginx/sites-enabled/api.jiucaihezi.studio.conf .
cp -r /opt/creation-models . 2>/dev/null
cp -r /opt/jiucai-adapter . 2>/dev/null
tar -czf /root/jiucai-migration.tar.gz /root/migration-backup
```

### 传输备份（服务器直传，不经过本机）

```bash
# 旧服务器
cd /root && python3 -m http.server 19876 &

# 新服务器
wget http://47.82.86.196:19876/jiucai-migration.tar.gz -O /root/jiucai-migration.tar.gz

# 旧服务器：关掉
pkill -f "http.server 19876"
```

### 新服务器：部署

```bash
# 基础环境
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y nginx certbot python3-certbot-nginx git
systemctl enable docker && systemctl start docker

# rh-adapter（git 稀疏克隆）
git clone --filter=blob:none --sparse https://github.com/liuyunlong2021-wq/jiucaihezi-app.git /opt/jiucai-repo
cd /opt/jiucai-repo && git sparse-checkout set rh-adapter && git checkout 0705-chuagnzuo
mkdir -p /opt/rh-adapter && cp -r rh-adapter/* /opt/rh-adapter/
cp /root/migration-backup/rh-adapter.env /opt/rh-adapter/.env
cd /opt/rh-adapter && docker compose up -d --build rh-adapter

# 恢复数据库 → 启动 NewAPI → 配 Nginx → certbot → DNS 切换
```

### 以后 rh-adapter 更新（一行）

```bash
cd /opt/jiucai-repo && git pull && cp -r rh-adapter/* /opt/rh-adapter/ && cd /opt/rh-adapter && docker compose up -d --force-recreate --build rh-adapter
```
