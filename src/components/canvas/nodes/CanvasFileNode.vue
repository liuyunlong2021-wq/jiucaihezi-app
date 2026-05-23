<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { CanvasFileNodeData } from '@/types/canvas'
import { useCanvasStore } from '@/stores/canvasStore'
import { useFileStore } from '@/composables/useFileStore'

const props = defineProps<{ id: string; data: CanvasFileNodeData; selected?: boolean }>()

const canvasStore = useCanvasStore()
const fileStore = useFileStore()

const selectableFiles = computed(() => fileStore.files.value.filter(file => file.mimeType !== 'folder'))

onMounted(() => {
  void fileStore.loadAll()
})

function preview(content: string): string {
  return String(content || '').trim().slice(0, 260)
}

async function selectStoredFile(event: Event) {
  const fileId = (event.target as HTMLSelectElement).value
  const file = fileId ? await fileStore.getFile(fileId) : undefined
  canvasStore.updateNodeData(props.id, {
    fileId,
    fileName: file?.name || '',
    fileCategory: file?.category || '',
    sourcePath: '',
    contentPreview: file ? preview(file.content) : '',
  })
}

async function selectLocalFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    title: '选择画布文件',
  })
  if (typeof selected !== 'string' || !selected.trim()) return
  const name = selected.split(/[\\/]/).filter(Boolean).at(-1) || selected
  canvasStore.updateNodeData(props.id, {
    fileId: '',
    fileName: name,
    fileCategory: 'local',
    sourcePath: selected,
    contentPreview: selected,
  })
}
</script>

<template>
  <div class="cv-node" :class="{ selected }">
    <Handle type="target" :position="Position.Left" />
    <div class="cv-node-head">
      <span class="mso">draft</span>
      <span>{{ data.label }}</span>
    </div>
    <div class="cv-body">
      <select @pointerdown.stop class="cv-input" :value="data.fileId || ''" @change="selectStoredFile">
        <option value="">选择文件区文件</option>
        <option v-for="file in selectableFiles" :key="file.id" :value="file.id">{{ file.name }}</option>
      </select>
      <button @pointerdown.stop class="cv-local-btn" @click="selectLocalFile">
        <span class="mso">attach_file</span>
        选择本地文件
      </button>
      <div class="cv-file-name">{{ data.fileName || data.fileId || '未选择文件' }}</div>
      <div v-if="data.contentPreview" class="cv-preview">{{ data.contentPreview }}</div>
      <div v-else class="cv-empty">文件内容会作为下游输入</div>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { width:240px; border:1px solid var(--border); background:var(--paper); border-radius:8px; box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:hidden; }
.cv-node.selected { border-color:var(--olive-dark); box-shadow:0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node-head { height:34px; display:flex; align-items:center; gap:6px; padding:0 10px; border-bottom:1px solid var(--border2); font-size:12px; font-weight:700; }
.cv-node-head .mso { font-size:16px; color:var(--olive-dark); }
.cv-body { padding:10px; font-size:12px; display:flex; flex-direction:column; gap:8px; }
.cv-input { height:28px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink1); padding:0 8px; font:inherit; font-size:12px; }
.cv-local-btn { height:28px; display:flex; align-items:center; justify-content:center; gap:5px; border:1px solid var(--border); border-radius:6px; background:var(--surface-alt); color:var(--ink2); font:inherit; font-size:12px; cursor:pointer; }
.cv-local-btn .mso { font-size:16px; }
.cv-file-name { font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cv-preview { max-height:96px; overflow:auto; white-space:pre-wrap; color:var(--ink2); line-height:1.5; }
.cv-empty { color:var(--ink3); }
</style>
