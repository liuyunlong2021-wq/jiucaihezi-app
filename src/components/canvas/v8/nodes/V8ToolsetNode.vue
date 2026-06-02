<script setup lang="ts">
/**
 * V8ToolsetNode.vue — 工具集合开关（纯引用，宽容模式）
 * TDD CP-001/002 + LLM-002（工具暴露但 LLM 可决定不调用）
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const node = { id: props.id, data: props.data } as CanvasNode
const { onResizeHandlePointerDown } = useV8NodeBehavior(node, {})

const tools = computed(() => (props.data?.enabledTools || ['webSearch', 'localRead']) as string[])

function toggleTool(t: string) {
  const set = new Set(tools.value)
  set.has(t) ? set.delete(t) : set.add(t)
  canvasStore.updateNodeData(props.id, { enabledTools: Array.from(set) })
}
</script>

<template>
  <NodeFrame
    :id="id"
    label="工具集"
    icon="construction"
    role="context"
    :collapsed="false"
    :selected="selected"
    :executable="false"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <Handle id="right-context" type="source" :position="Position.Right" :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none' }" />
    <div class="v8-context-node">
      <div class="v8-tool-list">
        <label v-for="t in ['webSearch','localRead','browser','codeExec']" :key="t" class="v8-tool-item">
          <input type="checkbox" :checked="tools.includes(t)" @change="toggleTool(t)" />
          {{ t }}
        </label>
      </div>
      <div class="v8-context-hint">已选工具暴露给 LLM（LLM-002：可决定不调用）</div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-context-node { padding: 8px 10px; font-size: 11px; }
.v8-tool-list { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.v8-tool-item { display: flex; align-items: center; gap: 4px; user-select: none; }
.v8-context-hint { font-size: 10px; color: var(--ink3); margin-top: 6px; }
</style>