<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import CanvasNodeHeader from './shared/CanvasNodeHeader.vue'
import type { CanvasGroupNodeData } from '@/types/canvas'

defineProps<{ id: string; data: CanvasGroupNodeData; selected?: boolean }>()
</script>

<template>
  <div class="cv-group" :class="{ selected }" :style="{ width: (data.width || 460) + 'px', height: (data.height || 300) + 'px' }">
    <Handle type="target" :position="Position.Left" />
    <CanvasNodeHeader :id="id" type="group" icon="folder_open" :label="data.label" :status="data.status" />
    <div class="cv-group-body">
      <span>把相关节点拖到这个区域附近，作为章节、镜头组或工具链分组。</span>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.cv-group { min-width:280px; min-height:160px; border:1px dashed var(--olive-dark); background:color-mix(in srgb, var(--olive-pale) 42%, transparent); border-radius:8px; color:var(--ink1); overflow:visible; }
.cv-group.selected { box-shadow:0 0 0 2px var(--olive-pale), var(--jc-shadow-sm); }
.cv-group-body { height:calc(100% - 34px); display:flex; align-items:flex-start; padding:10px; pointer-events:none; }
.cv-group-body span { font-size:12px; color:var(--ink3); }
</style>
