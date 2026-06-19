<script setup lang="ts">
/**
 * V8VideoGenNode — webhuabu Phase 1b: 真实 API + 模型选择器 + SHA cache + state machine
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import { generateVideo, type VideoGenParams } from '@/api/media-generation'
import type { CanvasNode } from '@/types/canvas'

const shaCache = new Map<string, { output: string; ts: number }>()
async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useV8NodeBehavior(node.value, {})

const d = computed(() => props.data || {})

// ─── 模型选择 ───
const videoModels = computed(() => agentStore.videoModels)
const model = computed({ get: () => d.value.model || videoModels.value[0]?.id || 'grok-video-3', set: v => canvasStore.updateNodeData(props.id, { model: v }) })

// ─── 参数 ───
const ratio = computed({ get: () => d.value.ratio || '16:9', set: v => canvasStore.updateNodeData(props.id, { ratio: v }) })
const resolution = computed({ get: () => d.value.resolution || '720p', set: v => canvasStore.updateNodeData(props.id, { resolution: v }) })
const duration = computed({ get: () => d.value.duration || 8, set: v => canvasStore.updateNodeData(props.id, { duration: v }) })
const prompt = computed({ get: () => d.value.prompt || '', set: v => canvasStore.updateNodeData(props.id, { prompt: v }) })

const status = computed(() => d.value.status || 'idle')
const outputUrl = computed(() => d.value.url || d.value.outputUrl || '')
const error = computed(() => d.value.error || '')

async function run() {
  if (localStorage.getItem('jc_canvas_fake_media') === 'true') { await fakeRun(); return }
  if (!prompt.value.trim()) { canvasStore.updateNodeData(props.id, { status: 'error', error: '请输入提示词' }); return }

  const inputKey = JSON.stringify({ prompt: prompt.value, ratio: ratio.value, resolution: resolution.value, duration: duration.value, model: model.value })
  const sig = await sha256(inputKey)
  if (shaCache.has(sig)) { canvasStore.updateNodeData(props.id, { status: 'success', url: shaCache.get(sig)!.output }); return }

  canvasStore.updateNodeData(props.id, { status: 'submitting', error: '', url: '' })
  try {
    const params: VideoGenParams = { model: model.value, prompt: prompt.value, aspectRatio: ratio.value, resolution: resolution.value, duration: duration.value }
    const result = await generateVideo(params, (_elapsed, _status) => {
      if (_status === 'polling') canvasStore.updateNodeData(props.id, { status: 'polling' })
    })
    const url = result.url || ''
    if (url) { shaCache.set(sig, { output: url, ts: Date.now() }); canvasStore.updateNodeData(props.id, { status: 'success', url, progress: 100 }) }
    else { canvasStore.updateNodeData(props.id, { status: 'error', error: '生成成功但未返回视频URL' }) }
  } catch (e: any) { canvasStore.updateNodeData(props.id, { status: 'error', error: e?.message || '视频生成失败' }) }
}

async function fakeRun() {
  const inputKey = JSON.stringify({ prompt: prompt.value, ratio: ratio.value, resolution: resolution.value, duration: duration.value })
  const sig = await sha256(inputKey)
  if (shaCache.has(sig)) { canvasStore.updateNodeData(props.id, { status: 'success', url: shaCache.get(sig)!.output }); return }
  canvasStore.updateNodeData(props.id, { status: 'submitting', error: '', url: '' })
  await new Promise(r => setTimeout(r, 400))
  canvasStore.updateNodeData(props.id, { status: 'polling' })
  await new Promise(r => setTimeout(r, 1800))
  const fakeUrl = `https://example.com/v8-video-${Date.now()}.mp4`
  shaCache.set(sig, { output: fakeUrl, ts: Date.now() })
  canvasStore.updateNodeData(props.id, { status: 'success', url: fakeUrl, progress: 100 })
}

function cancel() { canvasStore.updateNodeData(props.id, { status: 'cancelled' }) }

const v8ExecHandler = (ev: Event) => { const detail = (ev as CustomEvent).detail || {}; if (detail.id === props.id) run() }
onMounted(() => window.addEventListener('v8-execute-node', v8ExecHandler))
onUnmounted(() => window.removeEventListener('v8-execute-node', v8ExecHandler))
</script>

<template>
  <NodeFrame
    :id="id"
    label="视频生成"
    icon="movie"
    role="generate"
    :status="status"
    :selected="selected"
    executable
    show-stop
    @run="run"
    @stop="cancel"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <Handle id="left-ref" type="target" :position="Position.Left" :style="{ background: '#f59e0b', width: 10, height: 10, border: 'none' }" />
    <Handle id="right-result" type="source" :position="Position.Right" :style="{ background: '#10b981', width: 10, height: 10, border: 'none' }" />

    <div class="v8-media">
      <!-- 模型选择 -->
      <div class="v8-field">
        <label>模型</label>
        <select v-model="model" class="v8-select">
          <option v-for="m in videoModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
        </select>
      </div>
      <div class="v8-params">
        <label>比例 <select v-model="ratio"><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
        <label>分辨率 <select v-model="resolution"><option>720p</option><option>1080p</option></select></label>
        <label>时长(秒) <input type="number" v-model.number="duration" min="1" max="20" /></label>
      </div>
      <textarea v-model="prompt" class="v8-prompt" placeholder="视频提示词（首尾帧参考会自动增强）" rows="2" />

      <div v-if="outputUrl" class="v8-preview">
        <video v-if="outputUrl" :src="outputUrl" controls style="max-width:100%; border-radius:6px" />
      </div>

      <div v-if="error" class="v8-error">{{ error }}</div>

      <div v-if="status === 'submitting' || status === 'polling'" class="v8-status">
        {{ status === 'submitting' ? '提交中...' : '轮询生成中...' }}
      </div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-media { padding: 6px 8px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
.v8-field { display: flex; flex-direction: column; gap: 2px; }
.v8-field label { font-size: 10px; color: var(--ink3); }
.v8-select { width: 100%; font-size: 12px; border: 1px solid var(--border); border-radius: 4px; padding: 3px 6px; background: var(--surface); color: var(--ink1); }
.v8-params { display: flex; gap: 8px; margin-bottom: 0; }
.v8-params label { font-size: 10px; flex: 1; }
.v8-params select, .v8-params input { width: 100%; font-size: 11px; }
.v8-prompt { width: 100%; font-size: 12px; border: 1px solid var(--border); border-radius: 4px; padding: 4px; background: var(--surface); color: var(--ink1); resize: vertical; }
.v8-preview { margin-top: 6px; position: relative; }
.v8-error { font-size: 10px; color: #f87171; background: rgba(239,68,68,.1); border-radius: 4px; padding: 4px 6px; }
.v8-status { font-size: 11px; color: var(--ink3); margin-top: 4px; }
</style>
