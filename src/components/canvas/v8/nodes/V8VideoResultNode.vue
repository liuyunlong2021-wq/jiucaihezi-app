<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
const props = defineProps<{id:string;data?:any;selected?:boolean}>()
const node={id:props.id,data:props.data}
const {onResizeHandlePointerDown}=useV8NodeBehavior(node as any,{})
const url=computed(()=>props.data?.url||'')
</script>
<template>
  <NodeFrame :id="id" label="视频结果" icon="movie" role="result" :selected="selected" :executable="false" @delete="$emit('delete',$event)" @resize-start="onResizeHandlePointerDown">
    <Handle id="left" type="target" :position="Position.Left" :style="{background:'#6b7280',width:10,height:10,border:'none'}"/>
    <div class="v8-result gallery">
      <video v-if="url" :src="url" controls style="max-width:100%;border-radius:6px"/>
      <div v-else class="v8-gallery-placeholder">视频结果</div>
    </div>
  </NodeFrame>
</template>
<style scoped>
.v8-result {
  padding: 8px;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border-radius: 4px;
}
.v8-gallery-placeholder {
  color: var(--ink3);
  font-size: 11px;
  text-align: center;
}
</style>