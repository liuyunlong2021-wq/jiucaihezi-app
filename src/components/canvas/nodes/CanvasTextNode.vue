<script setup lang="ts">
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const size = ref({ w: 260, h: undefined as number | undefined })

const text = computed({
  get: () => props.data?.prompt || '',
  set: (v) => canvasStore.updateNodeData(props.id, { prompt: v }),
})
</script>

<template>
  <div class="tx" :class="{ sel: selected }" :style="{ width: size.w + 'px', height: size.h ? size.h + 'px' : 'auto', minWidth: '220px' }">
    <Handle type="source" :position="Position.Right" :style="{ background: '#38bdf8', border: 'none', width: 10, height: 10 }" />
    <!-- 头部 -->
    <div class="tx-hd">
      <div class="tx-hd-ic" style="background:rgba(14,165,233,.18);color:#7dd3fc;box-shadow:inset 0 0 0 1px rgba(14,165,233,.4)">
        <span class="mso" style="font-size:13px">notes</span>
      </div>
      <div class="tx-hd-lb">文本</div>
      <div class="tx-hd-tag">prompt</div>
    </div>
    <!-- Body -->
    <div class="tx-bd" :class="{ 'tx-bd-fix': size.h }">
      <textarea
        v-model="text"
        class="tx-ta"
        :class="{ 'tx-ta-fill': size.h }"
        placeholder="输入提示词..."
        spellcheck="false"
        @mousedown.stop
      />
      <div class="tx-ft">
        <span>{{ text.length }} 字符</span>
        <span>→ 输出到下游节点</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tx { border:2px solid var(--border); border-radius:12px; background:var(--paper); box-shadow:var(--jc-shadow-sm); color:var(--ink1); transition:border-color .15s; display:flex; flex-direction:column; }
.tx.sel { border-color:#38bdf8; box-shadow:0 0 20px rgba(56,189,248,.2); }
.tx-hd { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border2); }
.tx-hd-ic { width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.tx-hd-lb { flex:1; font-size:13px; font-weight:600; }
.tx-hd-tag { font-size:10px; color:var(--ink3); }
.tx-bd { padding:10px; display:flex; flex-direction:column; }
.tx-bd-fix { flex:1; min-height:0; }
.tx-ta { width:100%; resize:none; border-radius:6px; border:1px solid var(--border); background:var(--surface); color:var(--ink1); padding:6px 8px; font-size:12px; outline:none; font:inherit; min-height:96px; }
.tx-ta:focus { border-color:#38bdf8; }
.tx-ta-fill { flex:1; min-height:72px; }
.tx-ft { display:flex; justify-content:space-between; font-size:10px; color:var(--ink3); margin-top:4px; }
</style>
