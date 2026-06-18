# 设计文档：双端文件存取统一方案

> **状态**: ✅ 已完成（2026-06-18）
> **日期**: 2026-06-18
> **作者**: GitHub Copilot (DeepSeek V4 Pro)
> **读者**: AI 协作者、前端开发者、产品设计者
> **目的**: 提交给其他 AI 工具评审，收集意见后执行

---

## 目录

1. [背景：为什么要做这个改变](#1-背景为什么要做这个改变)
2. [目标](#2-目标)
3. [当前架构分析](#3-当前架构分析)
4. [目标架构](#4-目标架构)
5. [双端方案](#5-双端方案)
6. [实施计划](#6-实施计划)
7. [最终效果](#7-最终效果)
8. [风险与已知限制](#8-风险与已知限制)
9. [开放问题（待评审）](#9-开放问题待评审)

---

## 1. 背景：为什么要做这个改变

### 1.1 项目现状

韭菜盒子 Studio 已完成 P0-P3 存储瘦身项目：
- 数据库从 2.4 GB 瘦身到 0.57 GB（76%）
- 聊天贴图的 base64 已剥离到文件系统 `data/media/chat/`
- FileTree 底部新增「📁 我的文件」按钮，点击打开 Finder 到 `data/media/`
- 右键对话可导出为 `.md` 到 `data/media/exports/`

### 1.2 当前问题

**问题一：创作面板生成的图片不在「我的文件」里。**

用户在创作面板生成一张图片，画廊里能看到，但点「📁 我的文件」→ `creation/` 目录不存在或为空。原因是画廊渲染走的是远程 CDN URL（`https://rh-images-xxx.cos.ap-beijing.myqcloud.com/xxx`），图片从未下载到本地。

```
画廊显示:  <img src="https://cdn.xxx/abc.png">   ← 远程，浏览器直接加载
本地文件:  data/media/creation/                   ← 空的，从未写入
```

**问题二：用户困惑「文件到底在哪」。**

- 聊天贴图 → `data/media/chat/`
- 创作作品 → 不知道在哪（远程 URL）
- 对话记录 → 锁在 SQLite 里
- 画布工程 → 锁在 SQLite 里
- OS 下载按钮 → 去了系统下载文件夹，跟 APP 无关

用户不知道该去哪找，也不知道什么操作产生什么结果。

**问题三：试验性接入暴露了架构缺陷。**

上一轮尝试在创作任务成功后自动下载远程图片到本地 `data/media/creation/`，遇到了两个低级 bug：
1. `appDataDir()` 返回无尾 `/` 的路径（如 `/Users/xxx/Library/Application Support/com.jiucaihezi.desktop`），字符串拼接 `appData + 'data/media/...'` 导致路径缺少 `/`（变成了 `...desktopdata/media/...`）
2. `writeMediaAsset` 接收 `Uint8Array` 时 MIME 硬编码为 `application/octet-stream`，导致文件扩展名为 `.bin`

这两个 bug 揭示了一个根本问题：`writeMediaAsset` 是为聊天贴图（base64 自带 MIME）设计的，创作图片走的是完全不同的数据形态（远程二进制流，无 base64 前缀）。

### 1.4 为什么不早点修

P0-P3 的存储瘦身项目的核心目标是「数据库瘦身 + 启动加速」，不是「统一文件存取体验」。`writeMediaAsset` 的设计约束来自 P1「新消息 base64 剥离」，天然适配聊天贴图场景。创作面板的图片生成链路（NewAPI → RH 轮询 → CDN URL）是独立演进的功能，两个子系统在数据层面从未交汇。

现在是时候把两条路合成一条了。

---

## 2. 目标

### 2.1 核心目标

**让用户始终知道文件在哪。** 不管是通过聊天、创作面板、画布还是编辑器产生的文件，用户都能在一个统一的位置找到。

### 2.2 具体目标

| # | 目标 | 衡量标准 |
|---|------|---------|
| 1 | 创作生成的图片自动落地到本地 `data/media/creation/` | 生成一张图 → 点「我的文件」→ 看到 `.png` |
| 2 | 画廊优先显示本地文件（fallback 远程 URL） | 本地有文件则显示本地，无则显示远程 |
| 3 | 文件名正确（不是 `.bin`） | 扩展名匹配真实格式 |
| 4 | 导出的对话/画布/文本统一在 `data/media/exports/` | 右键导出 → 「我的文件」→ `exports/` 可见 |
| 5 | Web 端导出功能可用（浏览器下载） | Web 端右键导出 → 浏览器触发下载 |
| 6 | 双端架构清晰，不互相污染 | 桌面专属代码在 `isTauriRuntime()` 分支内 |

### 2.3 非目标

- 不做 symlink / 镜像目录（操作系统是最好的文件管理器）
- 不做云端同步
- 不修改 OpenCode 存储逻辑
- 不在 Web 端做「我的文件」按钮（浏览器右键另存为已足够）
- 不做视频缩略图（需 ffmpeg，不在范围）

---

## 3. 当前架构分析

### 3.1 数据流（现状）

```
┌──────────────────────────────────────────────────────────────┐
│                        聊天贴图                                │
│  用户粘贴/拖入图片                                              │
│    → sessionStore.saveSession                                 │
│      → writeMediaAsset(base64) → data/media/chat/YYYY-MM/xxx.png │
│      → messages.images: ["jc-media://{assetId}"]              │
│    → 画廊渲染: resolveForDisplay(assetId) → convertFileSrc    │
│    → 「我的文件」: ✅ 可见                                     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                       创作面板                                 │
│  用户提交生成任务                                               │
│    → CreationPanel → mediaTaskStore.submitTask                │
│      → NewAPI / RH → 轮询 → resultUrl = "https://cdn.xxx/..." │
│    → 画廊渲染: <img src="https://cdn.xxx/...">   ← 远程 URL   │
│    → 「我的文件」: ❌ 不可见                                   │
│    → 下载按钮: OS 下载文件夹（另一条路）                        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                      对话 / 画布 / 文本                        │
│  存储在 SQLite (messages / documents 表)                       │
│    → 右键导出 → exportToMyFiles → data/media/exports/xxx.md  │
│    → 「我的文件」: ✅ exports/ 可见                            │
│    → Web 端: ❌ 导出功能依赖 Tauri FS，Web 不可用              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 根因

三条数据链路各自为政，没有统一的「结果落地」概念：

- 聊天贴图：落地到本地（✅）但 MIME 由 base64 前缀提供
- 创作图片：不落地，远程 URL 直传画廊（❌）
- 导出的文档：落地到本地（✅）但 Web 端路径断裂（❌）

---

## 4. 目标架构

### 4.1 统一数据流

```
任何产生文件的操作
  │
  ├─ 是媒体文件（图片/视频/音频）？
  │   ├─ 桌面: writeMediaAsset(data, { source, mime })
  │   │   → data/media/{source}/YYYY-MM/{assetId}.{ext}
  │   │   → INSERT INTO media_assets
  │   │   → 返回 jc-media://{assetId}
  │   │   → 画廊用 resolveForDisplay(assetId) 渲染
  │   │   → 「我的文件」可见 ✅
  │   │
  │   └─ Web: storeToIndexedDB(blob, metadata)
  │       → URL.createObjectURL(blob)
  │       → 画廊用 blob URL 渲染
  │       → 用户右键 → 浏览器「存储为...」
  │
  └─ 是文档（对话/画布/文本）？
      ├─ 桌面: exportToMyFiles(content, format)
      │   → data/media/exports/xxx.{md|json}
      │   → 「我的文件」→ exports/ 可见 ✅
      │
      └─ Web: downloadAsBlob(content, format)
          → new Blob → URL.createObjectURL → <a download>
          → 浏览器触发下载
```

### 4.2 存储分层（双端统一逻辑）

```
┌─────────────────────────────────────────────────────┐
│                    统一逻辑层                         │
│                                                     │
│  聊天图片 → media/chat/       自动存，用户只读       │
│  创作作品 → media/creation/   自动存，用户只读       │
│  用户导出 → media/exports/    手动触发，用户管理     │
│  系统缓存 → media/thumbnails/ 自动管理，不暴露给用户  │
│                                                     │
│  对话记录 → SQLite/IndexedDB  右键导出 → exports/    │
│  画布工程 → SQLite/IndexedDB  导出项目 → exports/    │
│  文本文件 → SQLite/IndexedDB  保存到本地 → exports/  │
└─────────────────────────────────────────────────────┘
```

### 4.3 关键设计决策

**决策一：「本地文件是第一公民，远程 URL 是 fallback。」**

创作图片生成后，先下载到本地，再把 `jc-media://{assetId}` 作为 `resultUrl`。画廊渲染时优先调 `resolveForDisplay` 走本地文件，网络异常或下载失败时才 fallback 到远程 URL。

**决策二：「writeMediaAsset 是唯一写入入口。」**

所有媒体落地都经过 `writeMediaAsset`。它需要支持两种数据形态：
- `data: string`（base64，可能含 data: URI 前缀）→ 从 base64 提取 MIME
- `data: Uint8Array`（二进制流）→ 必须由调用方传入 `mime` 参数

**决策三：「Web 端不做文件管理，浏览器就是文件管理器。」**

Web 端没有文件系统，浏览器自带完整的下载管理能力（下载栏、右键另存为、`<a download>`）。Web 端的「导出」行为应该触发浏览器下载，而不是试图模拟本地文件系统。

---

## 5. 双端方案

### 5.1 桌面端

```
用户操作              →  存储位置                →  如何查看
────────────────────────────────────────────────────────────
聊天贴图               →  data/media/chat/       →  📁 我的文件
创作生成图             →  data/media/creation/   →  📁 我的文件
右键导出对话           →  data/media/exports/    →  📁 我的文件
编辑器保存到本地        →  data/media/exports/    →  📁 我的文件
画布导出项目           →  data/media/exports/    →  📁 我的文件
画廊渲染               →  优先本地文件，fallback 远程 URL
```

技术实现：
- `open_in_shell` Rust command + `invoke` 打开 Finder
- `writeMediaAsset` 落地媒体文件到 Tauri FS
- `resolveForDisplay(assetId)` → `convertFileSrc` 渲染本地文件
- `exportToMyFiles` 导出文档到 `data/media/exports/`

### 5.2 Web 端

```
用户操作              →  存储位置                →  如何查看
────────────────────────────────────────────────────────────
聊天贴图               →  IndexedDB              →  浏览器渲染
创作生成图             →  IndexedDB              →  浏览器渲染
右键导出对话           →  浏览器下载 .md          →  下载文件夹
编辑器保存到本地        →  浏览器下载 .md          →  下载文件夹
画布导出项目           →  浏览器下载 .json        →  下载文件夹
画廊渲染               →  Blob URL               →  浏览器渲染
```

技术实现：
- 不做「我的文件」按钮（浏览器右键另存为已足够）
- 导出功能改为 `new Blob → URL.createObjectURL → <a download>` 触发浏览器下载
- 创作图片下载后存 IndexedDB，Blob URL 渲染
- `exportToMyFiles` 改为双端兼容：`isTauriRuntime()` → 写本地文件，否则 → 触发浏览器下载

### 5.3 平台隔离原则

```
桌面专属（Tauri）:
  src-tauri/**
  src/utils/mediaFileWriter.ts
  src/utils/mediaFileReader.ts (Tauri 分支)
  src/utils/exportToMyFiles.ts (Tauri 分支)

Web 专属:
  IndexedDB 存储逻辑
  Blob 下载逻辑
  浏览器原生功能

共享（双端一致）:
  ChatMessage 类型定义
  exportToMyFiles 接口签名
  画廊 UI 组件 (CreationPanel.vue)
```

---

## 6. 实施计划

### 6.1 改动清单

| # | 文件 | 改动 | 端 | 说明 |
|---|------|------|-----|------|
| 1 | `mediaFileWriter.ts` | `WriteMediaOptions` 加 `mime?: string`；Uint8Array 分支使用 `opts.mime` | 桌面 | 修 .bin bug |
| 2 | `mediaTaskStore.ts` | `downloadAndPersistMediaAsset` 传 `Content-Type` 作为 `mime` | 桌面 | 创作图片 MIME 正确 |
| 3 | `mediaTaskStore.ts` | 成功回调中 `resultUrl` 改为 `jc-media://{assetId}`（下载成功时） | 桌面 | 本地文件成为第一公民 |
| 4 | `CreationPanel.vue` | 画廊渲染优先 `resolveForDisplay(assetId)`，fallback `resultUrl` | 桌面 | 画廊走本地 |
| 5 | `exportToMyFiles.ts` | `isTauriRuntime()` 分叉：桌面写文件，Web 触发浏览器下载 | 双端 | Web 导出可用 |
| 6 | `mediaFileReader.ts` | `assetRowToRealPath` 已改为 `join()` ✅ | 桌面 | 已完成 |
| 7 | `mediaFileWriter.ts` | 路径拼接已改为 `join()` ✅ | 桌面 | 已完成 |

### 6.2 不需要改的

| 功能 | 原因 |
|------|------|
| 聊天贴图链路 | ✅ P1 已完整落地 |
| 「我的文件」按钮 | ✅ 已指向 `data/media/` |
| 画廊 UI 布局 | 改动在数据层，UI 不变 |
| OpenCode 文/武模式 | 不在范围 |
| Skills 数据库 | 不在范围 |
| thumbnails 生成 | P3.4 已提供函数，懒调用 |

### 6.3 执行顺序

```
1. mediaFileWriter.ts 加 mime 参数
2. mediaTaskStore.ts 传 Content-Type + 改 resultUrl
3. CreationPanel.vue 画廊优先本地
4. exportToMyFiles.ts 双端分叉
5. 验证: pnpm tauri dev（桌面）+ pnpm dev（Web）
```

---

## 7. 最终效果

### 7.1 用户视角（桌面）

```
我生成了一张图：
  → 画廊里看到了（跟以前一样）
  → 点「📁 我的文件」
    → data/media/creation/2026-06/我的提示词.png  ← 就在这 ✅

我导出了一个对话：
  → 右键 →「导出到文件夹」
  → 点「📁 我的文件」
    → data/media/exports/会话名_日期.md  ← 就在这 ✅

我删了一个文件：
  → Finder 里删了
  → APP 不崩溃（P3.6 ENOENT 降级已实现）
```

### 7.2 用户视角（Web）

```
我生成了一张图：
  → 画廊里看到了
  → 右键 →「存储为...」→ 浏览器存到下载文件夹 ✅

我导出了一个对话：
  → 右键 →「导出到文件夹」→ 浏览器下载 .md ✅
```

### 7.3 开发者视角

- 所有媒体落地走 `writeMediaAsset`，唯一入口
- 所有媒体读取走 `resolveForDisplay` / `resolveForLlm`，唯一出口
- 双端逻辑在 `exportToMyFiles.ts` 内部 `isTauriRuntime()` 分叉，调用方无感
- `data/media/` 目录结构：`{source}/{YYYY-MM}/{assetId}.{ext}`

---

## 8. 风险与已知限制

| 风险 | 缓解 |
|------|------|
| 创作图片下载失败（网络问题） | fallback 到远程 URL 渲染，不丢图 |
| 大文件下载耗时 | 异步 fire-and-forget，不阻塞画廊渲染 |
| Web 端 IndexedDB 膨胀 | 后续单独写 Web 存储优化 SDD（本轮明确不做） |
| `writeMediaAsset` 接口膨胀 | 只加了 `mime?` 可选字段，向后兼容 |
| 历史创作结果（远程 URL） | `resolveForDisplay` 查不到本地文件时返回空，画廊降级到远程 URL |

### 已知限制

- Web 端不做「我的文件」按钮，依赖浏览器自带下载管理
- 视频缩略图不在范围（需 ffmpeg）
- 不做云端同步
- 不做存储仪表盘

---

## 9. 开放问题（待评审）

1. **`resultUrl` 改为 `jc-media://` 是否影响现有序列化/反序列化？**
   - `task.resultUrl` 目前被多处读取（`emitEvent('media-task-complete')`、`saveMediaToFileTree`、`persistTasksSafely`）。改为 `jc-media://` 后，消费方需要能解析这个逻辑路径。现有 `resolveForDisplay` 已经支持，但需要确认所有消费方都经过 resolver。

2. **Web 端创作图片是否需要存 IndexedDB？**
   - 当前方案是「下载→Blob→IndexedDB→Blob URL」。如果图片数量大，IndexedDB 会膨胀。是否可以只缓存最近 N 张，其余保留远程 URL？

3. **画廊的「fallback 到远程 URL」逻辑应该放在哪一层？**
   - 方案 A：`resolveForDisplay` 返回空时，调用方 (`CreationPanel.vue`) 自己 fallback
   - 方案 B：`resolveForDisplay` 内部处理 fallback（但这会模糊职责边界）
   - 建议：方案 A，保持 resolver 的纯粹性。

4. **是否需要给用户一个「重新下载」按钮？**
   - 如果自动下载失败（网络抖动），用户看到的是远程 URL 渲染的图。是否需要手动触发重试？还是一切自动重试不可见？

5. **`data/media/` 的目录结构是否需要可视化标签？**
   - 当前是 `chat/` `creation/` `exports/` `thumbnails/`。英文名对中文用户不友好。是否考虑中文别名或在 Finder 里放一个 `README.txt` 说明？

---

> **请评审以上方案，尤其关注第 9 节的开放问题。任何 AI 工具或开发者都可以在此基础上提出修改意见。**
