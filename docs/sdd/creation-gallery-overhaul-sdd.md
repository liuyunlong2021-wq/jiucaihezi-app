# SDD: 创作面板画廊全面优化

> **状态**: 待审核
> **日期**: 2026-06-05
> **范围**: CreationPanel 画廊区 UI 重构 + 删除持久化 Bug 修复 + 视频/音频体验 + 画廊功能补全
> **涉及文件**: `GalleryCard.vue`, `CreationPanel.vue`, `GalleryLightbox.vue`, `GalleryLoadingCard.vue`, `useCreation.ts`, `mediaTaskStore.ts`, `design-tokens.css`

---

## 0. 当前问题摘要

| # | 问题 | 严重度 | 根因 |
|---|------|--------|------|
| BUG-1 | 删除画廊内容后重开 App 又出现 | P0 | `reconcileCreationTasksToGallery()` 不知道哪些是用户主动删除的，每次重新塞回 |
| UI-1 | 卡片"糊在一起"，无边界感 | P0 | gap 仅 8px、无静态阴影、border 极淡、无信息栏 |
| UI-2 | 视频卡片只有静态帧+播放图标 | P1 | 无时长显示、无 hover 预览 |
| UI-3 | 音频卡片用原生 `<audio>` 控件 | P1 | 与产品设计语言不搭 |
| UI-4 | 灯箱无左右导航 | P1 | 只能关闭再开另一张 |
| UI-5 | 图片/视频/音频混杂无法筛选 | P2 | 无类型 tab |
| UI-6 | 失败卡片无重试 | P2 | 只显示错误，用户只能重新填参数 |
| UI-7 | 硬限 24 条，无分页 | P2 | `slice(0, 24)` 硬编码 |
| UI-8 | 无右键菜单 | P3 | 操作只能 hover 底栏 |
| UI-9 | 无批量操作 | P3 | 不能多选删除/下载 |
| UI-10 | 强制 1:1 裁图 | P3 | 宽幅/竖版作品被裁 |

---

## 1. P0 — 删除持久化 Bug 修复

### 1.1 根因分析

```
用户删除卡片
  → cpState.results.splice(index, 1)    ✓ 内存移除
  → saveCpState()                        ✓ localStorage 持久化
  → mediaTaskStore.deleteTask(taskId)    ✗ 很多结果没有 taskId → 跳过

App 重启
  → mediaTaskStore.init()               从 IndexedDB 加载全部历史任务
  → reconcileCreationTasksToGallery()   遍历已完成任务
    → hasGalleryRecordForTask(task)     画廊里没有（刚删的）→ 重新塞回
```

两个缺陷叠加：
1. 没有 `taskId` 的结果删除时不会从 mediaTaskStore 移除
2. 即使有 `taskId` 并成功删除了 mediaTaskStore 条目，`reconcile` 也没有"用户主动删除"的语义记忆

### 1.2 方案

在 localStorage 维护一个已删除 taskId 集合 + 已删除 URL 集合（双保险）：

```ts
// useCreation.ts 新增
const DELETED_KEY = 'jc_cp_deleted_v1'

function loadDeletedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function saveDeletedSet(set: Set<string>) {
  // 只保留最近 200 条，防止无限增长
  const arr = [...set].slice(-200)
  localStorage.setItem(DELETED_KEY, JSON.stringify(arr))
}

const deletedSet = loadDeletedSet()

export function markResultDeleted(result: CreationResult) {
  if (result.taskId) deletedSet.add(`task:${result.taskId}`)
  if (result.originalUrl) deletedSet.add(`url:${result.originalUrl}`)
  if (result.url) deletedSet.add(`url:${result.url}`)
  saveDeletedSet(deletedSet)
}

export function isResultDeleted(taskId?: string, url?: string): boolean {
  if (taskId && deletedSet.has(`task:${taskId}`)) return true
  if (url && deletedSet.has(`url:${url}`)) return true
  return false
}
```

**修改 `deleteResult()`**（CreationPanel.vue）：

```ts
function deleteResult(index: number) {
  const result = cpState.results[index]
  if (result) markResultDeleted(result)          // ← 新增
  cpState.results.splice(index, 1)
  if (result?.taskId) mediaTaskStore.deleteTask(result.taskId)
  if (lbIndex.value === index) closeLightbox()
  saveCpState()
}
```

**修改 `reconcileCreationTasksToGallery()`**（CreationPanel.vue）：

```ts
function reconcileCreationTasksToGallery() {
  const settled = mediaTaskStore.tasks
    .filter(task => task.source === 'creation' && (task.status === 'success' || task.status === 'failed'))
    .filter(task => !isResultDeleted(task.id, task.resultUrl))  // ← 新增
    .sort(...)
  for (const task of settled) {
    void addSettledCreationTaskToGallery(task)
  }
}
```

### 1.3 边界

- `deletedSet` 上限 200 条，超过则丢弃最老的（FIFO）
- "清空画廊" `clearResults()` 同时清空 `deletedSet`（防止以后新生成的被误判）
- 不影响 mediaTaskStore 的正常持久化逻辑

---

## 2. P0 — 视觉边界感重构

### 2.1 卡片结构变更

**当前 GalleryCard 结构**：
```
div.gc-card          ← 1:1 方形容器
  img / video / audio / text / failed   ← 内容填满
  div.gc-card-tag    ← 左上角"已生成"标签
  div.gc-card-actions ← hover 底部操作栏
```

**新结构**：
```
div.gc-card                    ← 取消强制 1:1，自然高度
  div.gc-card-media            ← 媒体区域（保持原比例或限定最大比例）
    img / video / audio-player / text / failed
    div.gc-card-play           ← 视频播放图标
    div.gc-card-type-badge     ← 左上角类型角标（视频🎬/音频🎵）
    div.gc-card-actions        ← hover 操作栏
  div.gc-card-info             ← 底部信息栏（新增）
    span.gc-card-model         ← 模型名
    span.gc-card-time          ← 相对时间
```

### 2.2 样式变更

```css
/* 卡片容器 — 取消强制 1:1 */
.gc-card {
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--paper);                          /* 从 surface-alt 改为 paper */
  box-shadow: 0 2px 8px var(--jc-shadow-color);      /* ← 新增：常态轻阴影 */
  transition: transform .2s, box-shadow .2s;
}
.gc-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--jc-shadow-sm);                    /* 复用设计令牌 */
}

/* 媒体区域 — 限定最大宽高比而非强制 1:1 */
.gc-card-media {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;                                    /* 默认 1:1 */
  background: var(--surface-alt);
}

/* 信息栏 */
.gc-card-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  font-size: 10px;
  color: var(--ink3);
  border-top: 1px solid var(--line);
  min-height: 26px;
}
.gc-card-model {
  font-weight: 600;
  color: var(--ink2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}
.gc-card-time {
  flex-shrink: 0;
  white-space: nowrap;
}

/* 类型角标 — 视频/音频有，图片无 */
.gc-card-type-badge {
  position: absolute;
  right: 7px;
  top: 7px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(0,0,0,.5);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  z-index: 2;
}
```

### 2.3 画廊网格间距

```css
/* 间距加大 */
.cp.size-small .cp-gallery-zone  { gap: 8px;  }   /* 原 5px → 8px */
.cp.size-medium .cp-gallery-zone { gap: 12px; }   /* 原 8px → 12px */
.cp.size-large .cp-gallery-zone  { gap: 16px; }   /* 原 10px → 16px */
```

### 2.4 GalleryCard props 扩展

```ts
const props = defineProps<{
  url: string
  type: string
  content?: string
  model?: string          // ← 新增：模型名
  ts?: number             // ← 新增：生成时间戳
  index: number
}>()
```

CreationPanel 传值：
```vue
<GalleryCard
  v-for="(r, i) in displayResults"
  :key="r.ts + '-' + i"
  :url="displayUrl(i, r.url)"
  :type="r.type"
  :content="r.content"
  :model="r.model"
  :ts="r.ts"
  :index="i"
  @preview="openLightbox"
  @reference="referenceResult"
  @delete="deleteResult"
/>
```

时间格式复用现有 `src/utils/timeFormat.ts` 的 `formatRelativeTime(ts)`。

---

## 3. P1 — 视频卡片体验

### 3.1 视频时长角标

在 `<video>` 加载 metadata 后读取 `duration`，显示在右上角类型角标内：

```vue
<div class="gc-card-type-badge" v-if="isVideo">
  <span class="mso" style="font-size:12px">videocam</span>
  <span v-if="videoDuration">{{ formatDuration(videoDuration) }}</span>
</div>
```

```ts
const videoRef = ref<HTMLVideoElement | null>(null)
const videoDuration = ref(0)

function onVideoMeta() {
  if (videoRef.value) videoDuration.value = videoRef.value.duration
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
```

### 3.2 Hover 静音预览

视频卡片 hover 时自动播放（muted），离开时暂停回首帧：

```vue
<video
  ref="videoRef"
  :src="url"
  muted
  loop
  preload="metadata"
  @loadedmetadata="onVideoMeta"
  @mouseenter="videoRef?.play()"
  @mouseleave="pauseAndReset"
/>
```

```ts
function pauseAndReset() {
  if (videoRef.value) {
    videoRef.value.pause()
    videoRef.value.currentTime = 0
  }
}
```

注意：hover 预览只在 `size-medium` 和 `size-large` 模式启用。`size-small` 模式卡片太小，不触发自动播放。

---

## 4. P1 — 音频卡片体验

### 4.1 自绘简约播放器

去掉原生 `<audio>` 控件，改为自绘：

```
div.gc-card-audio
  div.gc-audio-visual            ← 渐变背景 + 图标区
    span.mso  graphic_eq         ← 大图标
    span.gc-audio-title          ← 显示 content（prompt 摘要）
  div.gc-audio-controls          ← 自绘播放条
    button.gc-audio-play-btn     ← 播放/暂停按钮
    div.gc-audio-progress        ← 进度条（可点击跳转）
      div.gc-audio-progress-fill
    span.gc-audio-time           ← 当前/总时长
```

```ts
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)
const audioProgress = ref(0)
const audioDuration = ref(0)
const audioCurrentTime = ref(0)

function toggleAudioPlay(e: Event) {
  e.stopPropagation()
  if (!audioRef.value) return
  if (audioPlaying.value) {
    audioRef.value.pause()
  } else {
    audioRef.value.play()
  }
}

function onAudioTimeUpdate() {
  if (!audioRef.value) return
  audioCurrentTime.value = audioRef.value.currentTime
  audioProgress.value = audioDuration.value > 0
    ? (audioRef.value.currentTime / audioDuration.value) * 100 : 0
}

function seekAudio(e: MouseEvent) {
  e.stopPropagation()
  const bar = e.currentTarget as HTMLElement
  const ratio = e.offsetX / bar.offsetWidth
  if (audioRef.value && audioDuration.value) {
    audioRef.value.currentTime = ratio * audioDuration.value
  }
}
```

样式：
```css
.gc-audio-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 12px;
}
.gc-audio-play-btn {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--olive);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gc-audio-progress {
  flex: 1;
  height: 4px;
  background: rgba(107,142,35,.15);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}
.gc-audio-progress-fill {
  height: 100%;
  background: var(--olive);
  border-radius: 2px;
  transition: width .1s linear;
}
.gc-audio-time {
  font-size: 10px;
  color: var(--ink3);
  flex-shrink: 0;
  min-width: 36px;
  text-align: right;
}
```

### 4.2 音频角标

```vue
<div class="gc-card-type-badge" v-if="isAudio">
  <span class="mso" style="font-size:12px">music_note</span>
  <span v-if="audioDuration">{{ formatDuration(audioDuration) }}</span>
</div>
```

---

## 5. P1 — 灯箱导航

### 5.1 功能

- 左右箭头键切换上一张/下一张
- 点击灯箱左/右区域切换
- 底部显示 `当前索引 / 总数`
- 边界循环（最后一张→第一张）

### 5.2 接口变更

GalleryLightbox.vue 新增 props：

```ts
const props = defineProps<{
  show: boolean
  url: string
  type: string
  content?: string
  model?: string             // ← 新增
  ts?: number                // ← 新增
  currentIndex: number       // ← 新增
  totalCount: number         // ← 新增
}>()

const emit = defineEmits<{
  close: []
  download: []
  prev: []                   // ← 新增
  next: []                   // ← 新增
}>()
```

键盘事件：
```ts
function onKeydown(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft') emit('prev')
  if (e.key === 'ArrowRight') emit('next')
}
```

CreationPanel 侧：
```ts
function lbPrev() {
  if (lbIndex.value > 0) lbIndex.value--
  else lbIndex.value = cpState.results.length - 1
}
function lbNext() {
  if (lbIndex.value < cpState.results.length - 1) lbIndex.value++
  else lbIndex.value = 0
}
```

### 5.3 灯箱信息栏

灯箱底部显示当前结果的模型名 + 时间 + prompt 摘要：

```vue
<div class="lb-info-bar" v-if="model || ts">
  <span class="lb-info-model">{{ model }}</span>
  <span class="lb-info-time" v-if="ts">{{ formatRelativeTime(ts) }}</span>
  <span class="lb-info-index">{{ currentIndex + 1 }} / {{ totalCount }}</span>
</div>
```

---

## 6. P2 — 类型筛选

### 6.1 UI

画廊区顶部（在 availability notice 下方）加一行筛选 tab：

```vue
<div class="cp-gallery-filter">
  <button v-for="f in filterTabs" :key="f.key"
          :class="{ active: activeFilter === f.key }"
          @click="activeFilter = f.key">
    {{ f.label }}
    <span class="cp-filter-count">{{ f.count }}</span>
  </button>
</div>
```

```ts
const activeFilter = ref<'all' | 'image' | 'video' | 'audio' | 'failed'>('all')

const filterTabs = computed(() => [
  { key: 'all', label: '全部', count: cpState.results.length },
  { key: 'image', label: '图片', count: cpState.results.filter(r => r.type === 'image').length },
  { key: 'video', label: '视频', count: cpState.results.filter(r => r.type === 'video').length },
  { key: 'audio', label: '音频', count: cpState.results.filter(r => r.type === 'audio').length },
  { key: 'failed', label: '失败', count: cpState.results.filter(r => r.type === 'failed').length },
])

const displayResults = computed(() => {
  const filtered = activeFilter.value === 'all'
    ? cpState.results
    : cpState.results.filter(r => r.type === activeFilter.value)
  return filtered.slice(0, galleryLimit.value)
})
```

### 6.2 样式

```css
.cp-gallery-filter {
  grid-column: 1 / -1;
  display: flex;
  gap: 4px;
  padding: 2px 0 4px;
}
.cp-gallery-filter button {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: none;
  font-size: 11px;
  color: var(--ink2);
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all .15s;
}
.cp-gallery-filter button.active {
  background: var(--olive);
  color: #fff;
  border-color: var(--olive);
}
.cp-gallery-filter button:hover:not(.active) {
  border-color: var(--olive);
}
.cp-filter-count {
  font-size: 10px;
  opacity: .7;
}
```

---

## 7. P2 — 失败卡片重试

### 7.1 方案

失败卡片操作栏增加"重试"按钮：

```vue
<!-- GalleryCard.vue 操作栏 -->
<button v-if="isFailed" class="gc-act retry" @click.stop="emit('retry', index)" title="重试">
  <span class="mso">refresh</span>
</button>
```

CreationPanel 侧：
```ts
function retryResult(index: number) {
  const r = cpState.results[index]
  if (!r) return
  // 恢复参数到输入区
  if (r.task === 'image' || r.task === 'video' || r.task === 'audio') {
    switchTask(r.task as CreationTask)
  }
  // 恢复 prompt
  if (r.content && r.type === 'failed' && r.content !== r.errorMsg) {
    cpState.prompt = r.content
  }
  // 删除失败卡片
  deleteResult(index)
}
```

重试 = 恢复参数到输入区 + 删除失败卡片。不自动重新提交（用户可能想修改 prompt）。

---

## 8. P2 — 移除 24 条硬限

### 8.1 方案

将 `slice(0, 24)` 改为动态加载：

```ts
const galleryLimit = ref(30)

// 画廊滚动区触底加载更多
function onGalleryScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    galleryLimit.value = Math.min(galleryLimit.value + 30, cpState.results.length)
  }
}
```

```vue
<div class="cp-gallery-zone" @scroll="onGalleryScroll">
```

结合 P6 筛选，`displayResults` 统一管理：

```ts
const displayResults = computed(() => {
  const filtered = activeFilter.value === 'all'
    ? cpState.results
    : cpState.results.filter(r => r.type === activeFilter.value)
  return filtered.slice(0, galleryLimit.value)
})
```

---

## 9. P2 — 右键菜单

### 9.1 方案

GalleryCard 加 `@contextmenu`：

```vue
<div class="gc-card" @click="..." @contextmenu.prevent="emit('contextmenu', index, $event)">
```

CreationPanel 实现一个简单的自定义右键菜单组件（内联实现，不新建文件）：

```ts
const ctxMenu = reactive({ show: false, x: 0, y: 0, index: -1 })

function onCardContextMenu(index: number, e: MouseEvent) {
  ctxMenu.show = true
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.index = index
}
```

菜单项：
- 查看大图
- 引用到输入框
- 下载
- 重试（仅失败卡片）
- 删除

---

## 10. P3 — 批量操作

### 10.1 方案

工具栏加"选择"按钮进入选择模式：

```ts
const selectMode = ref(false)
const selectedIndices = ref<Set<number>>(new Set())

function toggleSelect(index: number) {
  if (selectedIndices.value.has(index)) selectedIndices.value.delete(index)
  else selectedIndices.value.add(index)
}

function selectAll() {
  displayResults.value.forEach((_, i) => selectedIndices.value.add(i))
}

async function batchDelete() {
  const indices = [...selectedIndices.value].sort((a, b) => b - a)
  for (const i of indices) deleteResult(i)
  selectedIndices.value.clear()
  selectMode.value = false
}

async function batchDownload() {
  for (const i of selectedIndices.value) await downloadResult(i)
  selectedIndices.value.clear()
  selectMode.value = false
}
```

GalleryCard 在选择模式下左上角显示 checkbox 而非"已生成"标签。

### 10.2 样式

```css
.gc-card.select-mode { cursor: default; }
.gc-card.selected { outline: 2px solid var(--olive); outline-offset: -2px; }
.gc-select-check {
  position: absolute; left: 7px; top: 7px; z-index: 3;
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.7);
  background: rgba(0,0,0,.3);
  display: flex; align-items: center; justify-content: center;
}
.gc-card.selected .gc-select-check {
  background: var(--olive);
  border-color: var(--olive);
}
```

---

## 11. P3 — 保留原始比例（可选）

### 11.1 方案

GallerySizeControl 增加第四个选项"瀑布流"：

```ts
// GallerySizeControl.vue
const sizes = [
  { key: 'small', icon: 'grid_view', label: '小' },
  { key: 'medium', icon: 'grid_on', label: '中' },
  { key: 'large', icon: 'view_agenda', label: '大' },
  { key: 'masonry', icon: 'dashboard', label: '瀑布' },   // ← 新增
]
```

瀑布流模式下取消 `aspect-ratio: 1`，让卡片按内容自然高度排列。CSS Grid 暂不原生支持 masonry，采用 `columns` 布局：

```css
.cp.size-masonry .cp-gallery-zone {
  display: block;
  columns: 3;
  column-gap: 12px;
}
.cp.size-masonry .gc-card {
  break-inside: avoid;
  margin-bottom: 12px;
}
.cp.size-masonry .gc-card-media {
  aspect-ratio: auto;    /* 取消 1:1，按原始比例 */
}
```

GalleryCard 的 `<img>` 在瀑布流模式下改为 `object-fit: contain` 或直接自然尺寸。

---

## 12. 实施顺序

| 阶段 | 内容 | 改动文件 | 预估行数 |
|------|------|----------|----------|
| **P0-a** | 删除持久化 bug 修复 | `useCreation.ts`, `CreationPanel.vue` | ~40 |
| **P0-b** | 卡片边界感重构（阴影+间距+信息栏+类型角标） | `GalleryCard.vue`, `CreationPanel.vue`, `design-tokens.css` | ~120 |
| **P1-a** | 视频卡片（时长+hover 预览） | `GalleryCard.vue` | ~40 |
| **P1-b** | 音频卡片自绘播放器 | `GalleryCard.vue` | ~80 |
| **P1-c** | 灯箱导航 | `GalleryLightbox.vue`, `CreationPanel.vue` | ~50 |
| **P2-a** | 类型筛选 tab | `CreationPanel.vue` | ~40 |
| **P2-b** | 失败重试 | `GalleryCard.vue`, `CreationPanel.vue` | ~20 |
| **P2-c** | 移除 24 条硬限（滚动加载） | `CreationPanel.vue` | ~15 |
| **P2-d** | 右键菜单 | `GalleryCard.vue`, `CreationPanel.vue` | ~60 |
| **P3-a** | 批量操作 | `GalleryCard.vue`, `CreationPanel.vue` | ~70 |
| **P3-b** | 瀑布流布局 | `GalleryCard.vue`, `GallerySizeControl.vue`, `CreationPanel.vue` | ~30 |

**总计约 ~565 行变更**。建议按 P0 → P1 → P2 → P3 分批提交。

---

## 13. 验收标准

### P0 验收
- [ ] 删除画廊卡片 → 关闭 App → 重新打开 → 已删除的不再出现
- [ ] 卡片之间有明显视觉间距和阴影分隔
- [ ] 每张卡片底部显示模型名和相对时间
- [ ] 视频/音频卡片有类型角标

### P1 验收
- [ ] 视频卡片右上角显示时长
- [ ] hover 视频卡片自动静音播放预览，离开暂停
- [ ] 音频卡片有播放/暂停按钮 + 进度条 + 时长，不出现原生 audio 控件
- [ ] 灯箱可用左右箭头键切换，显示 `N / M` 页码

### P2 验收
- [ ] 画廊顶部有"全部/图片/视频/音频/失败"筛选 tab，数量正确
- [ ] 失败卡片有"重试"按钮，点击后恢复参数到输入区
- [ ] 滚动到底部自动加载更多，不再硬限 24 条
- [ ] 右键卡片弹出上下文菜单

### P3 验收
- [ ] 工具栏"选择"按钮进入多选模式，可批量删除/下载
- [ ] 瀑布流模式下卡片按原始比例显示，不强制 1:1 裁切

---

## 14. 不做的事

- 不改 mediaTaskStore 的核心任务引擎逻辑
- 不改 media-generation.ts 的 API 调用链路
- 不改创作面板的参数输入区和提交流程
- 不新建独立组件文件（右键菜单、筛选栏内联到 CreationPanel）
- 不引入第三方 UI 库（自绘播放器、右键菜单都用原生实现）
