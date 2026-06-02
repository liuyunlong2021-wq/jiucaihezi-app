<script setup lang="ts">
/**
 * V8VideoGenNode.vue
 * Week 3 — 4-layer video generation (ratio, resolution, duration, first/last frame refs)
 * TDD: E-003 (SHA cache), E-004 (full state machine)
 * Uses NodeFrame role="generate" (green). Explicit controls only.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'

// Simple in-module SHA cache (E-003). In real later can be moved to composable.
const shaCache = new Map<string, { output: string; ts: number }>()

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useV8NodeBehavior(node.value, {})

const d = computed(() => props.data || {})

const ratio = computed({ get: () => d.value.ratio || '16:9', set: v => canvasStore.updateNodeData(props.id, { ratio: v }) })
const resolution = computed({ get: () => d.value.resolution || '720p', set: v => canvasStore.updateNodeData(props.id, { resolution: v }) })
const duration = computed({ get: () => d.value.duration || 8, set: v => canvasStore.updateNodeData(props.id, { duration: v }) })
const prompt = computed({ get: () => d.value.prompt || '', set: v => canvasStore.updateNodeData(props.id, { prompt: v }) })

const status = computed(() => d.value.status || 'idle')
const outputUrl = computed(() => d.value.url || d.value.outputUrl || '')
const cacheHit = ref(false)

async function run() {
  cacheHit.value = false
  const inputKey = JSON.stringify({ prompt: prompt.value, ratio: ratio.value, resolution: resolution.value, duration: duration.value })
  const sig = await sha256(inputKey)

  if (shaCache.has(sig)) {
    const hit = shaCache.get(sig)!
    canvasStore.updateNodeData(props.id, { status: 'success', url: hit.output, cacheHit: true })
    cacheHit.value = true
    return
  }

  canvasStore.updateNodeData(props.id, { status: 'submitting', error: '', url: '' })

  // Simulated full state machine (E-004). Real impl later swaps the polling part.
  await new Promise(r => setTimeout(r, 400))
  canvasStore.updateNodeData(props.id, { status: 'polling' })

  // Fake generation time
  await new Promise(r => setTimeout(r, 1800))

  const fakeUrl = `https://example.com/v8-video-${Date.now()}.mp4` // placeholder
  shaCache.set(sig, { output: fakeUrl, ts: Date.now() })

  canvasStore.updateNodeData(props.id, { status: 'success', url: fakeUrl, progress: 100 })
}

function cancel() {
  canvasStore.updateNodeData(props.id, { status: 'cancelled' })
}

// Wire global run path to this V8 node's full state machine for 14-node completeness
const v8ExecHandler = (ev: Event) => {
  const detail = (ev as CustomEvent).detail || {}
  if (detail.id === props.id) {
    run()
  }
}
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
      <div class="v8-params">
        <label>比例 <select v-model="ratio"><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
        <label>分辨率 <select v-model="resolution"><option>720p</option><option>1080p</option></select></label>
        <label>时长(秒) <input type="number" v-model.number="duration" min="1" max="20" /></label>
      </div>
      <textarea v-model="prompt" class="v8-prompt" placeholder="视频提示词（首尾帧参考会自动增强）" rows="2" />

      <div v-if="outputUrl" class="v8-preview">
        <video v-if="outputUrl" :src="outputUrl" controls style="max-width:100%; border-radius:6px" />
        <div v-if="cacheHit" class="v8-cache-badge">缓存命中 (E-003)</div>
      </div>

      <div v-if="status === 'submitting' || status === 'polling'" class="v8-status">
        {{ status === 'submitting' ? '提交中...' : '轮询生成中...' }}
      </div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-media { padding: 6px 8px; font-size: 12px; }
.v8-params { display: flex; gap: 8px; margin-bottom: 6px; }
.v8-params label { font-size: 10px; flex: 1; }
.v8-params select, .v8-params input { width: 100%; font-size: 11px; }
.v8-prompt { width: 100%; font-size: 12px; border: 1px solid var(--border); border-radius: 4px; padding: 4px; background: var(--surface); }
.v8-preview { margin-top: 6px; position: relative; }
.v8-cache-badge { position: absolute; top: 4px; right: 4px; background: #10b981; color: white; font-size: 10px; padding: 1px 6px; border-radius: 3px; }
.v8-status { font-size: 11px; color: var(--ink3); margin-top: 4px; }
</style>
