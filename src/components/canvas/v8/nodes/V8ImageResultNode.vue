<template>
  <div class="irn-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="irn-card" :class="data.selected ? 'irn-selected' : ''">
      <div class="irn-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="irn-header-label" title="双击编辑名称">{{ data.label || '图片结果' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="irn-header-input" />
        <div class="irn-header-actions">
          <button v-if="data.url" @click="handlePreview" class="irn-action-btn" title="预览"><span class="mso" style="font-size:14px">visibility</span></button>
          <button v-if="data.url" @click="handleDownload" class="irn-action-btn" title="下载"><span class="mso" style="font-size:14px">download</span></button>
          <button @click="handleDuplicate" class="irn-action-btn" title="复制"><span class="mso" style="font-size:14px">content_copy</span></button>
          <button @click="handleDelete" class="irn-action-btn" title="删除"><span class="mso" style="font-size:14px">delete</span></button>
        </div>
      </div>
      <div v-if="data.model" class="irn-model">{{ data.model }}</div>
      <div class="irn-body">
        <div v-if="data.loading" class="irn-state irn-loading">
          <div class="irn-spinner-lg"></div>
          <span>生成中...</span>
        </div>
        <div v-else-if="data.error" class="irn-state irn-error-state">
          <span class="mso" style="font-size:32px;color:#ef4444">error</span>
          <span>{{ data.error }}</span>
        </div>
        <div v-else-if="data.url" class="irn-image-wrap">
          <img :src="data.url" :alt="data.label" class="irn-image" @click="handlePreview" />
        </div>
        <div v-else class="irn-state irn-empty">
          <span class="mso" style="font-size:32px;color:var(--ink3)">image</span>
          <span>等待生成...</span>
        </div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="irn-target-handle" />
      <NodeHandleMenu :nodeId="id" nodeType="imageResult" :operations="operations" @select="handleSelect" />
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

const operations: NodeHandleOperation[] = [
  { type: 'videoGen', label: '图生视频', icon: 'movie' },
  { type: 'imageGen', label: '图生图', icon: 'image' },
]

const handlePreview = () => { if (props.data?.url) window.open(props.data.url, '_blank') }
const handleDownload = () => { if (props.data?.url) { const a = document.createElement('a'); a.href = props.data.url; a.download = props.data?.label || 'image'; a.click() } }

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
.irn-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.irn-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 200px; max-width: 280px; transition: all 0.2s; }
.irn-selected { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6, 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent); }
.irn-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.irn-header-label { font-size: 13px; font-weight: 500; color: var(--ink); cursor: text; padding: 0 4px; border-radius: 4px; }
.irn-header-label:hover { background: var(--surface); }
.irn-header-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #3b82f6; width: 100px; }
.irn-header-actions { display: flex; gap: 2px; }
.irn-action-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.irn-action-btn:hover { background: var(--surface); color: var(--ink); }
.irn-model { padding: 4px 12px; font-size: 11px; color: var(--ink3); }
.irn-body { padding: 12px; }
.irn-state { aspect-ratio: 1; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.irn-loading { background: linear-gradient(135deg, #06b6d4, #3b82f6, #f59e0b); }
.irn-loading span { color: #fff; font-size: 13px; font-weight: 500; }
.irn-error-state { background: color-mix(in srgb, #ef4444 10%, var(--surface)); border: 1px solid color-mix(in srgb, #ef4444 30%, transparent); }
.irn-error-state span { font-size: 12px; color: #ef4444; text-align: center; padding: 0 8px; }
.irn-empty { background: var(--surface); border: 2px dashed var(--border); }
.irn-empty span { font-size: 12px; color: var(--ink3); }
.irn-image-wrap { border-radius: 12px; overflow: hidden; }
.irn-image { width: 100%; height: auto; object-fit: cover; cursor: pointer; display: block; }
.irn-target-handle { background: #3b82f6 !important; }
.irn-spinner-lg { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: irn-spin 0.8s linear infinite; }
@keyframes irn-spin { to { transform: rotate(360deg); } }
</style>
