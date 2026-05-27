<script setup lang="ts">
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { resumeCanvasResultNode } from '@/components/canvas/runtime/canvasMediaRuntime'
import { isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import type { CanvasAudioResultNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasAudioResultNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()
const canResume = computed(() => Boolean(!props.data.url && props.data.pollUrl && ['running', 'queued', 'error'].includes(props.data.status)))
const showUrlInput = ref(false)
const urlValue = ref('')

async function uploadAudio() {
  const selected = await open({ multiple: false, directory: false, filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] }] })
  if (typeof selected !== 'string' || !selected.trim()) return
  const name = selected.split(/[\\/]/).filter(Boolean).at(-1) || '音频节点'
  canvasStore.updateNodeData(props.id, {
    label: name,
    url: convertFileSrc(selected),
    sourcePath: selected,
    status: 'success',
    progress: 100,
    detail: '已选择音频',
  } as any, true)
}

function patchUrl() {
  showUrlInput.value = !showUrlInput.value
  if (showUrlInput.value) urlValue.value = props.data.url || ''
}

function submitUrl() {
  const clean = urlValue.value.trim()
  showUrlInput.value = false
  if (clean && !isAllowedMediaAttachmentUrl(clean)) return
  canvasStore.updateNodeData(props.id, { url: clean, status: clean ? 'success' : 'idle' } as any, true)
}

async function resumeTask() {
  if (!canResume.value) return
  try {
    await resumeCanvasResultNode(props.id, 'audio', props.data)
  } catch {
    // resumeCanvasResultNode writes the visible node error state.
  }
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 280) + 'px', minHeight: (data.height || 150) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="audioResult" icon="audio_file" :label="data.label" :status="data.status" />
    <div class="cv-preview">
      <audio v-if="data.url" :src="data.url" controls preload="metadata" />
      <div v-else-if="data.status === 'running' || data.status === 'queued'" class="cv-state running">
        <span class="mso">hourglass_top</span>
        <strong>{{ data.detail || '生成中' }}</strong>
        <div class="cv-progress-bar"><i :style="{ width: Math.max(4, data.progress || 3) + '%' }"></i></div>
        <small>{{ data.progress || 0 }}%</small>
      </div>
      <div v-else-if="data.status === 'error'" class="cv-state error">
        <span class="mso">error</span>
        <strong>生成失败</strong>
        <small>{{ data.error || data.detail || '请重试' }}</small>
      </div>
      <button v-else class="cv-upload" @pointerdown.stop @click.stop="uploadAudio">
        <span class="mso">audio_file</span>
        点击上传音频
      </button>
    </div>
    <div class="cv-actions">
      <button v-if="canResume" @pointerdown.stop @click.stop="resumeTask"><span class="mso">restart_alt</span>恢复</button>
      <button @pointerdown.stop @click.stop="uploadAudio"><span class="mso">upload_file</span>上传</button>
      <button @pointerdown.stop @click.stop="patchUrl"><span class="mso">link</span>地址</button>
    </div>
    <div v-if="showUrlInput" class="cv-url-input" @pointerdown.stop>
      <input v-model="urlValue" placeholder="粘贴音频 URL" @keyup.enter="submitUrl" @keyup.escape="showUrlInput = false" />
      <button @click="submitUrl"><span class="mso">check</span></button>
    </div>
    <div v-if="data.status === 'running' || data.status === 'queued'" class="cv-meta">{{ data.detail || data.status }} · {{ data.progress || 0 }}%</div>
    <div v-else-if="data.fileId || data.sourcePath" class="cv-meta">{{ data.fileId ? '已写入文件区' : '本地音频' }}</div>
    <CanvasResizeHandle :id="id" :default-width="280" :default-height="150" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { position:relative; border:1px solid var(--border); background:var(--paper); border-radius:8px; box-shadow:var(--jc-shadow-sm); color:var(--ink1); overflow:visible; }
.cv-node.selected { border-color:var(--olive-dark); box-shadow:0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-preview { min-height:72px; padding:10px; background:var(--surface); display:flex; align-items:center; justify-content:center; }
.cv-preview audio { width:100%; }
.cv-upload { width:100%; min-height:56px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border:1px dashed var(--border); border-radius:8px; background:var(--paper); color:var(--ink3); font:inherit; font-size:12px; cursor:pointer; }
.cv-upload .mso { font-size:26px; color:var(--olive-dark); }
.cv-state { width:100%; min-height:72px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; padding:10px; text-align:center; color:var(--ink3); }
.cv-state .mso { font-size:26px; color:var(--olive-dark); }
.cv-state strong { font-size:12px; color:var(--ink1); }
.cv-state small { max-width:100%; font-size:11px; color:var(--ink3); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.cv-state.error .mso { color:var(--jc-error); }
.cv-progress-bar { width:78%; height:6px; border-radius:999px; background:var(--border2); overflow:hidden; }
.cv-progress-bar i { display:block; height:100%; border-radius:inherit; background:var(--olive-dark); transition:width .2s ease; }
.cv-actions { display:flex; gap:6px; padding:7px 8px; border-top:1px solid var(--border2); }
.cv-actions button { height:26px; flex:1; min-width:0; display:inline-flex; align-items:center; justify-content:center; gap:3px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink2); font:inherit; font-size:11px; cursor:pointer; }
.cv-actions .mso { font-size:14px; }
.cv-meta { padding:7px 10px; font-size:11px; color:var(--ink3); border-top:1px solid var(--border2); }
.cv-url-input { display:flex; gap:4px; padding:6px 8px; border-top:1px solid var(--border2); }
.cv-url-input input { flex:1; min-width:0; height:28px; padding:0 8px; border:1px solid var(--border); border-radius:6px; background:var(--surface); font:inherit; font-size:12px; color:var(--ink); outline:none; }
.cv-url-input input:focus { border-color:var(--olive); }
.cv-url-input button { width:28px; height:28px; border:1px solid var(--olive); border-radius:6px; background:var(--olive); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; }
</style>
