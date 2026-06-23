<template>
  <div v-if="visible" class="mp-overlay" @click.self="close">
    <div class="mp-panel" :style="{ left: position.x + 'px', top: position.y + 'px' }">
      <input v-if="showSearch" v-model="searchQuery" ref="searchInput" class="mp-search" placeholder="搜索节点..." @keydown="handleKeydown" @keydown.escape="close" />
      <div class="mp-list" v-if="filteredNodes.length > 0">
        <div v-for="(node, idx) in filteredNodes" :key="node.id" class="mp-item" :class="{ active: idx === selectedIndex }" @click="selectNode(node)" @mouseenter="selectedIndex = idx">
          <span class="mp-item-icon">{{ node.type === 'image' || node.type === 'imageResult' ? '🖼️' : node.type === 'video' || node.type === 'videoResult' ? '🎬' : '📝' }}</span>
          <div class="mp-item-info">
            <span class="mp-item-label">{{ nodeLabel(node) }}</span>
            <span class="mp-item-id">{{ node.id.slice(-8) }}</span>
          </div>
        </div>
      </div>
      <div v-else class="mp-empty">没有可引用的节点</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'

interface NodeItem {
  id: string
  type: string
  data?: Record<string, any>
}

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  context?: string
  showSearch?: boolean
  connectedNodeIds?: string[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  select: [payload: { nodeId: string }]
}>()

const searchQuery = ref('')
const selectedIndex = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)

// 从 canvasStore 获取可用节点（简化：通过注入或全局事件）
const allNodes = ref<NodeItem[]>([])
function refreshNodes() {
  try {
    const store = (window as any).__canvasStore__
    if (store?.nodes) allNodes.value = store.nodes.value || []
  } catch { /* ignore */ }
}

// 每次打开时刷新
watch(() => props.visible, (v) => {
  if (v) {
    refreshNodes()
    searchQuery.value = ''
    selectedIndex.value = 0
    nextTick(() => searchInput.value?.focus())
  }
})

// 可引用的目标类型
const targetTypes = computed(() => props.context === 'llmConfig' ? ['text'] : ['imageResult', 'image'])

const availableNodes = computed(() => {
  return allNodes.value.filter(n => {
    if (!targetTypes.value.includes(n.type)) return false
    if (props.connectedNodeIds?.length) return props.connectedNodeIds.includes(n.id)
    return true
  })
})

const filteredNodes = computed(() => {
  if (!searchQuery.value) return availableNodes.value
  const q = searchQuery.value.toLowerCase()
  return availableNodes.value.filter(n => {
    const label = (n.data?.label || '').toLowerCase()
    return label.includes(q) || n.id.toLowerCase().includes(q)
  })
})

const nodeLabel = (n: NodeItem) => n.data?.label || n.data?.publicProps?.name || n.id.slice(-8)

const close = () => { emit('update:visible', false) }

const selectNode = (node: NodeItem) => {
  emit('select', { nodeId: node.id })
  close()
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex.value = Math.min(selectedIndex.value + 1, filteredNodes.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex.value = Math.max(selectedIndex.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); if (filteredNodes.value[selectedIndex.value]) selectNode(filteredNodes.value[selectedIndex.value]) }
}
</script>

<style scoped>
.mp-overlay { position: fixed; inset: 0; z-index: 9999; }
.mp-panel { position: fixed; width: 220px; max-height: 240px; background: var(--paper); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--jc-shadow-lg); overflow: hidden; display: flex; flex-direction: column; }
.mp-search { width: 100%; border: none; border-bottom: 1px solid var(--border); padding: 8px 10px; font-size: 12px; outline: none; background: var(--paper); color: var(--ink); font-family: var(--jc-font-body); }
.mp-list { flex: 1; overflow-y: auto; padding: 4px; }
.mp-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; cursor: pointer; transition: background 0.1s; }
.mp-item:hover, .mp-item.active { background: var(--surface-alt); }
.mp-item-icon { font-size: 16px; flex-shrink: 0; }
.mp-item-info { flex: 1; min-width: 0; }
.mp-item-label { display: block; font-size: 12px; color: var(--ink); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-item-id { font-size: 10px; color: var(--ink3); }
.mp-empty { padding: 16px; text-align: center; font-size: 12px; color: var(--ink3); }
</style>
