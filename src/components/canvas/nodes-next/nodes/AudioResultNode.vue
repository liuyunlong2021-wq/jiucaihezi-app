<template>
  <div class="arn-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="arn-card" :class="data.selected ? 'arn-selected' : ''">
      <div class="arn-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="arn-header-label" title="双击编辑名称">{{ data.label || '音频' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="arn-header-input" />
        <div class="arn-header-actions">
          <button @click="triggerUpload" class="arn-action-btn" title="上传"><JcIcon name="upload" /></button>
          <button v-if="data.url" @click="handleDownload" class="arn-action-btn" title="下载"><JcIcon name="download" /></button>
          <button @click="handleDuplicate" class="arn-action-btn" title="复制"><JcIcon name="content_copy" /></button>
          <button @click="handleDelete" class="arn-action-btn" title="删除"><JcIcon name="delete" /></button>
        </div>
      </div>
      <div v-if="data.modelId" class="arn-model">{{ data.modelId }}</div>
      <div class="arn-body" @drop.prevent="handleDrop" @dragover.prevent>
        <input ref="fileInput" type="file" accept="audio/*" style="display:none" @change="handleFileSelect" />
        <div v-if="data.loading" class="arn-state arn-loading">
          <div class="arn-spinner-lg"></div>
          <span>生成中...</span>
        </div>
        <div v-else-if="data.error" class="arn-state arn-error-state">
          <JcIcon name="error" style="color:#ef4444;font-size:32px" />
          <span>{{ data.error }}</span>
        </div>
        <div v-else-if="data.url" class="arn-audio-wrap">
          <audio :src="data.url" controls style="width:100%" />
        </div>
        <div v-else class="arn-state arn-empty" @click="triggerUpload">
          <JcIcon name="audio_file" style="color:var(--ink3);font-size:32px" />
          <span>点击或拖拽上传</span>
        </div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="arn-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="audioResult" :operations="operations" @select="handleSelect" />
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
  { type: 'audioGen', label: '音频生成', icon: 'music_note' },
]

function triggerUpload() { fileInput.value?.click() }

function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  canvasStore.updateNodeData(props.id, { url, label: file.name || '音频' })
}

function handleDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('audio/')) return
  const url = URL.createObjectURL(file)
  canvasStore.updateNodeData(props.id, { url, label: file.name || '音频' })
}

const handleDownload = () => {
  if (props.data?.url) { const a = document.createElement('a'); a.href = props.data.url; a.download = 'audio'; a.click() }
}

const handleSelect = (item: NodeHandleOperation) => {
  const cn = canvasStore.nodes.find(n => n.id === props.id)
  const n = canvasStore.addNodeWithData(item.type as any, { label: item.label } as any, { x: (cn?.position?.x || 0) + 380, y: cn?.position?.y || 0 })
  canvasStore.addEdge(props.id, n.id, {}); setTimeout(() => updateNodeInternals([n.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.arn-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.arn-card { position: relative; background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 260px; max-width: 320px; transition: all 0.2s; }
.arn-selected { border-color: #10b981; box-shadow: 0 0 0 1px #10b981, 0 4px 16px color-mix(in srgb, #10b981 20%, transparent); }
.arn-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.arn-header-label { font-size: 13px; font-weight: 500; color: var(--ink); cursor: text; padding: 0 4px; border-radius: 4px; }
.arn-header-label:hover { background: var(--surface); }
.arn-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #10b981; width: 100px; }
.arn-header-actions { display: flex; gap: 1px; }
.arn-action-btn { padding: 2px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.arn-action-btn:hover { background: var(--surface); color: var(--ink); }
.arn-model { padding: 4px 12px; font-size: 11px; color: var(--ink3); }
.arn-body { padding: 12px; }
.arn-state { min-height: 100px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.arn-loading { background: linear-gradient(135deg, #06b6d4, #10b981, #f59e0b); }
.arn-loading span { color: #fff; font-size: 13px; font-weight: 500; }
.arn-error-state { background: color-mix(in srgb, #ef4444 10%, var(--surface)); border: 1px solid color-mix(in srgb, #ef4444 30%, transparent); }
.arn-error-state span { font-size: 12px; color: #ef4444; text-align: center; padding: 0 8px; }
.arn-empty { background: var(--surface); border: 2px dashed var(--border); cursor: pointer; transition: border-color 0.15s; }
.arn-empty:hover { border-color: #10b981; }
.arn-empty span { font-size: 12px; color: var(--ink3); }
.arn-audio-wrap { padding: 8px 0; }
.arn-target-handle { background: #10b981 !important; }
.arn-spinner-lg { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: arn-spin 0.8s linear infinite; }
@keyframes arn-spin { to { transform: rotate(360deg); } }
</style>
