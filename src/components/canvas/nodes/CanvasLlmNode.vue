<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useVaultStore } from '@/stores/vaultStore'
import type { CanvasLlmNodeData } from '@/types/canvas'

const props = defineProps<{
  id: string
  data: CanvasLlmNodeData
  selected?: boolean
}>()

const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const vaultStore = useVaultStore()

const textModels = computed(() => agentStore.textModels)

function patch(patch: Partial<CanvasLlmNodeData>) {
  canvasStore.updateNodeData(props.id, patch)
}

function selectModel(event: Event) {
  const modelId = (event.target as HTMLSelectElement).value
  const model = agentStore.availableModels.find(item => item.id === modelId)
  patch({ modelId, modelProviderId: model?.providerId || 'jiucaihezi' })
}
</script>

<template>
  <div class="cv-node cv-llm" :class="{ selected, running: data.status === 'running' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="llm" icon="smart_toy" :label="data.label" :status="data.status" executable />
    <div class="cv-node-body">
      <select @pointerdown.stop @mousedown.stop class="cv-input" :value="data.modelId" @change="selectModel">
        <option value="">使用当前模型</option>
        <option v-for="model in textModels" :key="model.id" :value="model.id">{{ model.label }}</option>
      </select>
      <select @pointerdown.stop @mousedown.stop class="cv-input" :value="data.agentId || ''" @change="patch({ agentId: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">不指定搭子</option>
        <option v-for="agent in agentStore.agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
      </select>
      <select @pointerdown.stop @mousedown.stop class="cv-input" :value="data.vaultId || ''" @change="patch({ vaultId: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">不绑定知识库</option>
        <option v-for="vault in vaultStore.vaults" :key="vault.id" :value="vault.id">{{ vault.name }}</option>
      </select>
      <textarea
        @pointerdown.stop @mousedown.stop
        class="cv-node-textarea"
        :value="data.prompt"
        placeholder="当前节点的补充要求..."
        @input="patch({ prompt: ($event.target as HTMLTextAreaElement).value })"
      />
      <div v-if="data.status === 'running' || data.status === 'queued'" class="cv-progress">
        {{ data.detail || data.status }} · {{ data.progress || 0 }}%
      </div>
      <div v-if="data.outputContent" class="cv-output">{{ data.outputContent }}</div>
      <div v-if="data.error" class="cv-error">{{ data.error }}</div>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-node { width: 300px; border: 1px solid var(--border); background: var(--paper); border-radius: 8px; box-shadow: var(--jc-shadow-sm); color: var(--ink1); overflow: visible; }
.cv-node.selected { border-color: var(--olive-dark); box-shadow: 0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-node.running { opacity: 0.86; }
.cv-node-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.cv-input { height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink1); padding: 0 8px; font: inherit; font-size: 12px; }
.cv-node-textarea { height: 76px; resize: vertical; border: 1px solid var(--border); border-radius: 6px; outline: 0; background: var(--surface); color: var(--ink1); padding: 8px; font: inherit; font-size: 12px; line-height: 1.5; }
.cv-output { max-height: 160px; overflow: auto; white-space: pre-wrap; padding: 8px; border-radius: 6px; background: color-mix(in srgb, var(--olive) 10%, transparent); font-size: 12px; line-height: 1.55; }
.cv-progress { font-size: 11px; color: var(--ink3); }
.cv-error { color: var(--jc-error); font-size: 12px; line-height: 1.45; }
</style>
