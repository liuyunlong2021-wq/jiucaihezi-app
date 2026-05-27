<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasNodeType, CanvasRunStatus } from '@/types/canvas'

const props = defineProps<{
  id: string
  type: CanvasNodeType
  icon: string
  label: string
  status?: CanvasRunStatus
  executable?: boolean
}>()

const canvasStore = useCanvasStore()
const editing = ref(false)
const draft = ref(props.label)

const canGrow = computed(() => ['text', 'llm', 'imageResult'].includes(props.type))
const canResize = computed(() => ['text', 'imageResult', 'videoResult', 'group'].includes(props.type))
const canPublish = computed(() => ['text', 'imageResult'].includes(props.type))
const isPublic = computed(() => Boolean((canvasStore.nodes.find(node => node.id === props.id)?.data as any)?.publicEnabled))

function startRename() {
  draft.value = props.label
  editing.value = true
}

function commitRename() {
  editing.value = false
  canvasStore.setNodeLabel(props.id, draft.value)
}

function duplicate() {
  canvasStore.duplicateNode(props.id)
}

function remove() {
  canvasStore.deleteNode(props.id)
}

function runNode() {
  if (!props.executable) return
  window.dispatchEvent(new CustomEvent('jc-canvas-run-node', { detail: props.id }))
}

function togglePublic() {
  const node = canvasStore.nodes.find(item => item.id === props.id)
  const current = Boolean((node?.data as any)?.publicEnabled)
  canvasStore.updateNodeData(props.id, { publicEnabled: !current, publicName: props.label } as any, true)
}

function resizeNode(delta: number) {
  const node = canvasStore.nodes.find(item => item.id === props.id)
  if (!node) return
  const width = Math.max(180, Number((node.data as any).width || 0) + delta)
  const height = Math.max(120, Number((node.data as any).height || 0) + Math.round(delta * 0.65))
  canvasStore.updateNodeData(props.id, { width, height } as any, true)
}

function grow(kind: 'llm' | 'image' | 'video' | 'imageToImage' | 'imageToVideo') {
  if (kind === 'llm') canvasStore.createTextToLlmChain(props.id)
  if (kind === 'image') canvasStore.createTextToImageChain(props.id)
  if (kind === 'video') canvasStore.createTextToVideoChain(props.id)
  if (kind === 'imageToImage') canvasStore.createImageToImageChain(props.id)
  if (kind === 'imageToVideo') canvasStore.createImageToVideoChain(props.id)
}
</script>

<template>
  <div class="cv-node-head">
    <span class="mso cv-head-icon">{{ icon }}</span>
    <input
      v-if="editing"
      class="cv-title-input"
      v-model="draft"
      autofocus
      @keydown.enter.stop.prevent="commitRename"
      @keydown.esc.stop.prevent="editing = false"
      @blur="commitRename"
      @pointerdown.stop @mousedown.stop
    />
    <span v-else class="cv-title" title="双击重命名" @dblclick.stop="startRename" @pointerdown.stop>
      {{ label }}
    </span>
    <div class="cv-head-actions" @pointerdown.stop>
      <button v-if="canResize" class="cv-icon-btn" title="缩小" @click.stop="resizeNode(-40)"><span class="mso">close_fullscreen</span></button>
      <button v-if="canResize" class="cv-icon-btn" title="放大" @click.stop="resizeNode(40)"><span class="mso">open_in_full</span></button>
      <button v-if="canGrow" class="cv-icon-btn" title="快捷生长">
        <span class="mso">add_circle</span>
        <div class="cv-grow-menu">
          <button v-if="type !== 'imageResult'" @click.stop="grow('llm')">接 AI 文本</button>
          <button v-if="type !== 'imageResult'" @click.stop="grow('image')">接图片生成</button>
          <button v-if="type !== 'imageResult'" @click.stop="grow('video')">接视频生成</button>
          <button v-if="type === 'imageResult'" @click.stop="grow('imageToImage')">图生图</button>
          <button v-if="type === 'imageResult'" @click.stop="grow('imageToVideo')">图生视频</button>
        </div>
      </button>
      <button v-if="canPublish" class="cv-icon-btn" :class="{ active: isPublic }" title="公开为 @素材" @click.stop="togglePublic"><span class="mso">alternate_email</span></button>
      <button v-if="executable" class="cv-icon-btn" title="执行节点" @click.stop="runNode">
        <span class="mso">{{ status === 'running' ? 'add_circle' : 'play_arrow' }}</span>
      </button>
      <button class="cv-icon-btn" title="复制" @click.stop="duplicate"><span class="mso">content_copy</span></button>
      <button class="cv-icon-btn danger" title="删除" @click.stop="remove"><span class="mso">delete</span></button>
    </div>
  </div>
</template>

<style scoped>
.cv-node-head {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px 0 10px;
  border-bottom: 1px solid var(--border2);
  font-size: 12px;
  font-weight: 700;
}
.cv-head-icon { font-size: 16px; color: var(--olive-dark); flex: 0 0 auto; }
.cv-title {
  min-width: 0;
  flex: 1;
  color: var(--ink1);
  font-size: 12px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: grab;
}
.cv-title-input {
  min-width: 0;
  flex: 1;
  height: 24px;
  border: 1px solid var(--olive-dark);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink1);
  font: inherit;
  font-size: 12px;
  padding: 0 6px;
  outline: 0;
}
.cv-head-actions { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.cv-icon-btn {
  position: relative;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.cv-icon-btn:hover, .cv-icon-btn.active { border-color: var(--border); background: var(--surface-alt); color: var(--olive-dark); }
.cv-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cv-icon-btn.danger:hover { color: var(--jc-error); }
.cv-icon-btn .mso { font-size: 16px; }
.cv-grow-menu {
  position: absolute;
  top: 25px;
  right: 0;
  z-index: 20;
  display: none;
  min-width: 106px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: var(--jc-shadow-md);
}
.cv-icon-btn:hover .cv-grow-menu { display: grid; gap: 4px; }
.cv-grow-menu button {
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink2);
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 0 7px;
  cursor: pointer;
}
.cv-grow-menu button:hover { background: var(--surface-alt); color: var(--ink1); }
</style>
