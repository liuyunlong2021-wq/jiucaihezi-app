# SDD: 创作面板媒体资产区与第二列媒体移除方案

> 状态：待执行规格
> 日期：2026-06-09
> 范围：创作面板 / 第二列媒体 tab / 媒体查看器 / 媒体文件入口
> 目标：移除第二列媒体入口，把媒体查看、历史生成、上传导入、下载和复用集中到创作面板上半区；创作面板下半区继续作为生成操作台。

---

## 1. 决策摘要

本方案明确：

```text
第二列媒体直接去掉。
创作面板上半区承担媒体资产入口。
创作面板下半区继续承担生成操作台。
统一查看器优先服务创作面板。
底层媒体数据不删除，只更换 UI 入口。
画布本轮不改，只做后续引用预留。
```

新的创作面板结构：

```text
创作面板
├── 上半区：媒体资产区
│   ├── 本次结果
│   ├── 全部媒体
│   ├── 图片 / 视频 / 音频筛选
│   ├── 上传 / 导入
│   ├── 大图 / 视频 / 音频查看器
│   └── 下载 / 复制 / 设为参考 / 发送到画布预留
└── 下半区：生成操作台
    ├── 模型
    ├── 提示词
    ├── 参数
    ├── 参考图 / 首帧 / 尾帧
    └── 生成按钮
```

核心原则：

```text
用户在哪生成，就在哪查看、筛选、下载和继续复用。
第二列不承载复杂媒体 UI。
媒体底层仍然走 fileStore / 后续 MediaAsset。
移除第二列媒体 tab 不等于删除媒体数据。
```

---

## 2. 背景与问题

### 2.1 当前问题

1. 创作面板生成成功后，画廊可能显示空白。
2. 第二列媒体区域太窄，不适合承载图片、视频、音频、大图查看、筛选、下载等复杂能力。
3. 用户在创作面板生成，却需要去第二列媒体找历史结果，路径割裂。
4. 第二列媒体当前只是缩略图入口，不能承担专业媒体库。
5. 如果继续升级第二列媒体，会把复杂 UI 塞进过窄空间。

### 2.2 新判断

媒体管理 UI 应该跟生成入口在同一个主工作区。

因此：

```text
创作面板上半区 = 媒体资产区
创作面板下半区 = 生成操作台
第二列媒体 tab = 移除
```

这比“第二列升级素材库”更合理，因为创作面板有更宽的展示空间，也更符合用户动作链路：

```text
生成 -> 查看 -> 放大 -> 下载 -> 设为参考 -> 再生成
```

---

## 3. 目标与非目标

### 3.1 目标

1. 创作面板生成成功后，媒体资产区稳定显示结果。
2. 创作面板上半区可以查看本次生成和历史媒体。
3. 创作面板内置统一媒体查看器，支持图片、视频、音频。
4. 第二列媒体 tab 从 UI 中移除。
5. 第二列媒体已有数据不删除，统一通过创作面板媒体资产区展示。
6. 创作面板媒体资产区支持上传 / 导入媒体，替代第二列媒体原上传入口。
7. 下载、复制、设为参考、发送到画布预留集中在创作面板查看器。
8. 为后续完整 `MediaAsset` 统一源预留 adapter。

### 3.2 非目标

1. 不把生成操作台搬进画布。
2. 不改画布主流程。
3. 不删除已有媒体数据。
4. 不迁移大文件到磁盘资产目录。
5. 不改变 RH / Grok / Veo / Seedance / Suno 等生成接口。
6. 不引入自动 Agent 或自动工作流编排。
7. 不重构第二列其它 tab，如历史、文本、知识、Skill、画布。

---

## 4. 目标 UI

### 4.1 创作面板整体布局

推荐布局：

```text
┌──────────────────────────────────────────────┐
│ 媒体资产区                                    │
│ ┌──────────────┬───────────────────────────┐ │
│ │ 筛选/分组      │ 媒体网格 / 大图查看器       │ │
│ │ 本次结果       │ 图片 / 视频 / 音频卡片      │ │
│ │ 全部媒体       │ loading / failed / ready   │ │
│ │ 图片/视频/音频 │                           │ │
│ └──────────────┴───────────────────────────┘ │
├──────────────────────────────────────────────┤
│ 生成操作台                                    │
│ 模型 / 提示词 / 参数 / 参考槽 / 生成按钮        │
└──────────────────────────────────────────────┘
```

如果空间有限，媒体资产区可使用顶部 tabs：

```text
本次结果 | 全部 | 图片 | 视频 | 音频 | 收藏 | 失败
```

### 4.2 媒体资产区

媒体资产区不是旧画廊，而是创作面板内的媒体入口。

能力：

| 能力 | 说明 |
|---|---|
| 本次结果 | 显示当前生成任务产物 |
| 全部媒体 | 显示已有 `image/video/audio` FileEntry |
| 类型筛选 | 图片、视频、音频 |
| 搜索 | 按名称、prompt、模型搜索 |
| 上传 / 导入 | 替代第二列媒体原上传入口 |
| 状态显示 | loading、ready、failed、remote-only |
| 点击查看 | 打开统一媒体查看器 |
| 右键操作 | 查看、下载、复制引用、设为参考、删除 |

### 4.3 生成操作台

创作面板下半区继续保留现有生成能力：

- 任务类型：图片 / 视频 / 音频。
- 模型选择。
- 提示词。
- 尺寸、比例、数量、时长。
- 参考图、首帧、尾帧、参考视频、音频输入。
- 生成按钮。
- 任务状态。

本轮不改变底层生成 API。

### 4.4 统一媒体查看器

查看器优先在创作面板内使用。

打开来源：

```text
创作面板媒体资产区卡片
创作面板本次结果卡片
```

后续来源：

```text
画布媒体节点
聊天媒体结果
```

查看器能力：

| 类型 | 能力 |
|---|---|
| 图片 | 大图、适配窗口、缩放、拖拽平移 |
| 视频 | 播放、暂停、进度、音量、大视图 |
| 音频 | 播放、暂停、基础信息 |

操作：

| 操作 | 说明 |
|---|---|
| 下载 | 下载当前媒体 |
| 复制引用 | 复制本地引用或可展示 URL |
| 设为参考 | 把当前媒体放入生成操作台参考槽 |
| 重新生成 | 带回 prompt、模型、参数 |
| 发送到画布 | 预留动作，本轮可隐藏或禁用 |
| 删除 | 删除媒体资产，必须确认 |

---

## 5. 数据策略

### 5.1 移除 UI，不删除数据

移除第二列媒体 tab 只影响 UI。

不删除：

```text
fileStore 中已有 image / video / audio FileEntry
已有 data URL
已有 jc-media:file_xxx 引用
已有远端 URL
```

这些数据统一由创作面板媒体资产区读取并展示。

### 5.2 第一阶段仍使用 FileEntry

第一阶段不新增数据库表。

继续使用：

```text
FileEntry.category = image | video | audio
FileEntry.content = data URL 或远端 URL
FileEntry.mimeType = image/png | video/mp4 | audio/mpeg
```

### 5.3 新增轻量显示模型

新增轻量显示类型：

```ts
export type MediaAssetKind = 'image' | 'video' | 'audio'

export interface MediaDisplayAsset {
  id: string
  kind: MediaAssetKind
  name: string
  mimeType?: string
  displayUrl: string
  originalUrl?: string
  localRef?: string
  fileId?: string
  prompt?: string
  model?: string
  taskId?: string
  createdAt?: number
  status?: 'loading' | 'ready' | 'failed' | 'remote-only'
  errorMsg?: string
}
```

转换来源：

```text
Creation result -> MediaDisplayAsset
FileEntry -> MediaDisplayAsset
jc-media ref -> MediaDisplayAsset
```

### 5.4 后续完整 MediaAsset 预留

后续可升级为完整 `MediaAsset`：

```ts
interface MediaAsset {
  id: string
  kind: 'image' | 'video' | 'audio'
  name: string
  mimeType: string
  localFileId?: string
  localPath?: string
  originalUrl?: string
  prompt?: string
  model?: string
  provider?: string
  taskId?: string
  origin: 'creation-panel' | 'canvas' | 'chat' | 'upload' | 'import'
  parentAssetIds?: string[]
  params?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
```

本轮只做显示层 adapter，不做完整迁移。

---

## 6. 架构方案

### 6.1 新增或调整模块

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/components/creation/CreationPanel.vue` | 修改 | 上半区升级为媒体资产区，下半区保留生成操作台 |
| `src/components/creation/GalleryCard.vue` | 修改或替换 | 作为媒体资产卡片使用 |
| `src/components/media/MediaViewer.vue` | 新增 | 统一图片/视频/音频查看器 |
| `src/utils/mediaDisplayAsset.ts` | 新增 | `FileEntry`、创作结果到 `MediaDisplayAsset` 的转换 |
| `src/utils/mediaDisplayResolver.ts` | 新增 | 解析 `jc-media:`、data URL、远端 URL |
| `src/components/filetree/FileTreePanel.vue` | 修改 | 移除 media tab UI 和相关入口 |
| `src/utils/creationMediaCache.ts` | 小改 | 保持 `jc-media:` 解析和缓存能力 |

### 6.2 创作面板媒体资产区链路

```text
CreationPanel
  -> load media FileEntry(image/video/audio)
  -> fileEntryToMediaDisplayAsset()
  -> merge current generation results
  -> media asset grid
  -> click card
  -> MediaViewer(asset)
```

### 6.3 生成成功链路

```text
mediaTaskStore task success
  -> cacheCreationMediaResult()
  -> fileStore.addMedia()
  -> CreationPanel media asset list refresh
  -> 本次结果分组出现新卡片
  -> 全部媒体同步出现新卡片
```

### 6.4 第二列媒体移除链路

```text
FileTreePanel tabs
  -> remove media tab config
  -> remove media-specific grid UI
  -> remove media tab upload path
  -> keep fileStore media data untouched
```

替代入口：

```text
CreationPanel media asset area
  -> upload / import media
  -> fileStore.addMedia()
```

### 6.5 画布预留

本轮不改画布。

只预留：

```text
MediaViewer asset
  -> future sendToCanvas(asset)
  -> canvas node stores fileId or assetId
```

---

## 7. 分阶段实施

### P0：创作面板画廊稳定显示

目标：解决生成成功后卡片空白。

任务：

1. 为创作结果建立稳定 `resolvedGalleryAssets` map。
2. 模板渲染不再触发异步 `displayUrl()`。
3. `jc-media:` 解析中显示 loading。
4. 解析失败显示 failed 卡片。
5. data URL、远端 URL、`jc-media:` 都能显示。

验收：

1. RH 生图成功后创作面板不空白。
2. 刷新后仍能显示已缓存结果。
3. 失败状态不空白。

### P1：创作面板统一媒体查看器

目标：在创作面板内完成大图、视频、音频查看。

任务：

1. 新增 `MediaViewer.vue`。
2. 创作面板媒体卡片点击打开查看器。
3. 图片支持大图查看。
4. 视频支持播放。
5. 音频支持播放。
6. 查看器支持下载。

验收：

1. 创作面板图片可大图查看。
2. 创作面板视频可播放。
3. 创作面板音频可播放。
4. 下载可用。

### P2：创作面板上半区升级为媒体资产区

目标：把创作面板上半区从旧画廊升级为媒体文件入口。

任务：

1. 读取 `fileStore` 中所有 image/video/audio 文件。
2. 转换为 `MediaDisplayAsset`。
3. 与本次生成结果合并展示。
4. 支持本次结果、全部、图片、视频、音频筛选。
5. 支持上传 / 导入媒体。
6. 支持搜索或基础过滤。

验收：

1. 旧媒体数据能在创作面板上半区看到。
2. 新生成媒体能自动出现。
3. 用户可以在创作面板上传媒体。
4. 第二列媒体不再是必要入口。

### P3：移除第二列媒体 UI

目标：第二列不再显示媒体 tab。

任务：

1. 从 `FileTreePanel.vue` tabs 中移除 media。
2. 移除或停用 media tab 的网格 UI。
3. 移除 media tab 上传入口。
4. 保留底层 `fileStore.addMedia()` 和媒体数据。
5. 确认其它 tab 不受影响。

验收：

1. 第二列不再显示媒体 tab。
2. 已有媒体数据没有删除。
3. 媒体仍能在创作面板上半区看到。
4. 文本、历史、知识、Skill、画布 tab 正常。

### P4：创作面板媒体动作完善

目标：让媒体资产区具备基本工作台能力。

任务：

1. 卡片右键支持查看、下载、复制引用。
2. 查看器支持设为参考图。
3. 查看器支持重新生成。
4. 查看器预留发送到画布。
5. 删除媒体前弹确认。

验收：

1. 用户能在创作面板完成查看、下载、复用。
2. 删除不会误伤无确认数据。
3. 设为参考后生成操作台能识别该媒体。

### P5：长期 MediaAsset 与画布接入预留

目标：后续再做完整统一素材源。

任务：

1. 引入完整 `MediaAsset` 类型。
2. 媒体资产区升级为真正素材库。
3. 画布节点改为引用 `MediaAsset.id`。
4. 大文件迁移到磁盘资产目录。
5. 批量下载和 metadata sidecar 单独立项。

验收：

1. 该阶段不阻塞本轮创作面板改造。
2. 可作为后续 SDD 单独执行。

---

## 8. 测试计划

### 8.1 单元测试

| 测试 | 覆盖 |
|---|---|
| `mediaDisplayResolver.test.ts` | `jc-media:`、data URL、远端 URL 解析 |
| `mediaDisplayAsset.test.ts` | `FileEntry` 和创作结果转显示资产 |
| `creationMediaCache.test.ts` | 缓存结果和失败状态 |

### 8.2 组件测试

| 组件 | 覆盖 |
|---|---|
| `CreationPanel.vue` | 媒体资产区、筛选、上传、本次结果 |
| `MediaViewer.vue` | 图片、视频、音频、加载失败 |
| `FileTreePanel.vue` | media tab 移除后其它 tab 正常 |

### 8.3 手动验收

1. 创作面板生成图片后，上半区显示结果。
2. 点击图片能看大图。
3. 生成视频后，上半区显示视频卡片。
4. 点击视频能播放。
5. 上传图片后，上半区能看到。
6. 第二列不再显示媒体 tab。
7. 已有媒体数据没有丢失。
8. 下载当前媒体可用。

---

## 9. 风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| 删除第二列媒体入口后找不到旧媒体 | 旧媒体原来在第二列 | 创作面板上半区必须读取所有旧媒体 |
| 创作面板变复杂 | 上半区媒体库、下半区操作台都在同页 | 用 tabs/筛选/查看器控制密度 |
| 上传入口丢失 | media tab 移除后原上传路径消失 | 创作面板媒体资产区新增上传/导入 |
| 与画布割裂 | 本轮不改画布 | 查看器预留发送到画布，长期 MediaAsset 再接入 |
| 数据误删 | UI 移除可能误解为删除数据 | 明确只移除 UI，不删除 fileStore 数据 |

---

## 10. 最终形态

本轮最终体验：

```text
用户进入创作面板。
上半区看到本次结果和历史媒体。
下半区继续输入提示词、选择模型和参数。
生成后结果直接进入上半区。
点击媒体可以看大图、播放视频、下载、设为参考。
第二列不再显示媒体 tab。
```

一句话：

```text
第二列媒体去掉；创作面板上半区成为媒体资产入口，下半区继续作为生成操作台。
```

