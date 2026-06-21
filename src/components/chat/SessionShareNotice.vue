<script setup lang="ts">
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { openExternal } from '@/utils/httpClient'

const props = defineProps<{
  url: string
}>()

const emit = defineEmits<{
  (e: 'dismiss'): void
}>()

const copyLabel = ref('复制链接')

async function copyShareUrl() {
  if (!props.url) return
  try {
    await invoke('write_clipboard_text', { text: props.url })
    copyLabel.value = '已复制'
  } catch {
    try {
      await navigator.clipboard?.writeText(props.url)
      copyLabel.value = '已复制'
    } catch {
      copyLabel.value = '复制失败'
    }
  }
  setTimeout(() => { copyLabel.value = '复制链接' }, 1400)
}

async function openShareUrl() {
  if (!props.url) return
  await openExternal(props.url)
}

watch(() => props.url, (url) => {
  if (url) void copyShareUrl()
}, { immediate: true })
</script>

<template>
  <div v-if="url" class="session-share-notice">
    <JcIcon name="ios_share" class="session-share-icon" />
    <div class="session-share-main">
      <strong>分享链接已生成</strong>
      <span>{{ url }}</span>
    </div>
    <button type="button" @click="copyShareUrl">{{ copyLabel }}</button>
    <button type="button" @click="openShareUrl">打开</button>
    <button type="button" class="icon" aria-label="关闭分享提示" @click="emit('dismiss')">
      <JcIcon name="close" />
    </button>
  </div>
</template>

<style scoped>
.session-share-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 86%, var(--olive-pale));
  color: var(--ink2);
}
.session-share-icon {
  color: var(--olive-dark);
  font-size: 17px;
}
.session-share-main {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 1px;
}
.session-share-main strong {
  color: var(--ink1);
  font-size: 12px;
}
.session-share-main span {
  color: var(--ink3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-share-notice button {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
  padding: 4px 7px;
}
.session-share-notice button:hover,
.session-share-notice button:focus-visible {
  border-color: var(--olive);
  color: var(--olive-dark);
  outline: none;
}
.session-share-notice button.icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
}
.session-share-notice button.icon .mso {
  font-size: 15px;
}
</style>
