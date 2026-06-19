<template>
  <div class="node-wrapper" @mouseenter="showHandleMenu = true" @mouseleave="showHandleMenu = false">
    <div class="node-card" :class="data.selected ? 'node-selected' : ''">
      <div class="node-header">
        <span v-if="!isEditingLabel" @dblclick="startEditLabel" class="node-label" title="双击编辑名称">{{ data.label || '图片结果' }}</span>
        <input v-else ref="labelInputRef" v-model="editingLabelValue" @blur="finishEditLabel" @keydown.enter="finishEditLabel" @keydown.escape="cancelEditLabel" class="node-label-input" />
        <div class="node-actions">
          <button v-if="data.url" @click="handlePreview" class="node-btn" title="预览"><span class="mso">visibility</span></button>
          <button v-if="data.url" @click="handleDownload" class="node-btn" title="下载"><span class="mso">download</span></button>
          <button @click="handleDuplicate" class="node-btn" title="复制"><span class="mso">content_copy</span></button>
          <button @click="handleDelete" class="node-btn" title="删除"><span class="mso">delete</span></button>
        </div>
      </div>
      <div class="node-body">
        <!-- Loading -->
        <div v-if="data.loading" class="state-box loading-box">
          <div class="v8-spinner-lg"></div>
          <span>生成中...</span>
        </div>
        <!-- Error -->
        <div v-else-if="data.error" class="state-box error-box">
          <span class="mso error-icon">error</span>
          <span>{{ data.error }}</span>
        </div>
        <!-- Image -->
        <div v-else-if="data.url" class="image-wrap">
          <img :src="data.url" :alt="data.label" class="image-preview" @click="handlePreview" />
        </div>
        <!-- Empty -->
        <div v-else class="state-box empty-box">
          <span class="mso empty-icon">image</span>
          <span>等待生成...</span>
        </div>
      </div>
      <Handle type="target" :position="Position.Left" id="left" class="target-handle" />
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
const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref<HTMLInputElement | null>(null)

const operations: NodeHandleOperation[] = [
  { type: 'videoGen', label: '生视频', icon: 'movie' },
  { type: 'imageGen', label: '图生图', icon: 'image' },
]

const handlePreview = () => { if (props.data?.url) window.open(props.data.url, '_blank') }
const handleDownload = () => {
  if (props.data?.url) {
    const a = document.createElement('a'); a.href = props.data.url; a.download = props.data?.label || 'image'; a.click()
  }
}

const handleSelect = (item: NodeHandleOperation) => {
  const currentNode = canvasStore.nodes.find(n => n.id === props.id)
  const newNode = canvasStore.addNodeWithData(item.type as any, {
    label: item.label, prompt: props.data?.url ? `参考图片: ${props.data.url}` : '',
  } as any, { x: (currentNode?.position?.x || 0) + 380, y: currentNode?.position?.y || 0 })
  canvasStore.addEdge(props.id, newNode.id, {})
  setTimeout(() => updateNodeInternals([newNode.id]), 50)
}

const startEditLabel = () => { editingLabelValue.value = props.data?.label || ''; isEditingLabel.value = true; nextTick(() => { labelInputRef.value?.focus(); labelInputRef.value?.select() }) }
const finishEditLabel = () => { const v = editingLabelValue.value.trim(); if (v && v !== props.data?.label) canvasStore.updateNodeData(props.id, { label: v }); isEditingLabel.value = false }
const cancelEditLabel = () => { isEditingLabel.value = false }
const handleDelete = () => canvasStore.deleteNode(props.id)
const handleDuplicate = () => { const n = canvasStore.duplicateNode(props.id); if (n) setTimeout(() => updateNodeInternals([n.id]), 50) }
</script>

<style scoped>
.node-wrapper { padding-right: 50px; padding-top: 20px; position: relative; }
.node-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); min-width: 200px; max-width: 280px; transition: all 0.2s; }
.node-selected { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6, 0 4px 16px color-mix(in srgb, #3b82f6 20%, transparent); }
.node-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.node-label { font-size: 13px; font-weight: 500; color: var(--ink); cursor: text; padding: 0 4px; border-radius: 4px; }
.node-label:hover { background: var(--surface); }
.node-label-input { font-size: 13px; font-weight: 500; background: var(--surface); color: var(--ink); padding: 0 4px; border-radius: 4px; outline: none; border: 1px solid #3b82f6; width: 100px; }
.node-actions { display: flex; gap: 2px; }
.node-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.node-btn:hover { background: var(--surface); color: var(--ink); }
.node-btn .mso { font-size: 14px; }
.node-body { padding: 12px; }
.state-box { aspect-ratio: 1; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.loading-box { background: linear-gradient(135deg, #06b6d4, #3b82f6, #f59e0b); }
.loading-box span { color: #fff; font-size: 13px; font-weight: 500; }
.error-box { background: color-mix(in srgb, #ef4444 10%, var(--surface)); border: 1px solid color-mix(in srgb, #ef4444 30%, transparent); }
.error-box span { font-size: 12px; color: #ef4444; text-align: center; padding: 0 8px; }
.error-icon { font-size: 32px !important; }
.empty-box { background: var(--surface); border: 2px dashed var(--border); }
.empty-icon { font-size: 32px !important; color: var(--ink3); }
.empty-box span { font-size: 12px; color: var(--ink3); }
.image-wrap { border-radius: 12px; overflow: hidden; }
.image-preview { width: 100%; height: auto; object-fit: cover; cursor: pointer; }
.target-handle { background: #3b82f6 !important; }
.v8-spinner-lg { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: v8-spin 0.8s linear infinite; }
@keyframes v8-spin { to { transform: rotate(360deg); } }
</style>
