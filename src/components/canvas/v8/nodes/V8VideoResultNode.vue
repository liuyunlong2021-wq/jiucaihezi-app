<template>
  <div class="vrn-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="vrn-card" :class="data.selected ? 'vrn-selected' : ''">
      <div class="vrn-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="vrn-header-label" title="双击编辑名称">{{ data.label || '视频' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="vrn-header-input" />
        <div class="vrn-header-actions">
          <button @click="triggerUpload" class="vrn-action-btn" title="上传"><span class="mso" style="font-size:12px">upload</span></button>
          <button v-if="data.url" @click="handleDownload" class="vrn-action-btn" title="下载"><span class="mso" style="font-size:12px">download</span></button>
          <button @click="handleDuplicate" class="vrn-action-btn" title="复制"><span class="mso" style="font-size:12px">content_copy</span></button>
          <button @click="handleDelete" class="vrn-action-btn" title="删除"><span class="mso" style="font-size:12px">delete</span></button>
        </div>
      </div>
      <div v-if="data.modelId" class="vrn-model">{{ data.modelId }}</div>
      <div class="vrn-body" @drop.prevent="handleDrop" @dragover.prevent>
        <input ref="fileInput" type="file" accept="video/*" style="display:none" @change="handleFileSelect" />
        <div v-if="data.loading" class="vrn-state vrn-loading">
          <div class="vrn-spinner-lg"></div>
          <span>生成中...</span>
        </div>
        <div v-else-if="data.error" class="vrn-state vrn-error-state">
          <span class="mso" style="font-size:32px;color:#ef4444">error</span>
          <span>{{ data.error }}</span>
        </div>
        <div v-else-if="data.url" class="vrn-video-wrap">
          <video :src="data.url" controls class="vrn-video" />
        </div>
        <div v-else class="vrn-state vrn-empty" @click="triggerUpload">
          <span class="mso" style="font-size:32px;color:var(--ink3)">video_library</span>
          <span>点击或拖拽上传</span>
        </div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="vrn-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="videoResult" :operations="operations" @select="handleSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import NodeHandleMenu from '../shared/NodeHandleMenu.vue'
import type { NodeHandleOperation } from '../shared/NodeHandleMenu.vue'
import { useCanvasStore } from '@/stores/canvasStore'

const props = defineProps<{ id: string; data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const { updateNodeInternals } = useVueFlow()

const showHandleMenu = ref(false)
const isEditingLabel = ref(false); const editingLabelValue = ref(''); const labelInputRef = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const operations: NodeHandleOperation[] = [
  { type: 'imageGen', label: '图生图', icon: 'image' },
  { type: 'videoGen', label: '图生视频', icon: 'movie' },
]

function triggerUpload() { fileInput.value?.click() }

function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  canvasStore.updateNodeData(props.id, { url, label: file.name || '视频' })
}

function handleDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('video/')) return
  const url = URL.createObjectURL(file)
  canvasStore.updateNodeData(props.id, { url, label: file.name || '视频' })
}

const handleDownload = () => {
  if (props.data?.url) { const a = document.createElement('a'); a.href = props.data.url; a.download = 'video'; a.click() }
}

const handleSelect = (item: NodeHandleOperation) => {
  const cn = canvasStore.nodes.find(n => n.id === props.id)
  const n = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, { x: (cn?.position?.x || 0) + 420, y: cn?.position?.y || 0 })
  canvasStore.addEdge(props.id, n.id, {}); setTimeout(() => updateNodeInternals([n.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.vrn-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.vrn-card { position: relative; background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 320px; max-width: 400px; transition: all 0.2s; }
.vrn-selected { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b, 0 4px 16px color-mix(in srgb, #f59e0b 20%, transparent); }
.vrn-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.vrn-header-label { font-size: 13px; font-weight: 500; color: var(--ink); cursor: text; padding: 0 4px; border-radius: 4px; }
.vrn-header-label:hover { background: var(--surface); }
.vrn-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #f59e0b; width: 100px; }
.vrn-header-actions { display: flex; gap: 1px; }
.vrn-action-btn { padding: 2px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.vrn-action-btn:hover { background: var(--surface); color: var(--ink); }
.vrn-model { padding: 4px 12px; font-size: 11px; color: var(--ink3); }
.vrn-body { padding: 12px; }
.vrn-state { aspect-ratio: 16/9; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.vrn-loading { background: linear-gradient(135deg, #06b6d4, #3b82f6, #f59e0b); }
.vrn-loading span { color: #fff; font-size: 13px; font-weight: 500; }
.vrn-error-state { background: color-mix(in srgb, #ef4444 10%, var(--surface)); border: 1px solid color-mix(in srgb, #ef4444 30%, transparent); }
.vrn-error-state span { font-size: 12px; color: #ef4444; text-align: center; padding: 0 8px; }
.vrn-empty { background: var(--surface); border: 2px dashed var(--border); cursor: pointer; transition: border-color 0.15s; }
.vrn-empty:hover { border-color: #f59e0b; }
.vrn-empty span { font-size: 12px; color: var(--ink3); }
.vrn-video-wrap { border-radius: 12px; overflow: hidden; background: #000; }
.vrn-video { width: 100%; aspect-ratio: 16/9; object-fit: contain; }
.vrn-target-handle { background: #f59e0b !important; }
.vrn-spinner-lg { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: vrn-spin 0.8s linear infinite; }
@keyframes vrn-spin { to { transform: rotate(360deg); } }
</style>
