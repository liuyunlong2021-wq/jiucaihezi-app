# SDD：创作图片本地化 + 导出双端兼容

> **状态**: ✅ 已完成（2026-06-18）
> **日期**: 2026-06-18
> **分支策略**: 桌面改动合入 `codex/opencode-core-execution`；Web 改动合入 `codex/web-direct-wongsaang`；共享接口双分支保持一致，通过 `main` 整合。

---

## TL;DR / 评审结论

- **解决什么**: 创作面板生成的图片不在「我的文件」里；Web 端导出功能不可用。
- **本轮范围**: App 产生或导出的媒体与文档（`data/media/` 下的 chat / creation / exports / thumbnails）。源码项目文件、OpenCode 工作区、SQLite 内部状态不在范围。
- **桌面端**: 创作图片自动落地 `data/media/creation/`，画廊优先本地文件，fallback 远程 URL。`writeMediaAsset` 增加 `mime` 参数。
- **Web 端**: 媒体查看保留浏览器原生保存能力；导出改为浏览器 `<a download>` 触发。
- **最大待定点**: `resultUrl` 是否改语义 → 本提案倾向「保留 `resultUrl` 为远程 URL，新增 `assetUri` 存本地引用」。
- **请重点评审**: `resultUrl` 兼容策略、Web 端创作媒体是否持久化 IndexedDB、失败重试是否需要用户可见入口。

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [目标](#2-目标)
3. [当前架构](#3-当前架构)
4. [目标架构](#4-目标架构)
5. [关键设计决策](#5-关键设计决策)
6. [数据字段契约](#6-数据字段契约)
7. [双端方案](#7-双端方案)
8. [实施计划](#8-实施计划)
9. [验收场景](#9-验收场景)
10. [历史数据策略](#10-历史数据策略)
11. [风险与已知限制](#11-风险与已知限制)
12. [开放问题](#12-开放问题)
附录 A: [上轮试验性接入复盘](#附录-a-上轮试验性接入复盘)

---

## 1. 背景与动机

### 1.1 已完成的基础设施

P0-P3 存储瘦身项目已交付：
- 数据库 2.4 GB → 0.57 GB（76%）
- 聊天贴图 base64 剥离到 `data/media/chat/`
- 「📁 我的文件」按钮 → 打开 Finder 到 `data/media/`
- 右键导出对话为 `.md`
- WAL checkpoint、ENOENT 降级、缩略图缓存框架

### 1.2 用户可感知的剩余问题

| # | 问题 | 用户影响 |
|---|------|---------|
| 1 | **创作图片不落地**。生成图在画廊可见，但 `data/media/creation/` 为空 | 点「我的文件」找不到 |
| 2 | **文件路径不统一**。聊天贴图在 `chat/`，导出在 `exports/`，创作作品不知在哪 | 用户困惑"文件到底存哪了" |
| 3 | **下载按钮 ≠ 我的文件**。创作面板下载按钮走 OS 下载文件夹，与 APP 存储无关 | 两条路径用户分不清 |
| 4 | **Web 端导出不可用**。`exportToMyFiles` 依赖 Tauri FS，Web 端右键导出无效 | Web 用户体验断裂 |

### 1.3 为什么三条链路一直没合流

P1 的 `writeMediaAsset` 为聊天贴图设计——输入是 base64（自带 `data:image/png;base64,...` 前缀），MIME 天然可解析。创作图片走的是 `NewAPI → RH 轮询 → CDN URL` 链路，数据形态是远程二进制流，与 base64 完全不同。两条链路在 P0-P3 阶段从未交汇，是正常的子系统演进节奏。现在是汇合的时候。

---

## 2. 目标

### 2.1 核心目标

让用户始终知道 **App 产生或导出的媒体与文档在哪**。源码项目文件、OpenCode 工作区文件、内部数据库状态不在本方案范围内。

### 2.2 具体目标

| # | 目标 | 验收 |
|---|------|------|
| 1 | 创作图片自动落地 `data/media/creation/`，扩展名正确 | 生成图 → 点「我的文件」→ 看到 `.png`/`.jpg` |
| 2 | 画廊优先本地文件，fallback 远程 URL | 本地有则显示本地；下载失败/断网仍可渲染 |
| 3 | 导出目标统一为 `data/media/exports/`（桌面）/ 浏览器下载（Web） | 右键导出 → 能找到文件 |
| 4 | Web 端导出可用 | Web 端右键导出 → 浏览器触发 `.md`/`.json` 下载 |
| 5 | 双端架构隔离，不互相污染 | 桌面代码不进入 Web bundle；Web 不引用 Tauri API |

### 2.3 非目标

- 不做 symlink / 镜像目录
- 不做云端同步
- 不修改 OpenCode 存储逻辑
- 不在 Web 端提供「我的文件」按钮
- 不做视频缩略图（需 ffmpeg）

---

## 3. 当前架构

### 3.1 聊天贴图路径（✅ 已工作）

```
用户贴图 → sessionStore.saveSession
  → writeMediaAsset(base64)
    → data/media/chat/YYYY-MM/{assetId}.png
    → INSERT media_assets
  → messages.images: ["jc-media://{assetId}"]
  → 画廊: resolveForDisplay(assetId) → convertFileSrc
  → 我的文件: ✅
```

### 3.2 创作图片路径（❌ 不落地）

```
创作面板提交 → mediaTaskStore.submitTask
  → NewAPI / RH 轮询
  → resultUrl = "https://cdn.xxx/abc.png"    ← 远程 URL！
  → 画廊: <img src="https://cdn.xxx/abc.png"> ← 直接渲染远程
  → 我的文件: ❌ 无本地文件
  → 下载按钮: OS 下载文件夹（另一条路）
```

### 3.3 导出路径（❌ Web 断裂）

```
桌面: 右键导出 → exportToMyFiles → data/media/exports/xxx.md ✅
Web:  右键导出 → exportToMyFiles → Tauri FS import → 报错/无反应 ❌
```

---

## 4. 目标架构

### 4.1 统一数据流

```
任何产生文件的操作
  │
  ├─ 是媒体文件（图片/视频/音频）？
  │   ├─ 桌面:
  │   │   下载远程 URL → Uint8Array
  │   │   → writeMediaAsset({ data, source, mime })
  │   │     → data/media/{source}/YYYY-MM/{assetId}.{ext}
  │   │     → INSERT media_assets
  │   │   → assetUri = "jc-media://{assetId}"
  │   │   → 画廊: resolveForDisplay(assetId) → convertFileSrc
  │   │   → 我的文件: ✅
  │   │
  │   └─ Web:
  │       下载远程 URL → Blob
  │       → storeToIndexedDB(blob, metadata)
  │       → 画廊: URL.createObjectURL(blob)
  │       → 用户右键 → 浏览器「存储为...」
  │
  └─ 是文档（对话/画布/文本）？
      ├─ 桌面: exportToMyFiles(content, format)
      │   → data/media/exports/xxx.{md|json}
      │   → 我的文件 → exports/ ✅
      │
      └─ Web: downloadAsBlob(content, format)
          → new Blob → URL.createObjectURL → <a download>
          → 浏览器触发下载
```

### 4.2 存储分层

```
data/media/
├── chat/YYYY-MM/          ← 聊天图片，自动
├── creation/YYYY-MM/      ← 创作作品，自动（本轮实现）
├── exports/               ← 用户导出，手动
└── thumbnails/            ← 系统缓存，不暴露
```

### 4.3 `jc-media://` 协议契约

**BNF**:
```
jc-media-uri  = "jc-media://" asset-id
asset-id      = "jcma_" <base36-timestamp> "_" <random-6chars>
```

**解析器**: `mediaFileReader.parseMediaRef(str)` → `assetId | null`

**解析流程**:
```
resolveForDisplay(assetId):
  1. 查 media_assets 表 → 获得 logicalPath
  2. assetRowToRealPath(row) → 真实文件路径
  3. convertFileSrc(realPath) → Tauri asset protocol URL
  4. 文件不存在 → 返回空字符串（调用方 fallback）

resolveForLlm(assetId):
  1. LRU 缓存命中 → 返回 data URL
  2. 读文件 → base64 编码 → 写缓存 → 返回
  3. 文件不存在 → 返回空字符串（P3.6 ENOENT 降级）
```

---

## 5. 关键设计决策

### 决策一：本地文件是第一公民，远程 URL 是 fallback

创作图片生成后，下载到本地。`assetUri` 存储 `jc-media://{assetId}`。画廊优先用 `resolveForDisplay(assetUri)` 渲染。本地缺失时透明降级到 `remoteUrl` 渲染。

**边界**: 本地缺失且远程不可用时，画廊显示「图片不可用」占位图。UI 不显示「未本地化」标记（复杂度收益比过低，暂不做）。

### 决策二：`resultUrl` 语义不变，新增 `assetUri`

**`resultUrl` 保留为原始远程 URL**（历史兼容）。新增 `assetUri` 字段存 `jc-media://{assetId}` 或 Web blob URL。画廊渲染优先级：`assetUri` → `resultUrl`。

这样历史数据零迁移，`resultUrl` 的消费方（`emitEvent('media-task-complete')`、`saveMediaToFileTree`）不受影响。

### 决策三：桌面端 `writeMediaAsset` 是唯一文件入口；Web 端统一走 IndexedDB

双端各自有一个入口，不假装统一。共享语义是「persist media asset」，实现按平台分叉。

### 决策四：下载失败的状态模型

| 场景 | 行为 |
|------|------|
| 首次下载成功 | `assetUri` 设为 `jc-media://{assetId}` |
| 首次下载失败 | `assetUri` 保持空，画廊用 `remoteUrl` 渲染 |
| 后续命中（用户再次查看） | 检测 `assetUri` 为空 → 自动重试下载（不提示用户） |
| 累计失败 3 次 | 标记 `assetStatus = 'remote-only'`，不再自动重试 |
| 启动时 | 所有 `assetUri` 为空且 `assetStatus ≠ 'remote-only'` 的任务 → 后台续传（限速 2 并发） |

### 决策五：Web 端不复刻「我的文件」按钮

Web 端导出统一为浏览器 `<a download>` 触发；媒体查看保留浏览器原生保存能力。不提供桌面式「我的文件」目录入口。

### 决策六：命名规则

文件名使用 `{assetId}.{ext}`（如 `jcma_mqj5wla3_macttd.png`），不使用用户提示词。提示词等元数据存入 `media_assets` 表。

---

## 6. 数据字段契约

本方案涉及的核心数据字段，供前后端/双端对齐：

| 字段 | 类型 | 存储位置 | 说明 |
|------|------|---------|------|
| `remoteUrl` | `string` | `mediaTask.resultUrl` | 原始 CDN URL，历史兼容，不可变 |
| `assetUri` | `string?` | `mediaTask.assetUri`（新增） | 桌面 `jc-media://{id}`，Web blob/indexedDB 引用 |
| `assetStatus` | `'pending' \| 'local' \| 'remote-only'` | `mediaTask.assetStatus`（新增） | 本地化状态 |
| `displayUrl` | — | 运行时计算，不持久化 | `resolveForDisplay(assetUri) \|\| remoteUrl` |
| `mime` | `string` | `media_assets.mime` | 必须来自 HTTP `Content-Type` 或 base64 前缀推断 |
| `source` | `'chat' \| 'creation' \| 'canvas' \| 'exports'` | `media_assets.source` | 文件来源分类 |

---

## 7. 双端方案

### 7.1 桌面端

| 用户操作 | 存储位置 | 如何查看 |
|---------|---------|---------|
| 聊天贴图 | `data/media/chat/` | 📁 我的文件 |
| 创作生成图 | `data/media/creation/` | 📁 我的文件 |
| 右键导出对话 | `data/media/exports/` | 📁 我的文件 |
| 编辑器保存到本地 | `data/media/exports/` | 📁 我的文件 |
| 画布导出项目 | `data/media/exports/` | 📁 我的文件 |

### 7.2 Web 端

> 以下为 `codex/web-direct-wongsaang` 分支目标态，当前实现以该分支为准。
> Web 端必须登录才能使用云端对话；未登录态下创作面板不可用，IndexedDB 无需按用户隔离。

| 用户操作 | 存储位置 | 如何查看 |
|---------|---------|---------|
| 聊天贴图 | IndexedDB | 浏览器渲染 |
| 创作生成图 | IndexedDB（下载后） | 浏览器渲染 + 右键另存为 |
| 右键导出对话 | — | 浏览器 `<a download>` 触发下载 |
| 编辑器保存到本地 | — | 浏览器 `<a download>` 触发下载 |
| 画布导出项目 | — | 浏览器 `<a download>` 触发下载 |

### 7.3 平台隔离

```
桌面专属:
  src-tauri/**
  src/utils/mediaFileWriter.ts
  src/utils/mediaFileReader.ts

Web 专属:
  IndexedDB 存储 + Blob URL 渲染
  浏览器下载触发

共享接口（双分支保持一致）:
  exportToMyFiles 签名
  jc-media:// 协议契约
  画廊组件 UI
```

---

## 8. 实施计划

### 8.1 待执行项

| # | 文件 | 改动 | 端 | 验收用例 |
|---|------|------|-----|---------|
| 1 | `mediaFileWriter.ts` | `WriteMediaOptions` 加 `mime?: string`；Uint8Array 分支用 `opts.mime` | 桌面 | 传入 `mime: 'image/png'` → 文件扩展名为 `.png` |
| 2 | `mediaTaskStore.ts` | 新增 `assetUri`/`assetStatus` 字段；`downloadAndPersistMediaAsset` 传 `Content-Type` 为 `mime`；成功后写 `assetUri` | 桌面 | z-image-turbo 任务完成 → `assetUri` = `jc-media://jcma_xxx` |
| 3 | `mediaTaskStore.ts` | 实现决策四：失败重试（最多 3 次）、`assetStatus` 状态机 | 桌面 | 断网生成图 → `assetStatus` = `'pending'` → 恢复网络后自动重试 |
| 4 | `CreationPanel.vue` | 画廊渲染：`resolveForDisplay(task.assetUri)` 优先，fallback `task.resultUrl` | 桌面 | 画廊 `<img>` 的 src 以 `asset://` (convertFileSrc) 开头 |
| 5 | `exportToMyFiles.ts` | `isTauriRuntime()` 分叉：桌面写 `data/media/exports/`；Web 触发浏览器 `<a download>` | 双端 | 桌面：文件出现在 `exports/`；Web：浏览器弹出下载 |
| 6 | `mediaFileWriter.ts` | `assetRowToRealPath` 使用 `join()` ✅（已于上轮修复） | 桌面 | 路径无缺 `/` |
| 7 | `mediaFileReader.ts` | `assetRowToRealPath` 使用 `join()` ✅（已于上轮修复） | 桌面 | 路径无缺 `/` |

### 8.2 执行顺序

```
1. mediaFileWriter.ts 加 mime 参数           → vue-tsc -b
2. mediaTaskStore.ts 新增 assetUri + 重试逻辑  → vue-tsc -b
3. CreationPanel.vue 画廊优先本地            → pnpm tauri dev 验证
4. exportToMyFiles.ts 双端分叉               → pnpm dev (Web) + pnpm tauri dev (桌面)
5. 全链路验证                               → 按 §9 验收场景
```

---

## 9. 验收场景

| # | 场景 | 预期 |
|---|------|------|
| 1 | 桌面生成 z-image-turbo 图片 | 任务完成后，`data/media/creation/2026-06/` 下有 `.png` 文件，大小 > 0，扩展名正确 |
| 2 | 立即点「📁 我的文件」 | Finder 显示 `creation/2026-06/`，文件可预览 |
| 3 | 画廊渲染 | `<img>` 的 src 以 `asset://` (convertFileSrc) 开头 |
| 4 | 断网后查看画廊 | 已经本地化的图正常显示；未本地化的 fallback 远程 URL（如网络也断则占位图） |
| 5 | 断网后生成新图 → 恢复网络 | `assetStatus` 从 `pending` → 自动重试 → `local` |
| 6 | 历史远程 URL 任务 | 画廊仍可渲染（`resultUrl` 不变） |
| 7 | 桌面右键导出对话 | `data/media/exports/` 出现 `.md` 文件 |
| 8 | Web 端右键导出对话 | 浏览器触发 `.md` 下载 |
| 9 | Web 端生成创作图片 | 浏览器正常渲染（Blob URL 或远程 URL） |
| 10 | 非 Tauri 环境 | 不 import / invoke Tauri-only API，应用不崩溃 |

---

## 10. 历史数据策略

| 数据类型 | 策略 |
|---------|------|
| 已有 `resultUrl` 的创作任务（远程 URL） | **不回填**。`assetUri` 保持空，画廊 fallback 到 `resultUrl` 渲染。未来用户再次查看时按决策四自动触发下载。 |
| 已从 `documents` 表迁移的旧图片（P2） | 已有本地文件和 `media_assets` 记录，不受影响。 |
| 已有的导出文件 | 桌面 `.md` 已在 `data/media/exports/`；Web 端历史导出不做迁移。 |

---

## 11. 风险与已知限制

| 风险 | 缓解 |
|------|------|
| 大文件下载期间用户关 APP → 下载中断 | 启动时续传（决策四），限速 2 并发 |
| `resultUrl` 消费方未适配 `assetUri` | 保留 `resultUrl` 不变，新增字段，不破坏现有消费方 |
| Web 端 IndexedDB 膨胀 | 不做（本轮范围外，后续单独 SDD） |
| 视频文件下载超时 | 限速 + 分片（如超出本轮范围，先以已知限制处理） |
| Web 端跨域图片无法 fetch | 依赖 Tauri rustFetch 或后端代理，非本方案引入 |

### 已知限制

- Web 端不做「我的文件」按钮，依赖浏览器下载管理
- 视频缩略图不在范围（需 ffmpeg）
- 不做云端同步
- `fire-and-forget` 下载 + 启动续传是尽力而为，极端情况下（APP 崩溃 + WAL 未持久化 `assetStatus`）可能导致状态丢失

---

## 12. 开放问题

| # | 问题 | 建议 |
|---|------|------|
| 1 | Web 端创作图片是否需要持久化到 IndexedDB？ | 建议：先只做浏览器渲染 + 右键另存为。IndexedDB 持久化作为后续优化。 |
| 2 | 失败重试是否需要用户可见入口？ | 建议：先不做。自动重试不可见。如果后续用户反馈，再加「重新下载」按钮。 |
| 3 | `data/media/` 英文目录名是否需要中文别名？ | 暂不做。可在后续 Skill 仓库建设时复用中文 README 模板。 |

---

## 附录 A: 上轮试验性接入复盘

> 本节仅作为背景记录，不影响提案评审。

在 P3 后期尝试在 `mediaTaskStore` 成功回调中接入 `writeMediaAsset`，遇到两个 bug：

1. **路径拼接缺 `/`**: `appDataDir()` 返回无尾 `/` 的路径，`${appData}data/media/...` 导致路径变为 `...desktopdata/media/...`。已在 `mediaFileWriter.ts` 和 `mediaFileReader.ts` 中改用 `join()` 修复。

2. **扩展名为 `.bin`**: `writeMediaAsset` 接收 `Uint8Array` 时 MIME 硬编码为 `application/octet-stream`，导致文件扩展名 `.bin`。本提案 §8.1 第 1 项通过增加 `mime` 参数修复。

这两个 bug 揭示了 `writeMediaAsset` 最初为 base64 设计、未适配远程二进制流的架构缺陷。本提案从根本上解决此问题。

---

> **请重点评审**: `resultUrl` 字段兼容策略（§5 决策二）、Web 端是否持久化创作媒体（§12 开放问题 1）、失败重试是否需要用户可见入口（§12 开放问题 2），以及 `data/media/` 中文说明是否进入本轮（§12 开放问题 3）。
