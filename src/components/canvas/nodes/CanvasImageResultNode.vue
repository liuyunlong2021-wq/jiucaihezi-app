<script setup lang="ts">
/**
 * CanvasImageResultNode — Phase B 重写，对齐 T8 OutputNode 的图像展示
 *
 * 功能: 显示生成/上传的图片、下载、删除、拖拽源、上传替换
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { useMaterialDragSource } from '@/canvas/composables/useMaterialDragSource'
import { type MaterialPayload } from '@/stores/canvasDragMaterialStore'
import { uploadFile } from '@/canvas/services/canvasGeneration'
import type { CanvasMediaAsset } from '@/canvas/types/mediaAsset'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const cs = useCanvasStore()
const d = computed(() => props.data || {})
const url = computed(() => d.value.url || d.value.imageUrl || '')
const prompt = computed(() => d.value.prompt || d.value.label || '')
const taskId = computed(() => d.value.taskId || '')

function patch(p: any) { cs.updateNodeData(props.id, p) }

// 拖拽源
const onDragStart = useMaterialDragSource(() => ({
  kind: 'image', url: url.value, sourceNodeId: props.id, previewUrl: url.value,
} as MaterialPayload))

// 下载
async function handleDownload() {
  if (!url.value) return
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url.value)
  } catch { window.open(url.value, '_blank') }
}

// 删除节点
function handleDelete() {
  const { nodes, edges } = cs
  cs.replaceNodes(nodes.filter(n => n.id !== props.id))
  cs.replaceEdges(edges.filter(e => e.source !== props.id && e.target !== props.id))
}

// 上传替换
const fileInputRef = computed(() => null)
async function handleUploadReplace(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || [])
  if (!files.length) return
  try {
    const r = await uploadFile(files[0])
    const newAsset: CanvasMediaAsset = {
      kind: 'image',
      url: r.url,
      name: r.filename,
      origin: 'uploaded',
    }
    const currentAssets = Array.isArray(d.value.assets) ? [...d.value.assets] : []
    currentAssets.push(newAsset)

    patch({
      url: r.url,
      imageUrl: r.url,
      fileName: r.filename,
      assets: currentAssets,
    })
  } catch (e: any) { /* ignore */ }
}
</script>

<template>
  <div class="irn" :class="{ sel: selected }">
    <Handle type="target" :position="Position.Left" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />
    <Handle type="source" :position="Position.Right" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />

    <div class="irn-hd">
      <div class="irn-hd-ic" style="background: rgba(245,158,11,.18); color: #fcd34d;">
        <span class="mso" style="font-size:13px">image</span>
      </div>
      <div class="irn-hd-lb">图片结果</div>
    </div>

    <div v-if="url" class="irn-body">
      <img :src="url" :alt="prompt" class="irn-img" @mousedown="onDragStart" title="Ctrl+拖拽可送到其他节点" />

      <div class="irn-actions">
        <button class="irn-btn" @click="handleDownload" title="下载"><span class="mso" style="font-size:11px">download</span></button>
        <label class="irn-btn" title="替换图片" style="cursor:pointer">
          <span class="mso" style="font-size:11px">upload_file</span>
          <input type="file" accept="image/*" hidden @change="handleUploadReplace" />
        </label>
        <button class="irn-btn irn-btn-del" @click="handleDelete" title="删除"><span class="mso" style="font-size:11px">delete</span></button>
      </div>

      <div v-if="prompt" class="irn-prompt">{{ prompt.slice(0, 200) }}{{ prompt.length > 200 ? '…' : '' }}</div>
      <div v-if="taskId" class="irn-tid">任务: {{ String(taskId).slice(0, 12) }}…</div>
    </div>

    <div v-else class="irn-empty">等待生成结果…</div>
  </div>
</template>

<style scoped>
.irn { width: 260px; border: 2px solid var(--border); border-radius: 12px; background: var(--paper); box-shadow: var(--jc-shadow-sm); color: var(--ink1); }
.irn.sel { border-color: #f59e0b; }
.irn-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border2); }
.irn-hd-ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.irn-hd-lb { flex: 1; font-size: 13px; font-weight: 600; }
.irn-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.irn-img { width: 100%; border-radius: 6px; display: block; cursor: grab; }
.irn-actions { display: flex; gap: 4px; }
.irn-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink2); cursor: pointer; }
.irn-btn:hover { background: var(--surface-alt); }
.irn-btn-del:hover { background: rgba(239,68,68,.2); color: #ef4444; border-color: rgba(239,68,68,.4); }
.irn-prompt { font-size: 10px; color: var(--ink3); padding: 4px 6px; background: var(--surface); border-radius: 4px; word-break: break-all; }
.irn-tid { font-size: 9px; color: var(--ink3); }
.irn-empty { padding: 20px; text-align: center; font-size: 11px; color: var(--ink3); }
</style>
