<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { JsonCanvasDocument, JsonCanvasNode } from '@/runtime/memory/jsonCanvas'

const props = defineProps<{ document: JsonCanvasDocument; viewport?: { x: number; y: number; zoom: number } | null }>()
const emit = defineEmits<{
  open: [path: string, viewport: { x: number; y: number; zoom: number }]
  save: [document: JsonCanvasDocument]
}>()

const canvas = ref<HTMLElement | null>(null)
const document = ref<JsonCanvasDocument>(structuredClone(props.document))
const pan = ref({ x: props.viewport?.x || 0, y: props.viewport?.y || 0 })
const zoom = ref(props.viewport?.zoom || 1)
let pointer: { id: number; x: number; y: number; node?: JsonCanvasNode; originX: number; originY: number; moved: boolean } | null = null

watch(() => props.document, value => { document.value = structuredClone(value) })
const nodesById = computed(() => new Map(document.value.nodes.map(node => [node.id, node])))
const bounds = computed(() => {
  const nodes = document.value.nodes
  if (!nodes.length) return { x: 0, y: 0, width: 1, height: 1 }
  const left = Math.min(...nodes.map(node => node.x)); const top = Math.min(...nodes.map(node => node.y))
  const right = Math.max(...nodes.map(node => node.x + node.width)); const bottom = Math.max(...nodes.map(node => node.y + node.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
})

function nodeText(node: JsonCanvasNode) {
  return node.type === 'file' ? node.file || node.id : node.type === 'link' ? node.url || node.id : node.label || node.text || node.id
}

function filePath(node: JsonCanvasNode): string {
  if (node.type === 'file') return String(node.file || '')
  return /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(String(node.text || ''))?.[1]?.trim() || ''
}

function currentViewport() { return { ...pan.value, zoom: zoom.value } }

function openNode(node: JsonCanvasNode) {
  const path = filePath(node)
  if (path) emit('open', path, currentViewport())
  else if (node.type === 'link' && node.url) window.open(node.url, '_blank', 'noopener,noreferrer')
}

function pointerDown(event: PointerEvent, node?: JsonCanvasNode) {
  if (event.button !== 0) return
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, node, originX: node?.x || pan.value.x, originY: node?.y || pan.value.y, moved: false }
}

function pointerMove(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return
  const dx = event.clientX - pointer.x; const dy = event.clientY - pointer.y
  pointer.moved ||= Math.abs(dx) + Math.abs(dy) > 3
  if (pointer.node) {
    pointer.node.x = pointer.originX + dx / zoom.value
    pointer.node.y = pointer.originY + dy / zoom.value
    document.value = { ...document.value, nodes: [...document.value.nodes] }
  } else pan.value = { x: pointer.originX + dx, y: pointer.originY + dy }
}

function pointerUp(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return
  if (pointer.node) {
    if (pointer.moved) emit('save', structuredClone(document.value))
    else openNode(pointer.node)
  }
  pointer = null
}

function wheel(event: WheelEvent) {
  event.preventDefault()
  zoom.value = Math.min(2.5, Math.max(.25, zoom.value * (event.deltaY > 0 ? .9 : 1.1)))
}

function fit() {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return
  zoom.value = Math.min(1.5, Math.max(.25, Math.min((rect.width - 80) / bounds.value.width, (rect.height - 80) / bounds.value.height)))
  pan.value = { x: (rect.width - bounds.value.width * zoom.value) / 2 - bounds.value.x * zoom.value, y: (rect.height - bounds.value.height * zoom.value) / 2 - bounds.value.y * zoom.value }
}
</script>

<template>
  <section ref="canvas" class="project-map" @pointerdown="pointerDown($event)" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointer=null" @wheel="wheel">
    <button class="project-map-fit" type="button" title="适应画布" @pointerdown.stop @click="fit">适应</button>
    <div class="project-map-world" :style="{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }">
      <svg class="project-map-edges" :style="{ left: `${bounds.x - 2000}px`, top: `${bounds.y - 2000}px`, width: `${bounds.width + 4000}px`, height: `${bounds.height + 4000}px` }">
        <g v-for="edge in document.edges" :key="edge.id">
          <line
            :x1="(nodesById.get(edge.fromNode)?.x || 0) + (nodesById.get(edge.fromNode)?.width || 0) / 2 - bounds.x + 2000"
            :y1="(nodesById.get(edge.fromNode)?.y || 0) + (nodesById.get(edge.fromNode)?.height || 0) / 2 - bounds.y + 2000"
            :x2="(nodesById.get(edge.toNode)?.x || 0) + (nodesById.get(edge.toNode)?.width || 0) / 2 - bounds.x + 2000"
            :y2="(nodesById.get(edge.toNode)?.y || 0) + (nodesById.get(edge.toNode)?.height || 0) / 2 - bounds.y + 2000" />
          <text v-if="edge.label"
            :x="(((nodesById.get(edge.fromNode)?.x || 0) + (nodesById.get(edge.fromNode)?.width || 0) / 2 + (nodesById.get(edge.toNode)?.x || 0) + (nodesById.get(edge.toNode)?.width || 0) / 2) / 2) - bounds.x + 2000"
            :y="(((nodesById.get(edge.fromNode)?.y || 0) + (nodesById.get(edge.fromNode)?.height || 0) / 2 + (nodesById.get(edge.toNode)?.y || 0) + (nodesById.get(edge.toNode)?.height || 0) / 2) / 2) - bounds.y + 1994">{{ edge.label }}</text>
        </g>
      </svg>
      <button v-for="node in document.nodes" :key="node.id" type="button" class="project-map-node" :class="node.type"
        :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px`, borderColor: node.color || undefined }"
        @pointerdown.stop="pointerDown($event,node)" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointer=null">
        <strong>{{ node.type === 'group' ? (node.label || '分组') : node.type === 'file' ? '文件' : node.type === 'link' ? '链接' : '笔记' }}</strong>
        <span>{{ nodeText(node) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.project-map{position:relative;width:100%;height:100%;min-height:420px;overflow:hidden;background-color:#f4f5f1;background-image:radial-gradient(#c9cec6 1px,transparent 1px);background-size:20px 20px;touch-action:none;cursor:grab}.project-map:active{cursor:grabbing}.project-map-world{position:absolute;inset:0;transform-origin:0 0}.project-map-edges{position:absolute;overflow:visible;pointer-events:none}.project-map-edges line{stroke:#9ba39a;stroke-width:2}.project-map-edges text{fill:#687067;font:12px sans-serif;text-anchor:middle}.project-map-node{position:absolute;display:flex;flex-direction:column;gap:8px;overflow:hidden;padding:12px;border:2px solid #9aa298;border-radius:6px;background:#fff;color:#252923;text-align:left;cursor:pointer}.project-map-node strong{font-size:11px;color:#65705f}.project-map-node span{overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}.project-map-node.group{background:rgba(218,224,213,.55);border-style:dashed}.project-map-node.file{border-color:#758344}.project-map-fit{position:absolute;z-index:3;right:16px;top:16px;border:1px solid #c9cec6;border-radius:5px;background:#fff;padding:7px 11px;cursor:pointer}
</style>
