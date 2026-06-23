<script setup lang="ts">
/**
 * GroupNode.vue
 *
 * Week 4-6 Phase 2 — Group (Subgraph) — THE MOST CRITICAL NODE.
 * TDD priority: G-001 (prompt-flow N-port aggregation, zero data loss) > G-002 > G-003.
 *
 * Features (first delivery focused on G-001 correctness):
 * - Fold / Expand (dramatic visual change)
 * - When FOLDED: dynamically exposes multiple independent "left-prompt-N" target Handles
 *   for prompt-flow. This directly satisfies "≥2 inputs → N independent ports, no data dropped".
 * - Uses NodeFrame role="orchestrate" (amber #f59e0b)
 * - Container visual when expanded (children can live inside via parentNode or manual grouping later)
 * - Right-click friendly (dispatches v8-group-action consumed by workspace for "execute subgraph", "export template")
 * - Context scope isolation stub (G-002): internal context marked with groupId
 * - Template export (G-003): placeholder json with structure only, downloadable
 *
 * Data model (all optional for compatibility):
 *   - isFolded: boolean
 *   - promptPortCount: number (user can increase when folded to prove N-port)
 *   - childNodeIds: string[]
 *   - groupTemplateId (future)
 */

import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useNodeBehavior } from '@/components/canvas/nodes-next/composables/useNodeBehavior'
import type { CanvasNode } from '@/types/canvas'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()

const canvasStore = useCanvasStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useNodeBehavior(node.value, {
  onResizeEnd(id, w, h) { canvasStore.updateNodeData(id, { width: w, height: h }) }
})

const d = computed(() => props.data || {})

const isFolded = computed({
  get: () => d.value.isFolded ?? false,
  set: (v: boolean) => canvasStore.updateNodeData(props.id, { isFolded: v })
})

// G-001: Number of independent prompt-flow ports exposed when folded
const promptPortCount = computed({
  get: () => Math.max(1, d.value.promptPortCount || 1),
  set: (v: number) => canvasStore.updateNodeData(props.id, { promptPortCount: Math.max(1, Math.min(8, v)) })
})

const childCount = computed(() => (d.value.childNodeIds || []).length)

// Dynamic prompt ports for G-001 (the critical rule)
const promptPorts = computed(() => {
  if (!isFolded.value) return []
  const count = promptPortCount.value
  return Array.from({ length: count }, (_, i) => ({
    id: `left-prompt-${i + 1}`,
    label: `Prompt-${i + 1}`
  }))
})

// For G-001 demo: when folding, we can auto set port count based on "internal prompt inputs"
// Stub: for now manual, but in future workspace can analyze internal edges and set promptPortCount
function autoDetectPromptPorts() {
  // Placeholder for auto from child wiring
  const detected = Math.max(1, Math.min(4, childCount.value))
  promptPortCount.value = detected
}

function toggleFold() {
  const next = !isFolded.value
  isFolded.value = next
  // When unfolding, we could restore child positions (future enhancement)
}

function addPromptPort() {
  promptPortCount.value = promptPortCount.value + 1
}

function removePromptPort() {
  if (promptPortCount.value > 1) promptPortCount.value = promptPortCount.value - 1
}

function emitSubgraphAction(action: 'execute' | 'export-template') {
  // These will be consumed by CanvasWorkspace right-click / context menu layer (Phase 3)
  window.dispatchEvent(new CustomEvent('v8-group-action', {
    detail: { groupId: props.id, action }
  }))
}
</script>

<template>
  <NodeFrame
    :id="id"
    :label="isFolded ? 'Group (已折叠)' : 'Group (展开中)'"
    icon="folder"
    role="orchestrate"
    :selected="selected"
    executable
    @run="emitSubgraphAction('execute')"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <!-- Context in (left, purple dashed style) -->
    <Handle
      id="left-context"
      type="target"
      :position="Position.Left"
      :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none' }"
    />

    <!-- Dynamic prompt-flow ports — G-001 core -->
    <Handle
      v-for="port in promptPorts"
      :key="port.id"
      :id="port.id"
      type="target"
      :position="Position.Left"
      :style="{
        background: '#3b82f6',
        width: '10px',
        height: '10px',
        border: 'none',
        top: `${35 + (promptPorts.indexOf(port) * 18)}%`
      }"
    />

    <!-- Output (right) -->
    <Handle
      id="right-out"
      type="source"
      :position="Position.Right"
      :style="{ background: '#f59e0b', width: '10px', height: '10px', border: 'none' }"
    />

    <!-- Content -->
    <div class="v8-group" :class="{ folded: isFolded }">
      <div class="v8-group-header" @click="toggleFold">
        <JcIcon :name="isFolded ? 'unfold_more' : 'unfold_less'" />
        <strong>{{ isFolded ? '已折叠子图' : '展开子图' }}</strong>
        <span class="v8-child-count">({{ childCount }} 节点)</span>
      </div>

      <!-- When folded: G-001 controls + port explanation -->
      <div v-if="isFolded" class="v8-folded-body">
        <div class="v8-port-info">
          当前暴露 <strong>{{ promptPortCount }}</strong> 个独立 prompt-flow 入口
          <span class="v8-g001-badge">G-001 保护</span>
        </div>

        <div class="v8-port-controls">
          <button @click.stop="addPromptPort" class="v8-btn-small">+ Prompt 端口</button>
          <button @click.stop="removePromptPort" class="v8-btn-small" :disabled="promptPortCount <= 1">- 端口</button>
          <button @click.stop="autoDetectPromptPorts" class="v8-btn-small">自动检测 (G-001)</button>
        </div>

        <div class="v8-hint">
          每个 Prompt 端口独立传输数据。折叠时绝不合并或丢弃上游内容。
        </div>
      </div>

      <!-- When expanded -->
      <div v-else class="v8-expanded-body">
        <div class="v8-group-container">
          <div class="v8-hint">
            子图容器（展开态）。子节点可拖入此区域（支持 parentNode 嵌套未来完善）。<br>
            右键 Group 可「仅执行此子图」或「导出为模板」（G-003）。
          </div>
          <div class="v8-group-actions">
            <button class="v8-btn-small" @click.stop="emitSubgraphAction('execute')">
              仅执行此子图 (G-003)
            </button>
            <button class="v8-btn-small" @click.stop="emitSubgraphAction('export-template')">
              导出为模板（占位符）
            </button>
          </div>
        </div>
      </div>

      <!-- Context out stub (for G-002 leak control) -->
      <div class="v8-context-out">
        <Handle
          id="right-context"
          type="source"
          :position="Position.Right"
          :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none', left: 'auto', right: '-5px' }"
        />
        <span class="v8-hint-small">Context 出口（显式连线才泄露）</span>
      </div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-group {
  padding: 8px 10px;
  min-height: 120px;
  border: 2px dashed #f59e0b;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.06);
  position: relative;
}
.v8-group.folded {
  min-height: 90px;
  border-style: solid;
  background: rgba(245, 158, 11, 0.04);
}

.v8-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(245,158,11,0.3);
}

.v8-child-count {
  font-size: 10px;
  color: var(--ink3);
}

.v8-folded-body, .v8-expanded-body {
  margin-top: 6px;
}

.v8-port-info {
  font-size: 11px;
  margin-bottom: 4px;
}

.v8-g001-badge {
  background: #10b981;
  color: white;
  font-size: 9px;
  padding: 0 5px;
  border-radius: 3px;
  margin-left: 4px;
}

.v8-port-controls {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.v8-btn-small {
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 4px;
  cursor: pointer;
}
.v8-btn-small:disabled { opacity: 0.5; }

.v8-hint {
  font-size: 10px;
  color: var(--ink3);
  line-height: 1.4;
}

.v8-hint-small {
  font-size: 9px;
  color: var(--ink3);
  position: absolute;
  bottom: -14px;
  right: 4px;
  white-space: nowrap;
}

.v8-context-out {
  position: absolute;
  right: 4px;
  top: 50%;
}

.v8-group-container {
  border: 2px dashed #f59e0b;
  border-radius: 6px;
  padding: 12px;
  min-height: 60px;
  background: rgba(245, 158, 11, 0.03);
  margin-top: 6px;
}

.v8-group-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>
