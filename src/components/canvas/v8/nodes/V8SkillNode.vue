<script setup lang="ts">
/**
 * V8SkillNode.vue — Skill 选择器（纯引用，无 ▶）
 * TDD CP-001/002
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

const selectedSkill = computed(() => props.data?.skillName || '未选择 Skill')

function openSelector() {
  const name = prompt('输入 Skill 名称（真实版用 Skill 面板多选）', selectedSkill.value)
  if (name) canvasStore.updateNodeData(props.id, { skillName: name })
}
</script>

<template>
  <NodeFrame
    :id="id"
    label="Skill"
    icon="smart_toy"
    role="context"
    :collapsed="false"
    :selected="selected"
    :executable="false"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <Handle id="right-context" type="source" :position="Position.Right" :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none' }" />
    <div class="v8-context-node" @click="openSelector">
      <div class="v8-context-chip">🧩 {{ selectedSkill }}</div>
      <div class="v8-context-hint">点击选择 · 连 LLM 注入 system（skillApplicability 过滤）</div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-context-node { padding: 10px; cursor: pointer; }
.v8-context-chip { display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, #a78bfa 12%, var(--surface)); border: 1px solid #a78bfa; border-radius: 999px; padding: 4px 10px; font-size: 12px; color: #6d28d9; }
.v8-context-hint { font-size: 10px; color: var(--ink3); margin-top: 6px; }
</style>