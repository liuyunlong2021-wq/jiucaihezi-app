<script setup lang="ts">
/**
 * 项目统一图标组件 · facade pattern
 *
 * Phase 2C：内部切换为 Iconify SVG 渲染，告别 3.5MB Material Symbols 字体。
 * 对外 API 不变——所有 <JcIcon name="..." /> 调用无需改动。
 *
 * 用法：
 *   <JcIcon name="add_circle" />          基础（outlined）
 *   <JcIcon name="favorite" fill />        填充变体
 *   <JcIcon name="close" class="text-red" />  透传 class / style / 事件等
 */
import { Icon } from '@iconify/vue'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  fill?: boolean
}>()

/**
 * Material Symbols 在 Iconify 中使用 kebab-case 命名。
 * 例如：add_circle → add-circle，photo_camera → photo-camera
 */
function toKebab(name: string): string {
  return name.replace(/_/g, '-')
}

/** Material Symbols 命名与 Iconify 不完全对齐的极少数图标 */
const ICON_ALIAS: Record<string, string> = {
  'collections': 'collections-bookmark',
  'file_import': 'file-download',
  'folder_search': 'folder-managed',
  'save_alt': 'save-as',
  'source': 'source-environment',
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

