<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import CanvasResizeHandle from './shared/CanvasResizeHandle.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasImageResultNodeData } from '@/types/canvas'

const props = defineProps<{ id: string; data: CanvasImageResultNodeData; selected?: boolean }>()
const canvasStore = useCanvasStore()

async function uploadImage() {
  const selected = await open({ multiple: false, directory: false, filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
  if (typeof selected !== 'string' || !selected.trim()) return
  const name = selected.split(/[\\/]/).filter(Boolean).at(-1) || '图片节点'
  canvasStore.updateNodeData(props.id, { label: name, url: convertFileSrc(selected), sourcePath: selected, status: 'success', progress: 100, detail: '已选择图片' } as any, true)
}

function patchUrl() {
  const next = window.prompt('粘贴新的图片地址', props.data.url || '')
  if (next == null) return
  canvasStore.updateNodeData(props.id, { url: next.trim() } as any, true)
}

function preview() {
  if (props.data.url) window.open(props.data.url, '_blank')
}

function imageToImage() {
  canvasStore.createImageToImageChain(props.id)
}

function imageToVideo() {
  canvasStore.createImageToVideoChain(props.id)
}
</script>

<template>
  <div class="cv-node" :class="{ selected }" :style="{ width: (data.width || 240) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="imageResult" icon="image_search" :label="data.label" :status="data.status" />
    <div class="cv-preview">
      <img v-if="data.url" :src="data.url" alt="" />
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
      <button v-else class="cv-upload" @pointerdown.stop @click.stop="uploadImage"><span class="mso">image</span>点击上传图片</button>
    </div>
    <div class="cv-actions">
      <button @pointerdown.stop :disabled="!data.url" @click.stop="preview"><span class="mso">open_in_new</span>预览</button>
      <button @pointerdown.stop @click.stop="uploadImage"><span class="mso">upload_file</span>上传</button>
      <button @pointerdown.stop @click.stop="patchUrl"><span class="mso">link</span>地址</button>
      <button @pointerdown.stop @click.stop="imageToImage"><span class="mso">image</span>图生图</button>
      <button @pointerdown.stop @click.stop="imageToVideo"><span class="mso">movie</span>视频</button>
    </div>
    <div v-if="data.fileId" class="cv-meta">已写入文件区</div>
    <CanvasResizeHandle :id="id" :default-width="240" :default-height="230" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { position:relative; border: 1px solid var(--border); background: var(--paper); border-radius: 8px; box-shadow: var(--jc-shadow-sm); color: var(--ink1); overflow: visible; }
.cv-node.selected { border-color: var(--olive-dark); box-shadow: 0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-preview { height:160px; background:var(--surface); display:flex; align-items:center; justify-content:center; overflow:hidden; }
.cv-preview img { width:100%; height:100%; object-fit:cover; display:block; }
.cv-empty { color:var(--ink3); font-size:12px; }
.cv-upload { width:100%; height:100%; min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; border:0; background:transparent; color:var(--ink3); font:inherit; font-size:12px; cursor:pointer; }
.cv-upload .mso { font-size:30px; color:var(--olive-dark); }
.cv-state { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; padding:14px; text-align:center; color:var(--ink3); }
.cv-state .mso { font-size:30px; color:var(--olive-dark); }
.cv-state strong { font-size:12px; color:var(--ink1); }
.cv-state small { max-width:100%; font-size:11px; color:var(--ink3); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.cv-state.error .mso { color:var(--jc-error); }
.cv-progress-bar { width:78%; height:6px; border-radius:999px; background:var(--border2); overflow:hidden; }
.cv-progress-bar i { display:block; height:100%; border-radius:inherit; background:var(--olive-dark); transition:width .2s ease; }
.cv-actions { display:flex; gap:6px; padding:7px 8px; border-top:1px solid var(--border2); }
.cv-actions button { height:26px; flex:1; min-width:0; display:inline-flex; align-items:center; justify-content:center; gap:3px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink2); font:inherit; font-size:11px; cursor:pointer; }
.cv-actions button:disabled { opacity:.45; cursor:not-allowed; }
.cv-actions .mso { font-size:14px; }
.cv-meta { padding:7px 10px; font-size:11px; color:var(--ink3); border-top:1px solid var(--border2); }
</style>
