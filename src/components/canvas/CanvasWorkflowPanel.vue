<script setup lang="ts">
import { CANVAS_WORKFLOW_TEMPLATES } from './utils/canvasWorkflows'
import { useCanvasStore } from '@/stores/canvasStore'

const emit = defineEmits<{ (e: 'close'): void }>()
const canvasStore = useCanvasStore()

function useTemplate(id: string) {
  const template = CANVAS_WORKFLOW_TEMPLATES.find(item => item.id === id)
  if (!template) return
  canvasStore.addWorkflowTemplate(template)
  emit('close')
}
</script>

<template>
  <div class="cwf" @pointerdown.stop>
    <div class="cwf-head">
      <strong>工作流模板</strong>
      <button @click="emit('close')"><JcIcon name="close" /></button>
    </div>
    <div class="cwf-grid">
      <button v-for="item in CANVAS_WORKFLOW_TEMPLATES" :key="item.id" class="cwf-card" @click="useTemplate(item.id)">
        <JcIcon :name="item.icon" />
        <span class="cwf-copy">
          <strong>{{ item.title }}</strong>
          <small>{{ item.description }}</small>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cwf { position:absolute; left:14px; top:58px; z-index:30; width:360px; max-height:calc(100% - 82px); overflow:auto; border:1px solid var(--border); border-radius:10px; background:var(--paper); box-shadow:var(--jc-shadow-lg); color:var(--ink1); }
.cwf-head { height:40px; display:flex; align-items:center; justify-content:space-between; padding:0 10px 0 12px; border-bottom:1px solid var(--border2); }
.cwf-head strong { font-size:13px; }
.cwf-head button { width:28px; height:28px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--ink2); cursor:pointer; }
.cwf-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:10px; }
.cwf-card { min-height:74px; display:flex; align-items:flex-start; gap:8px; padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--ink1); text-align:left; cursor:pointer; }
.cwf-card:hover { border-color:var(--olive-dark); background:var(--olive-pale); }
.cwf-card > .mso { font-size:20px; color:var(--olive-dark); }
.cwf-copy { min-width:0; display:flex; flex-direction:column; gap:4px; }
.cwf-copy strong { font-size:12px; }
.cwf-copy small { font-size:11px; line-height:1.35; color:var(--ink3); }
</style>
