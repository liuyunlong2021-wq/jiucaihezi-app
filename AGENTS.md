# 韭菜盒子 Studio — AI 协作者手册

> **最后更新**: 2026-07-02
> **定位**: 本文档是项目的「第一入口」。任何 AI 工具 / 新协作者接手前，读完本文即可理解全貌、安全改代码。

---

## 一、项目概述

韭菜盒子 Studio 是一个**本地优先的 AI 工作台桌面应用**（Tauri v2 + Vue 3）。同时有 Web 端（Cloudflare Pages）。

```
桌面 APP = OpenCode 文/武模式 + 直连模式 + Tauri 本地能力
Web 端  = 直连模式（无 OpenCode）
后端    = NewAPI（api.jiucaihezi.studio）聚合 40+ AI 供应商
```

**技术栈**: Tauri v2 / Rust | Vue 3 / Pinia / TypeScript / Vite | SQLite | NewAPI (Go) | rh-adapter (Python)

**服务器**: 47.82.86.196 (阿里云香港)，运维手册见 `docs/notes/我的服务器运维手册.md`

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
│   │   └── media/                # 媒体画廊/查看器
│   ├── composables/              # Vue composables（useChat, useCreation 等）
│   ├── stores/                   # Pinia stores（agentStore, sessionStore, projectStore 等）
│   ├── services/                 # API 客户端（newApiClient, newApiAuth）
│   ├── api/                      # 媒体生成 API（media-generation.ts）
│   ├── data/                     # 静态数据（模型能力表, githubTools.json, skillCommands.json）
│   ├── runtime/                  # 运行时引擎（creation, conversationContext, tools）
│   ├── opencodeClient/           # OpenCode SDK 封装
│   ├── utils/                    # 工具函数
│   ├── layouts/                  # 布局组件
│   └── styles/                   # 样式
├── src-tauri/                    # ★ Rust 后端
│   ├── src/lib.rs                # IPC 命令入口
│   ├── src/skills/               # Skill 扫描/管理/导入
│   ├── src/secure_store.rs       # Keychain 安全存储
│   ├── binaries/                 # sidecar (opencode, ffmpeg, ffprobe, yt-dlp)
│   ├── capabilities/default.json # Tauri 权限
│   └── tauri.conf.json           # Tauri 配置（CSP, assetProtocol）
├── public/
│   ├── skills/                   # ★ 内置 Skill（JC-* 系列）
│   └── landing/                  # 产品首页
├── rh-adapter/                   # RunningHub 适配器（Python, 独立部署）
├── gateway/                      # Cloudflare Worker（登录/首页代理）
├── docs/                         # 文档
├── .github/workflows/build.yml   # CI 三平台发布
├── 知识库备份/                   # 旧知识库代码备份
└── _canvas-archive/              # 画布代码归档（已移除）
```

### 关联仓库

| 仓库 | 路径 | 作用 |
|------|------|------|
| NewAPI | `../搭子Studio桌面版/MYnewapi/` | AI API 网关，聚合 40+ 供应商 |
| RH_CLI | `../RH_CLI/` | RunningHub CLI 工具 |

---

## 三、铁律

### 开发铁律

1. **CORS**: 本地开发 `getGatewayBaseUrl()` 必须返回 `/__jc_api`（Vite proxy），不能直连 `api.jiucaihezi.studio`
2. **画布已移除**: 源码在 `_canvas-archive/`，不要恢复
3. **面板挂载不阻塞**: `onMounted` 中重操作用 `setTimeout(fn, 100)` 延迟
4. **图标**: 所有图标走 `<JcIcon name="xxx">`，新增后跑 `node scripts/bundle-icons.mjs`

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
# 常用构建命令
pnpm exec vue-tsc -b          # TypeScript 检查
pnpm exec vite build           # 前端构建
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 检查
```

---

## 五、产品架构

### 双端边界

| | 桌面端 | Web 端 |
|---|--------|--------|
| 执行引擎 | OpenCode（文/武）+ 直连 | 直连 |
| 本地工具 | Tauri（文件/命令/ffmpeg/yt-dlp） | 无 |
| 发布 | DMG + portable zip | Cloudflare Pages |

### OpenCode 集成

项目目录必须贯穿 server/client/session/tool。关键文件: `src/opencodeClient/*`、`src/composables/useChat.ts`。

改 OpenCode 代码前过检查清单: 见原 AGENTS.md §4.1（保留在本文档末尾附录A）

### Skill 仓库

Skill = Anthropic 标准 Skill 包（`SKILL.md` + `references/` + `scripts/` + `assets/`）。
内置 Skill 在 `public/skills/`，用户安装的在 `~/.agents/skills/`。
扫描逻辑: `src-tauri/src/skills/scanner.rs`。关键 store: `src/stores/skillsManageStore.ts`。

### 创作面板

链路: `CreationPanel → useCreation → media-generation.ts → NewAPI/rh-adapter → 轮询 → 画廊`。
模型参数事实源: `src/data/mediaModelCapabilities.ts` + `src/runtime/creation/creationModelRegistry.ts`。
模型映射: `rh-adapter/src/models/mapping.py` + `docs/model-registry-matrix.md`。

### 账号/Key

双路线: 手动 Key（优先）→ Keychain / 账号登录 Session → Worker 代理。
关键文件: `src/utils/api.ts`、`src/services/newApiClient.ts`。

### 对话

Markdown/Katex/Mermaid/代码高亮/TTS。关键文件: `src/components/chat/`、`src/composables/useChat.ts`。
直连模式消息构建: `src/utils/directMessageBuilder.ts`。

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

发新版: `git tag v0.1.x && git push origin v0.1.x` → CI 自动构建三平台。

---

## 八、当前状态

**发布基线**: v1.1.3 | **NewAPI**: v1.0.0-rc.15
**当前分支**: `youhua`（优化分支，15 个修复已完成，待合并 main）

### 已完成（精选）

画布移除、Skill 系统统一简化、JC-meitichuangzuo 媒体引擎、知识库内循环 v3 设计、项目文件树 VS Code 复刻、手机端适配 Phase 1、Windows CSP/黑框修复、stickyScroll 粘性滚动、15 个 youhua 分支 Bug 修复。

完整历史: 见本文档末尾 §附录B。

### 待处理

- `chajian` 分支（插件仓库）待合并
- `youhua` 分支 15 个修复待合并 main
- Skill 三件套 v3 改造待完成（交接文档: `docs/handover/knowledge-base-v3-handover.md`）
- 视频缩略图持久化（重启丢失）
- CORS 双头问题（`/api/creation/models` 返回重复 ACAO header）

---

## 九、高风险文件

改这些文件前必须读上下文、跑验证:

| 文件 | 风险 |
|------|------|
| `src/components/icons/JcIcon.vue` | 全站图标唯一入口 |
| `src/composables/useChat.ts` | 对话主链路 |
| `src-tauri/src/lib.rs` | Rust IPC 入口 |
| `src-tauri/tauri.conf.json` | CSP + assetProtocol，错一个画廊全黑 |
| `src/utils/idb.ts` | SQLite schema，加列必须走 `_migrations` |
| `src/api/media-generation.ts` | 媒体生成 API |
| `src/data/githubTools.json` | 工具仓库数据源 |
| `src/data/skillCommands.json` | Skill 指令映射 |
| `public/skills/JC-meitichuangzuo/scripts/jc_media.py` | 媒体引擎核心脚本 |
| `rh-adapter/src/models/mapping.py` | RH 模型映射事实源 |

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
