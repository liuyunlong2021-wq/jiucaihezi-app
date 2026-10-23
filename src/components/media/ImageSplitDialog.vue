<script setup lang="ts">
/**
 * ImageSplitDialog — 把一张成图按网格切开（MJ 四宫格默认 2×2）。
 * 宿主负责落地：调用方拿到 File[] 后存进「图片」目录并排队进画布。
 */
import { computed, ref, watch } from 'vue'
import { fetchCreationMediaBlob } from '@/utils/creationMediaCache'
import { resolveJcMediaUrl } from '@/utils/mediaFileReader'
import { cropImageTiles, IMAGE_SPLIT_GRIDS, imageSplitLabel, imageSplitRects, type ImageSplitGrid } from '@/utils/imageGridSplit'

const props = defineProps<{
  show: boolean
  url: string
  title?: string
  /** 项目文件的字节读取器：有它就不猜 URL 协议，直接读盘，canvas 永不被污染。 */
  blobLoader?: () => Promise<Blob>
}>()

const emit = defineEmits<{
  close: []
  split: [files: File[]]
}>()

const objectUrl = ref('')
const naturalWidth = ref(0)
const naturalHeight = ref(0)
const grid = ref<ImageSplitGrid>(IMAGE_SPLIT_GRIDS[0])
const selected = ref<Set<number>>(new Set())
const error = ref('')
const loading = ref(false)
const splitting = ref(false)

const rects = computed(() => imageSplitRects(naturalWidth.value, naturalHeight.value, grid.value))
const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => rects.value.length > 0 && selected.value.size === rects.value.length)

watch(
  () => [props.show, props.url] as const,
  async ([show, url]) => {
    if (!show || !url) return
    error.value = ''
    loading.value = true
    naturalWidth.value = 0
    naturalHeight.value = 0
    releaseObjectUrl()
    try {
      // 必须拿到字节再画：直接拿远端 http 图片画进 canvas 会被跨域污染，toBlob 会抛 SecurityError。
      const blob = await loadBlob(url)
      objectUrl.value = URL.createObjectURL(blob)
      const image = await loadImage(objectUrl.value)
      naturalWidth.value = image.naturalWidth
      naturalHeight.value = image.naturalHeight
      selectAll()
    } catch (cause) {
      error.value = `读取图片失败：${cause instanceof Error ? cause.message : String(cause)}`
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

/**
 * 图片字节的唯一入口：先按项目/本机地址解析，再退到创作结果缓存（带渠道鉴权头）。
 * 两条都不行就报错，绝不静默画一张被污染的图。
 */
async function loadBlob(url: string): Promise<Blob> {
  if (props.blobLoader) return props.blobLoader()
  const resolved = await resolveJcMediaUrl(url)
  try {
    const response = await fetch(resolved)
    if (response.ok) return await response.blob()
  } catch {
    /* 自定义协议（asset:）或跨域会 throw，继续走下面的分支 */
  }
  // 远端结果图：带渠道鉴权头取字节，顺便确认地址在白名单内
  if (/^https?:/i.test(resolved)) {
    const { blob } = await fetchCreationMediaBlob(resolved, 'image', true)
    return blob
  }
  throw new Error('无法读取图片内容')
}

function releaseObjectUrl() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = ''
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法解码'))
    image.src = src
  })
}

function selectAll() {
  selected.value = new Set(rects.value.map(rect => rect.index))
}

function toggleTile(index: number) {
  const next = new Set(selected.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  selected.value = next
}

function chooseGrid(next: ImageSplitGrid) {
  grid.value = next
  selectAll()
}

async function confirmSplit() {
  if (!objectUrl.value || !selectedCount.value) return
  splitting.value = true
  error.value = ''
  try {
    const blob = await loadBlob(props.url)
    const base = String(props.title || 'image').replace(/\.[^.]+$/, '') || 'image'
    const files = await cropImageTiles(blob, grid.value, [...selected.value].sort((left, right) => left - right), base)
    emit('split', files)
  } catch (cause) {
    error.value = `切图失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    splitting.value = false
  }
}

function close() {
  releaseObjectUrl()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="isd-overlay" @click.self="close">
      <section class="isd-card" role="dialog" aria-label="切图">
        <header class="isd-head">
          <JcIcon name="grid-view" />
          <strong>切图 · 按格子拆成独立图片</strong>
          <span v-if="title" class="isd-title" :title="title">{{ title }}</span>
          <button class="isd-close" type="button" title="关闭" @click="close"><JcIcon name="close" /></button>
        </header>
        <div class="isd-grid-bar">
          <button
            v-for="option in IMAGE_SPLIT_GRIDS"
            :key="imageSplitLabel(option)"
            class="isd-grid-btn"
            type="button"
            :class="{ active: option.rows === grid.rows && option.cols === grid.cols }"
            @click="chooseGrid(option)"
          >{{ imageSplitLabel(option) }}</button>
          <button class="isd-grid-btn" type="button" :disabled="allSelected" @click="selectAll">全选</button>
          <span class="isd-count">已选 {{ selectedCount }} / {{ rects.length }}</span>
        </div>
        <div class="isd-stage">
          <div v-if="objectUrl && naturalWidth" class="isd-image-wrap">
            <img class="isd-image" :src="objectUrl" alt="" />
            <button
              v-for="rect in rects"
              :key="rect.index"
              class="isd-tile"
              type="button"
              :class="{ selected: selected.has(rect.index) }"
              :style="{
                left: `${(rect.x / naturalWidth) * 100}%`,
                top: `${(rect.y / naturalHeight) * 100}%`,
                width: `${(rect.width / naturalWidth) * 100}%`,
                height: `${(rect.height / naturalHeight) * 100}%`,
              }"
              :title="`第 ${rect.index} 格（${rect.width}×${rect.height}）`"
              @click="toggleTile(rect.index)"
            >
              <span class="isd-tile-index">{{ rect.index }}</span>
            </button>
          </div>
          <p v-else-if="loading" class="isd-status">读取图片中…</p>
          <p v-else class="isd-status">{{ error || '没有可切的图片' }}</p>
        </div>
        <footer class="isd-foot">
          <p class="isd-hint">点格子选中/取消。切完存入项目「图片」目录，并排队加入画布。</p>
          <button class="isd-cancel" type="button" @click="close">取消</button>
          <button class="isd-primary" type="button" :disabled="splitting || !selectedCount" @click="confirmSplit">
            <JcIcon name="grid-view" />{{ splitting ? '切图中…' : `保存 ${selectedCount} 张` }}
          </button>
        </footer>
        <p v-if="error" class="isd-error">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.isd-overlay { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .6); backdrop-filter: blur(4px); }
.isd-card { display: flex; width: min(920px, 94vw); max-height: 92vh; flex-direction: column; overflow: hidden; border-radius: 14px; background: #fff; box-shadow: 0 24px 64px rgba(0, 0, 0, .35); }
.isd-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e5e5e5); }
.isd-head strong { color: var(--ink, #111); font-size: calc(var(--font-base, 14px) + 1px); }
.isd-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink3, #999); font-size: calc(var(--font-base, 14px) - 2px); }
.isd-close { display: grid; width: 28px; height: 28px; flex: 0 0 28px; margin-left: auto; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--ink3, #999); cursor: pointer; }
.isd-close:hover { background: rgba(0, 0, 0, .06); }
.isd-grid-bar { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--line, #eee); }
.isd-grid-btn { padding: 4px 10px; border: 1px solid var(--line, #ddd); border-radius: 8px; background: #fff; color: var(--ink2, #444); font-size: calc(var(--font-base, 14px) - 2px); cursor: pointer; }
.isd-grid-btn.active { border-color: var(--olive, #6b7f3a); background: rgba(107, 127, 58, .1); color: var(--olive, #6b7f3a); }
.isd-grid-btn:disabled { opacity: .5; cursor: default; }
.isd-count { margin-left: auto; color: var(--ink3, #999); font-size: calc(var(--font-base, 14px) - 2px); font-variant-numeric: tabular-nums; }
.isd-stage { display: flex; min-height: 240px; flex: 1; align-items: center; justify-content: center; overflow: auto; padding: 12px; background: #0c0c0c; }
.isd-image-wrap { position: relative; max-width: 100%; max-height: 58vh; }
.isd-image { display: block; max-width: 100%; max-height: 58vh; }
.isd-tile { position: absolute; display: grid; place-items: center; border: 2px solid transparent; background: rgba(255, 255, 255, .04); cursor: pointer; transition: background .12s ease; }
.isd-tile:hover { background: rgba(255, 255, 255, .16); }
.isd-tile.selected { border-color: var(--olive, #9ac05a); background: rgba(154, 192, 90, .18); }
.isd-tile-index { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; font-size: 12px; }
.isd-tile.selected .isd-tile-index { background: var(--olive, #6b7f3a); }
.isd-status { color: #bbb; font-size: calc(var(--font-base, 14px) - 1px); }
.isd-foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px 14px; border-top: 1px solid var(--line, #eee); }
.isd-hint { min-width: 0; margin: 0; color: var(--ink3, #999); font-size: calc(var(--font-base, 14px) - 2px); }
.isd-cancel { margin-left: auto; padding: 7px 14px; border: 1px solid var(--line, #ddd); border-radius: 9px; background: #fff; color: var(--ink2, #444); cursor: pointer; }
.isd-primary { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 0; border-radius: 10px; background: var(--olive, #6b7f3a); color: #fff; font-size: calc(var(--font-base, 14px) - 1px); cursor: pointer; }
.isd-primary:disabled { opacity: .5; cursor: default; }
.isd-error { margin: 0; padding: 0 16px 12px; color: #c0392b; font-size: calc(var(--font-base, 14px) - 2px); }
</style>
