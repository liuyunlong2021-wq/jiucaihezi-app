<script setup lang="ts">
/**
 * EditorTabs — 编辑区多文件 Tab 栏
 * 对标 VS Code 的 Tab 体验
 */
import { computed } from 'vue'

export interface EditorTab {
  id: string            // unique key: filePath or 'sqlite:'+fileId
  title: string         // display name
  filePath?: string     // disk path (if from disk)
  fileId?: string       // SQLite id (if from SQLite)
  dirty?: boolean       // unsaved changes
}

const props = defineProps<{
  tabs: EditorTab[]
  activeTabId: string | null
}>()

const emit = defineEmits<{
  (e: 'selectTab', tabId: string): void
  (e: 'closeTab', tabId: string): void
}>()

const hasTabs = computed(() => props.tabs.length > 0)
</script>

<template>
  <div v-if="hasTabs" class="et-bar">
    <div class="et-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="et-tab"
        :class="{ active: tab.id === activeTabId }"
        :title="tab.filePath || tab.title"
        @click="emit('selectTab', tab.id)"
      >
        <span v-if="tab.dirty" class="et-dirty">●</span>
        <span class="et-title">{{ tab.title }}</span>
        <button
          class="et-close"
          @click.stop="emit('closeTab', tab.id)"
          title="关闭"
        >×</button>
      </button>
    </div>
  </div>
</template>

<style scoped>
.et-bar {
  display: flex;
  align-items: center;
  background: var(--surface-alt);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  flex-shrink: 0;
}
.et-tabs {
  display: flex;
  gap: 0;
  padding: 2px 6px 0;
}
.et-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--ink3);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all .12s;
  white-space: nowrap;
  max-width: 160px;
}
.et-tab:hover {
  background: var(--olive-pale);
  color: var(--ink2);
}
.et-tab.active {
  background: var(--surface);
  color: var(--ink1);
  font-weight: 650;
  border-color: var(--line);
}
.et-dirty {
  color: var(--olive-dark);
  font-size: 8px;
}
.et-title {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.et-close {
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  border-radius: 3px;
  font-size: 13px;
  line-height: 1;
  color: var(--ink3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity .1s;
}
.et-tab:hover .et-close,
.et-tab.active .et-close {
  opacity: 1;
}
.et-close:hover {
  background: rgba(229,57,53,.10);
  color: #e53935;
}
</style>
