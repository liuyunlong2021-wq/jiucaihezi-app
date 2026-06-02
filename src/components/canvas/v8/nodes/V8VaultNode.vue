<script setup lang="ts">
/**
 * V8VaultNode.vue
 * Week 1-3 Context Provider (P0) — 知识库选择器（纯引用声明，无执行）
 * TDD: CP-001/002
 * - 永远无 ▶ 按钮
 * - 右侧 source Handle (id="right-context") 连 LLM 的 left-context
 * - 紫色虚线边（context-injection）
 * - 基于 NodeFrame role="context"
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

const selectedVault = computed(() => props.data?.vaultName || props.data?.selectedVault || '未选择知识库')

function openSelector() {
  // TODO Phase 3: 弹出或内联真实 Vault 选择器（复用现有面板）
  // 临时：简单 prompt 模拟（真实实现不会这样）
  const name = prompt('输入知识库名称（真实版用 Vault 面板）', selectedVault.value)
  if (name) canvasStore.updateNodeData(props.id, { vaultName: name, selectedVault: name })
}
</script>

<template>
  <NodeFrame
    :id="id"
    label="知识库"
    icon="library_books"
    role="context"
    :collapsed="false"
    :selected="selected"
    :executable="false"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <!-- 只有右侧 context source Handle -->
    <Handle
      id="right-context"
      type="source"
      :position="Position.Right"
      :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none' }"
    />

    <div class="v8-context-node" @click="openSelector">
      <div class="v8-context-chip">📁 {{ selectedVault }}</div>
      <div class="v8-context-hint">点击选择 · 仅声明引用（不执行）</div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-context-node { padding: 10px; cursor: pointer; }
.v8-context-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: color-mix(in srgb, #a78bfa 12%, var(--surface));
  border: 1px solid #a78bfa; border-radius: 999px;
  padding: 4px 10px; font-size: 12px; color: #6d28d9;
}
.v8-context-hint { font-size: 10px; color: var(--ink3); margin-top: 6px; }
</style>