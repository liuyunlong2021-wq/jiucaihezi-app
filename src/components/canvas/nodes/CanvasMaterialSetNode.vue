<script setup lang="ts">
/**
 * MaterialSetNode - 媒体素材集合节点
 * 
 * 功能：
 * - 收集多个媒体资产（图片/视频/音频）
 * - 支持从上游拖入素材（useMaterialDropTarget）
 * - 支持手动清空
 * - 输出统一 CanvasMediaAsset[] 供下游使用
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { useMaterialDropTarget } from '@/canvas/composables/useMaterialDropTarget'
import type { MaterialPayload } from '@/stores/canvasDragMaterialStore'
import type { Material } from '@/canvas/composables/useUpstreamMaterials'
import type { CanvasMediaAsset } from '@/canvas/types/mediaAsset'
import { createMediaAssetFromLegacy } from '@/canvas/types/mediaAsset'
import MaterialThumbnail from '@/components/canvas/shared/MaterialThumbnail.vue'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const canvasStore = useCanvasStore()

const assets = computed<CanvasMediaAsset[]>(() => {
  const d = props.data || {}
  if (Array.isArray(d.assets) && d.assets.length > 0) {
    // Prefer new format
    return d.assets.map((item: any) => normalizeToAsset(item)).filter(Boolean) as CanvasMediaAsset[]
  }
  // 兼容旧格式（逐步废弃）
  if (Array.isArray(d.items)) {
    return d.items.map((url: string, i: number) => ({
      kind: inferKind(url),
      url,
      name: d.itemLabels?.[i] || `素材${i + 1}`,
      origin: 'remote' as const,
    }))
  }
  return []
})

function normalizeToAsset(item: any): CanvasMediaAsset | null {
  if (!item) return null
  if (item.kind && item.url) return item as CanvasMediaAsset
  if (typeof item === 'string') {
    return {
      kind: inferKind(item),
      url: item,
      origin: 'remote',
    }
  }
  return createMediaAssetFromLegacy(item)
}

function inferKind(url: string): CanvasMediaAsset['kind'] {
  const u = url.toLowerCase()
  if (u.endsWith('.mp4') || u.endsWith('.mov') || u.endsWith('.webm')) return 'video'
  if (u.endsWith('.mp3') || u.endsWith('.wav') || u.endsWith('.m4a')) return 'audio'
  return 'image'
}

function patch(p: any) {
  canvasStore.updateNodeData(props.id, p)
}

// Ensure we always write back to the new assets format when modifying
function setAssets(newAssets: CanvasMediaAsset[]) {
  patch({
    assets: newAssets,
    // Clear legacy fields to encourage migration to new format
    items: undefined,
    itemLabels: undefined,
  })
}

// Output for downstream nodes (always prefers the new unified format)
const outputAssets = computed<CanvasMediaAsset[]>(() => assets.value)

// Convenience: expose as the primary output for this node
const mediaAssets = outputAssets

// Clean public API for downstream nodes
const assetsForDownstream = outputAssets

// 支持拖拽接收素材
const { dropProps, isAccepting } = useMaterialDropTarget({
  id: props.id,
  accepts: ['image', 'video', 'audio'],
  onDrop: (payload: MaterialPayload) => {
    if (payload.kind === 'text') return
    const newAsset: CanvasMediaAsset = {
      kind: payload.kind,
      url: payload.url || '',
      name: payload.url?.split('/').pop() || '素材',
      origin: payload.url?.startsWith('file:') || payload.sourceNodeId ? 'local' : 'remote',
    }
    const current = assets.value
    setAssets([...current, newAsset])
  },
})

function removeAsset(index: number) {
  const current = [...assets.value]
  current.splice(index, 1)
  setAssets(current)
}

function clearAll() {
  setAssets([])
}

function toMaterial(asset: CanvasMediaAsset, index: number): Material {
  return {
    id: asset.id || `${props.id}:asset:${index}`,
    kind: asset.kind,
    url: asset.url,
    sourceNodeId: props.id,
    label: asset.name,
    name: asset.name,
    size: asset.size,
    origin: asset.origin === 'local' ? 'local' : 'upstream',
  }
}
</script>

<template>
  <div 
    class="mat-set" 
    :class="{ sel: selected, accepting: isAccepting }"
    v-bind="dropProps"
  >
    <Handle type="target" :position="Position.Left" />
    
    <div class="mat-hd">
      <div class="mat-icon">
        <span class="mso">collections</span>
      </div>
      <div class="mat-title">{{ data.label || '素材集' }}</div>
      <button v-if="assets.length" class="mat-clear" @click.stop="clearAll">清空</button>
    </div>

    <div class="mat-body">
      <div v-if="assets.length === 0" class="mat-empty">
        <span class="mso">add_photo_alternate</span>
        <div>拖入素材或从上游连接</div>
      </div>

      <div v-else class="mat-grid">
        <div 
          v-for="(asset, index) in assets" 
          :key="index" 
          class="mat-item"
        >
          <MaterialThumbnail 
            :material="toMaterial(asset, index)"
            :removable="true"
            @remove="removeAsset(index)"
          />
        </div>
      </div>

      <div class="mat-count" v-if="assets.length">
        {{ assets.length }} 个媒体 · {{ data.materialSetKind || 'mixed' }}
      </div>
    </div>

    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.mat-set {
  width: 260px;
  min-height: 120px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: var(--jc-shadow-sm);
  display: flex;
  flex-direction: column;
}
.mat-set.sel { border-color: #fb923c; }
.mat-set.accepting { border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2); }

.mat-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border2);
}
.mat-icon {
  width: 24px; height: 24px;
  background: rgba(251, 146, 60, 0.18);
  color: #fdba74;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
}
.mat-title { flex: 1; font-weight: 600; font-size: 13px; }
.mat-clear {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  background: var(--surface-alt);
  color: var(--ink3);
  cursor: pointer;
}
.mat-clear:hover { background: #ef4444; color: white; }

.mat-body { padding: 10px; flex: 1; }
.mat-empty {
  text-align: center;
  color: var(--ink3);
  font-size: 11px;
  padding: 16px 8px;
}
.mat-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mat-item { position: relative; }
.mat-count {
  margin-top: 8px;
  font-size: 10px;
  color: var(--ink3);
  text-align: right;
}
</style>
