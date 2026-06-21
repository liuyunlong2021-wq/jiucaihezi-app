<script lang="ts">
/**
 * 模块加载时一次性注入本地图标 bundle，全局生效。
 * 这块用普通 <script>（非 setup），保证 addCollection 只跑一次。
 */
import { addCollection } from '@iconify/vue'
import iconBundle from '@/assets/icons-bundle.json'

addCollection(iconBundle as Parameters<typeof addCollection>[0])
</script>

<script setup lang="ts">
/**
 * 项目统一图标组件 · facade pattern
 *
 * Offline mode：所有图标 SVG 数据在 build 时打包进 src/assets/icons-bundle.json，
 * 运行时不发任何外部请求。CSP 不需要放行 api.iconify.design。
 *
 * 用法：
 *   <JcIcon name="add_circle" />            基础（outlined）
 *   <JcIcon name="favorite" fill />          填充变体
 *   <JcIcon name="close" class="text-red" /> 透传 class / style / 事件等
 */
import { Icon } from '@iconify/vue'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  fill?: boolean
}>()

/**
 * Material Symbols 在 Iconify 中使用 kebab-case 命名。
 * 例：add_circle → add-circle
 */
function toKebab(name: string): string {
  return name.replace(/_/g, '-')
}

/**
 * Material Symbols 命名与 Iconify 不完全对齐的极少数图标。
 * ⚠️ 修改此处时必须同步修改 scripts/bundle-icons.mjs 的 ICON_ALIAS，否则 bundle 里没有该图标数据。
 */
const ICON_ALIAS: Record<string, string> = {
  'collections': 'collections-bookmark',
  'file_download': 'download',
  'file_import': 'download',
  'file_upload': 'upload-file',
  'film_frames': 'movie',
  'folder_search': 'folder-managed',
  'save_alt': 'save-as',
  'source': 'source-environment',
  'view_agenda': 'view-list',
}

const iconId = computed(() => {
  const kebab = toKebab(props.name)
  const resolved = ICON_ALIAS[props.name] ?? kebab
  return props.fill
    ? `material-symbols:${resolved}?fill=1`
    : `material-symbols:${resolved}`
})
</script>

<template>
  <Icon :icon="iconId" />
</template>

