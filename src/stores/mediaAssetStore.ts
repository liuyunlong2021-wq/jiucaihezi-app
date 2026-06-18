/**
 * mediaAssetStore.ts — P1 媒体资产画廊 Store
 *
 * 职责：
 * - 维护 media_assets 表的分页查询
 * - 创作面板画廊列表的主数据源（替代扫 documents 全表）
 * - 按 source（chat/creation/canvas）过滤
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { queryMediaAssets, type MediaAssetRow } from '@/utils/idb'

export const useMediaAssetStore = defineStore('mediaAssets', () => {
  const assets = ref<MediaAssetRow[]>([])
  const loading = ref(false)
  const hasMore = ref(true)
  const currentSource = ref<string | null>(null)
  const currentPage = ref(0)

  const PAGE_SIZE = 30

  /** 加载画廊首页（重置） */
  async function loadGallery(source?: string, mimePrefix?: string) {
    loading.value = true
    currentPage.value = 0
    currentSource.value = source ?? null
    try {
      const rows = await queryMediaAssets({
        source: source ?? undefined,
        mimePrefix,
        limit: PAGE_SIZE,
        offset: 0,
      })
      assets.value = rows
      hasMore.value = rows.length >= PAGE_SIZE
    } finally {
      loading.value = false
    }
  }

  /** 加载下一页 */
  async function loadMore() {
    if (loading.value || !hasMore.value) return
    loading.value = true
    const nextPage = currentPage.value + 1
    try {
      const rows = await queryMediaAssets({
        source: currentSource.value ?? undefined,
        limit: PAGE_SIZE,
        offset: nextPage * PAGE_SIZE,
      })
      if (rows.length > 0) {
        assets.value.push(...rows)
        currentPage.value = nextPage
      }
      hasMore.value = rows.length >= PAGE_SIZE
    } finally {
      loading.value = false
    }
  }

  /** 创作画廊：图片 */
  async function loadCreationImages() {
    return loadGallery('creation', 'image/')
  }

  /** 创作画廊：视频 */
  async function loadCreationVideos() {
    return loadGallery('creation', 'video/')
  }

  /** 创作画廊：全部 */
  async function loadCreationAll() {
    return loadGallery('creation')
  }

  /** 对话图片列表 */
  async function loadChatImages() {
    return loadGallery('chat', 'image/')
  }

  return {
    assets,
    loading,
    hasMore,
    loadGallery,
    loadMore,
    loadCreationImages,
    loadCreationVideos,
    loadCreationAll,
    loadChatImages,
  }
})
